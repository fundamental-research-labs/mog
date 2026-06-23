import { jest } from '@jest/globals';

import type { VersionApplyMergeInput, VersionMergeInput } from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { applyMergeWorkbookVersion } from '../version-apply-merge';
import { mergeWorkbookVersion } from '../version-merge';

const BASE = `commit:sha256:${'1'.repeat(64)}` as VersionMergeInput['base'];
const OURS = `commit:sha256:${'2'.repeat(64)}` as VersionMergeInput['ours'];
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as VersionMergeInput['theirs'];
const RESULT_DIGEST = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
const CONFLICT_DIGEST = { algorithm: 'sha256', digest: 'b'.repeat(64) } as const;
const TARGET_REF = 'refs/heads/main';
const EXPECTED_TARGET_HEAD = { commitId: OURS, revision: { kind: 'counter', value: '1' } };
const HOST_POLICY_SECRET = 'host-principal-secret@example.test';
const REVIEW_ENDPOINTS = [
  {
    method: 'saveMergeResolutions',
    capability: 'version:mergeApply',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      resolutions: [],
    },
  },
  {
    method: 'getMergeConflictDetail',
    capability: 'version:mergePreview',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      conflictId: 'conflict:hidden',
      expectedConflictDigest: CONFLICT_DIGEST,
      valueRole: 'base',
      purpose: 'review',
    },
  },
  {
    method: 'putMergeResolutionPayload',
    capability: 'version:mergeApply',
    input: {
      resultId: 'merge-result:hidden',
      resultDigest: RESULT_DIGEST,
      redactionPolicyDigest: RESULT_DIGEST,
      conflictId: 'conflict:hidden',
      expectedConflictDigest: CONFLICT_DIGEST,
      optionId: 'option:hidden',
      kind: 'acceptTheirs',
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
      value: { secret: true },
      purpose: 'chooseValue',
    },
  },
] as const;

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

  it.each(REVIEW_ENDPOINTS)(
    'blocks $method under merge kill switch before provider lookup or payload writes',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext({
        versionControlMergeKillSwitch: true,
      });
      const version = new WorkbookVersionImpl(ctx as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'featureGate',
          reason: 'Version-control merge endpoints are disabled by the runtime kill switch.',
          retryable: false,
        },
      });
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );

  it.each(REVIEW_ENDPOINTS)(
    'blocks $method when host policy denies its merge capability before provider lookup or payload writes',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext();
      const version = new WorkbookVersionImpl({
        ...ctx,
        policySnapshot: { decisions: [{ capability, decision: 'denied' }] },
      } as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'hostCapability',
          reason: 'Host policy denies version-control merge capability for this workbook.',
          retryable: false,
        },
      });
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );

  it.each(REVIEW_ENDPOINTS)(
    'blocks $method when host policy omits capability but names its operation alias',
    async ({ method, capability, input }) => {
      const { ctx, providerLookup, providerTouch } = providerProbeContext();
      const version = new WorkbookVersionImpl({
        ...ctx,
        policySnapshot: {
          decisions: [{ operation: method, decision: 'denied', reviewer: HOST_POLICY_SECRET }],
        },
      } as any);

      const result = await (version as any)[method](input);

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'version_capability_unavailable',
          capability,
          dependency: 'hostCapability',
          reason: 'Host policy denies version-control merge capability for this workbook.',
          retryable: false,
        },
      });
      expect(JSON.stringify(result)).not.toContain(HOST_POLICY_SECRET);
      expect(providerLookup).not.toHaveBeenCalled();
      expect(providerTouch).not.toHaveBeenCalled();
    },
  );
});

function providerProbeContext(versioningExtra: Record<string, unknown> = {}) {
  const providerLookup = jest.fn();
  const providerTouch = jest.fn();
  const service = {
    saveMergeResolutions: providerTouch,
    getMergeConflictDetail: providerTouch,
    putMergeResolutionPayload: providerTouch,
    readMergeAttempt: providerTouch,
    writeMergeResolutionPayload: providerTouch,
    sealMergeResolutionPayload: providerTouch,
  };
  const versioning: Record<string, unknown> = { ...versioningExtra };

  for (const key of [
    'mergeResolutionService',
    'mergeReviewService',
    'mergePayloadService',
    'payloadService',
    'provider',
    'publicService',
  ]) {
    Object.defineProperty(versioning, key, { get: () => (providerLookup(key), service) });
  }
  for (const key of Object.keys(service)) {
    Object.defineProperty(versioning, key, { get: () => (providerLookup(key), providerTouch) });
  }

  return { ctx: { versioning }, providerLookup, providerTouch };
}
