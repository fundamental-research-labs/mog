import type {
  VersionApplyMergeResolution,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeResult,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const MERGE = `commit:sha256:${'4'.repeat(64)}` as VersionMergeInput['ours'];
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};
export const DIGEST_A = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
export const DIGEST_B = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
export const DIGEST_C = { algorithm: 'sha256', digest: 'c'.repeat(64) } as const;

export function conflictedResult(conflict: VersionMergeConflict): VersionMergeResult {
  return {
    status: 'conflicted',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [],
    conflicts: [conflict],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function ancestryResult(status: 'fastForward' | 'alreadyMerged'): VersionMergeResult {
  return {
    status,
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function sameCellConflict(): VersionMergeConflict {
  const conflictId = 'conflict:sha256:same-cell-a1';
  return {
    conflictId,
    conflictDigest: 'sha256:same-cell-a1',
    conflictKind: 'same-property',
    structural: metadata('merge-conflict-a1', 'sheet-1!A1'),
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    resolutionOptions: [
      option(conflictId, 'acceptOurs', 'ours'),
      option(conflictId, 'acceptTheirs', 'theirs'),
      option(conflictId, 'acceptBase', 'base'),
    ],
  };
}

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase',
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`missing option ${kind}`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

function option(
  conflictId: string,
  kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase',
  value: string,
) {
  return {
    optionId: `option:${kind}`,
    conflictId,
    kind,
    value: { kind: 'value' as const, value },
    recalcRequired: true,
  };
}

export function metadata(
  changeId: string,
  entityId: string,
  domain = 'cells.values',
  propertyPath: readonly string[] = ['value'],
) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain,
    entityId,
    propertyPath,
  };
}

export function workbookVersionWithVersioning(
  versioning: Record<string, unknown>,
  manifestRuntime = versionDomainSupportManifestRuntime(),
) {
  return new WorkbookVersionImpl({
    versioning: {
      ...versioning,
      ...manifestRuntime,
    },
  } as any);
}
