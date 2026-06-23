import type { PendingRemoteSegmentStore } from '../pending-remote-segment-store';
import type {
  ConflictProvider,
  InMemoryProvider,
} from './pending-remote-promotion-service-helpers-conflicts-types';

export function providerWithCompletionFailures(
  provider: InMemoryProvider,
  shouldFail: (
    attempt: number,
    input: Parameters<PendingRemoteSegmentStore['completeSegment']>[0],
  ) => boolean,
): ConflictProvider {
  let completionAttempts = 0;
  return {
    documentScope: provider.documentScope,
    accessContext: provider.accessContext,
    capabilities: provider.capabilities,
    readGraphRegistry: provider.readGraphRegistry.bind(provider),
    initializeGraph: provider.initializeGraph.bind(provider),
    scanDocumentIntegrity: provider.scanDocumentIntegrity.bind(provider),
    close: provider.close.bind(provider),
    dispose: provider.dispose.bind(provider),
    openGraph: provider.openGraph.bind(provider),
    openSyncBatchStatusStore: provider.openSyncBatchStatusStore.bind(provider),
    openPendingRemoteSegmentStore: async (namespace) => {
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const wrapped: PendingRemoteSegmentStore = {
        namespace: store.namespace,
        reserveSegment: (input) => store.reserveSegment(input),
        readBySegmentId: (segmentId) => store.readBySegmentId(segmentId),
        readByIdempotencyKey: (idempotencyKey) => store.readByIdempotencyKey(idempotencyKey),
        listByState: (state) => store.listByState(state),
        completeSegment: (input) => {
          completionAttempts += 1;
          if (!shouldFail(completionAttempts, input)) return store.completeSegment(input);
          const failed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>> = {
            status: 'failed',
            record: null,
            diagnostics: [
              {
                code: 'VERSION_PROVIDER_FAILED',
                message: 'Injected pending remote completion failure.',
                recoverability: 'retry',
              },
            ],
          };
          return Promise.resolve(failed);
        },
      };
      return wrapped;
    },
  };
}
