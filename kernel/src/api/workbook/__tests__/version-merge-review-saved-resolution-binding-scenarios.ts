import {
  DRIFTED_TARGET_REF,
  TARGET_REF,
  conflictDigestObject,
  driftExpectedHead,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  objectRecord,
  resolutionFor,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionBindingReviewTests(): void {
  it('rejects saved resolution sets with unsupported stale target bindings', async () => {
    await withReviewFixture(
      'stale-resolution-set-binding',
      async ({ graph, namespace, version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const resolutionSet = await objectRecord(namespace, 'workbook.mergeResolutionSet.v1', {
          schemaVersion: 1,
          recordKind: 'mergeResolutionSet',
          targetRef: DRIFTED_TARGET_REF,
          expectedTargetHead: driftExpectedHead(target),
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
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
          resolutionSet.digest.digest,
          DRIFTED_TARGET_REF,
          preview.resultDigest.digest,
        ]);
      },
    );
  });
}
