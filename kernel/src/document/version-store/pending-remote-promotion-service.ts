import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphWriteResult } from './graph-store';
import type { WorkbookCommit } from './commit-store';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import { objectDigestFor } from './merge-apply-intent-store';
import {
  hasPendingRemoteSegmentStoreProvider,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  pendingRemotePromotionErrorMessage as errorMessage,
  sourceDiagnosticsFromPromotionError as sourceDiagnosticsFromError,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
export type {
  PendingRemotePromotionDiagnostic,
  PendingRemotePromotionDiagnosticCode,
  PendingRemotePromotionSkipReason,
  PendingRemotePromotionSourceDiagnostic,
} from './pending-remote-promotion-diagnostics';
import {
  digestKey,
  digestKeys,
  pendingRemotePromotionBatchStatusDecision,
  readPendingRemotePromotionCurrentHead,
  readPendingRemotePromotionRequiredObject,
  readPendingRemotePromotionVisibleClosure,
  sortPendingRemoteSegments,
  stableJson,
  validatePendingRemotePromotionGroupConsistency,
  validatePendingRemotePromotionRecordEligibility,
} from './pending-remote-promotion-validation';
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

export type PendingRemotePromotionStatus = 'success' | 'partial' | 'failed';

export type PendingRemotePromotionSkippedSegment = {
  readonly segmentId: PendingRemoteSegmentId;
  readonly reason: PendingRemotePromotionSkipReason;
  readonly message: string;
  readonly commitId?: WorkbookCommitId;
};

export type PendingRemotePromotionResult = {
  readonly status: PendingRemotePromotionStatus;
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly commitIds: readonly WorkbookCommitId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
};

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

type PendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
};

type PreparedPendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
};

