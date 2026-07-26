# Testing multi-library semantic index (cheap ladder)

Goal: prove multi-library work **without** re-embedding the whole library.

## 1. Unit tests (no Zotero, no oMLX)

```bash
cd zotero-mcp-plugin
npm run test:unit
```

Covers:

- `libraryScope` — identity keys, exclude list, find_similar resolve
- `indexPlan` — dry-run counts by library
- `migrateMultiLibrary` — soft-migrate legacy schema, preserve rows, idempotent

## 2. Offline migrate on a **copy** of your vectors DB

```bash
# Live DB may be locked by Zotero; copy first
cp ~/Zotero/zotero-mcp-vectors.sqlite /tmp/zotero-mcp-vectors.copy.sqlite

npm run test:migrate-copy -- \
  --src /tmp/zotero-mcp-vectors.copy.sqlite \
  --user-library-id 1
```

- Does **not** write the live DB
- Asserts row counts unchanged and all rows get `library_id`
- Example production run: 25 758 embeddings / ~1 GB in ~1.3 s → PASS

## 3. Install XPI (migrate at runtime)

```bash
npm run build
# Install: .scaffold/build/zotero-mcp-plugin.xpi
```

1. Prefer **Auto Update off** until you review the plan
2. Restart Zotero → migrate runs once on live DB
3. Personal search should still work (same vectors, stamped library id)

## 4. Dry-run index plan (still no mass embeds)

MCP tool: **`semantic_index_plan`**

Returns libraries in scope, per-library `toIndex` / `alreadyIndexed`, sample keys.  
Does **not** call the embedding API.

Or from plugin code: `semanticService.planIndex()` / `buildIndex({ dryRun: true })`.

## 5. Surgical multi-library proof (tiny embed cost)

After migrate + dry-run looks good, index **1–5** group items only:

- `buildIndex({ itemKeys: ['<groupLibraryID>:<itemKey>'], rebuild: false })`
- Then `semantic_search` that concept; confirm `libraryID` is the group

## 6. Optional full group backfill

Only after 1–5: leave **Auto Update** on, or Resume indexing.  
**Do not** use Rebuild Index unless you intend to re-embed everything.

## What not to do

- Rebuild Index as a smoke test  
- Merge to main as a substitute for the steps above  
- Run migrate scripts against the live path with Zotero open for write
