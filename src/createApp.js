const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const buildDocumentRouter = require('./routes/documents');

function createApp(db) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('tiny'));

  app.get('/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      return res.status(500).json({ status: 'error', message: err.message });
    }
  });

  app.use('/api', buildDocumentRouter(db));

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = createApp;
