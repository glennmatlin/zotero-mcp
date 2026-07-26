/**
 * Pure dry-run planner for multi-library semantic indexing (no embeddings).
 */

import {
  filterIndexableLibraries,
  itemIdentityKey,
  type LibraryLike,
} from './libraryScope';

export type IndexableItemRef = {
  libraryID: number;
  itemKey: string;
};

export type LibraryPlanRow = {
  libraryID: number;
  name?: string;
  libraryType: string;
  totalCandidates: number;
  alreadyIndexed: number;
  toIndex: number;
};

export type SemanticIndexPlan = {
  librariesInScope: LibraryLike[];
  skippedLibraries: LibraryLike[];
  toIndex: IndexableItemRef[];
  totalItems: number;
  alreadyIndexed: number;
  byLibrary: Record<number, LibraryPlanRow>;
};

export function planSemanticIndex(input: {
  libraries: LibraryLike[];
  items: IndexableItemRef[];
  excludeLibraryIDs?: number[];
  indexedIdentityKeys: Set<string>;
}): SemanticIndexPlan {
  const exclude = input.excludeLibraryIDs ?? [];
  const inScope = filterIndexableLibraries(input.libraries, exclude);
  const inScopeIds = new Set(inScope.map((l) => l.libraryID));
  const skippedLibraries = input.libraries.filter(
    (l) => !inScopeIds.has(l.libraryID),
  );

  const byLibrary: Record<number, LibraryPlanRow> = {};
  for (const lib of inScope) {
    byLibrary[lib.libraryID] = {
      libraryID: lib.libraryID,
      name: lib.name,
      libraryType: lib.libraryType,
      totalCandidates: 0,
      alreadyIndexed: 0,
      toIndex: 0,
    };
  }

  const toIndex: IndexableItemRef[] = [];
  let alreadyIndexed = 0;

  for (const item of input.items) {
    if (!inScopeIds.has(item.libraryID)) continue;
    const row = byLibrary[item.libraryID];
    row.totalCandidates++;
    const id = itemIdentityKey(item.libraryID, item.itemKey);
    if (input.indexedIdentityKeys.has(id)) {
      alreadyIndexed++;
      row.alreadyIndexed++;
    } else {
      toIndex.push(item);
      row.toIndex++;
    }
  }

  return {
    librariesInScope: inScope,
    skippedLibraries,
    toIndex,
    totalItems: toIndex.length,
    alreadyIndexed,
    byLibrary,
  };
}
