import {
  PAYLOAD_DIGEST_CANARY,
  TARGET_REF,
  UNSAFE_FIELD,
  UNSAFE_VALUE,
  conflictDigestObject,
  driftExpectedHead,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  objectRecord,
  requireResolutionOption,
  resolutionFor,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionPayloadReviewTests(): void {
  it('rejects stale saved-resolution sealed payload refs without leaking payload bindings', async () => {
    await withReviewFixture('stale-sealed-payload-ref', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const payload = await version.putMergeResolutionPayload({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'chooseValue',
      });
      if (!payload.ok) throw new Error(`expected sealed payload: ${payload.error.code}`);

      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            ...resolutionFor(conflict, 'acceptTheirs'),
            sealedPayloadRef: payload.value,
          },
        ],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest) {
        throw new Error('expected saved sealed payload resolution set');
      }

      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: driftExpectedHead(target),
      });

      expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectNoDiagnosticLeaks(result, [
        conflict.conflictId,
        conflict.conflictDigest,
        option.optionId,
        payload.value.payloadDigest.digest,
        saved.value.resolutionSetDigest.digest,
        preview.resultDigest.digest,
      ]);
    });
  });

  it('rejects saved sealed payload refs without a replay target binding', async () => {
    await withReviewFixture(
      'sealed-payload-ref-missing-target',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected sealed payload: ${payload.error.code}`);

        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              sealedPayloadRef: payload.value,
            },
          ],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected saved sealed payload resolution set');
        }

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
        });

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          payload.value.payloadDigest.digest,
          saved.value.resolutionSetDigest.digest,
          preview.resultDigest.digest,
        ]);
      },
    );
  });

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
