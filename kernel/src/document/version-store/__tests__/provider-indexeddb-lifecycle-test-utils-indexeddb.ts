import 'fake-indexeddb/auto';

import { openVersionStoreIndexedDb, REGISTRIES_STORE } from '../provider-indexeddb-schema';
import { versionDocumentScopeKey, type VersionDocumentScope } from '../provider';

export async function putRegistryEnvelope(
  documentScope: VersionDocumentScope,
  value: unknown,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REGISTRIES_STORE, 'readwrite');
  tx.objectStore(REGISTRIES_STORE).put(value, versionDocumentScopeKey(documentScope));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('registry put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('registry put aborted'));
  });
  db.close();
}
