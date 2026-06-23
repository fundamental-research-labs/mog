import { expect, it, jest } from '@jest/globals';

import type { VersionMergeResult } from '@mog-sdk/contracts/api';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
import {
  BASE,
  EXPECTED_TARGET_HEAD,
  mergeInput,
  OURS,
  TARGET_REF,
  THEIRS,
  workbookVersionWithMergeService,
} from './version-merge-provider-test-utils';

export function describeMergeProviderDelegationScenarios(): void {
  it('delegates merge preview through an attached document-scoped service', async () => {
    const manifestRuntime = versionDomainSupportManifestRuntime();
    const cellsValues = manifestRuntime.domainSupportManifest.domains.find(
      (row) => row.matrixRowId === 'cells.values',
    );
    expect(cellsValues?.capabilityStates.merge).toBe('supported');

    const result: VersionMergeResult = {
      status: 'clean',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    };
    const merge = jest.fn(async () => result);
    const version = workbookVersionWithMergeService(merge, manifestRuntime);

    await expect(
      version.merge(mergeInput(), {
        mode: 'preview',
        includeDiagnostics: true,
        targetRef: TARGET_REF as any,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
        persistReviewRecord: true,
      }),
    ).resolves.toStrictEqual({ ok: true, value: result });
    expect(merge).toHaveBeenCalledWith(mergeInput(), {
      mode: 'preview',
      includeDiagnostics: true,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      persistReviewRecord: true,
    });
  });
}
