import type { InMemoryVersionGraphStoreSnapshot } from '../graph-store';

export function withoutDigest(
  snapshot: InMemoryVersionGraphStoreSnapshot,
  digest: string,
): InMemoryVersionGraphStoreSnapshot {
  return {
    ...snapshot,
    objectRecords: snapshot.objectRecords.filter((record) => record.digest.digest !== digest),
  };
}
