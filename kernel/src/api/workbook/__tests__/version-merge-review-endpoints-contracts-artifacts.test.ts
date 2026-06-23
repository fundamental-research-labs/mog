import { WorkbookVersionImpl } from '../version';
import {
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  mutateDigest,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

describe('WorkbookVersion merge review endpoint artifact contracts', () => {
  it('reads resolved conflict detail from saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-readback', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
        throw new Error('expected saved resolution artifact digests');
      }

      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'resolutionPayload',
          valueRole: 'resolved',
          value: { kind: 'value', value: 'theirs' },
        },
      });
    });
  });

  it('rejects mismatched saved-resolution artifact digests', async () => {
    await withReviewArtifact(
      'saved-resolution-digest-mismatch',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved resolution artifact digests');
        }

        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: mutateDigest(saved.value.resolutionSetDigest),
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        });

        expectMergeReviewFailure(
          detail,
          'getMergeConflictDetail',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
      },
    );
  });

  it('rejects non-replayable sealed payload refs without leaking binding values', async () => {
    await withReviewArtifact('sealed-ref-contract', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const canonical = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });
      if (!canonical.ok) throw new Error('expected canonical conflict detail');
      const option = canonical.value.resolutionOptions.find(
        (candidate) => candidate.kind === 'acceptTheirs',
      );
      if (!option) throw new Error('expected canonical acceptTheirs option');
      const sealedPayloadRef = {
        schemaVersion: 1,
        kind: 'sealedResolutionPayload',
        payloadId: `merge-payload:${preview.resultDigest.digest}`,
        payloadDigest: preview.resultDigest,
        storageMode: 'localOnly',
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        conflictId: canonical.value.conflictId,
        optionId: option.optionId,
        resolutionKind: option.kind,
      } as const;

      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            conflictId: canonical.value.conflictId,
            expectedConflictDigest: canonical.value.conflictDigest,
            optionId: option.optionId,
            kind: option.kind,
            sealedPayloadRef,
          },
        ],
      });

      expectMergeReviewFailure(saved, 'saveMergeResolutions', 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectNoDiagnosticLeaks(saved, [
        canonical.value.conflictId,
        canonical.value.conflictDigest,
        option.optionId,
        preview.resultDigest.digest,
      ]);
    });
  });

  it('redacts provider diagnostics while reading saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-redaction', async ({ provider, preview }) => {
      const canaries = [
        'xl/worksheets/sheet1.xml',
        'cells/A1',
        'sk_live_saved_resolution_secret',
        preview.resultDigest.digest,
      ];
      const wrappedProvider = {
        accessContext: provider.accessContext,
        readGraphRegistry: () => provider.readGraphRegistry(),
        openGraph: async (...args: Parameters<typeof provider.openGraph>) => {
          const graph = await provider.openGraph(...args);
          return {
            getObjectRecord: async (ref: any) => {
              if (ref.objectType === 'workbook.mergeResolutionSet.v1') {
                throw Object.assign(new Error(canaries.join(' ')), {
                  diagnostics: [
                    {
                      issueCode: 'VERSION_PERMISSION_DENIED',
                      safeMessage: `Cannot read ${canaries.join(' ')}`,
                    },
                  ],
                });
              }
              return graph.getObjectRecord(ref);
            },
          };
        },
      };
      const version = new WorkbookVersionImpl({ versioning: { provider: wrappedProvider } } as any);
      const conflict = preview.conflicts[0];
      const result = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: { algorithm: 'sha256', digest: '7'.repeat(64) },
      });

      expectMergeReviewFailure(result, 'getMergeConflictDetail', 'VERSION_PERMISSION_DENIED');
      expectNoDiagnosticLeaks(result, canaries);
    });
  });
});