type PrepareGroupResult =
  | {
      readonly status: 'ready';
      readonly prepared: PreparedPendingRemotePromotionGroup;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'skipped';
      readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

type PromotionCompletion = {
  readonly commitId: WorkbookCommitId;
  readonly promotionDigest: ObjectDigest;
};

type ExistingPromotionCommitResolution =
  | {
      readonly status: 'found';
      readonly completion: PromotionCompletion;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'not-found';
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

type PromotedRecoveryRecord = PendingRemoteSegmentRecord & {
  readonly terminal: {
    readonly status: 'promoted';
    readonly commitId: WorkbookCommitId;
    readonly promotionDigest?: ObjectDigest;
  };
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
    if (opened.status === 'failed') return failedResult(opened.diagnostics);

    const listed = await opened.stores.pendingStore.listByState('pending');
    if (listed.status !== 'success') {
      return failedResult([
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
      return failedResult(promotedRecoveryRecords.diagnostics);
    }

    const promotedSegmentIds: PendingRemoteSegmentId[] = [];
    const commitIds: WorkbookCommitId[] = [];
    const skipped: PendingRemotePromotionSkippedSegment[] = [];
    const diagnostics: PendingRemotePromotionDiagnostic[] = [];

    for (const group of groupPendingRemoteSegments(listed.records)) {
      const prepared = await this.prepareGroup(
        group,
        opened.stores.graph,
        opened.stores.syncBatchStatusStore,
      );
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
        const completed = await this.completePromotedSegments(
          opened.stores.pendingStore,
          prepared.prepared.records,
          existing.completion,
        );
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
      const completed = await this.completePromotedSegments(
        opened.stores.pendingStore,
        prepared.prepared.records,
        completion,
      );
      promotedSegmentIds.push(...completed.promotedSegmentIds);
      skipped.push(...completed.skipped);
      diagnostics.push(...completed.diagnostics);
    }

    return {
      status: resultStatus(promotedSegmentIds, skipped, diagnostics),
      promotedSegmentIds: Object.freeze([...promotedSegmentIds]),
      commitIds: Object.freeze([...commitIds]),
      skipped: Object.freeze([...skipped]),
      diagnostics: Object.freeze([...diagnostics]),
    };
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

  private async prepareGroup(
    group: PendingRemotePromotionGroup,
    graph: VersionGraphStore,
    syncBatchStatusStore: SyncBatchStatusStore | undefined,
  ): Promise<PrepareGroupResult> {
    const records = group.records;
    const groupConsistency = validatePendingRemotePromotionGroupConsistency(records);
    if (groupConsistency.status === 'skipped') {
      return skipPreparedGroup(
        records,
        groupConsistency.reason,
        groupConsistency.message,
        groupConsistency.diagnostics,
      );
    }

    for (const record of records) {
      const eligibility = validatePendingRemotePromotionRecordEligibility(record);
      if (eligibility.status === 'skipped') {
        return skipPreparedGroup(records, eligibility.reason, eligibility.message, [
          eligibility.diagnostic,
        ]);
      }

      const batchStatus = await pendingRemotePromotionBatchStatusDecision(
        record,
        syncBatchStatusStore,
      );
      if (batchStatus.status === 'blocked') {
        return skipPreparedGroup(records, batchStatus.reason, batchStatus.message, [
          ...batchStatus.diagnostics,
        ]);
      }
    }

    const first = records[0];
    if (first === undefined) {
      return skipPreparedGroup(
        records,
        'ineligible-state',
        'Pending remote promotion skipped an empty segment group.',
        [
          diagnostic(
            'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
            'warning',
            'Pending remote promotion skipped an empty segment group.',
          ),
        ],
      );
    }
    const snapshotRootRecord = await readPendingRemotePromotionRequiredObject(
      graph,
      'workbook.snapshotRoot.v1',
      first.snapshotRootDigest as ObjectDigest,
      'snapshotRootDigest',
    );
    if (snapshotRootRecord.status === 'skipped') {
      return skipPreparedGroup(records, snapshotRootRecord.reason, snapshotRootRecord.message, [
        ...snapshotRootRecord.diagnostics,
      ]);
    }

    const semanticChangeSetRecord = await readPendingRemotePromotionRequiredObject(
      graph,
      'workbook.semanticChangeSet.v1',
      first.semanticChangeSetDigest as ObjectDigest,
      'semanticChangeSetDigest',
    );
    if (semanticChangeSetRecord.status === 'skipped') {
      return skipPreparedGroup(
        records,
        semanticChangeSetRecord.reason,
        semanticChangeSetRecord.message,
        [...semanticChangeSetRecord.diagnostics],
      );
    }

    const mutationSegmentRecords: VersionObjectRecord<unknown>[] = [];
    for (const record of records) {
      const mutationSegmentRecord = await readPendingRemotePromotionRequiredObject(
        graph,
        'workbook.mutationSegment.v1',
        record.mutationSegmentDigest,
        'mutationSegmentDigest',
      );
      if (mutationSegmentRecord.status === 'skipped') {
        return skipPreparedGroup(
          records,
          mutationSegmentRecord.reason,
          mutationSegmentRecord.message,
          [...mutationSegmentRecord.diagnostics],
        );
      }
      mutationSegmentRecords.push(mutationSegmentRecord.record);
    }

    const ordered = sortPendingRemoteSegments(records);
    const firstOrdered = ordered[0] ?? first;
    return {
      status: 'ready',
      prepared: {
        records,
        snapshotRootRecord: snapshotRootRecord.record,
        semanticChangeSetRecord: semanticChangeSetRecord.record,
        mutationSegmentRecords: Object.freeze([...mutationSegmentRecords]),
        author: firstOrdered.operationContext.author,
        createdAt: firstOrdered.operationContext.createdAt,
      },
      diagnostics: [],
    };
  }

  private async completePromotedSegments(
    store: PendingRemoteSegmentStore,
    records: readonly PendingRemoteSegmentRecord[],
    completion: PromotionCompletion,
  ): Promise<{
    readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
    readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
    readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
  }> {
    const promotedSegmentIds: PendingRemoteSegmentId[] = [];
    const skipped: PendingRemotePromotionSkippedSegment[] = [];
    const diagnostics: PendingRemotePromotionDiagnostic[] = [];
    const completedAt = this.now().toISOString();

    for (const record of records) {
      let completed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>>;
      try {
        completed = await store.completeSegment({
          pendingRemoteSegmentId: record.pendingRemoteSegmentId,
          mutationSegmentDigest: record.mutationSegmentDigest,
          completedAt,
          terminal: {
            status: 'promoted',
            commitId: completion.commitId,
            promotionDigest: completion.promotionDigest,
          },
        });
      } catch (error) {
        completed = {
          status: 'failed',
          record: null,
          diagnostics: [
            {
              code: 'VERSION_PROVIDER_FAILED',
              message: 'Pending remote segment completion threw before returning a result.',
              recoverability: 'retry',
              details: { cause: errorMessage(error) },
            },
          ],
        };
      }

      if (completed.status === 'completed') {
        promotedSegmentIds.push(record.pendingRemoteSegmentId);
        continue;
      }

      skipped.push({
        segmentId: record.pendingRemoteSegmentId,
        reason: 'completion-failed',
        message: 'Pending remote segment was committed but could not be marked promoted.',
        commitId: completion.commitId,
      });
      diagnostics.push(
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
          'error',
          'Pending remote segment completion failed after graph commit creation.',
          {
            reason: 'completion-failed',
            segmentId: record.pendingRemoteSegmentId,
            commitId: completion.commitId,
            sourceDiagnostics: completed.diagnostics,
          },
        ),
      );
    }

    return {
      promotedSegmentIds: Object.freeze(promotedSegmentIds),
      skipped: Object.freeze(skipped),
      diagnostics: Object.freeze(diagnostics),
    };
  }
}

export function createPendingRemotePromotionService(
  options: PendingRemotePromotionServiceOptions,
): PendingRemotePromotionService {
  return new PendingRemotePromotionService(options);
}

async function listPromotedRecoveryRecords(
  store: PendingRemoteSegmentStore,
  pendingCount: number,
): Promise<
  | { readonly status: 'success'; readonly records: readonly PromotedRecoveryRecord[] }
  | { readonly status: 'failed'; readonly diagnostics: readonly PendingRemotePromotionDiagnostic[] }
> {
  if (pendingCount === 0) return { status: 'success', records: [] };
  const listed = await store.listByState('promoted');
  if (listed.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
          'error',
          'Promoted pending remote segments could not be listed for promotion recovery.',
          { sourceDiagnostics: listed.diagnostics },
        ),
      ],
    };
  }
  return { status: 'success', records: listed.records.filter(isPromotedRecoveryRecord) };
}

