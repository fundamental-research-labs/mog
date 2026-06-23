import { expect } from '@jest/globals';

import type {
  VersionMergeConflictResolutionOption,
  VersionMergeInput,
} from '@mog-sdk/contracts/api';
import { WorkbookVersionImpl } from '../version';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const DIGEST_A = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
export const DIGEST_B = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
export const DIGEST_C = { algorithm: 'sha256', digest: 'c'.repeat(64) } as const;
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

export function mergeInput(): VersionMergeInput {
  return { base: BASE, ours: OURS, theirs: THEIRS };
}

export function invalidCommitPayloadFailureMatcher() {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.merge',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_INVALID_COMMIT_PAYLOAD',
          data: expect.objectContaining({ redacted: true }),
        }),
      ],
    },
  };
}

export function resolutionOption(
  kind: 'acceptOurs' | 'acceptTheirs' | 'acceptBase',
  value: string,
): VersionMergeConflictResolutionOption {
  return {
    optionId: `option:${kind}`,
    conflictId: 'conflict:cell:sheet-1:B1:value',
    kind,
    value: { kind: 'value', value },
    recalcRequired: true,
  };
}

export function workbookVersionWithMergeService(
  merge: unknown,
  manifestRuntime = versionDomainSupportManifestRuntime(),
) {
  return new WorkbookVersionImpl({
    versioning: {
      mergeService: { merge },
      ...manifestRuntime,
    },
  } as any);
}

export function workbookVersionWithoutMergeService() {
  return new WorkbookVersionImpl({ versioning: {} } as any);
}
