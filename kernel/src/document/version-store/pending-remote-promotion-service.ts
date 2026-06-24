import type { VersionGraphWriteResult } from './graph';
import type { WorkbookCommitId } from './object-digest';
import {
  hasPendingRemoteSegmentStoreProvider,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  sourceDiagnosticsFromPromotionError as sourceDiagnosticsFromError,
  type PendingRemotePromotionDiagnostic,
} from './pending-remote-promotion-diagnostics';
export type {
  PendingRemotePromotionDiagnostic,
  PendingRemotePromotionDiagnosticCode,
  PendingRemotePromotionSkipReason,
  PendingRemotePromotionSourceDiagnostic,
} from './pending-remote-promotion-diagnostics';
import { readPendingRemotePromotionCurrentHead } from './pending-remote-promotion-validation';
import {
  buildPendingRemotePromotionResult,
  completePendingRemotePromotionSegments,
  failedPendingRemotePromotionResult,
  graphWriteDiagnostic,
  graphWriteExceptionDiagnostic,
  groupPendingRemoteSegments,
  listPromotedRecoveryRecords,
  preparePendingRemotePromotionGroup,
  promotedPeersForGroup,
  promotionCompletionForCommit,
  pushUnique,
  resolveExistingPromotionCommit,
  skipGroup,
  type PendingRemotePromotionResult,
  type PendingRemotePromotionSkippedSegment,
} from './pending-remote-promotion-helpers';
export type {
  PendingRemotePromotionResult,
  PendingRemotePromotionSkippedSegment,
  PendingRemotePromotionStatus,
} from './pending-remote-promotion-helpers';
import type { VersionGraphStore } from './provider-graph-store';
import type { VersionStoreProvider } from './provider';
import { namespaceForRegistry } from './registry';
import {
  hasSyncBatchStatusStoreProvider,
  type SyncBatchStatusStore,
} from './sync-batch-status-store';
import {
  createVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from './provider-write-activity';

export type PendingRemotePromotionServiceOptions = {
  readonly provider: VersionStoreProvider;
  readonly now?: () => Date;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
};

type OpenedPromotionStores = {
  readonly graph: VersionGraphStore;
  readonly pendingStore: PendingRemoteSegmentStore;
  readonly syncBatchStatusStore?: SyncBatchStatusStore;
};

export class PendingRemotePromotionService {
  readonly providerWriteActivityTracker: VersionProviderWriteActivityTracker;
  private readonly provider: VersionStoreProvider;
  private readonly now: () => Date;

  constructor(options: PendingRemotePromotionServiceOptions) {
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.providerWriteActivityTracker =
      options.providerWriteActivityTracker ?? createVersionProviderWriteActivityTracker();
  }

  async promotePendingRemoteSegments(): Promise<PendingRemotePromotionResult> {
    return this.providerWriteActivityTracker.runExclusivePendingRemotePromotion(() =>
      this.promotePendingRemoteSegmentsUnlocked(),
    );
  }

  private async promotePendingRemoteSegmentsUnlocked(): Promise<PendingRemotePromotionResult> {
    const opened = await this.openStores();
    if (opened.status === 'failed') return failedPendingRemotePromotionResult(opened.diagnostics);

    const listed = await opened.stores.pendingStore.listByState('pending');
    if (listed.status !== 'success') {
      return failedPendingRemotePromotionResult([
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
          'error',
          'Pending remote segments could not be listed for promotion.',
          {
            sourceDiagnostics: listed.diagnostics,
          },
        ),
      ]);
    }

    const promotedRecoveryRecords = await listPromotedRecoveryRecords(
      opened.stores.pendingStore,
      listed.records.length,
    );
    if (promotedRecoveryRecords.status === 'failed') {
      return failedPendingRemotePromotionResult(promotedRecoveryRecords.diagnostics);
    }

    const promotedSegmentIds: PendingRemoteSegmentId[] = [];
    const commitIds: WorkbookCommitId[] = [];
    const skipped: PendingRemotePromotionSkippedSegment[] = [];
    const diagnostics: PendingRemotePromotionDiagnostic[] = [];

    for (const group of groupPendingRemoteSegments(listed.records)) {
      const prepared = await preparePendingRemotePromotionGroup({
        group,
        graph: opened.stores.graph,
        syncBatchStatusStore: opened.stores.syncBatchStatusStore,
      });
      diagnostics.push(...prepared.diagnostics);
      if (prepared.status === 'skipped') {
        skipped.push(...prepared.skipped);
        continue;
      }

      const head = await readPendingRemotePromotionCurrentHead(opened.stores.graph);
      if (head.status === 'skipped') {
        const skippedGroup = skipGroup(prepared.prepared.records, head.reason, head.message);
        skipped.push(...skippedGroup);
        diagnostics.push(...head.diagnostics);
        continue;
      }

      const existing = await resolveExistingPromotionCommit({
        graph: opened.stores.graph,
        prepared: prepared.prepared,
        promotedPeers: promotedPeersForGroup(group, promotedRecoveryRecords.records),
        visibleHeadCommitId: head.main.commitId,
      });
      diagnostics.push(...existing.diagnostics);
      if (existing.status === 'skipped') {
        skipped.push(...skipGroup(prepared.prepared.records, existing.reason, existing.message));
        continue;
      }
      if (existing.status === 'found') {
        pushUnique(commitIds, existing.completion.commitId);
        const completed = await completePendingRemotePromotionSegments({
          store: opened.stores.pendingStore,
          records: prepared.prepared.records,
          completion: existing.completion,
          completedAt: this.now().toISOString(),
        });
        promotedSegmentIds.push(...completed.promotedSegmentIds);
        skipped.push(...completed.skipped);
        diagnostics.push(...completed.diagnostics);
        continue;
      }

      let committed: VersionGraphWriteResult;
      try {
        committed = await opened.stores.graph.commit({
          snapshotRootRecord: prepared.prepared.snapshotRootRecord,
          semanticChangeSetRecord: prepared.prepared.semanticChangeSetRecord,
          mutationSegmentRecords: prepared.prepared.mutationSegmentRecords,
          author: prepared.prepared.author,
          createdAt: prepared.prepared.createdAt,
          completenessDiagnostics: [],
          targetRef: head.main.name,
          expectedHeadCommitId: head.main.commitId,
          expectedTargetRefVersion: head.main.revision,
          parentCommitIds: [head.main.commitId],
        });
      } catch (error) {
        const skippedGroup = skipGroup(
          prepared.prepared.records,
          'graph-write-failed',
          'Pending remote promotion did not create a graph commit.',
        );
        skipped.push(...skippedGroup);
        diagnostics.push(graphWriteExceptionDiagnostic(error));
        continue;
      }

      if (committed.status !== 'success') {
        const skippedGroup = skipGroup(
          prepared.prepared.records,
          'graph-write-failed',
          'Pending remote promotion did not create a graph commit.',
        );
        skipped.push(...skippedGroup);
        diagnostics.push(graphWriteDiagnostic(committed));
        continue;
      }

      pushUnique(commitIds, committed.commit.id);
      const completion = await promotionCompletionForCommit(
        committed.commit,
        prepared.prepared.records,
      );
      const completed = await completePendingRemotePromotionSegments({
        store: opened.stores.pendingStore,
        records: prepared.prepared.records,
        completion,
        completedAt: this.now().toISOString(),
      });
      promotedSegmentIds.push(...completed.promotedSegmentIds);
      skipped.push(...completed.skipped);
      diagnostics.push(...completed.diagnostics);
    }

    return buildPendingRemotePromotionResult({
      promotedSegmentIds,
      commitIds,
      skipped,
      diagnostics,
    });
  }

  private async openStores(): Promise<
    | { readonly status: 'success'; readonly stores: OpenedPromotionStores }
    | {
        readonly status: 'failed';
        readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
      }
  > {
    if (!hasPendingRemoteSegmentStoreProvider(this.provider)) {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic(
            'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
            'error',
            'This version store provider does not expose pending remote segments.',
          ),
        ],
      };
    }

    try {
      const registry = await this.provider.readGraphRegistry();
      if (registry.status !== 'ok') {
        return {
          status: 'failed',
          diagnostics: [
            diagnostic(
              'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
              'error',
              'The visible version graph registry could not be opened for pending remote promotion.',
              {
                sourceDiagnostics: registry.diagnostics,
              },
            ),
          ],
        };
      }

      const namespace = namespaceForRegistry(registry.registry);
      const graph = await this.provider.openGraph(namespace, this.provider.accessContext);
      const pendingStore = await this.provider.openPendingRemoteSegmentStore(namespace);
      const syncBatchStatusStore = hasSyncBatchStatusStoreProvider(this.provider)
        ? await this.provider.openSyncBatchStatusStore()
        : undefined;

      return {
        status: 'success',
        stores: {
          graph,
          pendingStore,
          ...(syncBatchStatusStore === undefined ? {} : { syncBatchStatusStore }),
        },
      };
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic(
            'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
            'error',
            'Version store provider failed while opening pending remote promotion stores.',
            {
              sourceDiagnostics: sourceDiagnosticsFromError(error),
            },
          ),
        ],
      };
    }
  }
}

export function createPendingRemotePromotionService(
  options: PendingRemotePromotionServiceOptions,
): PendingRemotePromotionService {
  return new PendingRemotePromotionService(options);
}
