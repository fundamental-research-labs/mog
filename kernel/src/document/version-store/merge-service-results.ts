import type { VersionMergeInput, VersionMergeResult } from '@mog-sdk/contracts/api';

import type { MergeDiagnostic } from './merge-service-diagnostics';

export function fastForward(input: VersionMergeInput): VersionMergeResult {
  return {
    status: 'fastForward',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function alreadyMerged(input: VersionMergeInput): VersionMergeResult {
  return {
    status: 'alreadyMerged',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function blocked(
  input: VersionMergeInput,
  diagnostics: readonly MergeDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}
