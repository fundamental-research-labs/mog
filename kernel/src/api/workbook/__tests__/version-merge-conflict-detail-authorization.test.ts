import { WorkbookVersionImpl } from '../version';
import { mapGraphDiagnostics } from '../version-merge-public-diagnostics';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import type {
  VersionAccessContext,
  VersionGraphNamespace,
} from '../../../document/version-store/provider';
import {
  TARGET_REF,
  basicConflict,
  conflictDigestObject,
  conflictWithIdentity,
  expectDiagnosticMessages,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  mutateDigest,
  putResolutionPayload,
  redactedOptionConflict,
  requireResolutionOption,
  resolutionFor,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

describe('WorkbookVersion merge conflict detail authorization', () => {
  describe('request and diagnostic redaction', () => {
    it('rejects conflict detail requests whose expected conflict digest does not match', async () => {
      await withReviewArtifact('conflict-digest-mismatch', async ({ version, preview }) => {
        const conflict = preview.conflicts[0];
        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: mutateDigest(conflictDigestObject(conflict.conflictDigest)),
          valueRole: 'theirs',
          purpose: 'review',
        });

        expectMergeReviewFailure(
          result,
          'getMergeConflictDetail',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          preview.resultDigest.digest,
        ]);
      });
    });

    it('redacts missing workspace role denials before reading conflict detail artifacts', async () => {
      const resultDigest = { algorithm: 'sha256', digest: 'a'.repeat(64) } as const;
      const canaries = [
        'workspace-role-owner-secret',
        'principal-workspace-role-secret',
        'proposal:sha256:missing-workspace-role',
        'conflict:workspace-role-secret',
        resultDigest.digest,
      ];
      const version = new WorkbookVersionImpl({
        versioning: {
          provider: {
            accessContext: {
              principalScope: 'principal-workspace-role-secret',
              diagnosticsAllowed: true,
            },
            readGraphRegistry: async () => ({
              status: 'denied',
              diagnostics: [
                {
                  issueCode: 'VERSION_PERMISSION_DENIED',
                  safeMessage: `Missing ${canaries.join(' ')}`,
                  details: {
                    workspaceRole: 'workspace-role-owner-secret',
                    principalScope: 'principal-workspace-role-secret',
                    proposalId: 'proposal:sha256:missing-workspace-role',
                  },
                },
              ],
            }),
            openGraph: async () => {
              throw new Error('conflict detail graph must not open after registry denial');
            },
          },
        },
      } as any);

      const result = await version.getMergeConflictDetail({
        resultId: mergeResultIdForPreviewDigest(resultDigest),
        resultDigest,
        redactionPolicyDigest: resultDigest,
        conflictId: 'conflict:workspace-role-secret',
        expectedConflictDigest: conflictDigestObject(`sha256:${'b'.repeat(64)}`),
        valueRole: 'base',
        purpose: 'review',
      });

      expectMergeReviewFailure(result, 'getMergeConflictDetail', 'VERSION_PERMISSION_DENIED');
      expectDiagnosticMessages(result, ['Version merge review is not authorized for this caller.']);
      expectNoDiagnosticLeaks(result, canaries);
    });

    it('redacts stale proposal id diagnostics from public merge previews', () => {
      const canaries = [
        'proposal:sha256:stale-proposal-secret',
        'workspace-stale-proposal-secret',
        'principal-stale-proposal-secret',
        'conflict:sha256:stale-conflict-secret',
        'raw-value-stale-proposal-secret',
      ];
      const diagnostics = mapGraphDiagnostics([
        {
          code: 'stale_proposal_id',
          safeMessage: `Stale proposal ${canaries.join(' ')}`,
          details: {
            proposalId: 'proposal:sha256:stale-proposal-secret',
            workspaceId: 'workspace-stale-proposal-secret',
            principalScope: 'principal-stale-proposal-secret',
            conflictId: 'conflict:sha256:stale-conflict-secret',
            value: 'raw-value-stale-proposal-secret',
          },
        },
      ]);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        issueCode: 'VERSION_PERMISSION_DENIED',
        safeMessage: 'Version merge preview is not authorized for this caller.',
        redacted: true,
        payload: { operation: 'merge' },
      });
      expectNoDiagnosticLeaks(diagnostics, canaries);
    });

    it('rejects cross-workspace stable conflict ids before projecting detail values', async () => {
      const crossWorkspaceConflictId = `conflict:sha256:${'c'.repeat(64)}`;
      const crossWorkspaceConflictDigest = `sha256:${'d'.repeat(64)}`;
      await withReviewArtifact(
        'cross-workspace-conflict-id',
        async ({ version, preview }) => {
          const result = await version.getMergeConflictDetail({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            conflictId: crossWorkspaceConflictId,
            expectedConflictDigest: conflictDigestObject(crossWorkspaceConflictDigest),
            valueRole: 'theirs',
            purpose: 'review',
          });

          expectMergeReviewFailure(
            result,
            'getMergeConflictDetail',
            'VERSION_MERGE_RESOLUTION_MISMATCH',
          );
          expect(result).not.toHaveProperty('value');
          expectNoDiagnosticLeaks(result, [
            crossWorkspaceConflictId,
            crossWorkspaceConflictDigest,
            preview.resultDigest.digest,
            'theirs',
          ]);
        },
        {
          conflicts: [
            conflictWithIdentity(
              basicConflict(),
              crossWorkspaceConflictId,
              crossWorkspaceConflictDigest,
            ),
          ],
        },
      );
    });
  });

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

  describe('redacted detail values', () => {
    it('keeps redacted conflict option values redacted in detail responses', async () => {
      await withReviewArtifact(
        'redacted-option-values',
        async ({ version, preview }) => {
          const conflict = preview.conflicts[0];
          const detail = await version.getMergeConflictDetail({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            conflictId: conflict.conflictId,
            expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
            valueRole: 'theirs',
            purpose: 'review',
          });
          if (!detail.ok) throw new Error(`expected redacted detail success: ${detail.error.code}`);

          expect(detail.value.value).toEqual({ kind: 'redacted', reason: 'permission-denied' });
          expect(detail.value.resolutionOptions).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'acceptTheirs',
                value: { kind: 'redacted', reason: 'permission-denied' },
              }),
            ]),
          );
        },
        { conflicts: [redactedOptionConflict()] },
      );
    });
  });
});
