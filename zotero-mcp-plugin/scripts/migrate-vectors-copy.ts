/**
 * Offline soft-migrate of a *copy* of zotero-mcp-vectors.sqlite.
 * Never opens the live DB for write. No Zotero, no embeddings.
 *
 * Usage:
 *   npm run test:migrate-copy
 *   npm run test:migrate-copy -- --src ~/Zotero/zotero-mcp-vectors.sqlite --user-library-id 1
 */
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  hasMultiLibrarySchema,
  migrateSemanticDbToMultiLibrary,
  type AsyncSqlDb,
} from '../src/modules/semantic/migrateMultiLibrary';

function parseArgs(argv: string[]) {
  let src = `${process.env.HOME}/Zotero/zotero-mcp-vectors.sqlite`;
  let userLibraryID = 1;
  let dest = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') src = argv[++i];
    else if (argv[i] === '--user-library-id') userLibraryID = Number(argv[++i]);
    else if (argv[i] === '--dest') dest = argv[++i];
  }
  if (!dest) {
    dest = join(tmpdir(), `zotero-mcp-vectors.migrate-test.${Date.now()}.sqlite`);
  }
  return { src, dest, userLibraryID };
}

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

async function main() {
  const { src, dest, userLibraryID } = parseArgs(process.argv.slice(2));

  if (!existsSync(src)) {
    console.error(`Source DB not found: ${src}`);
    process.exit(1);
  }

  // Prefer immutable open of source to avoid lock fights; always write to dest copy.
  console.log(`Source: ${src} (${(statSync(src).size / 1e6).toFixed(1)} MB)`);
  console.log(`Copy → ${dest}`);
  copyFileSync(src, dest);

  const raw = new DatabaseSync(dest);
  const db = wrap(raw);

  const beforeMulti = await hasMultiLibrarySchema(db);
  const beforeCount = (await db.get(`SELECT COUNT(*) AS n FROM embeddings`))?.n;
  console.log(`Before: multiLibrary=${beforeMulti}, embeddings=${beforeCount}`);

  const t0 = Date.now();
  const result = await migrateSemanticDbToMultiLibrary(db, userLibraryID);
  const ms = Date.now() - t0;

  const afterMulti = await hasMultiLibrarySchema(db);
  const afterCount = (await db.get(`SELECT COUNT(*) AS n FROM embeddings`))?.n;
  const stamped = (
    await db.get(
      `SELECT COUNT(*) AS n FROM embeddings WHERE library_id = ?`,
      [userLibraryID],
    )
  )?.n;

  console.log(`Result:`, result, `(${ms}ms)`);
  console.log(
    `After: multiLibrary=${afterMulti}, embeddings=${afterCount}, stampedAsUser=${stamped}`,
  );

  raw.close();

  if (!afterMulti) {
    console.error('FAIL: schema is not multi-library after migrate');
    process.exit(1);
  }
  if (beforeCount != null && afterCount !== beforeCount) {
    console.error(
      `FAIL: row count changed ${beforeCount} → ${afterCount}`,
    );
    process.exit(1);
  }
  if (stamped !== afterCount) {
    console.error('FAIL: not all rows stamped with user library_id');
    process.exit(1);
  }

  console.log('PASS: offline migrate on copy');
  console.log(`Safe to delete copy: ${dest}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
