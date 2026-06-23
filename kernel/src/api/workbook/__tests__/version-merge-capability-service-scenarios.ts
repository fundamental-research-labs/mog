import { expect, jest } from '@jest/globals';

import type { VersionApplyMergeInput } from '@mog-sdk/contracts/api';

import { applyMergeWorkbookVersion } from '../version-apply-merge';
import { mergeWorkbookVersion } from '../version-merge';
import { OURS, THEIRS } from './version-merge-capability-test-utils';

export function registerMergeCapabilityServiceScenarios(): void {
  it('blocks merge before input validation or provider classification when versionControl.merge is disabled', async () => {
    const merge = jest.fn();
    const result = await mergeWorkbookVersion(
      {
        featureGates: { capabilities: { 'versionControl.merge': false } },
        versioning: { mergeService: { merge } },
      } as any,
      { base: 'redacted-bad-base', ours: OURS, theirs: THEIRS } as any,
      {},
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: null,
      ours: null,
      theirs: null,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
      safeMessage: 'Version-control merge capability is disabled for this workbook.',
      payload: {
        operation: 'merge',
        endpointStatus: 'capabilityDisabled',
        capability: 'version:mergePreview',
        featureGateCapability: 'versionControl.merge',
        publicCapability: 'version:mergePreview',
        reason: 'mergeCapabilityDisabled',
      },
      redacted: true,
      mutationGuarantee: 'no-write-attempted',
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('blocks persisted applyMerge before attempt lookup or provider mutation when the kill switch is active', async () => {
    const merge = jest.fn();
    const applyMerge = jest.fn();
    const readGraphRegistry = jest.fn();
    const openMergeApplyIntentStore = jest.fn();
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();
    const input = {
      resultId: 'merge-result:hidden',
      resultDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
    } as VersionApplyMergeInput;

    const result = await applyMergeWorkbookVersion(
      {
        versioning: {
          versionControlMergeKillSwitch: true,
          provider: { readGraphRegistry, openMergeApplyIntentStore },
          mergeService: { merge },
          applyMergeService: { applyMerge },
          writeService: { fastForwardMerge, mergeCommit },
        },
      } as any,
      input,
      {},
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: null,
      ours: null,
      theirs: null,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'no-write-attempted',
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      issueCode: 'VERSION_MERGE_CAPABILITY_DISABLED',
      safeMessage: 'Version-control merge endpoints are disabled by the runtime kill switch.',
      payload: {
        operation: 'applyMerge',
        endpointStatus: 'capabilityDisabled',
        capability: 'version:mergeApply',
        featureGateCapability: 'versionControl.merge',
        publicCapability: 'version:mergeApply',
        reason: 'mergeKillSwitchActive',
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
    expect(readGraphRegistry).not.toHaveBeenCalled();
    expect(openMergeApplyIntentStore).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });
}
