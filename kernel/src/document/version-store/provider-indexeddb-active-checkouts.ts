import {
  type ActiveCheckoutMaterializationRecord,
  type ActiveCheckoutMaterializationStore,
  decodeActiveCheckoutMaterializationRecord,
} from './active-checkout-materialization-store';
import { ACTIVE_CHECKOUTS_STORE } from './provider-indexeddb-schema';
import { idbRequest, idbTransactionDone } from './provider-indexeddb/internal';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

export class IndexedDbActiveCheckoutMaterializationStore
  implements ActiveCheckoutMaterializationStore
{
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
    const row = await idbRequest<unknown | undefined>(
      db.transaction(ACTIVE_CHECKOUTS_STORE, 'readonly')
        .objectStore(ACTIVE_CHECKOUTS_STORE)
        .get(this.documentScopeKey),
    );
    return decodeActiveCheckoutMaterializationRecord(row, this.documentScopeKey);
  }

  async write(
    record: Omit<ActiveCheckoutMaterializationRecord, 'documentScopeKey'>,
  ): Promise<void> {
    const db = await this.options.getDb();
    const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
    await idbRequest(
      tx.objectStore(ACTIVE_CHECKOUTS_STORE).put(
        {
          ...record,
          documentScopeKey: this.documentScopeKey,
        } satisfies ActiveCheckoutMaterializationRecord,
        this.documentScopeKey,
      ),
    );
    await idbTransactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.options.getDb();
    const tx = db.transaction(ACTIVE_CHECKOUTS_STORE, 'readwrite');
    await idbRequest(tx.objectStore(ACTIVE_CHECKOUTS_STORE).delete(this.documentScopeKey));
    await idbTransactionDone(tx);
  }
}
