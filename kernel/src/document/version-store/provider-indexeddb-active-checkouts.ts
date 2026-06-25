import {
  type ActiveCheckoutMaterializationRecord,
  type ActiveCheckoutMaterializationStore,
  decodeActiveCheckoutMaterializationRecord,
  decodeStoredActiveCheckoutMaterializationRecord,
  storedActiveCheckoutMaterializationRecord,
} from './active-checkout-materialization-store';
import { ACTIVE_CHECKOUTS_STORE } from './provider-indexeddb-schema';
import { idbRequest, idbTransactionDone } from './provider-indexeddb/internal';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export class IndexedDbActiveCheckoutMaterializationStore implements ActiveCheckoutMaterializationStore {
  private readonly documentScopeKey: string;

  constructor(
    private readonly options: {
      readonly documentScope: VersionDocumentScope;
      readonly getDb: () => Promise<IDBDatabase>;
    },
  ) {
    this.documentScopeKey = versionDocumentScopeKey(
      normalizeVersionDocumentScope(options.documentScope),
    );
  }

  async read(): Promise<ActiveCheckoutMaterializationRecord | null> {
    const db = await this.options.getDb();
    const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    const store = tx.objectStore(ACTIVE_CHECKOUTS_STORE);
    const row = await idbRequest<unknown | undefined>(store.get(this.documentScopeKey));
    if (row === undefined) {
      await done;
      return null;
    }

    const decoded = decodeStoredActiveCheckoutMaterializationRecord(row, this.documentScopeKey);
    if (decoded.status === 'valid') {
      await done;
      return decoded.record;
    }

    await idbRequest(store.delete(this.documentScopeKey));
    await done;
    return null;
  }

  async write(
    record: Omit<ActiveCheckoutMaterializationRecord, 'documentScopeKey'>,
  ): Promise<void> {
    const materialization = decodeActiveCheckoutMaterializationRecord(
      {
        ...record,
        documentScopeKey: this.documentScopeKey,
      },
      this.documentScopeKey,
    );
    if (!materialization) {
      throw new Error('Active checkout materialization record is malformed.');
    }
    const db = await this.options.getDb();
    const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    await idbRequest(
      tx
        .objectStore(ACTIVE_CHECKOUTS_STORE)
        .put(storedActiveCheckoutMaterializationRecord(materialization), this.documentScopeKey),
    );
    await done;
  }

  async clear(): Promise<void> {
    const db = await this.options.getDb();
    const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
    const done = idbTransactionDone(tx);
    await idbRequest(tx.objectStore(ACTIVE_CHECKOUTS_STORE).delete(this.documentScopeKey));
    await done;
  }
}
