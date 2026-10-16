import mongoose from 'mongoose';
import { sanitized, softDelete, tenantScope } from './plugins.js';

const { Schema } = mongoose;

/**
 * Product categories are per-business and soft-deletable. Archiving a category
 * detaches its products (set to uncategorised) rather than deleting anything,
 * so historical sales keep their category reference intact.
 */
const productCategorySchema = new Schema(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, trim: true, maxlength: 24, default: '' },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    parent: { type: Schema.Types.ObjectId, ref: 'ProductCategory', default: null },
    color: { type: String, trim: true, default: '#7657E8' },
    icon: { type: String, trim: true, maxlength: 40, default: 'Package' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Category names are unique within a business, not globally.
productCategorySchema.index(
  { business: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, name: 'business_category_name_unique' }
);
productCategorySchema.index({ business: 1, isActive: 1, sortOrder: 1, name: 1 });

productCategorySchema.plugin(tenantScope({ indexPrefix: 'cat' }));
productCategorySchema.plugin(softDelete);
sanitized(productCategorySchema);

export const ProductCategory =
  mongoose.models.ProductCategory || mongoose.model('ProductCategory', productCategorySchema);
export default ProductCategory;
