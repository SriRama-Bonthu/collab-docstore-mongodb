const dotenv = require('dotenv');

dotenv.config();

const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
  databaseName: process.env.DATABASE_NAME || 'collab_docstore',
  seedDocumentCount: Number(process.env.SEED_DOCUMENT_COUNT || 10000),
};

module.exports = config;
