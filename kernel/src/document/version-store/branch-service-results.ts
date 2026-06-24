import type { WorkbookCommitId } from './object-digest';
import { refNameStorageKey, type RefName, type RefNameDiagnostic } from './refs/ref-name';
import type {
  BranchFailureResult,
  BranchRecord,
  BranchRefName,
  BranchServiceErrorCode,
  DeletedBranchRecord,
} from './branch-service-types';
import type {
  DeleteRefResult as RefStoreDeleteRefResult,
  LiveRefRecord,
  RefMutationConflict,
  RefMutationResult as RefStoreMutationResult,
  RefVersion,
  TombstoneRefRecord,
  VersionDiagnostic,
} from './refs/ref-store';

export function branchFromLiveRef(ref: LiveRefRecord): BranchRecord {
  const cloned = cloneLiveRefRecord(ref);
  return Object.freeze({
    name: cloned.name,
    refName: refNameStorageKey(cloned.name) as BranchRefName,
    ref: cloned,
  });
}

export function branchFromTombstoneRef(ref: TombstoneRefRecord): DeletedBranchRecord {
  const cloned = cloneTombstoneRefRecord(ref);
  return Object.freeze({
    name: cloned.name,
    refName: refNameStorageKey(cloned.name) as BranchRefName,
    ref: cloned,
  });
}

export function fromRefStoreFailure(result: {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}): BranchFailureResult {
  return failure(
    branchErrorCodeFromRefStore(result.error.code),
    result.error.message,
    result.diagnostics,
    result.conflict,
  );
}

export function casConflict(
  name: RefName,
  result: Extract<RefStoreMutationResult | RefStoreDeleteRefResult, { readonly ok: false }>,
): BranchFailureResult {
  return failure(
    'casConflict',
    'Branch compare-and-swap conflict.',
    [
      diagnostic(
        'casConflict',
        'Branch compare-and-swap conflict.',
        name,
        result.conflict?.actualHead,
        result.conflict?.actualRefVersion,
        result.conflict?.actualRefIncarnationId,
        { cause: result.error.code },
      ),
      ...result.diagnostics,
    ],
    result.conflict,
  );
}

export function unsupportedDetachedHead(
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
): BranchFailureResult {
  return failure('unsupportedDetachedHead', message, [
    diagnostic('unsupportedDetachedHead', message, refName, commitId, undefined, undefined, {
      target: 'HEAD',
    }),
  ]);
}

export function activeRefDeleteRejected(name: RefName): BranchFailureResult {
  return failure('activeRef', 'The active branch cannot be deleted before switching heads.', [
    diagnostic(
      'activeRef',
      'The active branch cannot be deleted before switching heads.',
      name,
      undefined,
      undefined,
      undefined,
      { issue: 'activeBranchDelete' },
    ),
  ]);
}

export function failure(
  code: BranchServiceErrorCode,
  message: string,
  diagnostics: readonly VersionDiagnostic[],
  conflict?: RefMutationConflict,
): BranchFailureResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, diagnostics }),
    conflict,
    diagnostics,
  });
}

export function diagnostic(
  code: string,
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
  refVersion?: RefVersion,
  refIncarnationId?: string,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    refName,
    commitId,
    refVersion: refVersion === undefined ? undefined : cloneRefVersion(refVersion),
    refIncarnationId,
    details: details === undefined ? undefined : Object.freeze({ ...details }),
  });
}

export function refNameDiagnostics(
  diagnostics: readonly RefNameDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(item.code, item.message, item.value, undefined, undefined, undefined, {
      issue: item.issue,
    }),
  );
}

export function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

function branchErrorCodeFromRefStore(code: string): BranchServiceErrorCode {
  switch (code) {
    case 'invalidRefName':
    case 'invalidCommitId':
    case 'invalidRefVersion':
    case 'invalidRefPrefix':
    case 'protectedRef':
    case 'unsupportedRefOption':
    case 'refAlreadyExists':
    case 'refNotFound':
    case 'refTombstoned':
    case 'lastLiveRef':
    case 'unsupportedRefMetadataMutation':
    case 'versionCapabilityDisabled':
      return code;
    case 'expectedHeadMismatch':
    case 'expectedRefVersionMismatch':
      return 'casConflict';
    default:
      return 'versionCapabilityDisabled';
  }
}

function cloneLiveRefRecord(ref: LiveRefRecord): LiveRefRecord {
  return Object.freeze({
    ...ref,
    providerEpoch: Object.freeze({ ...ref.providerEpoch }),
    refVersion: cloneRefVersion(ref.refVersion),
    createdBy: Object.freeze({ ...ref.createdBy }),
    updatedBy: Object.freeze({ ...ref.updatedBy }),
  });
}

function cloneTombstoneRefRecord(ref: TombstoneRefRecord): TombstoneRefRecord {
  return Object.freeze({
    ...ref,
    previousProviderEpoch: Object.freeze({ ...ref.previousProviderEpoch }),
    refVersion: cloneRefVersion(ref.refVersion),
    deletedBy: Object.freeze({ ...ref.deletedBy }),
    deleteDiagnostics: ref.deleteDiagnostics?.map((item) => Object.freeze({ ...item })),
  });
}
