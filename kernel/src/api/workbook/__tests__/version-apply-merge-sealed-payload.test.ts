import {
  putResolutionPayload,
  readStoredResolutionSetResolution,
  requireResolutionOption,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-apply-merge-sealed-payload-test-utils';

describe('WorkbookVersion applyMerge sealed payload refs', () => {
  it('retains stable digest-bound sealed payload refs without raw values in resolution sets', async () => {
    await withPersistedConflictPreview(
      'retention-redaction',
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
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload,
        };

        const applied = await sourceWb.version.applyMerge(
          {
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            previewArtifactDigest: preview.previewArtifactDigest,
            resolutions: [resolution],
          },
          { targetRef: 'refs/heads/main' as any, expectedTargetHead },
        );
        if (!applied.ok) throw new Error(`expected sealed apply success: ${applied.error.code}`);
        if (!applied.value.resolutionSetDigest) {
          throw new Error('expected sealed apply to expose a resolution set digest');
        }

        const storedResolution = await readStoredResolutionSetResolution({
          provider,
          graphId,
          documentScope,
          resolutionSetDigest: applied.value.resolutionSetDigest,
        });
        expect(storedResolution).toMatchObject({
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflict.conflictDigest,
          optionId: option.optionId,
          kind: 'acceptTheirs',
          sealedPayloadRef: payload,
        });
        expect(storedResolution).not.toHaveProperty('value');
        expect(payload.payloadId).toBe(`merge-payload:${payload.payloadDigest.digest}`);
      },
    );
  });
});
