const mongoose = require('mongoose');
const ApiError = require('./ApiError');

function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload?.[field];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    throw ApiError.badRequest('Missing required fields', { missing });
  }
}

function toObjectId(value, label = 'id') {
  if (!mongoose.isValidObjectId(value)) {
    throw ApiError.badRequest(`Invalid ${label}`, { value });
  }
  return new mongoose.Types.ObjectId(String(value));
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.min(Math.max(num, min), max);
}

function parsePagination(query, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = clampNumber(query.limit || defaultLimit, 1, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { requireFields, toObjectId, clampNumber, parsePagination };
