import type { RefRecord } from './ref-store';

export type InMemoryRefStoreSnapshot = {
  readonly records: readonly RefRecord[];
  readonly nextGeneratedId: number;
};
