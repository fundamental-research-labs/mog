import { jest } from '@jest/globals';

import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { recoverPersistedMergeApplyPostCas } from '../version/apply-merge/version-apply-merge-recovery';
import type {
  computeMergeApplyRefCasProof,
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  TARGET_REF,
} from './version-apply-merge-ref-cas-proof-helpers-constants';

export function recoveryContext(input: {
  readonly namespace: ReturnType<typeof namespaceForDocumentScope>;
  readonly record: MergeApplyIntentRecord;
  readonly head: WorkbookCommitId;
  readonly proof?: Awaited<ReturnType<typeof computeMergeApplyRefCasProof>>;
  readonly mergeCommitPayload?: {
    readonly parentCommitIds: readonly WorkbookCommitId[];
    readonly resolvedMergeAttemptDigest?: ObjectDigest;
  };
  readonly completeIntent: MergeApplyIntentStore['completeIntent'];
  readonly fastForwardMerge?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.namespace,
    beginIntent: jest.fn(),
    readByIntentId: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readByIdempotencyKey: jest.fn(),
    readRefCasProof: jest.fn(async () =>
      input.proof
        ? { status: 'found', proof: input.proof, diagnostics: [] }
        : {
            status: 'missing',
            proof: null,
            diagnostics: [
              {
                code: 'VERSION_INTENT_NOT_FOUND',
                message: 'proof missing',
                recoverability: 'repair',
              },
            ],
          },
    ),
    completeIntent: input.completeIntent,
  };
  return {
    versioning: {
      versionControlMergeKillSwitch: true,
      provider: {
        accessContext: {},
        readGraphRegistry: jest.fn(async () => ({
          status: 'ok',
          registry: await registryPromise,
          diagnostics: [],
        })),
        openGraph: jest.fn(async () => ({
          readRef: jest.fn(async () => ({
            status: 'success',
            ref: {
              name: TARGET_REF,
              commitId: input.head,
              revision: { kind: 'counter', value: '2' },
              updatedAt: CREATED_AT,
            },
            diagnostics: [],
          })),
          readCommit: jest.fn(async () => ({
            status: 'success',
            commit: { payload: input.mergeCommitPayload ?? { parentCommitIds: [] } },
            diagnostics: [],
          })),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: {
        fastForwardMerge: input.fastForwardMerge ?? jest.fn(),
        mergeCommit: input.mergeCommit ?? jest.fn(),
      },
    },
  } as Parameters<typeof recoverPersistedMergeApplyPostCas>[0];
}
