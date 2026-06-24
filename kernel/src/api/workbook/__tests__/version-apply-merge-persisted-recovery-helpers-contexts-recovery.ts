import { jest } from '@jest/globals';

import type { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import {
  computeMergeApplyRefCasProof,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import { createVersionGraphRegistry } from '../../../document/version-store/provider';
import type { artifactFixture } from './version-apply-merge-persisted-recovery-helpers-artifacts';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  MERGE,
  OURS,
  TARGET_REF,
} from './version-apply-merge-persisted-recovery-helpers-values';

export function recoveryContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef: jest.Mock;
  readonly readRefCasProof?: jest.Mock;
  readonly completeIntent?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.fixture.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.fixture.namespace,
    beginIntent: jest.fn(),
    readByIntentId: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readByIdempotencyKey: jest.fn(),
    readRefCasProof:
      input.readRefCasProof ??
      jest.fn(async () => ({
        status: 'found',
        proof: await computeMergeApplyRefCasProof({
          applyKind: 'mergeCommit',
          targetRef: TARGET_REF,
          headBefore: OURS,
          headAfter: MERGE,
        }),
        diagnostics: [],
      })),
    completeIntent: input.completeIntent ?? jest.fn(),
  };
  return {
    versioning: {
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({
          readRef: input.readRef,
          readCommit: jest.fn(),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
    },
  } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0];
}
