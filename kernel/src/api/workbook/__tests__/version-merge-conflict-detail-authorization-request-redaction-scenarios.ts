import { WorkbookVersionImpl } from '../version';
import { mapGraphDiagnostics } from '../version-merge-public-diagnostics';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  basicConflict,
  conflictDigestObject,
  conflictWithIdentity,
  expectDiagnosticMessages,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  mutateDigest,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerRequestAndDiagnosticRedactionScenarios(): void {
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
}
