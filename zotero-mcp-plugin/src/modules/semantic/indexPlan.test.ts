/**
 * Dry-run index plan tests (no embeddings, no Zotero).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planSemanticIndex, type IndexableItemRef } from './indexPlan';
import { itemIdentityKey } from './libraryScope';

describe('planSemanticIndex', () => {
  const libraries = [
    { libraryID: 1, libraryType: 'user', name: 'My Library' },
    { libraryID: 2, libraryType: 'group', name: 'Lab' },
    { libraryID: 3, libraryType: 'group', name: 'SkipMe' },
    { libraryID: 4, libraryType: 'publications', name: 'My Publications' },
  ];

  const items: IndexableItemRef[] = [
    { libraryID: 1, itemKey: 'P1' },
    { libraryID: 1, itemKey: 'P2' },
    { libraryID: 2, itemKey: 'G1' },
    { libraryID: 2, itemKey: 'G2' },
    { libraryID: 3, itemKey: 'X1' },
    { libraryID: 4, itemKey: 'PUB1' },
  ];

  it('plans only user+group libraries minus excludes and already-indexed', () => {
    const indexed = new Set([itemIdentityKey(1, 'P1')]);
    const plan = planSemanticIndex({
      libraries,
      items,
      excludeLibraryIDs: [3],
      indexedIdentityKeys: indexed,
    });

    assert.deepEqual(
      plan.librariesInScope.map((l) => l.libraryID).sort(),
      [1, 2],
    );
    assert.equal(plan.skippedLibraries.some((l) => l.libraryID === 3), true);
    assert.equal(plan.skippedLibraries.some((l) => l.libraryID === 4), true);

    assert.equal(plan.totalItems, 3); // P2, G1, G2
    assert.equal(plan.alreadyIndexed, 1);
    assert.deepEqual(
      plan.toIndex.map((i) => itemIdentityKey(i.libraryID, i.itemKey)).sort(),
      ['1:P2', '2:G1', '2:G2'],
    );
    assert.equal(plan.byLibrary[1].toIndex, 1);
    assert.equal(plan.byLibrary[2].toIndex, 2);
    assert.equal(plan.byLibrary[1].alreadyIndexed, 1);
  });

  it('returns empty toIndex when everything is indexed', () => {
    const indexed = new Set(
      items
        .filter((i) => i.libraryID === 1 || i.libraryID === 2)
        .map((i) => itemIdentityKey(i.libraryID, i.itemKey)),
    );
    const plan = planSemanticIndex({
      libraries,
      items,
      excludeLibraryIDs: [3],
      indexedIdentityKeys: indexed,
    });
    assert.equal(plan.toIndex.length, 0);
    assert.equal(plan.totalItems, 0);
  });
});
