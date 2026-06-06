/**
 * Meta API unit tests — `kernel/src/document/providers/indexeddb-meta.ts`.
 *
 * Doc-agnostic free functions; not a Provider, so they live outside the
 * conformance suite. Each function gets independent coverage:
 *   - `readMeta()` — empty DB / populated DB.
 *   - `touchDoc()` — adds, dedupes, caps to 50, updates lastActiveDocId.
 *   - `forgetDoc()` — removes from recentDocs, clears lastActiveDocId iff
 *     it equals the forgotten id.
 *   - `clearMeta()` — wipes everything.
 *
 */

import 'fake-indexeddb/auto';

import { clearMeta, forgetDoc, readMeta, touchDoc } from '../indexeddb-meta';
import { deleteDatabase, META_STORE, openDb } from '../indexeddb-schema';

describe('Meta API — indexeddb-meta.ts', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  // -------------------------------------------------------------------------
  // readMeta()
  // -------------------------------------------------------------------------
  describe('readMeta', () => {
    it('returns empty state on a fresh DB', async () => {
      const meta = await readMeta();
      expect(meta.recentDocs).toEqual([]);
      expect(meta.lastActiveDocId).toBeNull();
    });

    it('returns the most recently written state', async () => {
      await touchDoc('doc-a');
      await touchDoc('doc-b');

      const meta = await readMeta();
      // touchDoc puts the most recent at the head.
      expect(meta.recentDocs[0]?.docId).toBe('doc-b');
      expect(meta.recentDocs[1]?.docId).toBe('doc-a');
      expect(meta.lastActiveDocId).toBe('doc-b');
    });
  });

  // -------------------------------------------------------------------------
  // touchDoc()
  // -------------------------------------------------------------------------
  describe('touchDoc', () => {
    it('appends a new docId to the head of recentDocs', async () => {
      await touchDoc('doc-1');
      const meta = await readMeta();
      expect(meta.recentDocs).toHaveLength(1);
      expect(meta.recentDocs[0]?.docId).toBe('doc-1');
      expect(meta.lastActiveDocId).toBe('doc-1');
    });

    it('moves an existing docId to the head (no duplicates)', async () => {
      await touchDoc('doc-1');
      await touchDoc('doc-2');
      await touchDoc('doc-1'); // touch again — should move to head

      const meta = await readMeta();
      expect(meta.recentDocs).toHaveLength(2);
      expect(meta.recentDocs[0]?.docId).toBe('doc-1');
      expect(meta.recentDocs[1]?.docId).toBe('doc-2');
      expect(meta.lastActiveDocId).toBe('doc-1');
    });

    it('updates lastTouchedAt monotonically across calls', async () => {
      await touchDoc('doc-1');
      const t1 = (await readMeta()).recentDocs[0]?.lastTouchedAt ?? 0;
      // Force the clock to advance at least 1ms so the second touch's
      // timestamp strictly exceeds the first. fake-indexeddb runs in
      // Node, where Date.now() resolution is ms; without a small delay
      // tests on fast machines may see `t2 === t1`.
      await new Promise((r) => setTimeout(r, 2));
      await touchDoc('doc-1');
      const t2 = (await readMeta()).recentDocs[0]?.lastTouchedAt ?? 0;
      expect(t2).toBeGreaterThan(t1);
    });

    it('caps the list at 50 entries (last-write-wins on the boundary)', async () => {
      for (let i = 0; i < 60; i++) {
        await touchDoc(`doc-${i}`);
      }
      const meta = await readMeta();
      expect(meta.recentDocs.length).toBeLessThanOrEqual(50);
      // The 10 most recently touched (doc-50 .. doc-59) must all be
      // present; touchDoc puts the head as the just-touched doc.
      const ids = new Set(meta.recentDocs.map((r) => r.docId));
      expect(ids.has('doc-59')).toBe(true);
      expect(ids.has('doc-50')).toBe(true);
    });

    it('preserves the previous lastActiveDocId when trimming a full list', async () => {
      const now = Date.now();
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(META_STORE, 'readwrite');
        const store = tx.objectStore(META_STORE);
        store.put(
          Array.from({ length: 50 }, (_, i) => ({
            docId: `doc-${String(49 - i).padStart(3, '0')}`,
            lastTouchedAt: now - i,
          })),
          'recentDocs',
        );
        store.put('doc-000', 'lastActiveDocId');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();

      await touchDoc('doc-new');

      const meta = await readMeta();
      const ids = meta.recentDocs.map((entry) => entry.docId);
      expect(ids).toHaveLength(50);
      expect(ids[0]).toBe('doc-new');
      expect(ids).toContain('doc-000');
      expect(ids).not.toContain('doc-001');
      expect(meta.lastActiveDocId).toBe('doc-new');
    });
  });

  // -------------------------------------------------------------------------
  // forgetDoc()
  // -------------------------------------------------------------------------
  describe('forgetDoc', () => {
    it('removes the docId from recentDocs', async () => {
      await touchDoc('doc-a');
      await touchDoc('doc-b');
      await forgetDoc('doc-a');

      const meta = await readMeta();
      expect(meta.recentDocs.map((r) => r.docId)).toEqual(['doc-b']);
    });

    it('clears lastActiveDocId iff it equals the forgotten id', async () => {
      await touchDoc('doc-a');
      await touchDoc('doc-b'); // doc-b is now lastActiveDocId

      await forgetDoc('doc-a');
      let meta = await readMeta();
      expect(meta.lastActiveDocId).toBe('doc-b');

      await forgetDoc('doc-b');
      meta = await readMeta();
      expect(meta.lastActiveDocId).toBeNull();
    });

    it('is a no-op for unknown docIds', async () => {
      await touchDoc('doc-a');
      await forgetDoc('does-not-exist');

      const meta = await readMeta();
      expect(meta.recentDocs.map((r) => r.docId)).toEqual(['doc-a']);
      expect(meta.lastActiveDocId).toBe('doc-a');
    });
  });

  // -------------------------------------------------------------------------
  // clearMeta()
  // -------------------------------------------------------------------------
  describe('clearMeta', () => {
    it('wipes recentDocs and lastActiveDocId', async () => {
      await touchDoc('doc-a');
      await touchDoc('doc-b');
      await clearMeta();

      const meta = await readMeta();
      expect(meta.recentDocs).toEqual([]);
      expect(meta.lastActiveDocId).toBeNull();
    });

    it('is idempotent on an already-clear DB', async () => {
      await clearMeta();
      await expect(clearMeta()).resolves.toBeUndefined();

      const meta = await readMeta();
      expect(meta.recentDocs).toEqual([]);
      expect(meta.lastActiveDocId).toBeNull();
    });
  });
});
