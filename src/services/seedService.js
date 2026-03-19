const https = require('https');
const { XMLParser } = require('fast-xml-parser');
const { generateBaseSlug, buildUniqueSlug } = require('../utils/slug');

const WIKI_STUB_URL = 'https://en.wikipedia.org/w/index.php?title=Special:Export&pages=MongoDB|NoSQL|Concurrency_control|REST|Search_engine';

function downloadXml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Unexpected status ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

function getFallbackXml() {
  return `<?xml version="1.0"?>
<mediawiki>
  <page><title>MongoDB</title><revision><text>MongoDB is a document database used to build scalable APIs.</text></revision></page>
  <page><title>Optimistic Concurrency</title><revision><text>Optimistic concurrency control avoids lost updates in collaborative systems.</text></revision></page>
  <page><title>Full Text Search</title><revision><text>Search indexes enable text relevance ranking and keyword discovery.</text></revision></page>
  <page><title>Aggregation Pipeline</title><revision><text>Aggregation pipelines support analytics and data aggregation workflows.</text></revision></page>
  <page><title>Schema Evolution</title><revision><text>Schema evolution allows graceful migration of metadata over time.</text></revision></page>
</mediawiki>`;
}

function parseWikiPages(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(xml);
  const pageNode = parsed?.mediawiki?.page;
  if (!pageNode) {
    return [];
  }

  const pages = Array.isArray(pageNode) ? pageNode : [pageNode];

  return pages.map((p) => {
    const title = p.title || 'Untitled';
    const revision = p.revision || {};
    const text = typeof revision.text === 'string' ? revision.text : (revision.text?.['#text'] || '');
    return { title, text };
  }).filter((p) => p.text && p.title);
}

function tagsForIndex(index) {
  const tagSets = [
    ['mongodb', 'guide', 'api-design'],
    ['search', 'mongodb', 'full-text'],
    ['concurrency', 'backend', 'collaboration'],
    ['analytics', 'aggregation', 'mongodb'],
    ['schema-evolution', 'migration', 'backend'],
    ['wiki', 'content', 'knowledge-base'],
  ];
  return tagSets[index % tagSets.length];
}

function randomAuthor(index) {
  const names = ['Jane Doe', 'Alex Kim', 'Priya Singh', 'Sam Lee', 'Maria Garcia', 'Nina Patel'];
  const name = names[index % names.length];
  return {
    id: `user-${(index % 250) + 1}`,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
  };
}

function buildSeedDocuments(basePages, count) {
  const docs = [];
  const now = Date.now();

  for (let i = 0; i < count; i += 1) {
    const base = basePages[i % basePages.length];
    const title = `${base.title} ${i + 1}`;
    const content = `${base.text}\n\nSeed article number ${i + 1} for MongoDB collaborative store.`;
    const baseSlug = generateBaseSlug(title);
    const slug = buildUniqueSlug(baseSlug, i + 1);
    const author = randomAuthor(i);

    const createdAt = new Date(now - (count - i) * 1000);
    const updatedAt = new Date(createdAt.getTime() + 250);

    const useLegacyAuthor = i % 10 === 0;

    docs.push({
      slug,
      title,
      content,
      version: 1,
      tags: tagsForIndex(i),
      metadata: {
        author: useLegacyAuthor ? author.name : author,
        createdAt,
        updatedAt,
        wordCount: content.split(/\s+/).filter(Boolean).length,
      },
      revision_history: [
        {
          version: 1,
          updatedAt,
          authorId: author.id,
          contentDiff: 'Initial version',
        },
      ],
    });
  }

  return docs;
}

async function ensureIndexes(collection) {
  await collection.createIndex({ slug: 1 }, { unique: true });
  await collection.createIndex({ title: 'text', content: 'text' });
}

async function ensureSeedData(db, options = {}) {
  const collection = db.collection('documents');
  await ensureIndexes(collection);

  const existing = await collection.estimatedDocumentCount();
  if (existing > 0) {
    return { seeded: false, count: existing };
  }

  const targetCount = Number(options.count || 10000);

  let xml;
  if (options.useRemoteStub === false) {
    xml = getFallbackXml();
  } else {
    try {
      xml = await downloadXml(WIKI_STUB_URL);
    } catch (err) {
      xml = getFallbackXml();
    }
  }

  const pages = parseWikiPages(xml);
  const basePages = pages.length > 0 ? pages : parseWikiPages(getFallbackXml());
  const documents = buildSeedDocuments(basePages, targetCount);

  // Insert in chunks to avoid oversized payloads.
  const chunkSize = 1000;
  for (let i = 0; i < documents.length; i += chunkSize) {
    const chunk = documents.slice(i, i + chunkSize);
    await collection.insertMany(chunk, { ordered: false });
  }

  return { seeded: true, count: documents.length };
}

module.exports = {
  ensureSeedData,
  ensureIndexes,
  parseWikiPages,
  buildSeedDocuments,
};
