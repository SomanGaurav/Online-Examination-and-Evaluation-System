const env = require('../config/env');
const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
}

/* eslint-disable-next-line no-unused-vars */
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    message = 'Validation failed';
    details = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value';
    details = err.keyValue;
  }

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    ok: false,
    error: { message, details, ...(env.nodeEnv === 'development' ? { stack: err.stack } : {}) },
  });
}

module.exports = { notFound, errorHandler };
