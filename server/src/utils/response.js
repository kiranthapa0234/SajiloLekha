/**
 * Consistent API response envelope.
 *
 * Success: { success: true, data, meta? }
 * Failure: { success: false, error: { code, message, details? } }
 *
 * The third argument to `sendOk`/`sendCreated` IS the meta object (pagination,
 * summaries, messages), which is why every list endpoint can return `meta`
 * without ceremony.
 */

export function sendOk(res, data, meta, status = 200) {
  const body = { success: true, data };
  if (meta && Object.keys(meta).length > 0) body.meta = meta;
  return res.status(status).json(body);
}

export function sendCreated(res, data, meta) {
  return sendOk(res, data, meta, 201);
}

export function sendNoContent(res) {
  return res.status(204).end();
}

/** Standard list metadata. */
export function pageMeta({ page, limit, total, pages, extra = {} }) {
  return {
    page,
    limit,
    total,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1,
    ...extra,
  };
}

/** Pagination helper used by every list controller. */
export function paginate(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
}
