import { ApiError } from '../utils/ApiError.js';

/**
 * validate({ body, query, params }) — each entry is a zod schema.
 * Parsed (coerced/trimmed) values replace the originals so controllers only see clean input.
 */
export const validate = (schemas) => (req, _res, next) => {
  const details = [];
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) {
      details.push(...result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    } else if (key === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    } else {
      req[key] = result.data;
    }
  }
  if (details.length) return next(new ApiError(422, 'VALIDATION_ERROR', details[0].message, details));
  next();
};
