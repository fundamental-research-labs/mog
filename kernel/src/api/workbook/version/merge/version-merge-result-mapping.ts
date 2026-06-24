import type {
  VersionMergeInput,
  VersionMergeResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { mapVersionMergeAttemptMetadata } from '../../version-attempt-metadata';
import {
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
} from '../../version-merge-public-diagnostics';
import { mapMergeChanges } from './version-merge-result-mapping-changes';
import { mapMergeConflicts } from './version-merge-result-mapping-conflicts';
import { isRecord, toCommitId } from './version-merge-result-mapping-shared';

export function mapMergeResult(value: unknown, fallback: VersionMergeInput): VersionMergeResult {
  if (!isRecord(value)) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  if (value.status === 'failed' || value.status === 'degraded' || value.status === 'blocked') {
    return blockedMergeResult(
      toCommitId(value.base) ?? fallback.base,
      toCommitId(value.ours) ?? fallback.ours,
      toCommitId(value.theirs) ?? fallback.theirs,
      mapGraphDiagnostics(value.diagnostics),
    );
  }

  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return blockedMergeResult(fallback.base, fallback.ours, fallback.theirs, [
      providerErrorDiagnostic(),
    ]);
  }

  const base = toCommitId(value.base);
  const ours = toCommitId(value.ours);
  const theirs = toCommitId(value.theirs);
  const changes = Array.isArray(value.changes) ? mapMergeChanges(value.changes) : null;
  const conflicts = Array.isArray(value.conflicts) ? mapMergeConflicts(value.conflicts) : null;
  const metadata = mapVersionMergeAttemptMetadata(value);
  const mutationGuarantee = value.mutationGuarantee === 'preview-only';
  const diagnostics =
    Array.isArray(value.diagnostics) && value.diagnostics.length > 0
      ? mapGraphDiagnostics(value.diagnostics)
      : [];

  if (
    !base ||
    !ours ||
    !theirs ||
    !changes ||
    !conflicts ||
    !metadata ||
    !mutationGuarantee ||
    diagnostics.length > 0
  ) {
    return blockedMergeResult(
      base ?? fallback.base,
      ours ?? fallback.ours,
      theirs ?? fallback.theirs,
      [
        ...diagnostics,
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service did not return a valid public merge preview.',
          { recoverability: 'repair' },
        ),
      ],
    );
  }

  if (value.status === 'clean') {
    if (conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned clean status with conflicts.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: 'clean',
      base,
      ours,
      theirs,
      changes,
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  if (value.status === 'fastForward' || value.status === 'alreadyMerged') {
    if (changes.length > 0 || conflicts.length > 0) {
      return blockedMergeResult(base, ours, theirs, [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version merge service returned ancestry status with merge changes.',
          { recoverability: 'repair' },
        ),
      ]);
    }
    return {
      ...metadata,
      status: value.status,
      base,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
  }

  return {
    ...metadata,
    status: 'conflicted',
    base,
    ours,
    theirs,
    changes,
    conflicts,
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function blockedMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}
