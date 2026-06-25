import {
  WorkbookVersionReviewRecordStoreImpl,
  decodeStoredWorkbookVersionReviewRecordRow,
  reviewRecordStorageKey,
  storedWorkbookVersionReviewRecordRow,
  type ReviewRecordRowMutation,
  type WorkbookVersionReviewRecordStoreRow,
} from './review-service';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { INTENTS_STORE } from './provider-indexeddb-schema';
import { idbRequest, idbTransactionDone } from './provider-indexeddb/internal';

export class IndexedDbWorkbookVersionReviewRecordStore extends WorkbookVersionReviewRecordStoreImpl {
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(reviewId) {
          const db = await options.getDb();
          const row = await idbRequest<unknown | undefined>(
            db
              .transaction(INTENTS_STORE, 'readonly')
              .objectStore(INTENTS_STORE)
              .get(reviewRecordStorageKey(documentScopeKey, reviewId)),
          );
          return decodeStoredWorkbookVersionReviewRecordRow(row, documentScopeKey) ?? undefined;
        },
        async listRows() {
          const db = await options.getDb();
          const tx = db.transaction(INTENTS_STORE, 'readonly');
          const done = idbTransactionDone(tx);
          const rows = await rowsForDocumentScope(tx.objectStore(INTENTS_STORE), documentScopeKey);
          await done;
          return rows;
        },
        async mutateRow<T>(
          reviewId: string,
          mutator: (
            row: WorkbookVersionReviewRecordStoreRow | undefined,
          ) => ReviewRecordRowMutation<T>,
        ) {
          const db = await options.getDb();
          const tx = db.transaction(INTENTS_STORE, 'readwrite');
          const store = tx.objectStore(INTENTS_STORE);
          const key = reviewRecordStorageKey(documentScopeKey, reviewId);
          const existing =
            decodeStoredWorkbookVersionReviewRecordRow(
              await idbRequest<unknown | undefined>(store.get(key)),
              documentScopeKey,
            ) ?? undefined;
          const result = mutator(existing);
          if (result.action === 'put') {
            await idbRequest(store.put(storedWorkbookVersionReviewRecordRow(result.row), key));
          }
          await idbTransactionDone(tx);
          return result.result;
        },
        async mutateRows<T>(
          mutator: (
            rows: readonly WorkbookVersionReviewRecordStoreRow[],
          ) => ReviewRecordRowMutation<T>,
        ) {
          const db = await options.getDb();
          const tx = db.transaction(INTENTS_STORE, 'readwrite');
          const store = tx.objectStore(INTENTS_STORE);
          const rows = await rowsForDocumentScope(store, documentScopeKey);
          const result = mutator(rows);
          if (result.action === 'put') {
            await idbRequest(
              store.put(
                storedWorkbookVersionReviewRecordRow(result.row),
                reviewRecordStorageKey(documentScopeKey, result.row.record.id),
              ),
            );
          }
          await idbTransactionDone(tx);
          return result.result;
        },
      },
    });
  }
}

function rowsForDocumentScope(
  store: IDBObjectStore,
  documentScopeKey: string,
): Promise<readonly WorkbookVersionReviewRecordStoreRow[]> {
  return new Promise((resolve, reject) => {
    const rows: WorkbookVersionReviewRecordStoreRow[] = [];
    const request = store.index('documentScopeKey').openCursor(IDBKeyRange.only(documentScopeKey));
    request.onerror = () => reject(request.error ?? new Error('review record cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const row = decodeStoredWorkbookVersionReviewRecordRow(cursor.value, documentScopeKey);
      if (row) rows.push(row);
      cursor.continue();
    };
  });
}
