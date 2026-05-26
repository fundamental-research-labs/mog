/**
 * IndexedDB schema + open helper.
 *
 * One database (`shortcut-rust-docs`, version 2) shared by two sibling modules:
 *   - `IndexedDBProvider` (per-doc) — owns `snapshots` + `updates`.
 *   - Meta API (free functions) — owns `meta`.
 *
 * They do not share a class; only this file. Layering on purpose: a future
 * `WebsocketProvider` won't carry meta, and the Meta API has no per-doc
 * Provider lifecycle to bolt onto.
 *
 * Schema migration v1 → v2 happens **inside the single `onupgradeneeded`
 * versionchange transaction**. That guarantees partial migration aborts
 * cleanly: a crashed upgrade leaves the DB at v1 with the legacy `documents`
 * store intact, never half-migrated.
 *
 * Concurrent-open safety: when two tabs (or two callers in the same tab)
 * race `openDb()` on first boot, only one runs the upgrade tx. The second
 * caller's request fires `onblocked`. We retry on `versionchange` end so
 * both callers receive a single resolved DB handle without throwing.
 *
 */

/** Database name shared across all IndexedDB consumers. */
export const DB_NAME = 'shortcut-rust-docs';

/** Schema version. v1 was the legacy single-`documents` store. */
export const DB_VERSION = 2;

/** v2 store: yrs full-state snapshots, keyed by `docId`. */
export const SNAPSHOTS_STORE = 'snapshots';

/**
 * v2 store: incremental yrs updates since the latest snapshot. Compound key
 * `[docId, seq]` is sortable in IDB cursor order — replay walks the range
 * for one docId in seq order.
 */
export const UPDATES_STORE = 'updates';

/**
 * v2 store: doc-agnostic meta (recentDocs, lastActiveDocId, per-doc
 * compaction watermark). Owned by the §5.1.1 Meta API.
 */
export const META_STORE = 'meta';

/** Legacy v1 store name. Dropped during migration. */
const LEGACY_DOCUMENTS_STORE = 'documents';

/**
 * Open `shortcut-rust-docs` at version 2. Handles:
 *   - Fresh install (no v1 data): creates all three v2 stores.
 *   - v1 → v2 upgrade: copies every `documents[docId]` to `snapshots[docId]`,
 *     then drops `documents` — all inside the same versionchange tx. If the
 *     copy fails, the tx aborts and the DB stays at v1.
 *   - Concurrent opens: a second caller during upgrade gets `onblocked`;
 *     we wait for the upgrade's `versionchange` to finish then retry.
 *
 * Callers receive a fully-opened, schema-current `IDBDatabase`. Errors are
 * rejected; callers handle (or propagate) per their own contract.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    attempt(resolve, reject);
  });
}

/**
 * One open attempt. Retries by re-entering itself when the request is
 * `blocked` (another tab/caller is mid-upgrade).
 */
function attempt(resolve: (db: IDBDatabase) => void, reject: (err: unknown) => void): void {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = (event) => {
    const db = request.result;
    const tx = request.transaction;
    if (!tx) {
      // Should never happen — IDB always provides a versionchange tx in
      // onupgradeneeded — but if it does, we cannot migrate safely.
      reject(new Error('openDb: missing versionchange transaction'));
      return;
    }

    const oldVersion = event.oldVersion;
    migrate(db, tx, oldVersion);
  };

  request.onsuccess = () => {
    const db = request.result;
    // Some browsers fire `versionchange` on the open handle when *another*
    // tab tries to upgrade. Closing the DB lets the other tab proceed
    // instead of getting permanently blocked. Callers re-open
    // on demand, so this is safe.
    db.onversionchange = () => {
      db.close();
    };
    resolve(db);
  };

  request.onerror = () => {
    reject(request.error ?? new Error('openDb: unknown error'));
  };

  request.onblocked = () => {
    // Another connection is holding the DB open at v1 (or an earlier v2).
    // Wait for that connection to close (it will, because `onversionchange`
    // above closes any DB that sees a sibling upgrade), then retry. We
    // cannot await `request.onsuccess` here because the request is parked
    // in the blocked state until the other connection closes; the cleanest
    // path is to abandon this request and re-open after a microtask.
    //
    // The blocked request itself will eventually fire `success` once the
    // other connection closes — but in some browsers that take seconds.
    // Re-opening immediately is faster; if the second open also blocks,
    // the recursion bottoms out the same way.
    //
    // We don't loop forever: if no other connection closes, the eventual
    // `request.onerror` rejects.
    queueMicrotask(() => {
      // Cancel pending listeners — letting them fire would resolve/reject
      // a different open than the one the caller now waits on.
      request.onsuccess = null;
      request.onerror = null;
      request.onupgradeneeded = null;
      attempt(resolve, reject);
    });
  };
}

