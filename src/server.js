const config = require('./config');
const { connectToDb } = require('./db');
const { ensureSeedData } = require('./services/seedService');
const createApp = require('./createApp');

async function bootstrap() {
  const { client, db } = await connectToDb(config.mongoUri, config.databaseName);

  process.on('SIGINT', async () => {
    await client.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await client.close();
    process.exit(0);
  });

  const seedResult = await ensureSeedData(db, { count: config.seedDocumentCount });
  if (seedResult.seeded) {
    // Keep startup logging concise and informative for first-run bootstraps.
    console.log(`Seeded ${seedResult.count} documents`);
  }

  const app = createApp(db);
  app.listen(config.port, () => {
    console.log(`API listening on port ${config.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
