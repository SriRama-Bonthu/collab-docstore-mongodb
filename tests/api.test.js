const request = require('supertest');
const createApp = require('../src/createApp');
const { ensureIndexes, ensureSeedData } = require('../src/services/seedService');
const { FakeDb } = require('./fakeDb');

let db;
let app;

beforeAll(async () => {
  db = new FakeDb();
  app = createApp(db);
  await ensureIndexes(db.collection('documents'));
});

afterAll(async () => {});

beforeEach(async () => {
  await db.collection('documents').deleteMany({});
  await ensureIndexes(db.collection('documents'));
});

describe('Seeding and indexes', () => {
  test('ensureSeedData seeds first run and creates required indexes', async () => {
    const result = await ensureSeedData(db, { count: 1000, useRemoteStub: false });

    expect(result.seeded).toBe(true);
    expect(result.count).toBe(1000);

    const count = await db.collection('documents').countDocuments();
    expect(count).toBeGreaterThanOrEqual(1000);

    const indexes = await db.collection('documents').indexes();
    const slugIndex = indexes.find((idx) => idx.key && idx.key.slug === 1);
    const textIndex = indexes.find((idx) => idx.key && idx.key.title === 'text' && idx.key.content === 'text');

    expect(slugIndex).toBeDefined();
    expect(slugIndex.unique).toBe(true);
    expect(textIndex).toBeDefined();

    const one = await db.collection('documents').findOne({});
    expect(typeof one.slug).toBe('string');
    expect(typeof one.title).toBe('string');
    expect(typeof one.content).toBe('string');
    expect(typeof one.version).toBe('number');
    expect(Array.isArray(one.tags)).toBe(true);
    expect(typeof one.metadata).toBe('object');
    expect(Number.isNaN(new Date(one.metadata.createdAt).getTime())).toBe(false);
    expect(Number.isNaN(new Date(one.metadata.updatedAt).getTime())).toBe(false);
    expect(Array.isArray(one.revision_history)).toBe(true);
  });
});