function promotedPeersForGroup(
  group: PendingRemotePromotionGroup,
  promotedRecords: readonly PromotedRecoveryRecord[],
): readonly PromotedRecoveryRecord[] {
  const first = group.records[0];
  if (!first) return [];
  const key = promotionGroupKey(first);
  return promotedRecords.filter((record) => promotionGroupKey(record) === key);
}

async function resolveExistingPromotionCommit(input: {
  readonly graph: VersionGraphStore;
  readonly prepared: PreparedPendingRemotePromotionGroup;
  readonly promotedPeers: readonly PromotedRecoveryRecord[];
  readonly visibleHeadCommitId: WorkbookCommitId;
}): Promise<ExistingPromotionCommitResolution> {
  const recoveryRecords = sortPendingRemoteSegments([
    ...input.prepared.records,
    ...input.promotedPeers,
  ]);
  const consistency = validatePendingRemotePromotionGroupConsistency(recoveryRecords);
  if (consistency.status === 'skipped') {
    return {
      status: 'skipped',
      reason: consistency.reason,
      message: consistency.message,
      diagnostics: consistency.diagnostics,
    };
  }
  const peerCommitIds = uniqueCommitIds(
    input.promotedPeers.map((record) => record.terminal.commitId),
  );
  if (peerCommitIds.length > 1) {
    return {
      status: 'skipped',
      reason: 'inconsistent-group',
      message: 'Pending remote promotion recovery found multiple promoted commit ids.',
      diagnostics: [recoverySkippedDiagnostic('multiple-promoted-commit-ids')],
    };
  }

  const closure = await readPendingRemotePromotionVisibleClosure(
    input.graph,
    input.visibleHeadCommitId,
  );
  if (closure.status === 'skipped') return closure;
  const match = peerCommitIds[0]
    ? closure.commits.find((commit) => commit.id === peerCommitIds[0])
    : closure.commits.find((commit) => promotionCommitMatches(commit, recoveryRecords));

  if (!match || !promotionCommitMatches(match, recoveryRecords)) {
    if (peerCommitIds.length === 0) return { status: 'not-found', diagnostics: [] };
    return {
      status: 'skipped',
      reason: 'inconsistent-group',
      message: 'Pending remote promotion recovery could not verify the promoted peer commit.',
      diagnostics: [recoverySkippedDiagnostic('promoted-peer-commit-mismatch')],
    };
  }

  return {
    status: 'found',
    completion: await promotionCompletionForCommit(match, recoveryRecords),
    diagnostics: [
      diagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED',
        'info',
        'Pending remote promotion recovered an already-visible commit.',
        { commitId: match.id, details: { segmentCount: recoveryRecords.length } },
      ),
    ],
  };
}

function promotionCommitMatches(
  commit: WorkbookCommit,
  records: readonly PendingRemoteSegmentRecord[],
): boolean {
  const ordered = sortPendingRemoteSegments(records);
  const first = ordered[0];
  if (!first || !first.snapshotRootDigest || !first.semanticChangeSetDigest) return false;
  return (
    digestKey(commit.payload.snapshotRootDigest) === digestKey(first.snapshotRootDigest) &&
    digestKey(commit.payload.semanticChangeSetDigest) ===
      digestKey(first.semanticChangeSetDigest) &&
    stableJson(commit.payload.author) === stableJson(first.operationContext.author) &&
    commit.payload.createdAt === first.operationContext.createdAt &&
    digestKeys(commit.payload.mutationSegmentDigests ?? []).join('\n') ===
      digestKeys(ordered.map((record) => record.mutationSegmentDigest)).join('\n')
  );
}

