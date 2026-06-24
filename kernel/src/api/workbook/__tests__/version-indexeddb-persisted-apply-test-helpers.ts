import type {
  VersionApplyMergeResolution,
  VersionHead,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { MergeApplyIntentStore } from '../../../document/version-store/merge-apply-intent-store';
import type { IndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';

export function installIndexedDbPersistedApplyTestLifecycle(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

export async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

export function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function failFirstIntentCompletion(
  provider: IndexedDbVersionStoreProvider,
): IndexedDbVersionStoreProvider {
  let shouldFailCompletion = true;
  const openStore = provider.openMergeApplyIntentStore.bind(provider);
  provider.openMergeApplyIntentStore = async (namespace) => {
    const store = await openStore(namespace);
    return {
      namespace: store.namespace,
      beginIntent: store.beginIntent.bind(store),
      readByIntentId: store.readByIntentId.bind(store),
      readByIdempotencyKey: store.readByIdempotencyKey.bind(store),
      completeIntent: async (input) => {
        if (!shouldFailCompletion) return store.completeIntent(input);
        shouldFailCompletion = false;
        return {
          status: 'failed',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_PROVIDER_FAILED',
              message: 'Injected merge intent completion failure.',
              recoverability: 'retry',
            },
          ],
        };
      },
    } satisfies MergeApplyIntentStore;
  };
  return provider;
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