describe('Document endpoints', () => {
  test('POST /api/documents creates a document', async () => {
    const payload = {
      title: 'Mongo Collaboration Guide',
      content: 'This page explains optimistic concurrency in mongodb.',
      tags: ['mongo', 'guide'],
      authorName: 'John Doe',
      authorEmail: 'john@example.com',
    };

    const res = await request(app).post('/api/documents').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.slug).toBeTruthy();
    expect(res.body.version).toBe(1);

    const inDb = await db.collection('documents').findOne({ slug: res.body.slug });
    expect(inDb).toBeTruthy();
    expect(inDb.title).toBe(payload.title);
  });

  test('GET /api/documents/:slug returns 200 for existing and 404 for missing', async () => {
    await db.collection('documents').insertOne({
      slug: 'seeded-doc',
      title: 'Seeded',
      content: 'Seed content',
      version: 1,
      tags: ['seed'],
      metadata: {
        author: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
        wordCount: 2,
      },
      revision_history: [],
    });

    const okRes = await request(app).get('/api/documents/seeded-doc');
    expect(okRes.status).toBe(200);
    expect(okRes.body.slug).toBe('seeded-doc');

    const notFoundRes = await request(app).get('/api/documents/does-not-exist');
    expect(notFoundRes.status).toBe(404);
  });

  test('GET /api/documents/:slug lazily migrates old author schema in response', async () => {
    await db.collection('documents').insertOne({
      slug: 'legacy-author-doc',
      title: 'Legacy',
      content: 'Old author schema content',
      version: 2,
      tags: ['migration'],
      metadata: {
        author: 'Old Author Name',
        createdAt: new Date(),
        updatedAt: new Date(),
        wordCount: 4,
      },
      revision_history: [],
    });

    const res = await request(app).get('/api/documents/legacy-author-doc');
    expect(res.status).toBe(200);
    expect(res.body.metadata.author).toEqual({
      id: null,
      name: 'Old Author Name',
      email: null,
    });
  });

  test('PUT /api/documents/:slug updates successfully with OCC when version matches', async () => {
    await db.collection('documents').insertOne({
      slug: 'occ-ok',
      title: 'Title V5',
      content: 'Body V5',
      version: 5,
      tags: ['mongo', 'guide'],
      metadata: {
        author: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
        wordCount: 2,
      },
      revision_history: [
        { version: 5, updatedAt: new Date(), authorId: 'u1', contentDiff: 'v5' },
      ],
    });

    const res = await request(app)
      .put('/api/documents/occ-ok')
      .send({
        title: 'Title V6',
        content: 'Body V6 updated',
        tags: ['mongo', 'guide'],
        version: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(6);
    expect(res.body.content).toBe('Body V6 updated');
    expect(res.body.revision_history[res.body.revision_history.length - 1].version).toBe(6);
  });

  test('PUT /api/documents/:slug returns 409 and latest doc when version is stale', async () => {
    await db.collection('documents').insertOne({
      slug: 'occ-conflict',
      title: 'Conflict',
      content: 'Current content',
      version: 5,
      tags: ['mongo'],
      metadata: {
        author: { id: 'u2', name: 'Bob', email: 'bob@example.com' },
        createdAt: new Date(),
        updatedAt: new Date(),
        wordCount: 2,
      },
      revision_history: [
        { version: 5, updatedAt: new Date(), authorId: 'u2', contentDiff: 'v5' },
      ],
    });

    const res = await request(app)
      .put('/api/documents/occ-conflict')
      .send({
        title: 'Stale write',
        content: 'Stale content',
        version: 4,
      });

    expect(res.status).toBe(409);
    expect(res.body.version).toBe(5);
    expect(res.body.content).toBe('Current content');

    const dbDoc = await db.collection('documents').findOne({ slug: 'occ-conflict' });
    expect(dbDoc.version).toBe(5);
    expect(dbDoc.content).toBe('Current content');
  });
});

describe('Search and analytics', () => {
  beforeEach(async () => {
    await db.collection('documents').insertMany([
      {
        slug: 'mongo-guide-1',
        title: 'Mongo guide basics',
        content: 'mongo mongo tutorial for collaborative editing',
        version: 1,
        tags: ['guide', 'mongo'],
        metadata: { author: { id: null, name: 'A', email: null }, createdAt: new Date(), updatedAt: new Date(), wordCount: 6 },
        revision_history: [{ version: 1, updatedAt: new Date(), authorId: null, contentDiff: 'init' }],
      },
      {
        slug: 'mongo-guide-2',
        title: 'Advanced Mongo search',
        content: 'mongo search relevance and ranking',
        version: 1,
        tags: ['mongo', 'search'],
        metadata: { author: { id: null, name: 'B', email: null }, createdAt: new Date(), updatedAt: new Date(), wordCount: 5 },
        revision_history: [
          { version: 1, updatedAt: new Date(), authorId: null, contentDiff: 'init' },
          { version: 2, updatedAt: new Date(), authorId: null, contentDiff: 'edit' },
          { version: 3, updatedAt: new Date(), authorId: null, contentDiff: 'edit' },
        ],
      },
      {
        slug: 'python-tips',
        title: 'Python API',
        content: 'fastapi backend tips',
        version: 1,
        tags: ['python', 'guide'],
        metadata: { author: { id: null, name: 'C', email: null }, createdAt: new Date(), updatedAt: new Date(), wordCount: 3 },
        revision_history: [{ version: 1, updatedAt: new Date(), authorId: null, contentDiff: 'init' }],
      },
      {
        slug: 'tag-pair-1',
        title: 'Aggregation with mongo',
        content: 'aggregation mongodb api design',
        version: 1,
        tags: ['mongodb', 'api-design', 'guide'],
        metadata: { author: { id: null, name: 'D', email: null }, createdAt: new Date(), updatedAt: new Date(), wordCount: 4 },
        revision_history: [{ version: 1, updatedAt: new Date(), authorId: null, contentDiff: 'init' }],
      },
      {
        slug: 'tag-pair-2',
        title: 'Mongo api design',
        content: 'mongodb api-design patterns',
        version: 1,
        tags: ['mongodb', 'api-design'],
        metadata: { author: { id: null, name: 'E', email: null }, createdAt: new Date(), updatedAt: new Date(), wordCount: 3 },
        revision_history: [{ version: 1, updatedAt: new Date(), authorId: null, contentDiff: 'init' }],
      },
    ]);
  });

  test('GET /api/search returns results with score sorted by relevance', async () => {
    const res = await request(app).get('/api/search?q=mongo');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    for (const doc of res.body) {
      expect(doc.score).toBeDefined();
      expect(typeof doc.score).toBe('number');
    }

    for (let i = 1; i < res.body.length; i += 1) {
      expect(res.body[i - 1].score).toBeGreaterThanOrEqual(res.body[i].score);
    }
  });

  test('GET /api/search supports tags filter requiring all tags', async () => {
    const res = await request(app).get('/api/search?q=mongo&tags=guide,mongo');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);

    for (const doc of res.body) {
      expect(doc.tags).toEqual(expect.arrayContaining(['guide', 'mongo']));
      expect(`${doc.title} ${doc.content}`.toLowerCase()).toContain('mongo');
    }

    const hasWrongDoc = res.body.some((d) => d.slug === 'mongo-guide-2');
    expect(hasWrongDoc).toBe(false);
  });

  test('GET /api/analytics/most-edited returns top items by edit count', async () => {
    const res = await request(app).get('/api/analytics/most-edited');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
    expect(res.body[0].slug).toBe('mongo-guide-2');
    expect(res.body[0].editCount).toBe(3);
  });

  test('GET /api/analytics/tag-cooccurrence returns correct pair counts', async () => {
    const res = await request(app).get('/api/analytics/tag-cooccurrence');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const target = res.body.find((item) =>
      Array.isArray(item.tags)
      && item.tags[0] === 'api-design'
      && item.tags[1] === 'mongodb');

    expect(target).toBeDefined();
    expect(target.count).toBe(2);
  });
});
