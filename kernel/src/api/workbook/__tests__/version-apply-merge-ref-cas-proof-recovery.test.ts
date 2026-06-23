import { jest } from '@jest/globals';

import { recoverStagedMergeCommitIfAlreadyApplied } from '../version-apply-merge-persisted-artifact-recovery';
import { recoverPersistedMergeApplyPostCas } from '../version-apply-merge-recovery';
import {
  computeMergeApplyRefCasProof,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
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
  TARGET_REF,
  THEIRS,
  blockedApplyMergeResult,
  fastForwardIntentRecord,
  intentStoreDiagnostics,
  mergeCommitIntentRecord,
  providerErrorDiagnosticForTest,
  recoveryContext,
  resolutionMismatchDiagnosticForTest,
} from './version-apply-merge-ref-cas-proof-test-utils';

describe('recoverStagedMergeCommitIfAlreadyApplied ref CAS proof recovery', () => {
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
});

describe('recoverPersistedMergeApplyPostCas', () => {
  it('finalizes an already-moved fast-forward intent under the merge kill switch without write services', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-fast-forward-recovery');
    const record = fastForwardIntentRecord(namespace);
    const completeIntent = jest.fn(
      async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
        status: 'completed' as const,
        record: { ...record, state: 'finalized' as const, terminal: input.terminal },
        diagnostics: [],
      }),
    );
    const fastForwardMerge = jest.fn();
    const mergeCommit = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: THEIRS,
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'fastForward',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: THEIRS,
        }),
        completeIntent,
        fastForwardMerge,
        mergeCommit,
      }),
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      commitRef: { id: THEIRS, refName: TARGET_REF },
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(completeIntent).toHaveBeenCalledTimes(1);
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(mergeCommit).not.toHaveBeenCalled();
  });

  it('does not mutate when the fast-forward ref CAS is not visible', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-fast-forward-not-moved');
    const record = fastForwardIntentRecord(namespace);
    const completeIntent = jest.fn();
    const fastForwardMerge = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: OURS,
        completeIntent,
        fastForwardMerge,
      }),
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_RECOVERY_NOT_READY' })],
    });
    expect(completeIntent).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
  });

  it('finalizes an already-moved mergeCommit intent under the merge kill switch without write services', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-merge-commit-recovery');
    const record = mergeCommitIntentRecord(namespace);
    const completeIntent = jest.fn(
      async (input: Parameters<MergeApplyIntentStore['completeIntent']>[0]) => ({
        status: 'completed' as const,
        record: { ...record, state: 'finalized' as const, terminal: input.terminal },
        diagnostics: [],
      }),
    );
    const mergeCommit = jest.fn();

    const result = await recoverPersistedMergeApplyPostCas(
      recoveryContext({
        namespace,
        record,
        head: MERGE,
        mergeCommitPayload: {
          parentCommitIds: [OURS, THEIRS],
          resolvedMergeAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
        },
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'mergeCommit',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: MERGE,
        }),
        completeIntent,
        mergeCommit,
      }),
      { resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST, resultDigest: RESULT_DIGEST },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      commitRef: { id: MERGE, refName: TARGET_REF },
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(completeIntent).toHaveBeenCalledTimes(1);
    expect(mergeCommit).not.toHaveBeenCalled();
  });
});
