import 'fake-indexeddb/auto';

import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';

export async function resetVersionStoreIndexedDbForXlsxImportRootTests(): Promise<void> {
  await deleteVersionStoreIndexedDbForTesting();
}

export function durableIndexedDbVersioning() {
  return {
    providerSelection: {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      requireDurablePersistence: true,
    },
  } as const;
}
