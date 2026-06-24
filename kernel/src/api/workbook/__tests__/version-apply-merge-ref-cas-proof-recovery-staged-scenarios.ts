import { jest } from '@jest/globals';

import { recoverStagedMergeCommitIfAlreadyApplied } from '../version/apply-merge/persisted-artifact/version-apply-merge-persisted-artifact-recovery';
import type { MergeApplyIntentStore } from '../../../document/version-store/merge-apply-intent-store';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  BASE,
  DOCUMENT_SCOPE,
  MERGE,
  OURS,
  RESOLVED_ATTEMPT_DIGEST,
  RESOLUTION_SET_DIGEST,
  RESULT_DIGEST,
  RESULT_ID,
  THEIRS,
  blockedApplyMergeResult,
  intentStoreDiagnostics,
  mergeCommitIntentRecord,
  providerErrorDiagnosticForTest,
  resolutionMismatchDiagnosticForTest,
} from './version-apply-merge-ref-cas-proof-test-utils';

export function registerStagedMergeCommitRecoveryScenarios(): void {
  it('does not finalize an already-moved mergeCommit intent without a durable proof row', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-merge-proof');
    const record = mergeCommitIntentRecord(namespace);
    const completeIntent = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(async () => ({
        status: 'missing',
        proof: null,
        diagnostics: [
          {
            code: 'VERSION_INTENT_NOT_FOUND',
            message: 'merge proof missing',
            recoverability: 'repair',
          },
        ],
      })),
      completeIntent,
    };

    const result = await recoverStagedMergeCommitIfAlreadyApplied({
      graph: {
        readCommit: jest.fn(async () => ({
          status: 'success',
          commit: {
            payload: {
              parentCommitIds: [OURS, THEIRS],
              resolvedMergeAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
            },
          },
          diagnostics: [],
        })),
      } as any,
      store,
      input: {
        resultId: RESULT_ID,
        resultDigest: RESULT_DIGEST,
        resolutionSetDigest: RESOLUTION_SET_DIGEST,
        resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
        resolutions: [],
      },
      record,
      readCurrentTargetHead: jest.fn(async () => ({ ok: true, commitId: MERGE })),
      resultFromTerminalArtifactIntent: jest.fn(),
      staleTargetHeadArtifactResult: jest.fn(),
      blockedApplyMergeResult,
      mapProviderDiagnostics: jest.fn(),
      providerErrorDiagnostic: providerErrorDiagnosticForTest,
      intentStoreDiagnostics,
      resolutionMismatchDiagnostic: resolutionMismatchDiagnosticForTest,
    });

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
      diagnostics: [
        {
          issueCode: 'VERSION_INTENT_NOT_FOUND',
          recoverability: 'repair',
          safeMessage: 'merge proof missing',
          redacted: true,
        },
      ],
    });
    expect(completeIntent).not.toHaveBeenCalled();
  });
}
