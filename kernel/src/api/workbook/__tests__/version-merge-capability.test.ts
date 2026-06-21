import { jest } from '@jest/globals';

import type {
  VersionApplyMergeInput,
  VersionMergeInput,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { applyMergeWorkbookVersion } from '../version-apply-merge';
import { mergeWorkbookVersion } from '../version-merge';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];

describe('WorkbookVersion merge capability gate', () => {
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
        capability: 'versionControl.merge',
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
    const input = {
      resultId: 'merge-result:hidden',
      resultDigest: { algorithm: 'sha256', digest: 'a'.repeat(64) },
    } as VersionApplyMergeInput;

    const result = await applyMergeWorkbookVersion(
      {
        versioning: {
          versionControlMergeKillSwitch: true,
          mergeService: { merge },
          applyMergeService: { applyMerge },
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
        capability: 'versionControl.merge',
        publicCapability: 'version:mergeApply',
        reason: 'mergeKillSwitchActive',
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('maps disabled applyMerge through the public facade without invoking attached services', async () => {
    const merge = jest.fn();
    const applyMerge = jest.fn();
    const version = new WorkbookVersionImpl({
      featureGates: { capabilities: { versionControlMerge: false } },
      versioning: {
        mergeService: { merge },
        applyMergeService: { applyMerge },
      },
    } as any);

    const result = await version.applyMerge(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'featureGate',
        reason: 'Version-control merge capability is disabled for this workbook.',
        retryable: false,
      },
    });
    expect(merge).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('blocks public merge when host policy denies merge preview capability', async () => {
    const merge = jest.fn();
    const version = new WorkbookVersionImpl({
      policySnapshot: {
        decisions: [{ capability: 'version:mergePreview', decision: 'denied' }],
      },
      versioning: { mergeService: { merge } },
    } as any);

    const result = await version.merge({ base: BASE, ours: OURS, theirs: THEIRS });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergePreview',
        dependency: 'hostCapability',
        reason: 'Host policy denies version-control merge capability for this workbook.',
        retryable: false,
      },
    });
    expect(merge).not.toHaveBeenCalled();
  });
});
