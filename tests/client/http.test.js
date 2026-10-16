/**
 * The HTTP error surface.
 *
 * `ApiError` is what every screen reads when a request fails, so a fault here
 * is not confined to one screen -- it replaces the server's explanation with a
 * JavaScript error, which is the worst possible outcome for a user who was
 * being told something actionable.
 */
import { describe, expect, it } from 'vitest';

import { ApiError } from '@client/services/http.js';

describe('ApiError', () => {
  it('keeps field messages from a validation failure', () => {
    const err = new ApiError('Please correct the highlighted fields', {
      status: 422,
      code: 'VALIDATION_ERROR',
      details: [
        { field: 'quantity', message: 'Enter a non-zero quantity', code: 'custom' },
        { field: 'supplier', message: 'Choose a supplier' },
      ],
    });

    expect(err.message).toBe('Please correct the highlighted fields');
    expect(err.fields).toEqual({
      quantity: 'Enter a non-zero quantity',
      supplier: 'Choose a supplier',
    });
    expect(err.fieldErrors).toEqual(err.fields);
  });

  it('survives an object-shaped details payload', () => {
    // Regression: the domain refusals send figures, not a list of field errors.
    // Assuming an array made the constructor throw, so the operator saw
    // "details.filter is not a function" instead of the message explaining that
    // there was not enough stock or cash.
    const err = new ApiError('Insufficient stock for "mouse". Available 0, requested 3.', {
      status: 422,
      code: 'INSUFFICIENT_STOCK',
      details: { productId: 'p-1', available: 0, requested: 3 },
    });

    expect(err.message).toContain('Insufficient stock');
    expect(err.code).toBe('INSUFFICIENT_STOCK');
    expect(err.details).toEqual({ productId: 'p-1', available: 0, requested: 3 });
    expect(err.fields).toEqual({});
  });

  it('handles the overdraft refusal, which is also an object', () => {
    const err = new ApiError('Not enough cash to cover this.', {
      status: 422,
      code: 'INSUFFICIENT_FUNDS',
      details: { account: 'cash', availableMinor: 80, shortfallMinor: 119920 },
    });

    expect(err.isConflict).toBe(true);
    expect(err.details.shortfallMinor).toBe(119920);
    expect(err.fields).toEqual({});
  });

  it('tolerates missing details entirely', () => {
    expect(() => new ApiError('Boom', { status: 500 })).not.toThrow();
    const err = new ApiError('Boom', { status: 500 });
    expect(err.fields).toEqual({});
    expect(err.details).toBeNull();
  });

  it('classifies the families screens branch on', () => {
    expect(new ApiError('x', { status: 0 }).isNetworkError).toBe(true);
    expect(new ApiError('x', { status: 401 }).isUnauthorized).toBe(true);
    expect(new ApiError('x', { status: 403 }).isForbidden).toBe(true);
    expect(new ApiError('x', { status: 409 }).isConflict).toBe(true);
    expect(new ApiError('x', { status: 422 }).isConflict).toBe(true);
    expect(new ApiError('x', { status: 500 }).isConflict).toBe(false);
  });
});