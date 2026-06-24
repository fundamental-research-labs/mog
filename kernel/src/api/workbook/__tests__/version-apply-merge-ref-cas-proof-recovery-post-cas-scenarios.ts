import { jest } from '@jest/globals';

import { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import { computeMergeApplyRefCasProof } from '../../../document/version-store/merge-apply-intent-store';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { createFinalizingCompleteIntent } from './version-apply-merge-ref-cas-proof-recovery-helpers';
import {
  DOCUMENT_SCOPE,
  MERGE,
  OURS,
  RESOLVED_ATTEMPT_DIGEST,
  RESULT_DIGEST,
  RESULT_ID,
  TARGET_REF,
  THEIRS,
  fastForwardIntentRecord,
  mergeCommitIntentRecord,
  recoveryContext,
} from './version-apply-merge-ref-cas-proof-test-utils';

export function registerPostCasRecoveryScenarios(): void {
  it('finalizes an already-moved fast-forward intent under the merge kill switch without write services', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'internal-fast-forward-recovery');
    const record = fastForwardIntentRecord(namespace);
    const completeIntent = jest.fn(createFinalizingCompleteIntent(record));
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
    const completeIntent = jest.fn(createFinalizingCompleteIntent(record));
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
}
