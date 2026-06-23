import type { RefRecord } from './ref-store-types';

export type InMemoryRefStoreSnapshot = {
  readonly records: readonly RefRecord[];
  readonly nextGeneratedId: number;
  readonly liveRefCount?: number;
};
