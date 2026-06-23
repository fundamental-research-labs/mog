import type {
  VersionRef,
  VersionRefMutationResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { toVersionRefRecordRevision } from './version-refs-diagnostics';
import {
  invalidPayloadDiagnostic,
  mapBranchFailureDiagnostics,
  providerErrorDiagnostic,
} from './version-refs-delete-diagnostics';
import { parsePublicBranchName } from './version-refs-delete-options';
import { isRecord, toCommitId, type DeleteRefOperation } from './version-refs-delete-types';

export function mapBranchMutationResult(
  value: unknown,
  operation: DeleteRefOperation,
): VersionRefMutationResult {
  if (!isRecord(value)) return degradedMutation(null, [providerErrorDiagnostic(operation)]);
  if (value.ok === false) {
    return degradedMutation(null, mapBranchFailureDiagnostics(value, operation));
  }
  const ref = mapBranchRecord(value.branch ?? value.ref ?? value);
  if (!ref) return degradedMutation(null, [invalidPayloadDiagnostic(operation)]);
  return { status: 'success', ref, diagnostics: [] };
}

export function mapBranchRecord(value: unknown): VersionRef | null {
  if (!isRecord(value)) return null;
  const ref = isRecord(value.ref) ? value.ref : value;
  const branchName =
    typeof value.name === 'string'
      ? value.name
      : typeof ref.name === 'string'
        ? ref.name
        : undefined;
  const commitId =
    toCommitId(ref.targetCommitId) ??
    toCommitId(ref.commitId) ??
    toCommitId(ref.previousTargetCommitId);
  const revision = toVersionRefRecordRevision(ref.refVersion, ref.revision);
  if (!branchName || !commitId || !revision) return null;
  const parsed = parsePublicBranchName(branchName, 'readRef');
  if (!parsed.ok) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof ref.deletedAt === 'string'
      ? { updatedAt: ref.deletedAt }
      : typeof ref.updatedAt === 'string'
        ? { updatedAt: ref.updatedAt }
        : {}),
  };
}

export function degradedMutation(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefMutationResult {
  return { status: 'degraded', ref, diagnostics };
}
