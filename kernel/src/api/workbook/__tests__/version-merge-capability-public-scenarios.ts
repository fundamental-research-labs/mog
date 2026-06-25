import { expect, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { BASE, HOST_POLICY_SECRET, OURS, THEIRS } from './version-merge-capability-test-utils';

export function registerMergeCapabilityPublicScenarios(): void {
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

  it('blocks applyMerge when host policy operation and capability aliases disagree', async () => {
    const merge = jest.fn();
    const applyMerge = jest.fn();
    const version = new WorkbookVersionImpl({
      policySnapshot: {
        decisions: [
          {
            capability: 'version:mergePreview',
            operation: 'applyMerge',
            decision: 'denied',
            principal: HOST_POLICY_SECRET,
          },
        ],
      },
      versioning: {
        mergeService: { merge },
        applyMergeService: { applyMerge },
      },
    } as any);

    const result = await version.applyMerge(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'hostCapability',
        reason: 'Host policy denies version-control merge capability for this workbook.',
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(HOST_POLICY_SECRET);
    expect(merge).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
  });

  it('blocks applyMerge from redacted host capability state payloads without a decisions array', async () => {
    const merge = jest.fn();
    const applyMerge = jest.fn();
    const version = new WorkbookVersionImpl({
      policySnapshot: {
        capabilities: {
          applyMerge: {
            enabled: false,
            dependency: 'hostCapability',
            reason: `Denied for ${HOST_POLICY_SECRET}`,
            retryable: false,
          },
        },
      },
      versioning: {
        mergeService: { merge },
        applyMergeService: { applyMerge },
      },
    } as any);

    const result = await version.applyMerge(
      { base: BASE, ours: OURS, theirs: THEIRS },
      { mode: 'preview' },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'hostCapability',
        reason: 'Host policy denies version-control merge capability for this workbook.',
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain(HOST_POLICY_SECRET);
    expect(merge).not.toHaveBeenCalled();
    expect(applyMerge).not.toHaveBeenCalled();
  });
}
