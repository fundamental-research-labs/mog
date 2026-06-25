import type { VersionApplyMergeResult } from '@mog-sdk/contracts/api';

import {
  mapCommitId,
  mapVersionApplyMergeAttemptMetadata,
} from '../../../version-attempt-metadata';
import { mapWorkbookCommitRef } from './version-apply-merge-write-result-commit-ref';
import {
  SUCCESS_WRITE_STATUSES,
  TERMINAL_WRITE_STATUSES,
} from './version-apply-merge-write-result-constants';
import {
  blockedApplyMergeResult,
  invalidProviderPayloadDiagnostic,
  mapWriteDiagnostics,
  providerErrorDiagnostic,
  staleTargetHeadDiagnostic,
} from './version-apply-merge-write-result-diagnostics';
import {
  appliedWriteIdentityDiagnostics,
  blockedWriteMetadata,
  terminalWriteIdentityDiagnostics,
} from './version-apply-merge-write-result-identity';
import {
  toApplyMergeMutationGuarantee,
  toTerminalMutationGuarantee,
} from './version-apply-merge-write-result-mutation-guarantee';
import { isRecord } from './version-apply-merge-write-result-shape';
import type { VersionApplyMergeWritePlan } from './version-apply-merge-write-result-types';

export function mapApplyMergeWriteResult(
  value: unknown,
  plan: VersionApplyMergeWritePlan,
  successMutationGuarantee: VersionApplyMergeResult['mutationGuarantee'],
): VersionApplyMergeResult {
  if (!isRecord(value)) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [providerErrorDiagnostic()]);
  }

  const metadata = mapVersionApplyMergeAttemptMetadata(value);
  if (!metadata) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      invalidProviderPayloadDiagnostic(),
    ]);
  }

  if (TERMINAL_WRITE_STATUSES.has(String(value.status))) {
    const commit = mapWorkbookCommitRef(value.commitRef ?? value.commit);
    const diagnostics = Array.isArray(value.diagnostics)
      ? mapWriteDiagnostics(value.diagnostics)
      : [];
    const identityDiagnostics = terminalWriteIdentityDiagnostics(
      value.status,
      metadata,
      plan,
      commit,
    );
    const mutationGuarantee =
      toTerminalMutationGuarantee(value.mutationGuarantee) ??
      (value.status === 'fastForwarded' ? 'ref-fast-forwarded' : 'ref-not-mutated');
    if (!commit || diagnostics.length > 0 || identityDiagnostics.length > 0) {
      return blockedApplyMergeResult(
        plan.base,
        plan.ours,
        plan.theirs,
        [
          ...diagnostics,
          ...identityDiagnostics,
          ...(!commit || diagnostics.length > 0 ? [invalidProviderPayloadDiagnostic()] : []),
        ],
        'ref-not-mutated',
      );
    }
    return {
      ...metadata,
      status: value.status as 'fastForwarded' | 'alreadyApplied' | 'alreadyMerged',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      commitRef: commit,
      changes: [],
      conflicts: [],
      diagnostics: [],
      resolutionCount: plan.resolutionCount,
      mutationGuarantee,
    };
  }

  if (value.status === 'staleTargetHead') {
    const diagnostics =
      value.diagnostics === undefined ? [] : mapWriteDiagnostics(value.diagnostics);
    return {
      ...metadata,
      status: 'staleTargetHead',
      base: mapCommitId(value.base) ?? plan.base,
      ours: mapCommitId(value.ours) ?? plan.ours,
      theirs: mapCommitId(value.theirs) ?? plan.theirs,
      changes: [],
      conflicts: [],
      diagnostics: diagnostics.length > 0 ? diagnostics : [staleTargetHeadDiagnostic()],
      mutationGuarantee: 'ref-not-mutated',
    };
  }

  if (!SUCCESS_WRITE_STATUSES.has(String(value.status))) {
    return blockedApplyMergeResult(
      plan.base,
      plan.ours,
      plan.theirs,
      mapWriteDiagnostics(value.diagnostics),
      toApplyMergeMutationGuarantee(value.mutationGuarantee),
    );
  }

  const commit = mapWorkbookCommitRef(value.commitRef ?? value.commit);
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapWriteDiagnostics(value.diagnostics)
    : [];
  const identityDiagnostics = appliedWriteIdentityDiagnostics(
    metadata,
    plan,
    commit,
    successMutationGuarantee,
  );
  if (!commit || diagnostics.length > 0 || identityDiagnostics.length > 0) {
    const blocked = blockedApplyMergeResult(
      plan.base,
      plan.ours,
      plan.theirs,
      [
        ...diagnostics,
        ...identityDiagnostics,
        ...(!commit || diagnostics.length > 0 ? [invalidProviderPayloadDiagnostic()] : []),
      ],
      commit ? 'unknown-after-crash' : 'no-write-attempted',
    );
    return commit
      ? {
          ...blockedWriteMetadata(metadata, plan, commit),
          ...blocked,
        }
      : blocked;
  }

  return {
    ...metadata,
    status: 'applied',
    base: plan.base,
    ours: plan.ours,
    theirs: plan.theirs,
    commitRef: commit,
    changes: plan.changes,
    conflicts: [],
    diagnostics: [],
    resolutionCount: plan.resolutionCount,
    mutationGuarantee: successMutationGuarantee,
  };
}

export function isApplyMergeWriteSuccessResult(result: VersionApplyMergeResult): boolean {
  return (
    result.status === 'applied' ||
    result.status === 'fastForwarded' ||
    result.status === 'alreadyApplied' ||
    result.status === 'alreadyMerged'
  );
}

export function isNonFastForwardWriteResult(value: unknown): boolean {
  if (!isRecord(value) || isKnownWriteOutcomeStatus(value.status)) return false;
  if (!Array.isArray(value.diagnostics)) return false;
  return value.diagnostics.some((diagnostic) => {
    if (!isRecord(diagnostic)) return false;
    return (
      diagnostic.code === 'VERSION_UNSUPPORTED_PARENT_COMMIT' ||
      diagnostic.issueCode === 'VERSION_UNSUPPORTED_PARENT_COMMIT'
    );
  });
}

function isKnownWriteOutcomeStatus(value: unknown): boolean {
  return (
    SUCCESS_WRITE_STATUSES.has(String(value)) ||
    TERMINAL_WRITE_STATUSES.has(String(value)) ||
    value === 'staleTargetHead'
  );
}
