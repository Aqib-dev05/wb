import { isProd } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

export const notFoundHandler = (req, _res, next) => next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message;
  let details = err.details;

  if (err.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'That value is already in use';
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid identifier';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  }

  if (status >= 500) {
    console.error(err);
    if (isProd) message = 'Something went wrong on our side';
  }

  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}
