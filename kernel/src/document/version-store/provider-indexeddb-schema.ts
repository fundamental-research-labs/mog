/**
 * IndexedDB schema for the VC version-store provider.
 *
 * This intentionally does not share the existing document Yrs stores
 * (`snapshots`, `updates`). VC data has separate object stores so registry
 * visibility, object durability, ref CAS, and future index repair can evolve
 * independently of document-sync persistence.
 */

export const VERSION_STORE_INDEXEDDB_NAME = 'mog-version-store';
export const VERSION_STORE_INDEXEDDB_VERSION = 3;

export const REGISTRIES_STORE = 'registries';
export const OBJECTS_STORE = 'objects';
export const REFS_STORE = 'refs';
export const SYMBOLIC_REFS_STORE = 'symbolicRefs';
export const COMMIT_INDEXES_STORE = 'commitIndexes';
export const PARENT_INDEXES_STORE = 'parentIndexes';
export const INDEX_MANIFESTS_STORE = 'indexManifests';
export const INTENTS_STORE = 'intents';
export const PROPOSALS_STORE = 'proposals';
export const ACTIVE_CHECKOUTS_STORE = 'activeCheckouts';

export const VERSION_STORE_INDEXEDDB_STORES = Object.freeze([
  REGISTRIES_STORE,
  OBJECTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
  COMMIT_INDEXES_STORE,
  PARENT_INDEXES_STORE,
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  PROPOSALS_STORE,
  ACTIVE_CHECKOUTS_STORE,
] as const);

export type VersionStoreIndexedDbStoreName = (typeof VERSION_STORE_INDEXEDDB_STORES)[number];

export function openVersionStoreIndexedDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    attemptOpen(resolve, reject);
  });
}

function attemptOpen(resolve: (db: IDBDatabase) => void, reject: (error: unknown) => void): void {
  const request = indexedDB.open(VERSION_STORE_INDEXEDDB_NAME, VERSION_STORE_INDEXEDDB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    createV1Stores(db);
    createV2Stores(db);
    createV3Stores(db);
  };

  request.onsuccess = () => {
    const db = request.result;
    db.onversionchange = () => {
      db.close();
    };
    resolve(db);
  };

  request.onerror = () => {
    reject(request.error ?? new Error('openVersionStoreIndexedDb: unknown error'));
  };

  request.onblocked = () => {
    queueMicrotask(() => {
      request.onsuccess = null;
      request.onerror = null;
      request.onupgradeneeded = null;
      attemptOpen(resolve, reject);
    });
  };
}

function createV1Stores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(REGISTRIES_STORE)) {
    db.createObjectStore(REGISTRIES_STORE);
  }
  if (!db.objectStoreNames.contains(OBJECTS_STORE)) {
    const store = db.createObjectStore(OBJECTS_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
  }
  if (!db.objectStoreNames.contains(REFS_STORE)) {
    const store = db.createObjectStore(REFS_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
  }
  if (!db.objectStoreNames.contains(SYMBOLIC_REFS_STORE)) {
    const store = db.createObjectStore(SYMBOLIC_REFS_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
  }
  if (!db.objectStoreNames.contains(COMMIT_INDEXES_STORE)) {
    const store = db.createObjectStore(COMMIT_INDEXES_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
  }
  if (!db.objectStoreNames.contains(PARENT_INDEXES_STORE)) {
    const store = db.createObjectStore(PARENT_INDEXES_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
    store.createIndex('parentLookupKey', 'parentLookupKey', { unique: false });
  }
  if (!db.objectStoreNames.contains(INDEX_MANIFESTS_STORE)) {
    db.createObjectStore(INDEX_MANIFESTS_STORE);
  }
  if (!db.objectStoreNames.contains(INTENTS_STORE)) {
    const store = db.createObjectStore(INTENTS_STORE);
    store.createIndex('namespaceKey', 'namespaceKey', { unique: false });
    store.createIndex('documentScopeKey', 'documentScopeKey', { unique: false });
  }
}

function createV2Stores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(PROPOSALS_STORE)) {
    const store = db.createObjectStore(PROPOSALS_STORE);
    store.createIndex('documentScopeKey', 'documentScopeKey', { unique: false });
    store.createIndex('documentId', 'documentId', { unique: false });
    store.createIndex('targetRef', 'targetRef', { unique: false });
    store.createIndex('baseCommitId', 'baseCommitId', { unique: false });
    store.createIndex('proposalCommitId', 'proposalCommitId', { unique: false });
    store.createIndex('proposalBranchName', 'proposalBranchName', { unique: false });
    store.createIndex('agentRunId', 'agentRunId', { unique: false });
    store.createIndex('status', 'status', { unique: false });
    store.createIndex('updatedAt', 'updatedAt', { unique: false });
  }
}

function createV3Stores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(ACTIVE_CHECKOUTS_STORE)) {
    const store = db.createObjectStore(ACTIVE_CHECKOUTS_STORE);
    store.createIndex('documentScopeKey', 'documentScopeKey', { unique: true });
  }
}

export function deleteVersionStoreIndexedDbForTesting(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(VERSION_STORE_INDEXEDDB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error('deleteVersionStoreIndexedDbForTesting: unknown error'));
    request.onblocked = () => {
      // Existing handles close on versionchange via openVersionStoreIndexedDb.
    };
  });
}
