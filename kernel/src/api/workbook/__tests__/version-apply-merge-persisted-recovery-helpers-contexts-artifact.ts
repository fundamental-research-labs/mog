import { jest } from '@jest/globals';

import type { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import { MERGE_PREVIEW_OBJECT_TYPE } from '../../../document/version-store/merge-attempt-artifacts';
import { createVersionGraphRegistry } from '../../../document/version-store/provider';
import type { artifactFixture } from './version-apply-merge-persisted-recovery-helpers-artifacts';
import { refReadSuccess } from './version-apply-merge-persisted-recovery-helpers-contexts-ref';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
  MERGE,
  OURS,
  THEIRS,
} from './version-apply-merge-persisted-recovery-helpers-values';

export function artifactContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef?: jest.Mock;
  readonly readCommit?: jest.Mock;
  readonly beginIntent?: jest.Mock;
  readonly completeIntent?: jest.Mock;
  readonly mergeCommit?: jest.Mock;
}) {
  const registryPromise = createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId: input.fixture.namespace.graphId,
    rootCommitId: BASE,
    createdAt: CREATED_AT,
  });
  const store: MergeApplyIntentStore = {
    namespace: input.fixture.namespace,
    beginIntent: input.beginIntent ?? jest.fn(),
    readByIntentId: jest.fn(),
    readByIdempotencyKey: jest.fn(async () => ({
      status: 'found',
      record: input.record,
      diagnostics: [],
    })),
    readRefCasProof: jest.fn(),
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
          readRef: input.readRef ?? jest.fn(async () => refReadSuccess(MERGE)),
          readCommit: input.readCommit ?? jest.fn(),
          getObjectRecord: jest.fn(async () => ({
            preimage: {
              objectType: MERGE_PREVIEW_OBJECT_TYPE,
              payload: {
                schemaVersion: 1,
                recordKind: 'mergePreview',
                status: 'clean',
                base: BASE,
                ours: OURS,
                theirs: THEIRS,
                changes: [],
                conflicts: [],
              },
            },
          })),
          putObjects: jest.fn(),
        })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: {
        mergeCommit: input.mergeCommit ?? jest.fn(),
      },
    },
  } as Parameters<typeof applyPersistedMergeResult>[0];
}
