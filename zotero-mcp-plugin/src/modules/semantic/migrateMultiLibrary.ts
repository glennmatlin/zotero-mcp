/**
 * Pure multi-library semantic DB migration (no Zotero globals).
 * Used by VectorStore and offline unit tests (node:sqlite).
 */

export interface AsyncSqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  get(sql: string, params?: unknown[]): Promise<Record<string, unknown> | undefined>;
}

/** @deprecated alias */
export type SyncSqlDb = AsyncSqlDb;

export type MigrateResult = {
  migrated: boolean;
  createdFresh: boolean;
};

async function tableExists(db: AsyncSqlDb, name: string): Promise<boolean> {
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name],
  );
  return !!row;
}

async function hasColumn(db: AsyncSqlDb, table: string, column: string): Promise<boolean> {
  if (!await tableExists(db, table)) return false;
  // table name is controlled internally
  const cols = await db.all(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

export async function hasMultiLibrarySchema(db: AsyncSqlDb): Promise<boolean> {
  return await tableExists(db, 'embeddings') && await hasColumn(db, 'embeddings', 'library_id');
}

async function createFreshTables(db: AsyncSqlDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
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
      UNIQUE(library_id, item_key, chunk_id)
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_item ON embeddings(library_id, item_key);
    CREATE INDEX IF NOT EXISTS idx_embeddings_language ON embeddings(language);

    CREATE TABLE IF NOT EXISTS index_status (
      library_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      chunk_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      item_modified TEXT,
      attachment_modified TEXT,
      PRIMARY KEY (library_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS content_cache (
      library_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      full_content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      cached_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (library_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS vectors_f32 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      chunk_id INTEGER NOT NULL,
      vector BLOB NOT NULL,
      UNIQUE(library_id, item_key, chunk_id)
    );
    CREATE INDEX IF NOT EXISTS idx_vectors_f32_item ON vectors_f32(library_id, item_key);
  `);
}

async function migrateLegacy(db: AsyncSqlDb, userLibraryID: number): Promise<void> {
  // --- embeddings ---
  await db.exec(`
    CREATE TABLE embeddings_ml (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL,
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
      UNIQUE(library_id, item_key, chunk_id)
    );
  `);

  const embCols = (await db.all(`PRAGMA table_info(embeddings)`)).map((c) => String(c.name));
  const hasInt8 = embCols.includes('vector_int8');

  if (hasInt8) {
    await db.run(
      `INSERT INTO embeddings_ml (
        library_id, item_key, chunk_id, vector, language, chunk_text, dimensions,
        created_at, vector_int8, vector_scale, vector_norm
      )
      SELECT ?, item_key, chunk_id, vector, language, chunk_text, dimensions,
        created_at, vector_int8, vector_scale, vector_norm
      FROM embeddings`,
      [userLibraryID],
    );
  } else {
    await db.run(
      `INSERT INTO embeddings_ml (
        library_id, item_key, chunk_id, vector, language, chunk_text, dimensions, created_at
      )
      SELECT ?, item_key, chunk_id, vector, language, chunk_text, dimensions, created_at
      FROM embeddings`,
      [userLibraryID],
    );
  }
  await db.exec(`DROP TABLE embeddings`);
  await db.exec(`ALTER TABLE embeddings_ml RENAME TO embeddings`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_item ON embeddings(library_id, item_key)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_embeddings_language ON embeddings(language)`);

  // --- index_status ---
  if (await tableExists(db, 'index_status')) {
    await db.exec(`
      CREATE TABLE index_status_ml (
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        version INTEGER DEFAULT 1,
        chunk_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        item_modified TEXT,
        attachment_modified TEXT,
        PRIMARY KEY (library_id, item_key)
      );
    `);
    const isCols = (await db.all(`PRAGMA table_info(index_status)`)).map((c) => String(c.name));
    if (isCols.includes('item_modified')) {
      await db.run(
        `INSERT OR IGNORE INTO index_status_ml (
          library_id, item_key, indexed_at, version, chunk_count, content_hash,
          item_modified, attachment_modified
        )
        SELECT ?, item_key, indexed_at, version, chunk_count, content_hash,
          item_modified, attachment_modified
        FROM index_status`,
        [userLibraryID],
      );
    } else {
      await db.run(
        `INSERT OR IGNORE INTO index_status_ml (
          library_id, item_key, indexed_at, version, chunk_count, content_hash
        )
        SELECT ?, item_key, indexed_at, version, chunk_count, content_hash
        FROM index_status`,
        [userLibraryID],
      );
    }
    await db.exec(`DROP TABLE index_status`);
    await db.exec(`ALTER TABLE index_status_ml RENAME TO index_status`);
  } else {
    await db.exec(`
      CREATE TABLE index_status (
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        version INTEGER DEFAULT 1,
        chunk_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        item_modified TEXT,
        attachment_modified TEXT,
        PRIMARY KEY (library_id, item_key)
      );
    `);
  }

  // --- content_cache ---
  if (await tableExists(db, 'content_cache')) {
    await db.exec(`
      CREATE TABLE content_cache_ml (
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        full_content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        cached_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (library_id, item_key)
      );
    `);
    await db.run(
      `INSERT OR IGNORE INTO content_cache_ml (
        library_id, item_key, full_content, content_hash, cached_at
      )
      SELECT ?, item_key, full_content, content_hash, cached_at FROM content_cache`,
      [userLibraryID],
    );
    await db.exec(`DROP TABLE content_cache`);
    await db.exec(`ALTER TABLE content_cache_ml RENAME TO content_cache`);
  } else {
    await db.exec(`
      CREATE TABLE content_cache (
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        full_content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        cached_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (library_id, item_key)
      );
    `);
  }

  // --- vectors_f32 ---
  if (await tableExists(db, 'vectors_f32')) {
    await db.exec(`
      CREATE TABLE vectors_f32_ml (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        chunk_id INTEGER NOT NULL,
        vector BLOB NOT NULL,
        UNIQUE(library_id, item_key, chunk_id)
      );
    `);
    await db.run(
      `INSERT OR IGNORE INTO vectors_f32_ml (library_id, item_key, chunk_id, vector)
       SELECT ?, item_key, chunk_id, vector FROM vectors_f32`,
      [userLibraryID],
    );
    await db.exec(`DROP TABLE vectors_f32`);
    await db.exec(`ALTER TABLE vectors_f32_ml RENAME TO vectors_f32`);
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_vectors_f32_item ON vectors_f32(library_id, item_key)`,
    );
  } else {
    await db.exec(`
      CREATE TABLE vectors_f32 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        item_key TEXT NOT NULL,
        chunk_id INTEGER NOT NULL,
        vector BLOB NOT NULL,
        UNIQUE(library_id, item_key, chunk_id)
      );
    `);
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_vectors_f32_item ON vectors_f32(library_id, item_key)`,
    );
  }
}

/**
 * Ensure semantic DB is multi-library.
 * Soft-migrates legacy personal-only tables by stamping userLibraryID.
 */
export async function migrateSemanticDbToMultiLibrary(
  db: AsyncSqlDb,
  userLibraryID: number,
): Promise<MigrateResult> {
  if (!await tableExists(db, 'embeddings')) {
    await createFreshTables(db);
    return { migrated: false, createdFresh: true };
  }

  if (await hasColumn(db, 'embeddings', 'library_id')) {
    return { migrated: false, createdFresh: false };
  }

  await migrateLegacy(db, userLibraryID);
  return { migrated: true, createdFresh: false };
}
