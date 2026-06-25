import {
  expectedHeadMismatch,
  expectedRefVersionMismatch,
  protectedRef,
  refNotFound,
  unsupportedRefMetadataMutation,
} from './ref-store-conflicts';
import {
  cloneLiveRefRecord,
  copyAuthor,
  freezeLiveRefRecord,
  nextRefVersion,
  refVersionsEqual,
} from './ref-store-revisions';
import { refTombstoned } from './ref-store-tombstones';
import type { RefMutationResult, UpdateRefInput } from './ref-store-types';
import {
  parseCommitForResult,
  parseRefNameForResult,
  parseRefVersionForResult,
} from './ref-store-validation';
import { currentMemoryRefStoreTime, type InMemoryRefStoreState } from './ref-store-memory-state';

export function updateMemoryRef(
  state: InMemoryRefStoreState,
  input: UpdateRefInput,
  allowProtected: boolean,
): RefMutationResult {
  const parsedName = parseRefNameForResult(input.name);
  if (!parsedName.ok) return parsedName.result;

  const nextCommitId = parseCommitForResult(input.nextCommitId, 'nextCommitId');
  if (!nextCommitId.ok) return nextCommitId.result;

  const expectedHead =
    input.expectedHead === undefined
      ? undefined
      : parseCommitForResult(input.expectedHead, 'expectedHead');
  if (expectedHead !== undefined && !expectedHead.ok) return expectedHead.result;

  const expectedRefVersion = parseRefVersionForResult(input.expectedRefVersion);
  if (!expectedRefVersion.ok) return expectedRefVersion.result;

  const record = state.records.get(parsedName.name);
  if (record === undefined) {
    return refNotFound(parsedName.name);
  }
  if (record.state === 'tombstone') {
    return refTombstoned(record);
  }
  if (record.protected && !allowProtected) {
    return protectedRef(record.name, 'update');
  }
  if (expectedHead !== undefined && record.targetCommitId !== expectedHead.commitId) {
    return expectedHeadMismatch(record, expectedHead.commitId);
  }
  if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
    return expectedRefVersionMismatch(record, expectedRefVersion.refVersion);
  }
  if (record.targetCommitId === nextCommitId.commitId) {
    return unsupportedRefMetadataMutation(record);
  }

  const updated = freezeLiveRefRecord({
    ...record,
    targetCommitId: nextCommitId.commitId,
    updatedAt: currentMemoryRefStoreTime(state),
    updatedBy: copyAuthor(input.updatedBy),
    refVersion: nextRefVersion(record.refVersion),
  });

  state.records.set(record.name, updated);
  return { ok: true, ref: cloneLiveRefRecord(updated), diagnostics: [] };
}
