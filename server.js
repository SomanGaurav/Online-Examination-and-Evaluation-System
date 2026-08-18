const app = require('./src/app');
const env = require('./src/config/env');
const { connectDB, disconnectDB } = require('./src/config/db');

let server;

async function start() {
  await connectDB();
  console.log(`[db] connected to ${env.mongoUri}`);

  server = app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

async function shutdown(signal) {
  console.log(`\n[api] ${signal} received, shutting down`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectDB();
  process.exit(0);
}

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled rejection', reason);
  shutdown('unhandledRejection');
});

start().catch((err) => {
  console.error('[fatal] failed to start', err);
  process.exit(1);
});
