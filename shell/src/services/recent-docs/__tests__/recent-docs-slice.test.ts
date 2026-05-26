/**
 * recent-docs zustand slice — round-trip tests against the Meta API.
 *
 * The slice is a thin observable mirror over `kernel/src/document/providers/
 * indexeddb-meta.ts`. These tests verify the slice's contract — `hydrate`,
 * `touch`, `forget`, and the `loaded` flag — by driving real IDB calls
 * through `fake-indexeddb`. Per `feedback_e2e_real_path`: no Meta-API
 * mocks; the slice must round-trip through the real persistence layer.
 *
 */

// jsdom 26 doesn't define `structuredClone` on its Window, and Jest's
// jsdom environment makes `globalThis === window` — so the fake-indexeddb
// value-cloning path sees `structuredClone is not defined`. Polyfill via
// the V8 serialization API (round-trip through `serialize`/`deserialize`)
// before any other import touches IDB.
//
// Imported as a side-effect-only module so the polyfill runs before
// `fake-indexeddb/auto` thanks to ES module evaluation order.
import './setup-structured-clone';

import 'fake-indexeddb/auto';

import { clearMeta, readMeta, touchDoc } from '@mog-sdk/kernel/storage';
import { createRecentDocsStore } from '../recent-docs-slice';

beforeEach(async () => {
  // Wipe the meta store between scenarios — without this each test inherits
  // the prior test's `recentDocs` and the LRU assertions become noise.
  await clearMeta();
});

describe('recent-docs slice', () => {
  it('starts empty and unloaded', () => {
    const store = createRecentDocsStore();
    const state = store.getState();
    expect(state.recentDocs).toEqual([]);
    expect(state.lastActiveDocId).toBeNull();
    expect(state.loaded).toBe(false);
  });

  it('hydrate() reads meta and flips loaded=true even on empty meta', async () => {
    const store = createRecentDocsStore();
    await store.getState().hydrate();
    const state = store.getState();
    expect(state.recentDocs).toEqual([]);
    expect(state.lastActiveDocId).toBeNull();
    expect(state.loaded).toBe(true);
  });

  it('hydrate() reflects pre-existing meta written by external touchDoc()', async () => {
    // Drive Meta API directly to simulate prior session(s) writing.
    await touchDoc('doc-alpha');
    await touchDoc('doc-beta');

    const store = createRecentDocsStore();
    await store.getState().hydrate();

    const state = store.getState();
    expect(state.loaded).toBe(true);
    expect(state.lastActiveDocId).toBe('doc-beta'); // most recent touch wins
    // LRU order — newest first.
    expect(state.recentDocs.map((d) => d.docId)).toEqual(['doc-beta', 'doc-alpha']);
    // Each entry has a numeric `lastTouchedAt` from the underlying meta call.
    for (const entry of state.recentDocs) {
      expect(typeof entry.lastTouchedAt).toBe('number');
    }
  });

  it('touch() writes through the Meta API and refreshes the slice', async () => {
    const store = createRecentDocsStore();
    await store.getState().hydrate();
    await store.getState().touch('doc-touched');

    // Slice reflects the post-write state.
    const state = store.getState();
    expect(state.lastActiveDocId).toBe('doc-touched');
    expect(state.recentDocs.map((d) => d.docId)).toEqual(['doc-touched']);

    // Underlying Meta API also has the entry — confirms we wrote through,
    // not just into local state.
    const meta = await readMeta();
    expect(meta.lastActiveDocId).toBe('doc-touched');
    expect(meta.recentDocs.map((d) => d.docId)).toEqual(['doc-touched']);
  });

  it('touch() promotes an existing doc to the head of the LRU', async () => {
    const store = createRecentDocsStore();
    await store.getState().touch('a');
    await store.getState().touch('b');
    await store.getState().touch('c');
    // Now touch 'a' again — it should jump to the head.
    await store.getState().touch('a');

    const state = store.getState();
    expect(state.lastActiveDocId).toBe('a');
    expect(state.recentDocs.map((d) => d.docId)).toEqual(['a', 'c', 'b']);
  });

  it('forget() removes an entry and clears lastActiveDocId iff it matched', async () => {
    const store = createRecentDocsStore();
    await store.getState().touch('keepme');
    await store.getState().touch('removeme');

    expect(store.getState().lastActiveDocId).toBe('removeme');

    await store.getState().forget('removeme');

    const state = store.getState();
    expect(state.recentDocs.map((d) => d.docId)).toEqual(['keepme']);
    // `lastActiveDocId` was 'removeme' — meta API clears it, slice reflects.
    expect(state.lastActiveDocId).toBeNull();
  });

  it('forget() of a non-active doc leaves lastActiveDocId untouched', async () => {
    const store = createRecentDocsStore();
    await store.getState().touch('older');
    await store.getState().touch('newer');
    expect(store.getState().lastActiveDocId).toBe('newer');

    await store.getState().forget('older');

    const state = store.getState();
    expect(state.recentDocs.map((d) => d.docId)).toEqual(['newer']);
    expect(state.lastActiveDocId).toBe('newer');
  });

  it('does NOT call touchDoc() itself — orchestrator owns that wiring (§6.2)', async () => {
    // The slice only mirrors. If something else touches the meta store
    // (e.g. the orchestrator from inside attachProvider), the slice should
    // pick it up via re-hydrate or explicit touch — not by piggybacking
    // on construct/hydrate. Verify by hydrating an empty meta store
    // and confirming nothing has been written.
    const store = createRecentDocsStore();
    await store.getState().hydrate();

    const meta = await readMeta();
    expect(meta.recentDocs).toEqual([]);
    expect(meta.lastActiveDocId).toBeNull();
  });
});
