import { compareAscii } from './ref-store-ordering';
import { cloneLiveRefRecord, cloneTombstoneRefRecord } from './ref-store-revisions';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import type { InMemoryRefStoreState } from './ref-store-memory-state';

export function exportInMemoryRefStoreSnapshot(
  state: InMemoryRefStoreState,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    records: Object.freeze(
      [...state.records.values()]
        .sort((left, right) => compareAscii(left.name, right.name))
        .map((record) =>
          record.state === 'live' ? cloneLiveRefRecord(record) : cloneTombstoneRefRecord(record),
        ),
    ),
    nextGeneratedId: state.nextGeneratedId,
    liveRefCount: state.liveRefCount,
  });
}