/**
 * Apply the schema for `oldVersion → DB_VERSION`. Runs inside the open
 * request's versionchange transaction; any error inside aborts the whole
 * upgrade, leaving the DB at `oldVersion`.
 */
function migrate(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    // Fresh install: create v2 stores directly. No legacy data to copy.
    createV2Stores(db);
    return;
  }

  if (oldVersion === 1) {
    // v1 → v2: copy `documents` entries into `snapshots`, then drop the
    // legacy store. All inside the same tx — partial copies abort cleanly.
    //
    // The legacy-store delete must run AFTER the cursor that walks it
    // has finished. We chain that into the cursor's "no more entries"
    // callback so the deleteObjectStore happens once the cursor is
    // closed (still inside the versionchange tx).
    createV2Stores(db);
    copyV1DocumentsIntoSnapshots(db, tx, () => {
      // `db.deleteObjectStore` runs in versionchange-tx context; safe
      // here because the cursor is already exhausted.
      if (db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)) {
        db.deleteObjectStore(LEGACY_DOCUMENTS_STORE);
      }
    });
  }
}

/** Create the three v2 stores. Idempotent against partial creation. */
function createV2Stores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
    db.createObjectStore(SNAPSHOTS_STORE);
  }
  if (!db.objectStoreNames.contains(UPDATES_STORE)) {
    // Compound key `[docId, seq]`. Both fields live on the value, but we
    // don't use a keyPath — values are raw `Uint8Array`s. The caller passes
    // the explicit key on every `put`.
    db.createObjectStore(UPDATES_STORE);
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE);
  }
}

/**
 * Copy every entry from the legacy `documents` store into `snapshots`,
 * preserving keys (which were already docIds in v1).
 *
 * Uses a cursor inside the same versionchange tx so the copy + delete-store
 * are one atomic unit. If the cursor or any `put` errors, the tx aborts
 * and the DB stays at v1 with the legacy store intact.
 */
function copyV1DocumentsIntoSnapshots(
  db: IDBDatabase,
  tx: IDBTransaction,
  onCursorDone: () => void,
): void {
  if (!db.objectStoreNames.contains(LEGACY_DOCUMENTS_STORE)) {
    onCursorDone();
    return;
  }

  const legacy = tx.objectStore(LEGACY_DOCUMENTS_STORE);
  const snapshots = tx.objectStore(SNAPSHOTS_STORE);

  const cursorRequest = legacy.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) {
      // Cursor exhausted — safe to drop the legacy store. Caller passes
      // the deleteObjectStore step through `onCursorDone` so it runs in
      // the same versionchange tx but only after the cursor closes.
      onCursorDone();
      return;
    }
    const value = cursor.value;
    // v1 stored either Uint8Array or ArrayBuffer; normalise to Uint8Array.
    const bytes =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : null;
    if (bytes) {
      snapshots.put(bytes, cursor.key);
    }
    cursor.continue();
  };
  // No explicit onerror handler — errors bubble to the versionchange tx
  // which aborts the whole upgrade. That is the desired behaviour.
}

/**
 * Test helper: wipe the entire `shortcut-rust-docs` database. Used by
 * conformance / unit tests to ensure no cross-test leakage. Not exported
 * from the package barrel — internal to the providers module.
 */
export function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase: error'));
    req.onblocked = () => {
      // Open connections elsewhere will receive `onversionchange` and
      // close (see `openDb` above). Resolve once that drain has happened.
      // The eventual `onsuccess` covers it.
    };
  });
}
