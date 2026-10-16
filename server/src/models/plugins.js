/**
 * Shared Mongoose plugins.
 *
 * `tenantScope` guarantees that a document can never be read or written without
 * a business in the filter. Controllers use `Model.forBusiness(ctx)`, which
 * returns a pre-bound query builder, so it is impossible to accidentally query a
 * global collection from business-scoped code paths.
 *
 * `softDelete` keeps records queryable for audit while hiding them from the
 * default read path.
 */
import mongoose from 'mongoose';

export const GONE = new mongoose.Types.ObjectId('000000000000000000000000');

/**
 * Wrap a synchronous query hook that must be able to reject.
 *
 * Mongoose's `kareem` decides how to invoke a hook from its declared arity, and
 * both naive styles break in opposite directions:
 *
 *   - `function (next) { ... }`  (arity 1) - `next` is silently bound to the
 *     FILTER, so `next(error)` just returns an object and the guard never
 *     actually guards.
 *   - `function (a, b, c) { }`   (arity 3) - matches the argument count, so
 *     Mongoose appends a callback and WAITS for it. A hook that never calls it
 *     hangs the request until it times out.
 *
 * An arity-ZERO function is invoked synchronously with no arguments and `this`
 * bound to the Query, which is unambiguous. The guard therefore THROWS, and
 * Mongoose converts a synchronous throw into a promise rejection.
 *
 * @param {(this: any, query: any) => Error | undefined} fn
 */
export function guard(fn) {
  return function guardedHook() {
    const error = fn.call(this, this);
    if (error) throw error;
  };
}

/** The update document of a query hook, or null for find/delete hooks. */
export function queryUpdate(query) {
  return query?.getUpdate?.() ?? null;
}

/** A custom option passed through `findOneAndUpdate(filter, update, options)`. */
export function queryOption(query, name) {
  return query?.getOptions?.()?.[name];
}

/**
 * Every field name an update document touches, flattened out of its operators.
 *
 * `{ $set: { quantity: 1 } }` mentions `quantity`; a naive top-level key check
 * would only see `$set` and wave the write straight through.
 *
 * @param {Record<string, any> | null} update
 * @returns {Set<string>}
 */
export function updatedFields(update) {
  const fields = new Set();
  if (!update || typeof update !== 'object') return fields;

  for (const [operator, value] of Object.entries(update)) {
    if (operator.startsWith('$')) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of Object.keys(value)) fields.add(key);
      }
    } else {
      // A replacement document (`replaceOne`) mentions its keys directly.
      fields.add(operator);
    }
  }
  return fields;
}

/**
 * Marks a schema as tenant-scoped and adds factory helpers.
 * @param {{ indexPrefix?: string, requireBusiness?: boolean }} [options]
 *   `requireBusiness: false` is for models that also record account-level
 *   events which happen before any workspace is known -- the audit log, where a
 *   failed login has no business to point at. Those rows simply never appear in
 *   a per-business listing, which is the correct behaviour.
 */
export function tenantScope(options = {}) {
  const prefix = options.indexPrefix ?? '';
  const requireBusiness = options.requireBusiness !== false;
  return function attach(schema) {
    for (const field of ['business', 'createdBy', 'updatedBy']) {
      if (schema.path(field)) schema.path(field).select({ virtuals: false });
    }

    schema.statics.forBusiness = function forBusiness(businessId) {
      return this.find({ business: businessId });
    };

    schema.statics.findOneForBusiness = function findOneForBusiness(businessId, filter = {}) {
      return this.findOne({ ...filter, business: businessId });
    };

    schema.statics.existsForBusiness = function existsForBusiness(businessId, filter = {}) {
      return this.exists({ ...filter, business: businessId });
    };

    schema.statics.countForBusiness = function countForBusiness(businessId, filter = {}) {
      return this.countDocuments({ ...filter, business: businessId });
    };

    schema.statics.aggregateForBusiness = function aggregateForBusiness(businessId, pipeline = []) {
      return this.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(businessId)) } },
        ...pipeline,
      ]);
    };

    // A tenant-scoped document can never exist without a business reference.
    if (requireBusiness) {
      schema.pre('validate', function ensureBusiness(next) {
        if (this.isNew && !this.business) {
          return next(new Error(`${this.constructor.modelName} requires a business reference`));
        }
        return next();
      });
    }

    if (prefix) {
      schema.index({ business: 1, archivedAt: 1 });
    }
  };
}

/**
 * Archival + soft deletion.
 *   - `archivedAt` set  -> hidden from active lists, still readable
 *   - `deletedAt` set   -> hidden everywhere, retained for audit/reporting
 */
