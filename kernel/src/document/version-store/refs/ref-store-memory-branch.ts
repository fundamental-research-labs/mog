import { parseRefName } from './ref-name';
import { refAlreadyExists } from './ref-store-conflicts';
import { diagnostic, failure } from './ref-store-diagnostics';
import { cloneLiveRefRecord, nextProviderEpoch, nextRefVersion } from './ref-store-revisions';
import { refTombstoned, validateTombstoneReuseMetadata } from './ref-store-tombstones';
import type {
  CreateBranchInput,
  CreateBranchResult,
  InitializeMainInput,
  RefMutationResult,
} from './ref-store-types';
import { parseCommitForResult, parseRefNameForResult } from './ref-store-validation';
import { createLiveMemoryRef, type InMemoryRefStoreState } from './ref-store-memory-state';

export function initializeMemoryMain(
  state: InMemoryRefStoreState,
  input: InitializeMainInput,
): RefMutationResult {
  const targetCommitId = parseCommitForResult(input.targetCommitId, 'targetCommitId');
  if (!targetCommitId.ok) return targetCommitId.result;

  const baseCommitId =
    input.baseCommitId === undefined
      ? undefined
      : parseCommitForResult(input.baseCommitId, 'baseCommitId');
  if (baseCommitId !== undefined && !baseCommitId.ok) return baseCommitId.result;

  const name = parseRefName('main');
  const existing = state.records.get(name);
  if (existing?.state === 'live') {
    return refAlreadyExists(existing);
  }
  if (existing?.state === 'tombstone') {
    return refTombstoned(existing);
  }

  const ref = createLiveMemoryRef(state, {
    name,
    targetCommitId: targetCommitId.commitId,
    baseCommitId: baseCommitId?.commitId,
    protected: input.protected ?? true,
    author: input.createdBy,
  });

  state.records.set(name, ref);
  state.liveRefCount += 1;
  return { ok: true, ref: cloneLiveRefRecord(ref), diagnostics: [] };
}

export function createMemoryBranch(
  state: InMemoryRefStoreState,
  input: CreateBranchInput,
): CreateBranchResult {
  const parsedName = parseRefNameForResult(input.name);
  if (!parsedName.ok) return parsedName.result;

  if (input.expectedAbsent !== true) {
    return failure('unsupportedRefOption', 'createBranch requires expectedAbsent: true.', [
      diagnostic(
        'unsupportedRefOption',
        'createBranch requires expectedAbsent: true.',
        parsedName.name,
      ),
    ]);
  }

  if (parsedName.name === 'main') {
    return failure('protectedRef', 'main can only be created by root/import initialization.', [
      diagnostic('protectedRef', 'main can only be created by root/import initialization.', 'main'),
    ]);
  }

  const targetCommitId = parseCommitForResult(input.targetCommitId, 'targetCommitId');
  if (!targetCommitId.ok) return targetCommitId.result;

  const baseCommitId =
    input.baseCommitId === undefined
      ? undefined
      : parseCommitForResult(input.baseCommitId, 'baseCommitId');
  if (baseCommitId !== undefined && !baseCommitId.ok) return baseCommitId.result;

  const existing = state.records.get(parsedName.name);
  if (existing?.state === 'live') {
    return refAlreadyExists(existing);
  }
  if (existing?.state === 'tombstone') {
    const reuse = validateTombstoneReuseMetadata(existing, input.reuseTombstone);
    if (!reuse.ok) return reuse.result;
    const ref = createLiveMemoryRef(state, {
      name: parsedName.name,
      targetCommitId: targetCommitId.commitId,
      baseCommitId: baseCommitId?.commitId,
      protected: input.protected ?? false,
      author: input.createdBy,
      providerEpoch: nextProviderEpoch(existing.previousProviderEpoch),
      refVersion: nextRefVersion(existing.refVersion),
    });

    state.records.set(parsedName.name, ref);
    state.liveRefCount += 1;
    return { ok: true, ref: cloneLiveRefRecord(ref), attached: false, diagnostics: [] };
  }

  const ref = createLiveMemoryRef(state, {
    name: parsedName.name,
    targetCommitId: targetCommitId.commitId,
    baseCommitId: baseCommitId?.commitId,
    protected: input.protected ?? false,
    author: input.createdBy,
  });

  state.records.set(parsedName.name, ref);
  state.liveRefCount += 1;
  return { ok: true, ref: cloneLiveRefRecord(ref), attached: false, diagnostics: [] };
}
