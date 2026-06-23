import { WorkbookVersionImpl } from '../version';
import type {
  VersionAccessContext,
  VersionGraphNamespace,
} from '../../../document/version-store/provider';
import {
  TARGET_REF,
  conflictDigestObject,
  expectDiagnosticMessages,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  mutateDigest,
  putResolutionPayload,
  requireResolutionOption,
  resolutionFor,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerSavedResolutionAuthorizationScenarios(): void {
  describe('saved resolution authorization', () => {
    it('rejects sealed payload refs when purpose or redaction access policy does not match', async () => {
      await withReviewArtifact(
        'payload-purpose-access-mismatch',
        async ({ version, preview, target }) => {
          const conflict = preview.conflicts[0];
          const option = requireResolutionOption(conflict, 'acceptTheirs');
          const resolution = resolutionFor(conflict, 'acceptTheirs');

          const customPayload = await putResolutionPayload({
            version,
            preview,
            conflict,
            option,
            redactionPolicyDigest: preview.resultDigest,
            target,
            value: { kind: 'value', value: 'custom' },
            purpose: 'custom',
            domainPayloadSchema: 'w9-06.custom-resolution.v1',
          });
          const customSave = await version.saveMergeResolutions({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            targetRef: TARGET_REF,
            expectedTargetHead: target,
            resolutions: [{ ...resolution, sealedPayloadRef: customPayload }],
          });
          expectMergeReviewFailure(
            customSave,
            'saveMergeResolutions',
            'VERSION_MERGE_RESOLUTION_MISMATCH',
          );
          expectDiagnosticMessages(customSave, [
            'sealed payload purpose is not executable.',
            'sealed payload value does not match resolution option.',
          ]);

          const chooseValuePayload = await putResolutionPayload({
            version,
            preview,
            conflict,
            option,
            redactionPolicyDigest: preview.resultDigest,
            target,
            value: option.value as any,
            purpose: 'chooseValue',
          });
          const accessMismatchSave = await version.saveMergeResolutions({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: mutateDigest(preview.resultDigest),
            targetRef: TARGET_REF,
            expectedTargetHead: target,
            resolutions: [{ ...resolution, sealedPayloadRef: chooseValuePayload }],
          });
          expectMergeReviewFailure(
            accessMismatchSave,
            'saveMergeResolutions',
            'VERSION_MERGE_RESOLUTION_MISMATCH',
          );
          expectDiagnosticMessages(accessMismatchSave, [
            'sealed payload object binding does not match.',
          ]);
          expectNoDiagnosticLeaks(accessMismatchSave, [
            conflict.conflictId,
            conflict.conflictDigest,
            option.optionId,
            'theirs',
          ]);
        },
      );
    });

    it('reads saved-resolution conflict detail under a different authorized principal', async () => {
      await withReviewArtifact(
        'saved-resolution-different-principal',
        async ({ provider, version, preview, target }) => {
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

          const readerAccess: VersionAccessContext = { principalScope: 'principal-reader' };
          const openGraphCalls: {
            readonly namespace: VersionGraphNamespace;
            readonly accessContext: VersionAccessContext | undefined;
          }[] = [];
          const openGraph = (
            namespace: VersionGraphNamespace,
            accessContext?: VersionAccessContext,
          ) => {
            openGraphCalls.push({ namespace, accessContext });
            return provider.openGraph(namespace, accessContext);
          };
          const readerVersion = new WorkbookVersionImpl({
            versioning: {
              provider: {
                accessContext: readerAccess,
                readGraphRegistry: () => provider.readGraphRegistry(),
                openGraph,
              },
            },
          } as any);

          const detail = await readerVersion.getMergeConflictDetail({
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

          expect(openGraphCalls).toEqual([
            expect.objectContaining({ accessContext: readerAccess }),
          ]);
          expect(detail).toMatchObject({
            ok: true,
            value: {
              kind: 'resolutionPayload',
              valueRole: 'resolved',
              value: { kind: 'value', value: 'theirs' },
            },
          });
        },
        { accessContext: { principalScope: 'principal-writer' } },
      );
    });

    it('denies applying review-only saved resolution artifacts without replayable resolutions', async () => {
      let mergeCommitCallCount = 0;
      await withReviewArtifact(
        'review-only-apply-denial',
        async ({ version, preview, target }) => {
          const conflict = preview.conflicts[0];
          const saved = await version.saveMergeResolutions({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            resolutions: [resolutionFor(conflict, 'acceptTheirs')],
          });
          if (!saved.ok || !saved.value.resolutionSetDigest) {
            throw new Error('expected review-only saved resolution artifact');
          }
          expect(saved.value).toMatchObject({ attemptKind: 'reviewOnly' });

          const applied = await version.applyMerge(
            {
              resultId: preview.resultId,
              resultDigest: preview.resultDigest,
              resolutionSetDigest: saved.value.resolutionSetDigest,
            },
            { targetRef: TARGET_REF, expectedTargetHead: target },
          );

          expect(applied).toMatchObject({
            ok: false,
            error: {
              target: 'workbook.version.applyMerge',
              diagnostics: [
                expect.objectContaining({
                  code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
                  message: 'applyMerge apply mode requires resolutions for conflicted previews.',
                }),
              ],
            },
          });
          expect(mergeCommitCallCount).toBe(0);
        },
        {
          versioning: {
            applyMergeService: {
              mergeCommit: async () => {
                mergeCommitCallCount += 1;
              },
            },
          },
        },
      );
    });
  });
}
