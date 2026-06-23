import { expect } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';

export const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
export const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
export const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
export const TARGET_REF = 'refs/heads/main';
export const EXPECTED_TARGET_HEAD = {
  commitId: OURS,
  revision: { kind: 'counter' as const, value: '1' },
};

export function mergeInput(): VersionMergeInput {
  return { base: BASE, ours: OURS, theirs: THEIRS };
}

export function plannedCheckoutResult(commitId: VersionMergeInput['base']) {
  return {
    ok: true,
    materialization: 'planned',
    plan: {
      strategy: 'fullSnapshot',
      commitId,
      parentCommitIds: [],
      resolvedTarget: { kind: 'commit', commitId },
      requiredDependencies: [{ role: 'snapshotRoot', objectType: 'workbook.snapshotRoot.v1' }],
    },
    diagnostics: [],
    mutationGuarantee: 'no-workbook-mutation',
  };
}

export function mergeCapabilityRegistryMismatch(operation: 'merge' | 'applyMerge') {
  return expect.objectContaining({
    code: 'VERSION_DOMAIN_SUPPORT_MANIFEST_INVALID',
    data: expect.objectContaining({
      operation,
      mutationGuarantee: 'no-write-attempted',
      payload: expect.objectContaining({
        diagnosticCode: 'domain-policy-registry-mismatch',
        domainId: 'cells.values',
        policyField: 'capabilityStates.merge',
        policyValue: 'redacted',
      }),
    }),
  });
}
