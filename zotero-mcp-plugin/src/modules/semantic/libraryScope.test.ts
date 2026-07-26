/**
 * Node-runnable unit tests for libraryScope (no Zotero).
 * Run: node --experimental-strip-types --test src/modules/semantic/libraryScope.test.ts
 * Or after build: npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemIdentityKey,
  parseItemIdentityKey,
  parseExcludeLibraryIDs,
  isIndexableLibrary,
  filterIndexableLibraries,
  resolveFindSimilarSource,
} from './libraryScope.ts';

describe('itemIdentityKey', () => {
  it('round-trips libraryID and itemKey', () => {
    const k = itemIdentityKey(1, 'ABCD1234');
    assert.equal(k, '1:ABCD1234');
    assert.deepEqual(parseItemIdentityKey(k), {
      libraryID: 1,
      itemKey: 'ABCD1234',
    });
  });

  it('rejects malformed keys', () => {
    assert.equal(parseItemIdentityKey(''), null);
    assert.equal(parseItemIdentityKey('nocolon'), null);
    assert.equal(parseItemIdentityKey(':onlykey'), null);
  });
});

describe('parseExcludeLibraryIDs', () => {
  it('parses comma-separated IDs', () => {
    assert.deepEqual(parseExcludeLibraryIDs('2, 5, 9'), [2, 5, 9]);
  });

  it('parses JSON array', () => {
    assert.deepEqual(parseExcludeLibraryIDs('[2,5]'), [2, 5]);
  });

  it('returns empty for blank', () => {
    assert.deepEqual(parseExcludeLibraryIDs(''), []);
    assert.deepEqual(parseExcludeLibraryIDs(null), []);
  });
});

describe('isIndexableLibrary', () => {
  it('allows user and group', () => {
    assert.equal(isIndexableLibrary({ libraryID: 1, libraryType: 'user' }), true);
    assert.equal(isIndexableLibrary({ libraryID: 2, libraryType: 'group' }), true);
  });

  it('rejects publications and excluded IDs', () => {
    assert.equal(
      isIndexableLibrary({ libraryID: 3, libraryType: 'publications' }),
      false,
    );
    assert.equal(
      isIndexableLibrary({ libraryID: 2, libraryType: 'group' }, [2]),
      false,
    );
  });

  it('filterIndexableLibraries drops excluded and non user/group', () => {
    const libs = [
      { libraryID: 1, libraryType: 'user' },
      { libraryID: 2, libraryType: 'group' },
      { libraryID: 3, libraryType: 'publications' },
      { libraryID: 4, libraryType: 'group' },
    ];
    assert.deepEqual(
      filterIndexableLibraries(libs, [4]).map((l) => l.libraryID),
      [1, 2],
    );
  });
});

describe('resolveFindSimilarSource', () => {
  const candidates = [
    { libraryID: 1, itemKey: 'AAAA' },
    { libraryID: 2, itemKey: 'AAAA' },
    { libraryID: 1, itemKey: 'BBBB' },
  ];

  it('uses requested libraryID', () => {
    const r = resolveFindSimilarSource('AAAA', candidates, 2);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.libraryID, 2);
  });

  it('returns unique when only one match', () => {
    const r = resolveFindSimilarSource('BBBB', candidates);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.libraryID, 1);
  });

  it('returns ambiguous when multiple without libraryID', () => {
    const r = resolveFindSimilarSource('AAAA', candidates);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'ambiguous');
  });

  it('returns not_found when missing', () => {
    const r = resolveFindSimilarSource('ZZZZ', candidates);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not_found');
  });
});
