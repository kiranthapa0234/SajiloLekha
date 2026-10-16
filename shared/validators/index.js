/**
 * Single entry point for the validation layer.
 * The SAME schema objects are used by the React Hook Form resolvers on the
 * client and by the Express `validate()` middleware on the server.
 */
export { z } from 'zod';
export * from './primitives.js';
export * from './schemas.js';
