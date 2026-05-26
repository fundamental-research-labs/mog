/**
 * IndexedDB Meta API — §5.1.1.
 *
 * Free functions, **not** a Provider. Owns the `meta` object store, which
 * tracks doc-agnostic state the shell needs at boot:
 *   - `recentDocs`: LRU list of docIds the user has touched, with
 *     `lastTouchedAt` timestamps for the soft-evict policy (§5.4).
 *   - `lastActiveDocId`: the most recently attached doc, used by the boot
 *     precedence table (§6.2) to reopen the user's last doc on refresh.
 *
 * The shell calls `readMeta()` in parallel with WASM init — well before any
 * Provider exists, so the shape cannot be a Provider.
 *
 * Sharing storage with `IndexedDBProvider` is intentional: one schema
 * migration covers both, and the browser-quota bucket is one regardless.
 *
 */

import { META_STORE, openDb } from './indexeddb-schema';

/** Default quota for `recentDocs` (Q2 default). */
const RECENT_DOCS_LIMIT = 50;

/** Per-key constants in the `meta` store. */
const KEY_RECENT_DOCS = 'recentDocs';
const KEY_LAST_ACTIVE_DOC_ID = 'lastActiveDocId';

/**
 * Recent-doc record shape persisted in the `meta` store. `lastTouchedAt`
 * is `Date.now()` at the time of the most recent `touchDoc(docId)` call;
 * the soft-evict heuristic (§5.4) reads this when deciding which docs to
 * forget.
 */
export interface RecentDoc {
  docId: string;
  lastTouchedAt: number;
}

/**
 * The shape returned by `readMeta()`. The shell mirrors this into a zustand
 * slice (`recentDocs`, `lastActiveDocId`) on boot and writes through via
 * `touchDoc` / `forgetDoc` afterwards.
 */
export interface MetaState {
  recentDocs: RecentDoc[];
  lastActiveDocId: string | null;
}

/** Empty `MetaState` for the fresh-DB / cleared-meta cases. */
const EMPTY_META: MetaState = {
  recentDocs: [],
  lastActiveDocId: null,
};

/**
 * Read the current meta state. Resolves with the empty state on a fresh
 * DB; never rejects on missing keys (only on tx-level IDB errors).
 *
 * Called by the shell in parallel with WASM init — must not block.
 */
export async function readMeta(): Promise<MetaState> {
  const db = await openDb();
  try {
    const recentDocs = await getValue<RecentDoc[]>(db, KEY_RECENT_DOCS);
    const lastActiveDocId = await getValue<string>(db, KEY_LAST_ACTIVE_DOC_ID);

    return {
      recentDocs: Array.isArray(recentDocs) ? recentDocs : [],
      lastActiveDocId: typeof lastActiveDocId === 'string' ? lastActiveDocId : null,
    };
  } finally {
    db.close();
  }
}

/**
 * Mark `docId` as just-touched: move it to the head of `recentDocs`, set
 * `lastActiveDocId`, and trim the list to `RECENT_DOCS_LIMIT`. Idempotent.
 *
 * Called by:
 *   - The orchestrator on every successful `Provider.attach` (so the most
 *     recently opened doc always wins).
 *   - The shell whenever the user explicitly opens a doc through the boot
 *     precedence table.
 */
export async function touchDoc(docId: string): Promise<void> {
  const db = await openDb();
  try {
    await runTx(db, 'readwrite', async (store) => {
      const list = await wrapRequest<RecentDoc[]>(store.get(KEY_RECENT_DOCS));
      const now = Date.now();
      const next: RecentDoc[] = [{ docId, lastTouchedAt: now }];
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (entry && entry.docId !== docId) {
            next.push(entry);
            if (next.length >= RECENT_DOCS_LIMIT) break;
          }
        }
      }
      store.put(next, KEY_RECENT_DOCS);
      store.put(docId, KEY_LAST_ACTIVE_DOC_ID);
    });
  } finally {
    db.close();
  }
}

/**
 * Remove `docId` from `recentDocs`. Clears `lastActiveDocId` iff it
 * equals `docId`. Used by:
 *   - Eviction when a doc is dropped from local cache.
 *   - The shell's "delete this doc" UI.
 */
