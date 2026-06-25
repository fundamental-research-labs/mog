import type { createInMemoryVersionStoreProvider, VersionStoreProvider } from '../provider';

export type InMemoryProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
export type ConflictProvider = VersionStoreProvider &
  Pick<InMemoryProvider, 'openPendingRemoteSegmentStore' | 'openSyncBatchStatusStore'>;
