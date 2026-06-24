import { jest } from '@jest/globals';

import type { VersionCommitExpectedHead } from '@mog-sdk/contracts/api';

import { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type { MergeApplyIntentStore } from '../../../document/version-store/merge-apply-intent-store';
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
  RESULT_DIGEST,
  RESULT_ID,
  TARGET_REF,
  THEIRS,
  fastForwardIntentRecord,
} from './version-apply-merge-ref-cas-proof-test-utils';

export function registerPersistedRefCasProofBlockingScenarios(): void {
  it('does not finalize an already-moved fast-forward intent without a durable proof row', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-ref-cas-proof');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const completeIntent = jest.fn();
    const store: MergeApplyIntentStore = {
      namespace,
      beginIntent: jest.fn(),
      readByIntentId: jest.fn(async () => ({
        status: 'found',
        record: fastForwardIntentRecord(namespace),
        diagnostics: [],
      })),
      readByIdempotencyKey: jest.fn(),
      readRefCasProof: jest.fn(async () => ({
        status: 'missing',
        proof: null,
        diagnostics: [
          {
            code: 'VERSION_INTENT_NOT_FOUND',
            message: 'proof missing',
            recoverability: 'repair',
          },
        ],
      })),
      completeIntent,
    };
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph: jest.fn(async () => ({
        readRef: jest.fn(async () => ({
          status: 'success',
          ref: {
            name: TARGET_REF,
            commitId: THEIRS,
            revision: { kind: 'counter', value: '2' },
            updatedAt: CREATED_AT,
          },
          diagnostics: [],
        })),
      })),
      openMergeApplyIntentStore: jest.fn(async () => store),
    };

    const result = await applyPersistedMergeResult(
      { versioning: { provider } } as Parameters<typeof applyPersistedMergeResult>[0],
      { resultId: RESULT_ID, resultDigest: RESULT_DIGEST },
      { targetRef: TARGET_REF, expectedTargetHead: EXPECTED_TARGET_HEAD },
    );

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
        },
      ],
    });
    expect(completeIntent).not.toHaveBeenCalled();
  });

  it('blocks malformed persisted intents whose expected head is not the stored ours commit', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'malformed-expected-head');
    const registry = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: namespace.graphId,
      rootCommitId: BASE,
      createdAt: CREATED_AT,
    });
    const malformedExpectedHead: VersionCommitExpectedHead = {
      ...EXPECTED_TARGET_HEAD,
      commitId: BASE,
    };
    const record = {
      ...fastForwardIntentRecord(namespace),
      expectedTargetHead: malformedExpectedHead,
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
    const openGraph = jest.fn();
    const provider = {
      accessContext: {},
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry,
        diagnostics: [],
      })),
      openGraph,
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
      { targetRef: TARGET_REF, expectedTargetHead: malformedExpectedHead },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      base: BASE,
      ours: OURS,
      theirs: THEIRS,
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        {
          issueCode: 'VERSION_MERGE_RESOLUTION_MISMATCH',
          recoverability: 'none',
        },
      ],
    });
    expect(openGraph).not.toHaveBeenCalled();
    expect(fastForwardMerge).not.toHaveBeenCalled();
    expect(store.readRefCasProof).not.toHaveBeenCalled();
    expect(store.completeIntent).not.toHaveBeenCalled();
  });
}