export async function forgetDoc(docId: string): Promise<void> {
  const db = await openDb();
  try {
    await runTx(db, 'readwrite', async (store) => {
      const list = await wrapRequest<RecentDoc[]>(store.get(KEY_RECENT_DOCS));
      if (Array.isArray(list)) {
        const next = list.filter((entry) => entry && entry.docId !== docId);
        store.put(next, KEY_RECENT_DOCS);
      }

      const lastActive = await wrapRequest<string>(store.get(KEY_LAST_ACTIVE_DOC_ID));
      if (lastActive === docId) {
        store.delete(KEY_LAST_ACTIVE_DOC_ID);
      }
    });
  } finally {
    db.close();
  }
}

/**
 * Wipe the entire meta store. Test fixture only; not part of the
 * shell-facing API surface. Used by the provider tests to ensure a clean
 * baseline between scenarios.
 */
export async function clearMeta(): Promise<void> {
  const db = await openDb();
  try {
    await runTx(db, 'readwrite', async (store) => {
      store.clear();
    });
  } finally {
    db.close();
  }
}

/** @internal — exposed for `IndexedDBProvider.attach()` eviction reads. */
export async function readMetaUsingDb(db: IDBDatabase): Promise<MetaState> {
  const recentDocs = await getValue<RecentDoc[]>(db, KEY_RECENT_DOCS);
  const lastActiveDocId = await getValue<string>(db, KEY_LAST_ACTIVE_DOC_ID);
  return {
    recentDocs: Array.isArray(recentDocs) ? recentDocs : [],
    lastActiveDocId: typeof lastActiveDocId === 'string' ? lastActiveDocId : null,
  };
}

/**
 * @internal — write `next` to the meta store within an open versionchange-
 * compatible tx. Used by the IndexedDBProvider's eviction path so the
 * meta updates land in the same tx as the snapshot/updates deletes.
 */
export function writeMetaWithinTx(tx: IDBTransaction, next: MetaState): void {
  const store = tx.objectStore(META_STORE);
  store.put(next.recentDocs, KEY_RECENT_DOCS);
  if (next.lastActiveDocId === null) {
    store.delete(KEY_LAST_ACTIVE_DOC_ID);
  } else {
    store.put(next.lastActiveDocId, KEY_LAST_ACTIVE_DOC_ID);
  }
}

/** Convenience: typed read of one key from the meta store. */
async function getValue<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let result: T | undefined;
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req = store.get(key);
    req.onsuccess = () => {
      result = req.result as T | undefined;
    };
    req.onerror = () => {
      reject(req.error ?? new Error(`meta.get(${key}) failed`));
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('meta.get tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('meta.get tx aborted'));
  });
}

/**
 * Convenience: open a `meta` store tx, run `body(store)`, await tx
 * completion. The body runs synchronously inside `tx` lifetime — any
 * `await` between `store` ops and the next op risks the tx auto-closing.
 *
 * The `body` is intentionally async only to await `wrapRequest`
 * for `get()` results — IDB schedules sub-requests inside the same tx as
 * long as we wait via the request's own `onsuccess`, which `wrapRequest`
 * does. This pattern is safe across all browsers we target.
 */
async function runTx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => void | Promise<void>,
): Promise<void> {
  const tx = db.transaction(META_STORE, mode);
  const store = tx.objectStore(META_STORE);

  let bodyPromise: void | Promise<void>;
  try {
    bodyPromise = body(store);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* tx may already be aborting */
    }
    throw err;
  }

  // Surface body-thrown errors before awaiting tx completion.
  if (bodyPromise) {
    try {
      await bodyPromise;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* tx may already be aborting */
      }
      throw err;
    }
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('meta tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('meta tx aborted'));
  });
}

/**
 * Convenience: turn an `IDBRequest` into a Promise. Lives next to
 * `runTx` because callers using this inside `body` keep their reads in
 * the same tx as their writes.
 */
async function wrapRequest<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

/** Convenience for `EMPTY_META` consumers (helps tests assert shape). */
export function emptyMeta(): MetaState {
  return { ...EMPTY_META, recentDocs: [] };
}
