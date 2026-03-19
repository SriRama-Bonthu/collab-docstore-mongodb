# Collaborative Document Store with MongoDB

Production-ready collaborative wiki backend with:
- MongoDB document model
- Optimistic concurrency control (OCC)
- Full-text search with relevance scoring
- Analytics aggregation pipelines
- Lazy + background schema migration
- Dockerized deployment

## Tech Stack
- Node.js 20
- Express.js
- MongoDB 7
- Docker + Docker Compose
- Jest + Supertest

## Features Implemented
- Automatic first-run database seeding (default 10,000 docs)
- Unique index on slug
- Text index on title + content
- CRUD APIs for documents
- Version-safe updates with OCC and 409 conflict handling
- Search API with optional tags filter
- Analytics endpoints:
  - Most edited documents
  - Tag co-occurrence frequency
- Lazy author schema upgrade on reads
- Batch background migration script for legacy author schema

## Project Structure
- src/server.js: app bootstrap, DB connection, startup seeding
- src/createApp.js: Express app + middleware + route mount
- src/routes/documents.js: all API endpoints
- src/services/seedService.js: index creation + data seeding
- src/utils/author.js: lazy author-shape migration helpers
- src/utils/slug.js: slug generation utilities
- scripts/migrate_author_schema.js: background schema migration script
- tests/api.test.js: end-to-end API contract tests
- tests/fakeDb.js: deterministic in-memory Mongo-like test adapter
- docker-compose.yml: API + Mongo services with healthcheck and volume
- .env.example: required environment variables

## Environment Variables
Copy .env.example into .env and adjust if needed.

Required variables:
- PORT
- MONGO_URI
- DATABASE_NAME
- SEED_DOCUMENT_COUNT

## Run Locally (Node + Local Mongo)
1. Install dependencies:
   npm install
2. Ensure MongoDB is running and reachable by MONGO_URI
3. Start API:
   npm start
4. Health check:
   GET http://localhost:3000/health

## Run with Docker (Recommended)
1. Create .env from .env.example
2. Start all services:
   docker compose up --build
3. API base URL:
   http://localhost:3000

Stop services:
- docker compose down

## Testing
Run test suite:
- npm test

Coverage includes:
- Seeding/index contract checks
- Create/get document
- OCC success and conflict paths
- Search relevance and tags filtering
- Analytics endpoints
- Lazy migration on read

## API Endpoints

### Health
- GET /health

### Documents
- POST /api/documents
- GET /api/documents/:slug
- PUT /api/documents/:slug
- DELETE /api/documents/:slug

Create document request body:
{
  "title": "string",
  "content": "string",
  "tags": ["string"],
  "authorName": "string",
  "authorEmail": "string"
}

Update document request body:
{
  "title": "string",
  "content": "string",
  "tags": ["string"],
  "version": 123,
  "authorName": "string (optional)",
  "authorEmail": "string (optional)"
}

### Search
- GET /api/search?q=<term>
- GET /api/search?q=<term>&tags=<tag1>,<tag2>

Behavior:
- Uses MongoDB text index on title/content
- Returns relevance score field
- With tags parameter, matches ALL provided tags

### Analytics
- GET /api/analytics/most-edited
- GET /api/analytics/tag-cooccurrence

## OCC Behavior
PUT /api/documents/:slug performs a version-matched atomic update:
- Success if slug + version match current document
- On success, increments version and appends revision_history
- Keeps revision_history capped at last 20 entries
- If version is stale, returns 409 with latest server document

## Schema Evolution Strategy

### Lazy Migration (On Read)
When a document has legacy schema:
- metadata.author: "Author Name"

API response transparently upgrades it to:
- metadata.author: { id: null, name: "Author Name", email: null }

### Background Migration Script
Script path:
- scripts/migrate_author_schema.js

Run:
- npm run migrate:author

What it does:
- Finds docs where metadata.author is a string
- Processes in batches (default 1000)
- Uses bulkWrite for efficient updates
- Logs migration progress

## Sample Demo Commands (PowerShell)

Create:
$body = @{
  title = "Video Demo Document"
  content = "Mongo OCC and search demo content"
  tags = @("mongo","guide")
  authorName = "Demo User"
  authorEmail = "demo@example.com"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/documents" -ContentType "application/json" -Body $body

Search:
Invoke-RestMethod "http://localhost:3000/api/search?q=mongo"
Invoke-RestMethod "http://localhost:3000/api/search?q=mongo&tags=guide"

Analytics:
Invoke-RestMethod "http://localhost:3000/api/analytics/most-edited"
Invoke-RestMethod "http://localhost:3000/api/analytics/tag-cooccurrence"

## Notes
- Seed process attempts to fetch a small Wikipedia XML stub and falls back to built-in sample XML if unavailable.
- Seed runs only when documents collection is empty.
- Mongo data persists via Docker volume.
