import mongoose from 'mongoose';
import {
  guard,
  queryOption,
  queryUpdate,
  sanitized,
  searchRegex,
  softDelete,
  tenantScope,
  updatedFields,
} from './plugins.js';
import { UNITS_OF_MEASURE } from '../../../shared/constants.js';
import ProductCategory from './ProductCategory.js';

const { Schema } = mongoose;

/**
 * Units whose quantity must always be a whole number. Continuous units
 * (kg, litre, metre) allow three decimal places.
 */
export const DISCRETE_UNITS = new Set(['pcs', 'box', 'pack', 'dozen', 'pair', 'set', 'bag', 'roll', 'service', 'hour']);

/**
 * An inventory item.
 *
 * MONEY: `costPriceMinor`, `sellingPriceMinor` and `averageCostMinor` are
 * integers in the currency's minor unit. Floating point never touches a price.
 *
 * STOCK: `stockQuantity` is mutated only by the stock service, which always
 * writes a StockMovement row beside it. `stockVersion` provides optimistic
 * concurrency so a concurrent writer is rejected rather than silently lost.
 */
const productSchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 160 },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
    barcode: { type: String, trim: true, maxlength: 64, default: '' },
    hsnCode: { type: String, trim: true, maxlength: 24, default: '' },

    category: { type: Schema.Types.ObjectId, ref: 'ProductCategory', default: null, index: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },

    description: { type: String, trim: true, maxlength: 1000, default: '' },
    unit: { type: String, enum: UNITS_OF_MEASURE, default: 'pcs' },
    imageUrl: { type: String, trim: true, maxlength: 500, default: null },

    // ---- MONEY: integer minor units --------------------------------------
    costPriceMinor: { type: Number, required: true, min: 0, default: 0 },
    sellingPriceMinor: { type: Number, required: true, min: 0, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },

    // ---- STOCK ------------------------------------------------------------
    stockQuantity: { type: Number, required: true, default: 0 },
    minStockLevel: { type: Number, min: 0, default: 0 },
    maxStockLevel: { type: Number, min: 0, default: null },
    /** Weighted average cost, recomputed on every purchase receipt. */
    averageCostMinor: { type: Number, min: 0, default: 0 },
    /** Bumped on every stock mutation; the optimistic-concurrency token. */
    stockVersion: { type: Number, default: 0 },

    isTrackable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    archivedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// SKU and barcode are unique *within a business*, never globally.
productSchema.index(
  { business: 1, sku: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_sku_unique' }
);
productSchema.index(
  { business: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null, barcode: { $type: 'string', $gt: '' } },
    name: 'business_barcode_unique',
  }
);
productSchema.index(
  { business: 1, name: 'text', sku: 'text', description: 'text', barcode: 'text' },
  { name: 'business_product_text', weights: { name: 10, sku: 8, barcode: 8, description: 2 } }
);
productSchema.index({ business: 1, isActive: 1, createdAt: -1 });
productSchema.index({ business: 1, category: 1, isActive: 1 });
productSchema.index({ business: 1, stockQuantity: 1, minStockLevel: 1 });

productSchema.virtual('marginMinor').get(function marginMinor() {
  return (this.sellingPriceMinor ?? 0) - (this.costPriceMinor ?? 0);
});

productSchema.virtual('marginPercent').get(function marginPercent() {
  if (!this.sellingPriceMinor) return 0;
  return Math.round(((this.marginMinor / this.sellingPriceMinor) * 100 + Number.EPSILON) * 100) / 100;
});

/** Low-stock classification is derived, never stored, so it can never go stale. */
productSchema.virtual('stockStatus').get(function stockStatus() {
  if (!this.isActive || this.archivedAt) return 'archived';
  if (!this.isTrackable) return 'not_tracked';
  if (this.stockQuantity <= 0) return 'out_of_stock';
  if (this.minStockLevel > 0 && this.stockQuantity <= this.minStockLevel) return 'low_stock';
  return 'in_stock';
});

productSchema.virtual('stockValueMinor').get(function stockValueMinor() {
  return Math.round((this.stockQuantity ?? 0) * (this.averageCostMinor ?? this.costPriceMinor ?? 0));
});

productSchema.pre('validate', function validateProduct(next) {
  if (this.barcode === undefined) this.barcode = '';
  // Discrete units must hold whole numbers.
  if (DISCRETE_UNITS.has(this.unit)) {
    const rounded = Math.round(this.stockQuantity);
    if (Math.abs(this.stockQuantity - rounded) > 1e-9) {
      return next(new Error(`Stock for unit "${this.unit}" must be a whole number`));
    }
    this.stockQuantity = rounded;
  }
  return next();
});

/**
 * Stock integrity guard.
 *
 * `stockQuantity` may only be changed by the stock service, which always:
 *   - bumps `stockVersion` (its optimistic-concurrency token), and
 *   - writes the matching StockMovement ledger row.
 *
 * Any other write is rejected, so stock can never move silently. The same hook
 * refuses negative stock unless the business has explicitly opted in.
 */
const STOCK_FIELDS = ['stockQuantity'];

function guardStockWrite(update, options) {
  if (!update || typeof update !== 'object') return undefined;

  const fields = updatedFields(update);
  const touchesStock = STOCK_FIELDS.some((f) => fields.has(f));
  if (!touchesStock) return undefined;

  const versionBumped = Boolean(update.$inc && typeof update.$inc.stockVersion === 'number');
  if (!versionBumped) {
    return new Error(
      'stockQuantity can only be changed through the stock service so a movement is always recorded'
    );
  }

  // The service computes the exact resulting figure itself, so an absolute
  // value is compared only when one is supplied. The permission to go negative
  // arrives as a query option, never inside the update document.
  const absolute = update.$set?.stockQuantity;
  if (typeof absolute === 'number' && absolute < 0 && !options?.allowNegativeStock) {
    return new Error('Stock cannot go below zero');
  }

  return undefined;
}

productSchema.pre('updateOne', guard((query) => guardStockWrite(queryUpdate(query), queryOption(query, 'allowNegativeStock'))));
productSchema.pre('updateMany', guard((query) => guardStockWrite(queryUpdate(query), queryOption(query, 'allowNegativeStock'))));
productSchema.pre('findOneAndUpdate', guard((query) => guardStockWrite(queryUpdate(query), queryOption(query, 'allowNegativeStock'))));

productSchema.statics.searchByText = function searchByText(businessId, term) {
  const rx = searchRegex(term);
  if (!rx) return this.find({ business: businessId });
  return this.find({
    business: businessId,
    deletedAt: null,
    $or: [{ name: rx }, { sku: rx }, { barcode: rx }, { description: rx }],
  });
};

productSchema.plugin(tenantScope({ indexPrefix: 'product' }));
productSchema.plugin(softDelete);
sanitized(productSchema);

export const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
export { ProductCategory };
export default Product;
