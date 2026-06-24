import 'fake-indexeddb/auto';

import {
  decodeActiveCheckoutMaterializationRecord,
  type ActiveCheckoutMaterializationRecord,
} from '../active-checkout-materialization-store';
import { IndexedDbActiveCheckoutMaterializationStore } from '../provider-indexeddb-active-checkouts';
import {
  ACTIVE_CHECKOUTS_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import { idbRequest, idbTransactionDone } from '../provider-indexeddb/internal';
import { versionDocumentScopeKey, type VersionDocumentScope } from '../registry';

const DOCUMENT_SCOPE = Object.freeze({
  documentId: 'active-checkout-materialization-store-test',
}) satisfies VersionDocumentScope;
const DOCUMENT_SCOPE_KEY = versionDocumentScopeKey(DOCUMENT_SCOPE);
const COMMIT_A = `commit:sha256:${'a'.repeat(64)}`;
const COMMIT_B = `commit:sha256:${'b'.repeat(64)}`;
const UPDATED_AT = '2026-01-02T03:04:05.678Z';

const VALID_RECORD = Object.freeze({
  documentScopeKey: DOCUMENT_SCOPE_KEY,
  checkedOutCommitId: COMMIT_A,
  branchName: 'main',
  refHeadAtMaterialization: COMMIT_B,
  updatedAt: UPDATED_AT,
}) satisfies ActiveCheckoutMaterializationRecord;

const openedDbs: IDBDatabase[] = [];

beforeEach(async () => {
  closeOpenedDbs();
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  closeOpenedDbs();
  await deleteVersionStoreIndexedDbForTesting();
});

describe('active checkout materialization store', () => {
  it('validates stored materialization records before restoring them', () => {
    expect(
      decodeActiveCheckoutMaterializationRecord(
        {
          ...VALID_RECORD,
          branchName: 'refs/heads/agent%2Freview-123',
        },
        DOCUMENT_SCOPE_KEY,
      ),
    ).toEqual({
      ...VALID_RECORD,
      branchName: 'agent/review-123',
    });

    expect(
      decodeActiveCheckoutMaterializationRecord(
        {
          ...VALID_RECORD,
          checkedOutCommitId: `commit:sha256:${'A'.repeat(64)}`,
        },
        DOCUMENT_SCOPE_KEY,
      ),
    ).toBeNull();
    expect(
      decodeActiveCheckoutMaterializationRecord(
        {
          ...VALID_RECORD,
          branchName: 'feature/unregistered',
        },
        DOCUMENT_SCOPE_KEY,
      ),
    ).toBeNull();
    expect(
      decodeActiveCheckoutMaterializationRecord(
        {
          ...VALID_RECORD,
          updatedAt: '2026-01-02T03:04:05Z',
        },
        DOCUMENT_SCOPE_KEY,
      ),
    ).toBeNull();
    expect(
      decodeActiveCheckoutMaterializationRecord(
        {
          ...VALID_RECORD,
          unexpected: true,
        },
        DOCUMENT_SCOPE_KEY,
      ),
    ).toBeNull();
  });

  it('stores IndexedDB rows in a versioned envelope', async () => {
    const store = new IndexedDbActiveCheckoutMaterializationStore({
      documentScope: DOCUMENT_SCOPE,
      getDb,
    });

    await store.write({
      checkedOutCommitId: VALID_RECORD.checkedOutCommitId,
      branchName: 'refs/heads/agent/review-123',
      refHeadAtMaterialization: VALID_RECORD.refHeadAtMaterialization,
      updatedAt: VALID_RECORD.updatedAt,
    });

    await expect(store.read()).resolves.toEqual({
      ...VALID_RECORD,
      branchName: 'agent/review-123',
    });
    await expect(readRawActiveCheckoutRow()).resolves.toMatchObject({
      schemaVersion: 1,
      recordKind: 'activeCheckoutMaterialization',
      documentScopeKey: DOCUMENT_SCOPE_KEY,
      record: {
        ...VALID_RECORD,
        branchName: 'agent/review-123',
      },
    });
  });

  it('deletes malformed IndexedDB rows and fails closed on read', async () => {
    await putRawActiveCheckoutRow({
      ...VALID_RECORD,
      checkedOutCommitId: 'not-a-commit-id',
    });

    const store = new IndexedDbActiveCheckoutMaterializationStore({
      documentScope: DOCUMENT_SCOPE,
      getDb,
    });

    await expect(store.read()).resolves.toBeNull();
    await expect(readRawActiveCheckoutRow()).resolves.toBeUndefined();
  });
});

async function getDb(): Promise<IDBDatabase> {
  const db = await openVersionStoreIndexedDb();
  openedDbs.push(db);
  return db;
}

async function readRawActiveCheckoutRow(): Promise<unknown | undefined> {
  const db = await getDb();
  const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readonly');
  const done = idbTransactionDone(tx);
  const value = await idbRequest<unknown | undefined>(
    tx.objectStore(ACTIVE_CHECKOUTS_STORE).get(DOCUMENT_SCOPE_KEY),
  );
  await done;
  return value;
}

async function putRawActiveCheckoutRow(value: unknown): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
  const done = idbTransactionDone(tx);
  await idbRequest(tx.objectStore(ACTIVE_CHECKOUTS_STORE).put(value, DOCUMENT_SCOPE_KEY));
  await done;
}

function closeOpenedDbs(): void {
  while (openedDbs.length > 0) {
    openedDbs.pop()?.close();
  }
}