export function softDelete(schema) {
  schema.index({ deletedAt: 1 });

  schema.statics.notDeleted = function notDeleted(filter = {}) {
    return this.find({ ...filter, deletedAt: null });
  };

  /** Escape hatch for administrative and reporting queries. */
  schema.query.withDeleted = function withDeleted() {
    this._mongooseOptions = { ...(this._mongooseOptions || {}), withDeleted: true };
    return this;
  };

  schema.pre(/^find/, function skipDeleted(next) {
    if (this._mongooseOptions?.withDeleted) return next();
    this.conditions = { ...(this.conditions || {}), deletedAt: null };
    return next();
  });

  schema.pre('aggregate', function skipDeletedAggregation(next) {
    if (this?._mongooseOptions?.withDeleted) return next();

    // Mongoose exposes the raw stage array as `_pipeline`; `pipeline` is a
    // getter that may compile on access. Support both shapes.
    const pipeline = Array.isArray(this._pipeline)
      ? this._pipeline
      : Array.isArray(this.pipeline)
        ? this.pipeline
        : null;
    if (!pipeline) return next();

    const match = { deletedAt: null };
    const matchStage = pipeline.find((s) => s && s.$match);
    if (matchStage) {
      // Merge into the first $match without clobbering its own conditions.
      matchStage.$match = { ...matchStage.$match, ...match };
    } else {
      pipeline.unshift({ $match: match });
    }
    return next();
  });
}

/**
 * Copy schema virtuals onto a lean (plain) result.
 *
 * Mongoose 8.24 silently IGNORES `.lean({ virtuals: true })`: the option is
 * accepted and the virtuals are simply absent. Anything read with `.lean()`
 * therefore loses `stockStatus`, `stockValueMinor`, `marginPercent`,
 * `itemCount`, `daysOverdue`, `netMinor` and friends — list and detail endpoints
 * would return rows missing the exact fields the UI renders.
 *
 * Rather than hand-computing those fields per service (and eventually
 * forgetting one), lean reads have the schema's own virtual getters evaluated
 * against the plain document.
 */
function applyVirtuals(schema, doc) {
  if (!doc || typeof doc !== 'object') return;

  for (const name of Object.keys(schema.virtuals)) {
    // A Document already resolves its own virtuals; a lean object does not.
    if (doc[name] !== undefined) continue;

    // `applyGetters()` is not usable here: in Mongoose 8 it dereferences its
    // first argument (expecting a Document), so it throws on a plain object.
    // The raw getter list is the supported way to evaluate against a scope.
    const getters = schema.virtuals[name].getters;
    if (!Array.isArray(getters) || getters.length === 0) continue;

    try {
      let value;
      for (const getter of getters) value = getter.call(doc, doc, schema.virtuals[name], doc);
      doc[name] = value;
    } catch {
      // A virtual that depends on a field excluded by the projection simply
      // stays absent, which is the correct outcome.
    }
  }
}

/**
 * Attach virtuals to query results.
 *
 * Registered WITHOUT a `{ lean: true }` filter on purpose: Mongoose does not
 * expose `lean` through `query.getOptions()`, so such a filter silently never
 * matches and the hook never runs.
 *
 * Applying it to non-lean results too is harmless — a Document already resolves
 * its virtuals through getters, so `doc[name]` is defined and the
 * already-defined guard skips it.
 */
export function leanVirtuals(schema) {
  schema.post('find', function applyFindVirtuals(docs) {
    if (Array.isArray(docs)) for (const doc of docs) applyVirtuals(schema, doc);
  });

  schema.post('findOne', function applyFindOneVirtuals(doc) {
    applyVirtuals(schema, doc);
  });
}

/** Hides sensitive and internal paths from JSON output. */
export function sanitized(schema, { remove = [], transform } = {}) {
  const hidden = ['__v', ...remove];
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform(doc, ret) {
      for (const key of hidden) delete ret[key];
      if (ret.passwordHash) delete ret.passwordHash;
      if (transform) transform(doc, ret);
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true, versionKey: false });

  // Lean reads bypass `toJSON` entirely, so virtuals are applied here instead.
  leanVirtuals(schema);
}

/** Builds a safely escaped RegExp for a search term. */
export function searchRegex(term, { caseInsensitive = true, maxLength = 120 } = {}) {
  const safe = String(term ?? '').trim().slice(0, maxLength);
  if (!safe) return null;
  const escaped = safe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, caseInsensitive ? 'i' : 'g');
}
