import { jest } from '@jest/globals';

import type { applyPersistedMergeResult } from '../version/apply-merge/version-apply-merge-persisted';
import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';
import { createVersionGraphRegistry } from '../../../document/version-store/provider';
import type { artifactFixture } from './version-apply-merge-persisted-recovery-helpers-artifacts';
import {
  BASE,
  CREATED_AT,
  DOCUMENT_SCOPE,
} from './version-apply-merge-persisted-recovery-helpers-values';

export function persistedIntentContext(input: {
  readonly fixture: Awaited<ReturnType<typeof artifactFixture>>;
  readonly record: MergeApplyIntentRecord;
  readonly readRef: jest.Mock;
  readonly fastForwardMerge: jest.Mock;
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
    readRefCasProof: jest.fn(),
    completeIntent: jest.fn(),
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
        openGraph: jest.fn(async () => ({ readRef: input.readRef })),
        openMergeApplyIntentStore: jest.fn(async () => store),
      },
      writeService: { fastForwardMerge: input.fastForwardMerge },
    },
  } as Parameters<typeof applyPersistedMergeResult>[0];
}
