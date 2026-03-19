function clone(value) {
  return structuredClone(value);
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!cur[key] || typeof cur[key] !== 'object') {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

function matchFilter(doc, filter = {}) {
  const entries = Object.entries(filter);
  for (const [key, value] of entries) {
    if (key === '$text') {
      const q = String(value.$search || '').toLowerCase();
      const haystack = `${doc.title || ''} ${doc.content || ''}`.toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
      continue;
    }

    if (typeof value === 'object' && value !== null && '$all' in value) {
      const arr = Array.isArray(doc[key]) ? doc[key] : [];
      const needed = value.$all;
      if (!needed.every((tag) => arr.includes(tag))) {
        return false;
      }
      continue;
    }

    if (typeof value === 'object' && value !== null && '$type' in value) {
      const current = getByPath(doc, key);
      if (value.$type === 'string' && typeof current !== 'string') {
        return false;
      }
      continue;
    }

    const current = key.includes('.') ? getByPath(doc, key) : doc[key];
    if (current !== value) {
      return false;
    }
  }

  return true;
}

function applyProjection(doc, projection = {}, score) {
  if (!projection || Object.keys(projection).length === 0) {
    return clone(doc);
  }

  const result = {};
  for (const [field, include] of Object.entries(projection)) {
    if (field === 'score' && include && include.$meta === 'textScore') {
      result.score = score;
      continue;
    }

    if (include) {
      result[field] = clone(field.includes('.') ? getByPath(doc, field) : doc[field]);
    }
  }
  return result;
}

function textScore(doc, query) {
  const target = `${doc.title || ''} ${doc.content || ''}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    const matches = target.match(new RegExp(word, 'g'));
    score += matches ? matches.length : 0;
  }
  return score;
}

class FakeCursor {
  constructor(items) {
    this.items = items;
  }

  sort(spec = {}) {
    const keys = Object.keys(spec);
    if (keys.length === 1 && keys[0] === 'score') {
      this.items.sort((a, b) => b.score - a.score);
      return this;
    }

    this.items.sort((a, b) => {
      for (const key of keys) {
        const direction = spec[key];
        if (a[key] < b[key]) {
          return direction < 0 ? 1 : -1;
        }
        if (a[key] > b[key]) {
          return direction < 0 ? -1 : 1;
        }
      }
      return 0;
    });
    return this;
  }

  async toArray() {
    return clone(this.items);
  }
}

class FakeCollection {
  constructor() {
    this.docs = [];
    this.indexSpecs = [{ name: '_id_', key: { _id: 1 } }];
    this.nextId = 1;
  }

  async createIndex(key, options = {}) {
    const name = Object.entries(key)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    this.indexSpecs.push({ name, key: clone(key), ...clone(options) });
    return name;
  }

  async indexes() {
    return clone(this.indexSpecs);
  }

  async estimatedDocumentCount() {
    return this.docs.length;
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matchFilter(d, filter)).length;
  }

  async insertOne(doc) {
    const toInsert = clone(doc);
    if (!toInsert._id) {
      toInsert._id = `fake-${this.nextId}`;
      this.nextId += 1;
    }
    this.docs.push(toInsert);
    return { insertedId: toInsert._id };
  }

  async insertMany(docs) {
    for (const doc of docs) {
      await this.insertOne(doc);
    }
    return { insertedCount: docs.length };
  }

  async findOne(filter = {}, options = {}) {
    const found = this.docs.find((d) => matchFilter(d, filter));
    if (!found) {
      return null;
    }
    return applyProjection(found, options.projection || {});
  }

  async deleteOne(filter = {}) {
    const idx = this.docs.findIndex((d) => matchFilter(d, filter));
    if (idx < 0) {
      return { deletedCount: 0 };
    }
    this.docs.splice(idx, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    if (Object.keys(filter).length === 0) {
      const deleted = this.docs.length;
      this.docs = [];
      return { deletedCount: deleted };
    }

    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchFilter(d, filter));
    return { deletedCount: before - this.docs.length };
  }

  find(filter = {}, options = {}) {
    const q = filter.$text ? String(filter.$text.$search || '') : null;

    let results = this.docs
      .filter((d) => matchFilter(d, filter))
      .map((d) => {
        const score = q ? textScore(d, q) : undefined;
        return applyProjection(d, options.projection || {}, score);
      });

    if (q) {
      results = results.filter((r) => typeof r.score === 'number' && r.score > 0);
    }

    return new FakeCursor(results);
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const idx = this.docs.findIndex((d) => matchFilter(d, filter));
    if (idx < 0) {
      return null;
    }

    const doc = this.docs[idx];

    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.includes('.')) {
          setByPath(doc, key, clone(value));
        } else {
          doc[key] = clone(value);
        }
      }
    }

    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        doc[key] = (doc[key] || 0) + value;
      }
    }

    if (update.$push) {
      for (const [key, op] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[key])) {
          doc[key] = [];
        }
        if (op && op.$each) {
          doc[key].push(...clone(op.$each));
        } else {
          doc[key].push(clone(op));
        }
        if (op && typeof op.$slice === 'number' && op.$slice < 0) {
          const keep = Math.abs(op.$slice);
          doc[key] = doc[key].slice(Math.max(doc[key].length - keep, 0));
        }
      }
    }

    this.docs[idx] = doc;
    return applyProjection(doc, options.projection || {});
  }

  aggregate(pipeline) {
    const hasEditCount = pipeline.some((stage) => stage.$project && stage.$project.editCount);
    if (hasEditCount) {
      const limitStage = pipeline.find((stage) => stage.$limit);
      const limit = limitStage ? limitStage.$limit : 10;
      const docs = this.docs
        .map((d) => ({
          slug: d.slug,
          title: d.title,
          editCount: Array.isArray(d.revision_history) ? d.revision_history.length : 0,
        }))
        .sort((a, b) => (b.editCount - a.editCount) || a.slug.localeCompare(b.slug))
        .slice(0, limit);
      return new FakeCursor(docs);
    }

    const hasCooccurrence = pipeline.some((stage) => stage.$group && stage.$group._id && stage.$group._id.a);
    if (hasCooccurrence) {
      const counts = new Map();
      for (const d of this.docs) {
        const tags = Array.from(new Set(Array.isArray(d.tags) ? d.tags : [])).sort();
        for (let i = 0; i < tags.length; i += 1) {
          for (let j = i + 1; j < tags.length; j += 1) {
            const key = `${tags[i]}||${tags[j]}`;
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }

      const docs = Array.from(counts.entries())
        .map(([key, count]) => {
          const [a, b] = key.split('||');
          return { tags: [a, b], count };
        })
        .sort((x, y) => (y.count - x.count) || x.tags.join(',').localeCompare(y.tags.join(',')));

      return new FakeCursor(docs);
    }

    return new FakeCursor([]);
  }

  async bulkWrite(operations) {
    let modifiedCount = 0;

    for (const op of operations) {
      if (op.updateOne) {
        const { filter, update } = op.updateOne;
        const idx = this.docs.findIndex((d) => matchFilter(d, filter));
        if (idx >= 0) {
          if (update.$set) {
            for (const [key, value] of Object.entries(update.$set)) {
              if (key.includes('.')) {
                setByPath(this.docs[idx], key, clone(value));
              } else {
                this.docs[idx][key] = clone(value);
              }
            }
          }
          modifiedCount += 1;
        }
      }
    }

    return { modifiedCount };
  }
}

class FakeDb {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new FakeCollection());
    }
    return this.collections.get(name);
  }

  async command() {
    return { ok: 1 };
  }
}

module.exports = {
  FakeDb,
};
