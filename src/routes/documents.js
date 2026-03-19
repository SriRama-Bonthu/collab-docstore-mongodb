const express = require('express');
const { ObjectId } = require('mongodb');
const { generateBaseSlug, buildUniqueSlug } = require('../utils/slug');
const { normalizeAuthorShape, withLazyAuthorMigration } = require('../utils/author');

function buildRevisionDiff(prevDoc, nextInput) {
  const changed = [];
  if (prevDoc.title !== nextInput.title) {
    changed.push('title');
  }
  if (prevDoc.content !== nextInput.content) {
    changed.push('content');
  }
  if (Array.isArray(nextInput.tags)) {
    const before = JSON.stringify(prevDoc.tags || []);
    const after = JSON.stringify(nextInput.tags || []);
    if (before !== after) {
      changed.push('tags');
    }
  }

  if (changed.length === 0) {
    return 'No substantive changes';
  }

  return `Updated ${changed.join(', ')}`;
}

async function generateUniqueSlug(collection, title) {
  const base = generateBaseSlug(title);
  let attempt = 0;

  while (attempt < 25) {
    const slug = buildUniqueSlug(base, attempt === 0 ? null : attempt + 1);
    const existing = await collection.findOne({ slug }, { projection: { _id: 1 } });
    if (!existing) {
      return slug;
    }
    attempt += 1;
  }

  return `${base}-${Date.now()}`;
}

function parseTags(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }

  return String(raw)
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function publicProjection() {
  return {
    _id: 1,
    slug: 1,
    title: 1,
    content: 1,
    version: 1,
    tags: 1,
    metadata: 1,
    revision_history: 1,
  };
}

function buildDocumentRouter(db) {
  const router = express.Router();
  const collection = db.collection('documents');

  router.post('/documents', async (req, res) => {
    try {
      const { title, content, tags, authorName, authorEmail } = req.body;
      if (!title || !content || !authorName) {
        return res.status(400).json({ error: 'title, content and authorName are required' });
      }

      const slug = await generateUniqueSlug(collection, title);
      const now = new Date();
      const doc = {
        slug,
        title,
        content,
        version: 1,
        tags: parseTags(tags),
        metadata: {
          author: {
            id: null,
            name: String(authorName),
            email: authorEmail || null,
          },
          createdAt: now,
          updatedAt: now,
          wordCount: String(content).split(/\s+/).filter(Boolean).length,
        },
        revision_history: [
          {
            version: 1,
            updatedAt: now,
            authorId: null,
            contentDiff: 'Initial version',
          },
        ],
      };

      await collection.insertOne(doc);
      const inserted = await collection.findOne({ slug }, { projection: publicProjection() });
      return res.status(201).json(inserted);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/documents/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const doc = await collection.findOne({ slug }, { projection: publicProjection() });
      if (!doc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.status(200).json(withLazyAuthorMigration(doc));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.delete('/documents/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const result = await collection.deleteOne({ slug });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      return res.status(204).send();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.put('/documents/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const { title, content, tags, version, authorName, authorEmail } = req.body;

      if (!title || !content || typeof version !== 'number') {
        return res.status(400).json({ error: 'title, content and numeric version are required' });
      }

      const currentDoc = await collection.findOne({ slug }, { projection: publicProjection() });
      if (!currentDoc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      const normalizedAuthor = normalizeAuthorShape(currentDoc.metadata?.author);
      const author = {
        ...normalizedAuthor,
        name: authorName || normalizedAuthor.name,
        email: authorEmail || normalizedAuthor.email,
      };

      const now = new Date();
      const nextVersion = version + 1;
      const revisionEntry = {
        version: nextVersion,
        updatedAt: now,
        authorId: author.id,
        contentDiff: buildRevisionDiff(currentDoc, { title, content, tags }),
      };

      const updated = await collection.findOneAndUpdate(
        { slug, version },
        {
          $set: {
            title,
            content,
            tags: parseTags(tags),
            'metadata.author': author,
            'metadata.updatedAt': now,
            'metadata.wordCount': String(content).split(/\s+/).filter(Boolean).length,
          },
          $inc: { version: 1 },
          $push: {
            revision_history: {
              $each: [revisionEntry],
              $slice: -20,
            },
          },
        },
        {
          returnDocument: 'after',
          projection: publicProjection(),
        },
      );

      if (!updated) {
        const latest = await collection.findOne({ slug }, { projection: publicProjection() });
        if (!latest) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.status(409).json(withLazyAuthorMigration(latest));
      }

      return res.status(200).json(withLazyAuthorMigration(updated));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const query = String(req.query.q || '').trim();
      if (!query) {
        return res.status(400).json({ error: 'q query parameter is required' });
      }

      const tags = parseTags(req.query.tags);

      const filter = {
        $text: {
          $search: query,
        },
      };

      if (tags.length > 0) {
        filter.tags = { $all: tags };
      }

      const results = await collection.find(
        filter,
        {
          projection: {
            ...publicProjection(),
            score: { $meta: 'textScore' },
          },
        },
      ).sort({ score: { $meta: 'textScore' } }).toArray();

      return res.status(200).json(results.map(withLazyAuthorMigration));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/analytics/most-edited', async (_req, res) => {
    try {
      const pipeline = [
        {
          $project: {
            slug: 1,
            title: 1,
            editCount: { $size: { $ifNull: ['$revision_history', []] } },
          },
        },
        { $sort: { editCount: -1, slug: 1 } },
        { $limit: 10 },
      ];

      const results = await collection.aggregate(pipeline).toArray();
      return res.status(200).json(results);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/analytics/tag-cooccurrence', async (_req, res) => {
    try {
      const pipeline = [
        {
          $project: {
            tags: { $setUnion: [{ $ifNull: ['$tags', []] }, []] },
          },
        },
        { $unwind: '$tags' },
        {
          $project: {
            tags: 1,
            tagA: '$tags',
          },
        },
        { $unwind: '$tags' },
        {
          $match: {
            $expr: { $lt: ['$tagA', '$tags'] },
          },
        },
        {
          $group: {
            _id: {
              a: '$tagA',
              b: '$tags',
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            tags: ['$_id.a', '$_id.b'],
            count: 1,
          },
        },
        { $sort: { count: -1, tags: 1 } },
      ];

      const results = await collection.aggregate(pipeline).toArray();
      return res.status(200).json(results);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = buildDocumentRouter;
