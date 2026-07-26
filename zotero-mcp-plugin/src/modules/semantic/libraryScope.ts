/**
 * Pure helpers for multi-library semantic indexing.
 * No Zotero globals — unit-testable in Node.
 */

export type LibraryLike = {
  libraryID: number;
  libraryType: string;
  name?: string;
};

export type ItemRef = {
  libraryID: number;
  itemKey: string;
};

/** Composite identity for Sets/Maps: libraryID + itemKey */
export function itemIdentityKey(libraryID: number, itemKey: string): string {
  return `${libraryID}:${itemKey}`;
}

export function parseItemIdentityKey(
  key: string,
): ItemRef | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const libraryID = Number(key.slice(0, idx));
  const itemKey = key.slice(idx + 1);
  if (!Number.isInteger(libraryID) || !itemKey) return null;
  return { libraryID, itemKey };
}

/** Pref: comma-separated or JSON array of library IDs to skip. */
export function parseExcludeLibraryIDs(raw: unknown): number[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isInteger(n) && Number.isFinite(n));
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map(Number)
          .filter((n) => Number.isInteger(n) && Number.isFinite(n));
      }
    } catch {
      // fall through to comma parse
    }
  }
  return s
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && Number.isFinite(n));
}

/**
 * Index user + group libraries only; honor exclude list.
 */
export function isIndexableLibrary(
  library: LibraryLike,
  excludeIDs: number[] = [],
): boolean {
  if (excludeIDs.includes(library.libraryID)) return false;
  const t = library.libraryType;
  return t === 'user' || t === 'group';
}

export function filterIndexableLibraries(
  libraries: LibraryLike[],
  excludeIDs: number[] = [],
): LibraryLike[] {
  return libraries.filter((lib) => isIndexableLibrary(lib, excludeIDs));
}

export type FindSimilarResolveResult =
  | { ok: true; libraryID: number; itemKey: string }
  | {
      ok: false;
      reason: 'not_found' | 'ambiguous';
      candidates: ItemRef[];
    };

/**
 * Resolve which library owns itemKey for find_similar.
 * - If libraryID provided: that library only
 * - Else: unique candidate → ok; 0 → not_found; many → ambiguous
 */
export function resolveFindSimilarSource(
  itemKey: string,
  candidates: ItemRef[],
  requestedLibraryID?: number | null,
): FindSimilarResolveResult {
  const matching = candidates.filter((c) => c.itemKey === itemKey);

  if (requestedLibraryID != null && Number.isFinite(requestedLibraryID)) {
    const hit = matching.find((c) => c.libraryID === requestedLibraryID);
    if (!hit) {
      return { ok: false, reason: 'not_found', candidates: matching };
    }
    return { ok: true, libraryID: hit.libraryID, itemKey: hit.itemKey };
  }

  if (matching.length === 0) {
    return { ok: false, reason: 'not_found', candidates: [] };
  }
  if (matching.length === 1) {
    return {
      ok: true,
      libraryID: matching[0].libraryID,
      itemKey: matching[0].itemKey,
    };
  }
  return { ok: false, reason: 'ambiguous', candidates: matching };
}
