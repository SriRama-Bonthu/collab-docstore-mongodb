const { MongoClient } = require('mongodb');

async function connectToDb(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);
  return { client, db };
}

module.exports = { connectToDb };
