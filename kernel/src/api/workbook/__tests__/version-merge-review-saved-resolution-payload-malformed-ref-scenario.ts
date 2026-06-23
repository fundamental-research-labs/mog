import {
  PAYLOAD_DIGEST_CANARY,
  TARGET_REF,
  UNSAFE_FIELD,
  UNSAFE_VALUE,
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  objectRecord,
  requireResolutionOption,
  resolutionFor,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionPayloadMalformedRefReviewTests(): void {
  it('rejects malformed persisted sealed refs with redacted invalid-artifact diagnostics', async () => {
    await withReviewFixture(
      'malformed-sealed-payload-ref',
      async ({ graph, namespace, version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolutionSet = await objectRecord(namespace, 'workbook.mergeResolutionSet.v1', {
          schemaVersion: 1,
          recordKind: 'mergeResolutionSet',
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              sealedPayloadRef: {
                schemaVersion: 1,
                kind: 'sealedResolutionPayload',
                payloadId: `merge-payload:${PAYLOAD_DIGEST_CANARY.digest}`,
                payloadDigest: PAYLOAD_DIGEST_CANARY,
                storageMode: 'serverEncrypted',
                resultId: preview.resultId,
                resultDigest: preview.resultDigest,
                conflictId: conflict.conflictId,
                optionId: option.optionId,
                resolutionKind: option.kind,
                [UNSAFE_FIELD]: UNSAFE_VALUE,
              },
            },
          ],
        });
        expect(await graph.putObjects([resolutionSet])).toMatchObject({ status: 'success' });

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: resolutionSet.digest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
        });

        expectMergeReviewFailure(result, 'VERSION_INVALID_COMMIT_PAYLOAD');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          PAYLOAD_DIGEST_CANARY.digest,
          resolutionSet.digest.digest,
          preview.resultDigest.digest,
          UNSAFE_FIELD,
          UNSAFE_VALUE,
        ]);
      },
    );
  });
}
