/* eslint-disable no-console */
require('dotenv').config();

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.DATABASE_NAME || 'collab_docstore';
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 1000);

async function migrate() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const db = client.db(DATABASE_NAME);
    const collection = db.collection('documents');

    let migrated = 0;
    let lastId = null;

    while (true) {
      const filter = {
        'metadata.author': { $type: 'string' },
      };

      if (lastId) {
        filter._id = { $gt: new ObjectId(lastId) };
      }

      const batch = await collection.find(filter)
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .project({ _id: 1, 'metadata.author': 1 })
        .toArray();

      if (batch.length === 0) {
        break;
      }

      const operations = batch.map((doc) => ({
        updateOne: {
          filter: {
            _id: doc._id,
            'metadata.author': { $type: 'string' },
          },
          update: {
            $set: {
              'metadata.author': {
                id: null,
                name: doc.metadata.author,
                email: null,
              },
            },
          },
        },
      }));

      const result = await collection.bulkWrite(operations, { ordered: false });
      migrated += result.modifiedCount;
      lastId = batch[batch.length - 1]._id.toString();

      console.log(`Processed batch size=${batch.length}, modified=${result.modifiedCount}, totalModified=${migrated}`);
    }

    console.log(`Migration complete. Total modified documents: ${migrated}`);
  } finally {
    await client.close();
  }
}

migrate().catch((err) => {
  console.error('Migration failed', err);
  process.exit(1);
});
