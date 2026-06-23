import {
  expectSealedApplyRejected,
  putForgedResolutionPayload,
  putResolutionPayload,
  putWrongPreviewArtifact,
  requireResolutionOption,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-apply-merge-sealed-payload-test-utils';

describe('WorkbookVersion applyMerge sealed payload hardening', () => {
  it('rejects stale digests, wrong artifact refs, principal metadata, and duplicate refs before writes', async () => {
    let mergeCommitCallCount = 0;
    await withPersistedConflictPreview(
      'reject-hardened-bindings',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        expect(preview.conflicts.length).toBeGreaterThan(1);
        const firstConflict = preview.conflicts[0];
        const secondConflict = preview.conflicts[1];
        const firstOption = requireResolutionOption(firstConflict, 'acceptTheirs');
        const firstResolution = resolutionFor(firstConflict, 'acceptTheirs');
        const secondResolution = resolutionFor(secondConflict, 'acceptTheirs');
        const forgedPayloadInput = {
          provider,
          graphId,
          documentScope,
          preview,
          conflict: firstConflict,
          option: firstOption,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: firstOption.value as any,
        };
        const firstPayload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict: firstConflict,
          option: firstOption,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: firstOption.value as any,
          purpose: 'chooseValue',
        });

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            {
              ...firstResolution,
              expectedConflictDigest: `${firstConflict.conflictDigest}:stale`,
              sealedPayloadRef: firstPayload,
            },
            secondResolution,
          ],
          messages: ['resolution does not match the merge conflict.'],
          leakCanaries: [firstOption.optionId, 'theirs'],
          expectPayloadOperation: false,
        });

        const wrongPreviewDigest = await putWrongPreviewArtifact({
          provider,
          graphId,
          documentScope,
          preview,
        });
        const wrongArtifactPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          dependencyResultDigest: wrongPreviewDigest,
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: wrongArtifactPayload },
            secondResolution,
          ],
          messages: ['sealed payload artifact binding does not match.'],
          leakCanaries: [wrongPreviewDigest.digest, firstOption.optionId, 'theirs'],
        });

        const principalCanary = 'principal-secret-sealed-payload';
        const principalPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          extraPayload: { principalScope: principalCanary },
        });
        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: principalPayload },
            secondResolution,
          ],
          messages: ['sealed payload object is invalid.'],
          leakCanaries: [principalCanary, firstOption.optionId, 'theirs'],
        });

        const missingDigestPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          omitPayloadKeys: ['conflictDigest'],
        });
        const staleAuthority = 'workspace-stale-sealed-payload';
        const authorityPayload = await putForgedResolutionPayload({
          ...forgedPayloadInput,
          extraPayload: { authority: { workspaceId: staleAuthority, principalScope: null } },
        });
        for (const [payload, messages, leakCanaries] of [
          [
            missingDigestPayload,
            ['sealed payload object is invalid.'],
            [firstOption.optionId, 'theirs'],
          ],
          [
            authorityPayload,
            ['sealed payload object binding does not match.'],
            [staleAuthority, firstOption.optionId, 'theirs'],
          ],
        ] as const) {
          await expectSealedApplyRejected({
            provider,
            graphId,
            documentScope,
            sourceWb,
            preview,
            expectedTargetHead,
            resolution: [{ ...firstResolution, sealedPayloadRef: payload }, secondResolution],
            messages,
            leakCanaries,
          });
        }

        await expectSealedApplyRejected({
          provider,
          graphId,
          documentScope,
          sourceWb,
          preview,
          expectedTargetHead,
          resolution: [
            { ...firstResolution, sealedPayloadRef: firstPayload },
            { ...secondResolution, sealedPayloadRef: firstPayload },
          ],
          messages: ['duplicate sealed payload ref supplied.'],
          leakCanaries: [firstOption.optionId, 'theirs'],
        });
      },
      {
        applyMergeService: {
          mergeCommit: async () => {
            mergeCommitCallCount += 1;
          },
        },
      },
      ['A1', 'B1'],
    );
    expect(mergeCommitCallCount).toBe(0);
  });
});
