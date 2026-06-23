import type { VersionRefName } from '@mog-sdk/contracts/api';

import {
  expectSealedApplyRejected,
  mutateDigest,
  putResolutionPayload,
  requireResolutionOption,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-apply-merge-sealed-payload-test-utils';

describe('WorkbookVersion applyMerge sealed payload validation', () => {
  it('rejects sealed payload refs with redaction digest or purpose mismatches before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-mismatch',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const mismatchedDigestPayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: mutateDigest(preview.resultDigest),
          value: option.value as any,
          purpose: 'chooseValue',
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: mismatchedDigestPayload },
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: [option.optionId, 'theirs'],
        });

        const customPurposePayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          domainPayloadSchema: 'test.custom-resolution.v1',
          value: { kind: 'value', value: 'custom' },
          purpose: 'custom',
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: { ...resolution, sealedPayloadRef: customPurposePayload },
          messages: [
            'sealed payload purpose is not executable.',
            'sealed payload value does not match resolution option.',
          ],
          leakCanaries: [option.optionId, 'custom'],
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
    );
    expect(mergeCommitCallCount).toBe(0);
  });

  it('rejects sealed payload refs bound to a different target precondition before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-target-binding',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: option.value as any,
          purpose: 'chooseValue',
        });

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead: {
            ...expectedTargetHead,
            revision: {
              ...expectedTargetHead.revision,
              value: `${expectedTargetHead.revision.value}:stale`,
            },
          },
          resolution: { ...resolutionFor(conflict, 'acceptTheirs'), sealedPayloadRef: payload },
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: [option.optionId, 'theirs'],
        });

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          targetRef: 'scenario/stale-sealed-payload' as VersionRefName,
          expectedTargetHead,
          resolution: { ...resolutionFor(conflict, 'acceptTheirs'), sealedPayloadRef: payload },
          messages: ['sealed payload object binding does not match.'],
          leakCanaries: ['scenario/stale-sealed-payload', option.optionId, 'theirs'],
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
    );
    expect(mergeCommitCallCount).toBe(0);
  });
});
