function normalizeAuthorShape(author) {
  if (typeof author === 'string') {
    return {
      id: null,
      name: author,
      email: null,
    };
  }

  if (!author || typeof author !== 'object') {
    return {
      id: null,
      name: 'Unknown',
      email: null,
    };
  }

  return {
    id: author.id ?? null,
    name: author.name ?? 'Unknown',
    email: author.email ?? null,
  };
}

function withLazyAuthorMigration(doc) {
  if (!doc) {
    return doc;
  }

  if (!doc.metadata) {
    return doc;
  }

  if (typeof doc.metadata.author !== 'string') {
    return doc;
  }

  return {
    ...doc,
    metadata: {
      ...doc.metadata,
      author: normalizeAuthorShape(doc.metadata.author),
    },
  };
}

module.exports = {
  normalizeAuthorShape,
  withLazyAuthorMigration,
};