async function promotionCompletionForCommit(
  commit: WorkbookCommit,
  records: readonly PendingRemoteSegmentRecord[],
): Promise<PromotionCompletion> {
  const ordered = sortPendingRemoteSegments(records);
  return {
    commitId: commit.id,
    promotionDigest: await objectDigestFor('mog.version.pending-remote-promotion.v1', {
      schemaVersion: 1,
      commitId: commit.id,
      pendingRemoteSegmentIds: ordered.map((record) => record.pendingRemoteSegmentId),
      snapshotRootDigest: commit.payload.snapshotRootDigest,
      semanticChangeSetDigest: commit.payload.semanticChangeSetDigest,
      mutationSegmentDigests: ordered.map((record) => record.mutationSegmentDigest),
      author: commit.payload.author,
      createdAt: commit.payload.createdAt,
    }),
  };
}

function groupPendingRemoteSegments(
  records: readonly PendingRemoteSegmentRecord[],
): readonly PendingRemotePromotionGroup[] {
  const groups = new Map<string, PendingRemoteSegmentRecord[]>();
  for (const record of sortPendingRemoteSegments(records)) {
    const key = promotionGroupKey(record);
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }
  return Object.freeze(
    [...groups.values()].map((recordsInGroup) => ({
      records: Object.freeze([...recordsInGroup]),
    })),
  );
}

function promotionGroupKey(record: PendingRemoteSegmentRecord): string {
  // Grouping is conservative: explicit group id, shared commit objects/author, earliest created-at.
  const groupId = record.operationContext.groupId;
  return typeof groupId === 'string' && groupId.length > 0
    ? `group:${groupId}`
    : `segment:${record.pendingRemoteSegmentId}`;
}

function skipPreparedGroup(
  records: readonly PendingRemoteSegmentRecord[],
  reason: PendingRemotePromotionSkipReason,
  message: string,
  diagnostics: readonly PendingRemotePromotionDiagnostic[],
): Extract<PrepareGroupResult, { status: 'skipped' }> {
  return {
    status: 'skipped',
    skipped: skipGroup(records, reason, message),
    diagnostics,
  };
}

function skipGroup(
  records: readonly PendingRemoteSegmentRecord[],
  reason: PendingRemotePromotionSkipReason,
  message: string,
): readonly PendingRemotePromotionSkippedSegment[] {
  return Object.freeze(
    records.map((record) => ({
      segmentId: record.pendingRemoteSegmentId,
      reason,
      message,
    })),
  );
}

function graphWriteDiagnostic(result: Extract<VersionGraphWriteResult, { status: 'failed' }>) {
  return diagnostic(
    'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
    'error',
    'Pending remote graph commit failed; segments were left pending.',
    {
      reason: 'graph-write-failed',
      sourceDiagnostics: result.diagnostics,
      details: { mutationGuarantee: result.mutationGuarantee },
    },
  );
}

function graphWriteExceptionDiagnostic(error: unknown) {
  return diagnostic(
    'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
    'error',
    'Pending remote graph commit threw before returning a result; segments were left pending.',
    {
      reason: 'graph-write-failed',
      details: { cause: errorMessage(error) },
      sourceDiagnostics: sourceDiagnosticsFromError(error),
    },
  );
}

function failedResult(
  diagnostics: readonly PendingRemotePromotionDiagnostic[],
): PendingRemotePromotionResult {
  return {
    status: 'failed',
    promotedSegmentIds: [],
    commitIds: [],
    skipped: [],
    diagnostics: Object.freeze([...diagnostics]),
  };
}

function resultStatus(
  promotedSegmentIds: readonly PendingRemoteSegmentId[],
  skipped: readonly PendingRemotePromotionSkippedSegment[],
  diagnostics: readonly PendingRemotePromotionDiagnostic[],
): PendingRemotePromotionStatus {
  if (skipped.length === 0 && !diagnostics.some((item) => item.severity === 'error')) {
    return 'success';
  }
  return promotedSegmentIds.length > 0 ? 'partial' : 'failed';
}

function uniqueCommitIds(commitIds: readonly WorkbookCommitId[]): readonly WorkbookCommitId[] {
  return [...new Set(commitIds)];
}
function isPromotedRecoveryRecord(
  record: PendingRemoteSegmentRecord,
): record is PromotedRecoveryRecord {
  return (
    record.state === 'promoted' &&
    record.terminal?.status === 'promoted' &&
    !!record.terminal.commitId &&
    record.operationContext.kind === 'sync-import' &&
    record.operationContext.collaboration?.commitGrouping === 'pendingRemote' &&
    record.snapshotRootDigest !== undefined &&
    record.semanticChangeSetDigest !== undefined
  );
}
function recoverySkippedDiagnostic(reason: string): PendingRemotePromotionDiagnostic {
  return diagnostic(
    'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
    'warning',
    'Pending remote promotion recovery could not safely reuse an existing commit.',
    { reason: 'inconsistent-group', details: { reason } },
  );
}
function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}
