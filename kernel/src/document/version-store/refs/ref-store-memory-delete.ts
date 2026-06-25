import {
  expectedHeadMismatch,
  expectedRefVersionMismatch,
  protectedRef,
  refNotFound,
} from './ref-store-conflicts';
import { diagnostic, failure } from './ref-store-diagnostics';
import {
  cloneDiagnostic,
  cloneProviderEpoch,
  cloneTombstoneRefRecord,
  copyAuthor,
  freezeTombstoneRefRecord,
  nextRefVersion,
  refVersionsEqual,
} from './ref-store-revisions';
import { refTombstoned } from './ref-store-tombstones';
import type { DeleteRefInput, DeleteRefResult } from './ref-store-types';
import {
  parseCommitForResult,
  parseRefNameForResult,
  parseRefVersionForResult,
} from './ref-store-validation';
import { currentMemoryRefStoreTime, type InMemoryRefStoreState } from './ref-store-memory-state';

export function deleteMemoryRef(
  state: InMemoryRefStoreState,
  input: DeleteRefInput,
): DeleteRefResult {
  const parsedName = parseRefNameForResult(input.name);
  if (!parsedName.ok) return parsedName.result;

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
  if (record.protected) {
    return protectedRef(record.name, 'delete');
  }
  if (state.liveRefCount <= 1) {
    const diagnostics = [
      diagnostic('lastLiveRef', 'Deleting the last live ref is not supported.', record.name),
    ];
    return failure('lastLiveRef', 'Deleting the last live ref is not supported.', diagnostics);
  }
  if (expectedHead !== undefined && record.targetCommitId !== expectedHead.commitId) {
    return expectedHeadMismatch(record, expectedHead.commitId);
  }
  if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
    return expectedRefVersionMismatch(record, expectedRefVersion.refVersion);
  }

  const tombstone = freezeTombstoneRefRecord({
    state: 'tombstone',
    schemaVersion: 1,
    versionDocumentId: state.versionDocumentId,
    name: record.name,
    previousTargetCommitId: record.targetCommitId,
    previousProviderRefId: record.providerRefId,
    previousProviderEpoch: cloneProviderEpoch(record.providerEpoch),
    previousRefIncarnationId: record.refIncarnationId,
    deletedAt: currentMemoryRefStoreTime(state),
    deletedBy: copyAuthor(input.deletedBy),
    deleteReason: input.deleteReason,
    deleteDiagnostics: input.deleteDiagnostics?.map(cloneDiagnostic),
    refVersion: nextRefVersion(record.refVersion),
  });

  state.records.set(record.name, tombstone);
  state.liveRefCount -= 1;
  return { ok: true, ref: cloneTombstoneRefRecord(tombstone), diagnostics: [] };
}
