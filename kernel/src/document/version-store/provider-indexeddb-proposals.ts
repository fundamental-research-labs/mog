import {
  AgentProposalMetadataStoreImpl,
  agentProposalStorageKey,
  decodeStoredAgentProposalRow,
  storedAgentProposalRow,
  type AgentProposalRowMutation,
  type AgentProposalStoreRow,
} from './proposals/proposal-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import { PROPOSALS_STORE } from './provider-indexeddb-schema';
import { idbRequest, idbTransactionDone } from './provider-indexeddb/internal';

export class IndexedDbAgentProposalMetadataStore extends AgentProposalMetadataStoreImpl {
  constructor(options: {
    readonly documentScope: VersionDocumentScope;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    const documentScope = normalizeVersionDocumentScope(options.documentScope);
    const documentScopeKey = versionDocumentScopeKey(documentScope);
    super({
      documentScope,
      adapter: {
        async readRow(proposalId) {
          const db = await options.getDb();
          const row = await idbRequest<unknown | undefined>(
            db
              .transaction(PROPOSALS_STORE, 'readonly')
              .objectStore(PROPOSALS_STORE)
              .get(agentProposalStorageKey(documentScopeKey, proposalId)),
          );
          return decodeStoredAgentProposalRow(row, documentScopeKey) ?? undefined;
        },
        async listRows() {
          const db = await options.getDb();
          const tx = db.transaction(PROPOSALS_STORE, 'readonly');
          const done = idbTransactionDone(tx);
          const rows = await rowsForDocumentScope(
            tx.objectStore(PROPOSALS_STORE),
            documentScopeKey,
          );
          await done;
          return rows;
        },
        async mutateRow<T>(
          proposalId: string,
          mutator: (row: AgentProposalStoreRow | undefined) => AgentProposalRowMutation<T>,
        ) {
          const db = await options.getDb();
          const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
          const store = tx.objectStore(PROPOSALS_STORE);
          const key = agentProposalStorageKey(documentScopeKey, proposalId);
          const existing =
            decodeStoredAgentProposalRow(
              await idbRequest<unknown | undefined>(store.get(key)),
              documentScopeKey,
            ) ?? undefined;
          const result = mutator(existing);
          if (result.action === 'put') {
            await idbRequest(store.put(storedAgentProposalRow(result.row), key));
          }
          await idbTransactionDone(tx);
          return result.result;
        },
        async mutateRows<T>(
          mutator: (rows: readonly AgentProposalStoreRow[]) => AgentProposalRowMutation<T>,
        ) {
          const db = await options.getDb();
          const tx = db.transaction(PROPOSALS_STORE, 'readwrite');
          const store = tx.objectStore(PROPOSALS_STORE);
          const rows = await rowsForDocumentScope(store, documentScopeKey);
          const result = mutator(rows);
          if (result.action === 'put') {
            await idbRequest(
              store.put(
                storedAgentProposalRow(result.row),
                agentProposalStorageKey(documentScopeKey, result.row.record.id),
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
): Promise<readonly AgentProposalStoreRow[]> {
  return new Promise((resolve, reject) => {
    const rows: AgentProposalStoreRow[] = [];
    const request = store.index('documentScopeKey').openCursor(IDBKeyRange.only(documentScopeKey));
    request.onerror = () => reject(request.error ?? new Error('proposal cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const row = decodeStoredAgentProposalRow(cursor.value, documentScopeKey);
      if (row) rows.push(row);
      cursor.continue();
    };
  });
}
