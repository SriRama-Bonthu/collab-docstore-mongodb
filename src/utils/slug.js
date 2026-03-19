const slugify = require('slugify');

function generateBaseSlug(title) {
  return slugify(title || 'untitled', {
    lower: true,
    strict: true,
    trim: true,
  });
}

function buildUniqueSlug(base, suffix) {
  if (!suffix) {
    return base;
  }
  return `${base}-${suffix}`;
}

module.exports = {
  generateBaseSlug,
  buildUniqueSlug,
};
