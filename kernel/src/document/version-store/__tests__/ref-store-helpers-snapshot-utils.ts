import { createInMemoryRefStore, type LiveRefRecord, type RefVersion } from '../refs/ref-store';
import type { InMemoryRefStoreSnapshot } from '../refs/ref-store-snapshot';
import { expectCreateOk } from './ref-store-helpers-assertions';
import { AUTHOR, COMMIT_A } from './ref-store-helpers-fixtures';

export function createBranch(
  store: ReturnType<typeof createInMemoryRefStore>,
  name: string,
): LiveRefRecord {
  const result = store.createBranch({
    name,
    targetCommitId: COMMIT_A,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expectCreateOk(result);
  return result.ref;
}

export function withMalformedRefName(
  snapshot: InMemoryRefStoreSnapshot,
  existingName: string,
  nextName: string,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === existingName ? Object.freeze({ ...record, name: nextName }) : record,
      ),
    ),
  }) as InMemoryRefStoreSnapshot;
}

export function withMalformedRefVersion(
  snapshot: InMemoryRefStoreSnapshot,
  name: string,
  refVersion: RefVersion,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === name ? Object.freeze({ ...record, refVersion }) : record,
      ),
    ),
  });
}

export function withMalformedTimestamp(
  snapshot: InMemoryRefStoreSnapshot,
  name: string,
  field: 'createdAt' | 'updatedAt' | 'deletedAt',
  value: string,
): InMemoryRefStoreSnapshot {
  return Object.freeze({
    ...snapshot,
    records: Object.freeze(
      snapshot.records.map((record) =>
        record.name === name ? Object.freeze({ ...record, [field]: value }) : record,
      ),
    ),
  }) as InMemoryRefStoreSnapshot;
}
