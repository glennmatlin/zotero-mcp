/**
 * Offline multi-library schema migration tests (no Zotero, no embeddings).
 * Run: npm run test:unit
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  hasMultiLibrarySchema,
  migrateSemanticDbToMultiLibrary,
  type AsyncSqlDb,
} from './migrateMultiLibrary';

function wrap(db: DatabaseSync): AsyncSqlDb {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    async run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as never[]));
    },
    async all(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    },
    async get(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as never[])) as
        | Record<string, unknown>
        | undefined;
    },
  };
}

function createLegacySchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key TEXT NOT NULL,
      chunk_id INTEGER NOT NULL,
      vector BLOB NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('zh', 'en')),
      chunk_text TEXT,
      dimensions INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      vector_int8 BLOB,
      vector_scale REAL,
      vector_norm REAL,
      UNIQUE(item_key, chunk_id)
    );
    CREATE TABLE index_status (
      item_key TEXT PRIMARY KEY,
      indexed_at INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      chunk_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      item_modified TEXT,
      attachment_modified TEXT
    );
    CREATE TABLE content_cache (
      item_key TEXT PRIMARY KEY,
      full_content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      cached_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE TABLE vectors_f32 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_key TEXT NOT NULL,
      chunk_id INTEGER NOT NULL,
      vector BLOB NOT NULL,
      UNIQUE(item_key, chunk_id)
    );
  `);
}

describe('migrateSemanticDbToMultiLibrary', () => {
  let raw: DatabaseSync;
  let db: AsyncSqlDb;
  const userLibraryID = 42;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    db = wrap(raw);
  });

  afterEach(() => {
    raw.close();
  });

  it('reports legacy schema as not multi-library', async () => {
    createLegacySchema(raw);
    assert.equal(await hasMultiLibrarySchema(db), false);
  });

  it('stamps personal library_id and preserves row counts and payloads', async () => {
    createLegacySchema(raw);
    const payload = new Uint8Array([1, 2, 3, 4]);
    raw
      .prepare(
        `INSERT INTO embeddings (item_key, chunk_id, vector, language, chunk_text, dimensions, vector_int8, vector_scale, vector_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('AAAA1111', 0, payload, 'en', 'hello chunk', 4, null, null, null);
    raw
      .prepare(
        `INSERT INTO embeddings (item_key, chunk_id, vector, language, chunk_text, dimensions)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('BBBB2222', 0, payload, 'zh', '中文', 4);
    raw
      .prepare(
        `INSERT INTO index_status (item_key, indexed_at, chunk_count, content_hash, item_modified, attachment_modified)
       VALUES (?, 100, 1, 'hash-a', '2024-01-01', '2024-01-02')`,
      )
      .run('AAAA1111');
    raw
      .prepare(
        `INSERT INTO content_cache (item_key, full_content, content_hash)
       VALUES (?, 'full text a', 'hash-a')`,
      )
      .run('AAAA1111');
    raw
      .prepare(`INSERT INTO vectors_f32 (item_key, chunk_id, vector) VALUES (?, ?, ?)`)
      .run('AAAA1111', 0, payload);

    const result = await migrateSemanticDbToMultiLibrary(db, userLibraryID);

    assert.equal(result.migrated, true);
    assert.equal(await hasMultiLibrarySchema(db), true);

    const embCount = (await db.get(`SELECT COUNT(*) AS n FROM embeddings`))!.n;
    assert.equal(embCount, 2);

    const emb = await db.all(
      `SELECT library_id, item_key, chunk_text, dimensions FROM embeddings ORDER BY item_key`,
    );
    assert.equal(emb[0].library_id, userLibraryID);
    assert.equal(emb[0].item_key, 'AAAA1111');
    assert.equal(emb[0].chunk_text, 'hello chunk');
    assert.equal(emb[1].library_id, userLibraryID);
    assert.equal(emb[1].item_key, 'BBBB2222');

    const status = (await db.get(
      `SELECT library_id, content_hash FROM index_status WHERE item_key = ?`,
      ['AAAA1111'],
    ))!;
    assert.equal(status.library_id, userLibraryID);
    assert.equal(status.content_hash, 'hash-a');

    const cache = (await db.get(
      `SELECT library_id, full_content FROM content_cache WHERE item_key = ?`,
      ['AAAA1111'],
    ))!;
    assert.equal(cache.library_id, userLibraryID);
    assert.equal(cache.full_content, 'full text a');

    const f32 = (await db.get(
      `SELECT library_id FROM vectors_f32 WHERE item_key = ? AND chunk_id = 0`,
      ['AAAA1111'],
    ))!;
    assert.equal(f32.library_id, userLibraryID);

    await db.run(
      `INSERT INTO embeddings (library_id, item_key, chunk_id, vector, language, chunk_text, dimensions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [99, 'AAAA1111', 0, payload, 'en', 'group copy', 4],
    );
    const both = (await db.get(
      `SELECT COUNT(*) AS n FROM embeddings WHERE item_key = 'AAAA1111'`,
    ))!.n;
    assert.equal(both, 2);
  });

  it('is idempotent when already multi-library', async () => {
    createLegacySchema(raw);
    await migrateSemanticDbToMultiLibrary(db, userLibraryID);
    const second = await migrateSemanticDbToMultiLibrary(db, userLibraryID);
    assert.equal(second.migrated, false);
    assert.equal(await hasMultiLibrarySchema(db), true);
  });

  it('creates multi-library tables on empty database', async () => {
    const result = await migrateSemanticDbToMultiLibrary(db, userLibraryID);
    assert.equal(result.createdFresh, true);
    assert.equal(await hasMultiLibrarySchema(db), true);
    const tables = (
      await db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    ).map((r) => r.name);
    assert.ok(tables.includes('embeddings'));
    assert.ok(tables.includes('index_status'));
    assert.ok(tables.includes('content_cache'));
    assert.ok(tables.includes('vectors_f32'));
  });
});
