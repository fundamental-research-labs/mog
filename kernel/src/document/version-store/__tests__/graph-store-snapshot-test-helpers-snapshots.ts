import type { InMemoryVersionGraphStoreSnapshot } from '../graph';

export function withoutDigest(
  snapshot: InMemoryVersionGraphStoreSnapshot,
  digest: string,
): InMemoryVersionGraphStoreSnapshot {
  return {
    ...snapshot,
    objectRecords: snapshot.objectRecords.filter((record) => record.digest.digest !== digest),
  };
}
