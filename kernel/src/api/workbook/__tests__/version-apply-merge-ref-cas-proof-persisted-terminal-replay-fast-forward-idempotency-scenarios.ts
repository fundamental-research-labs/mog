import { jest } from '@jest/globals';

import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  EXPECTED_TARGET_HEAD,
  OURS,
  RESOLVED_ATTEMPT_DIGEST,
  RESOLUTION_SET_DIGEST,
  RESULT_DIGEST,
  RESULT_ID,
  TARGET_REF,
  THEIRS,
  fastForwardIntentRecord,
} from './version-apply-merge-ref-cas-proof-test-utils';

export function registerPersistedRefCasProofTerminalReplayFastForwardIdempotencyScenarios(): void {
  it('returns terminal fast-forward idempotency before stale-target rejection', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'terminal-before-stale');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const record: MergeApplyIntentRecord = {
      ...fastForwardIntentRecord(namespace),
      state: 'finalized',
      terminal: {
        status: 'fastForwarded',
        headBefore: OURS,
        headAfter: THEIRS,
        commitId: THEIRS,
      },
    };
    const fastForwardMerge = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({ status: 'found', record, diagnostics: [] })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(),
      completeIntent: jest.fn(),
    };
    const readRef = jest.fn(async () => ({
      status: 'success' as const,
      ref: {
        name: TARGET_REF,
        commitId: THEIRS,
        revision: { kind: 'counter' as const, value: '2' },
        updatedAt: CREATED_AT,
      },
      diagnostics: [],
    }));
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => ({ readRef })),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      {
        versioning: {
          provider,
          writeService: { fastForwardMerge },
        },
      } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

    expect(result).toMatchObject({
      status: 'alreadyApplied',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      commitRef: { id: THEIRS, refName: TARGET_REF },
      resultId: RESULT_ID,
      resultDigest: RESULT_DIGEST,
      resolutionSetDigest: RESOLUTION_SET_DIGEST,
      resolvedAttemptDigest: RESOLVED_ATTEMPT_DIGEST,
      targetRef: TARGET_REF,
      headBefore: OURS,
      headAfter: THEIRS,
      mutationGuarantee: 'ref-not-mutated',
    });
    expect(readRef).toHaveBeenCalledWith(TARGET_REF);
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
  });
}
