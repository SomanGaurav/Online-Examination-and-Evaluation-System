require('dotenv').config();

const env = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/online_exam_system',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bulkGradeLimit: Number(process.env.BULK_GRADE_LIMIT || 500),
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

if (env.nodeEnv === 'production' && env.jwtSecret === 'dev-only-insecure-secret') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
