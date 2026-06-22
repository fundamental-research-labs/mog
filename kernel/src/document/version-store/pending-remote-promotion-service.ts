import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  VersionGraphReadHeadResult,
  VersionGraphStoreDiagnostic,
  VersionGraphWriteResult,
} from './graph-store';
import type { ObjectDigest, VersionObjectType, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import {
  hasPendingRemoteSegmentStoreProvider,
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentStore,
  type PendingRemoteSegmentStoreDiagnostic,
} from './pending-remote-segment-store';
import type { VersionGraphStore } from './provider-graph-store';
import {
  VersionStoreProviderError,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';
import {
  hasSyncBatchStatusStoreProvider,
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusRecord,
  type SyncBatchStatusId,
  type SyncBatchStatusStore,
  type SyncBatchStatusStoreDiagnostic,
} from './sync-batch-status-store';

export type PendingRemotePromotionStatus = 'success' | 'partial' | 'failed';

export type PendingRemotePromotionSkipReason =
  | 'batch-status-read-failed'
  | 'batch-status-terminal'
  | 'completion-failed'
  | 'graph-ref-unavailable'
  | 'graph-write-failed'
  | 'inconsistent-group'
  | 'ineligible-operation-context'
  | 'ineligible-state'
  | 'invalid-required-object'
  | 'missing-required-object'
  | 'missing-semantic-change-set'
  | 'missing-snapshot-root'
  | 'provider-read-failed';

export type PendingRemotePromotionDiagnosticCode =
  | 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE'
  | 'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED'
  | 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE';

export type PendingRemotePromotionSourceDiagnostic =
  | VersionStoreDiagnostic
  | VersionGraphStoreDiagnostic
  | PendingRemoteSegmentStoreDiagnostic
  | SyncBatchStatusStoreDiagnostic;

export type PendingRemotePromotionDiagnostic = {
  readonly code: PendingRemotePromotionDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly reason?: PendingRemotePromotionSkipReason;
  readonly segmentId?: PendingRemoteSegmentId;
  readonly commitId?: WorkbookCommitId;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly PendingRemotePromotionSourceDiagnostic[];
};

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

type GroupConsistencyResult =
  | { readonly status: 'ok' }
  | Extract<PrepareGroupResult, { status: 'skipped' }>;

type RecordEligibilityResult =
  | { readonly status: 'eligible' }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostic: PendingRemotePromotionDiagnostic;
    };

type ReadRequiredObjectResult =
  | {
      readonly status: 'success';
      readonly record: VersionObjectRecord<unknown>;
    }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

type BatchStatusDecision =
  | { readonly status: 'ok'; readonly diagnostics: readonly PendingRemotePromotionDiagnostic[] }
  | {
      readonly status: 'blocked';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export class PendingRemotePromotionService {
  private readonly provider: VersionStoreProvider;
  private readonly now: () => Date;

  constructor(options: PendingRemotePromotionServiceOptions) {
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
  }

  async promotePendingRemoteSegments(): Promise<PendingRemotePromotionResult> {
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

      const head = await readCurrentHead(opened.stores.graph);
      if (head.status === 'skipped') {
        const skippedGroup = skipGroup(prepared.prepared.records, head.reason, head.message);
        skipped.push(...skippedGroup);
        diagnostics.push(...head.diagnostics);
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
      const completed = await this.completePromotedSegments(
        opened.stores.pendingStore,
        prepared.prepared.records,
        committed.commit.id,
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
    | { readonly status: 'failed'; readonly diagnostics: readonly PendingRemotePromotionDiagnostic[] }
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
    const groupConsistency = validateGroupConsistency(records);
    if (groupConsistency.status === 'skipped') return groupConsistency;

    for (const record of records) {
      const eligibility = validateRecordEligibility(record);
      if (eligibility.status === 'skipped') {
        return skipPreparedGroup(records, eligibility.reason, eligibility.message, [
          eligibility.diagnostic,
        ]);
      }

      const batchStatus = await batchStatusDecision(record, syncBatchStatusStore);
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
    const snapshotRootRecord = await readRequiredObject(
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

    const semanticChangeSetRecord = await readRequiredObject(
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
      const mutationSegmentRecord = await readRequiredObject(
        graph,
        'workbook.mutationSegment.v1',
        record.mutationSegmentDigest,
        'mutationSegmentDigest',
      );
      if (mutationSegmentRecord.status === 'skipped') {
        return skipPreparedGroup(records, mutationSegmentRecord.reason, mutationSegmentRecord.message, [
          ...mutationSegmentRecord.diagnostics,
        ]);
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
    commitId: WorkbookCommitId,
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
          terminal: { status: 'promoted', commitId },
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
        commitId,
      });
      diagnostics.push(
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
          'error',
          'Pending remote segment completion failed after graph commit creation.',
          {
            reason: 'completion-failed',
            segmentId: record.pendingRemoteSegmentId,
            commitId,
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

function validateGroupConsistency(
  records: readonly PendingRemoteSegmentRecord[],
): GroupConsistencyResult {
  if (records.length <= 1) return { status: 'ok' };

  const ordered = sortPendingRemoteSegments(records);
  const first = ordered[0];
  if (first === undefined) return { status: 'ok' };
  const snapshotRootDigest = first.snapshotRootDigest;
  const semanticChangeSetDigest = first.semanticChangeSetDigest;
  const authorKey = stableJson(first.operationContext.author);

  for (const record of ordered.slice(1)) {
    if (
      snapshotRootDigest === undefined ||
      semanticChangeSetDigest === undefined ||
      record.snapshotRootDigest === undefined ||
      record.semanticChangeSetDigest === undefined ||
      digestKey(record.snapshotRootDigest) !== digestKey(snapshotRootDigest) ||
      digestKey(record.semanticChangeSetDigest) !== digestKey(semanticChangeSetDigest) ||
      stableJson(record.operationContext.author) !== authorKey
    ) {
      return skipPreparedGroup(
        records,
        'inconsistent-group',
        'Grouped pending remote segments must share commit-level objects and author metadata.',
        [
          diagnostic(
            'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
            'warning',
            'Pending remote promotion skipped an inconsistent grouped segment set.',
            {
              reason: 'inconsistent-group',
              details: { segmentCount: records.length },
            },
          ),
        ],
      );
    }
  }

  return { status: 'ok' };
}

function validateRecordEligibility(
  record: PendingRemoteSegmentRecord,
): RecordEligibilityResult {
  if (record.state !== 'pending') {
    return ineligibleRecord(record, 'ineligible-state', 'Pending remote segment is not pending.');
  }
  if (
    record.operationContext.kind !== 'sync-import' ||
    record.operationContext.collaboration?.commitGrouping !== 'pendingRemote'
  ) {
    return ineligibleRecord(
      record,
      'ineligible-operation-context',
      'Pending remote segment does not represent a pending remote sync import.',
    );
  }
  if (record.snapshotRootDigest === undefined) {
    return ineligibleRecord(
      record,
      'missing-snapshot-root',
      'Pending remote segment is missing a snapshot root digest required for commit creation.',
    );
  }
  if (record.semanticChangeSetDigest === undefined) {
    return ineligibleRecord(
      record,
      'missing-semantic-change-set',
      'Pending remote segment is missing a semantic change set digest required for commit creation.',
    );
  }
  return { status: 'eligible' };
}

function ineligibleRecord(
  record: PendingRemoteSegmentRecord,
  reason: PendingRemotePromotionSkipReason,
  message: string,
): Extract<RecordEligibilityResult, { status: 'skipped' }> {
  return {
    status: 'skipped',
    reason,
    message,
    diagnostic: diagnostic(
      'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
      'warning',
      message,
      {
        reason,
        segmentId: record.pendingRemoteSegmentId,
      },
    ),
  };
}

async function batchStatusDecision(
  record: PendingRemoteSegmentRecord,
  store: SyncBatchStatusStore | undefined,
): Promise<BatchStatusDecision> {
  if (store === undefined) return { status: 'ok', diagnostics: [] };

  let batchStatusId: SyncBatchStatusId;
  try {
    batchStatusId = (
      await syncBatchStatusKeyMaterialForOperationContext(record.operationContext)
    ).batchStatusId;
  } catch {
    return { status: 'ok', diagnostics: [] };
  }

  let read: Awaited<ReturnType<SyncBatchStatusStore['readByBatchStatusId']>>;
  try {
    read = await store.readByBatchStatusId(batchStatusId);
  } catch (error) {
    read = {
      status: 'failed',
      record: null,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: 'Sync batch status read threw before returning a result.',
          recoverability: 'retry',
          details: { cause: errorMessage(error) },
        },
      ],
    };
  }
  if (read.status === 'missing') return { status: 'ok', diagnostics: [] };
  if (read.status === 'failed') {
    const message = 'Referenced sync batch status could not be read for pending remote promotion.';
    return {
      status: 'blocked',
      reason: 'batch-status-read-failed',
      message,
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
          'error',
          message,
          {
            reason: 'batch-status-read-failed',
            segmentId: record.pendingRemoteSegmentId,
            sourceDiagnostics: read.diagnostics,
          },
        ),
      ],
    };
  }

  if (isTerminalBlockedBatchStatus(read.record)) {
    const message = 'Referenced sync batch status is terminal failed, dropped, or rejected.';
    return {
      status: 'blocked',
      reason: 'batch-status-terminal',
      message,
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
          'warning',
          message,
          {
            reason: 'batch-status-terminal',
            segmentId: record.pendingRemoteSegmentId,
            details: { batchStatusState: read.record.state },
          },
        ),
      ],
    };
  }

  return { status: 'ok', diagnostics: [] };
}

function isTerminalBlockedBatchStatus(record: SyncBatchStatusRecord): boolean {
  return (
    record.state === 'failedAfterMutation' ||
    record.state === 'dropped' ||
    record.state === 'rejected'
  );
}

async function readRequiredObject(
  graph: VersionGraphStore,
  objectType: VersionObjectType,
  digest: ObjectDigest,
  field: string,
): Promise<ReadRequiredObjectResult> {
  try {
    return {
      status: 'success',
      record: await graph.getObjectRecord({ kind: 'object', objectType, digest }),
    };
  } catch (error) {
    const sourceCode = diagnosticCodeFromError(error);
    const reason = objectReadSkipReason(sourceCode);
    const message =
      reason === 'missing-required-object'
        ? 'Pending remote segment references a required object that is not persisted.'
        : reason === 'invalid-required-object'
          ? 'Pending remote segment references a required object with invalid type or content.'
          : 'Pending remote segment required object could not be read.';
    return {
      status: 'skipped',
      reason,
      message,
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_OBJECT_READ_FAILED',
          reason === 'provider-read-failed' ? 'error' : 'warning',
          message,
          {
            reason,
            details: {
              objectType,
              digest: digest.digest,
              field,
              sourceCode: sourceCode ?? null,
            },
          },
        ),
      ],
    };
  }
}

function objectReadSkipReason(
  sourceCode: string | undefined,
): Extract<
  PendingRemotePromotionSkipReason,
  'invalid-required-object' | 'missing-required-object' | 'provider-read-failed'
> {
  if (sourceCode === 'VERSION_OBJECT_NOT_FOUND') return 'missing-required-object';
  if (
    sourceCode === 'VERSION_OBJECT_TYPE_MISMATCH' ||
    sourceCode === 'VERSION_OBJECT_CORRUPTION' ||
    sourceCode === 'VERSION_DIGEST_MISMATCH'
  ) {
    return 'invalid-required-object';
  }
  return 'provider-read-failed';
}

async function readCurrentHead(
  graph: VersionGraphStore,
): Promise<
  | Extract<VersionGraphReadHeadResult, { status: 'success' }>
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    }
> {
  let head: VersionGraphReadHeadResult;
  try {
    head = await graph.readHead();
  } catch (error) {
    const message = 'The visible graph head could not be read for pending remote promotion.';
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic(
          'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
          'error',
          message,
          {
            reason: 'graph-ref-unavailable',
            details: { cause: errorMessage(error) },
          },
        ),
      ],
    };
  }
  if (head.status === 'success') return head;

  const message = 'The visible graph head could not be read for pending remote promotion.';
  return {
    status: 'skipped',
    reason: 'graph-ref-unavailable',
    message,
    diagnostics: [
      diagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
        'error',
        message,
        {
          reason: 'graph-ref-unavailable',
          sourceDiagnostics: head.diagnostics,
        },
      ),
    ],
  };
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

function diagnostic(
  code: PendingRemotePromotionDiagnosticCode,
  severity: PendingRemotePromotionDiagnostic['severity'],
  message: string,
  options: {
    readonly reason?: PendingRemotePromotionSkipReason;
    readonly segmentId?: PendingRemoteSegmentId;
    readonly commitId?: WorkbookCommitId;
    readonly details?: PendingRemotePromotionDiagnostic['details'];
    readonly sourceDiagnostics?: readonly PendingRemotePromotionSourceDiagnostic[] | undefined;
  } = {},
): PendingRemotePromotionDiagnostic {
  return Object.freeze({
    code,
    severity,
    message,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.segmentId === undefined ? {} : { segmentId: options.segmentId }),
    ...(options.commitId === undefined ? {} : { commitId: options.commitId }),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.sourceDiagnostics === undefined
      ? {}
      : { sourceDiagnostics: Object.freeze([...options.sourceDiagnostics]) }),
  });
}

function sortPendingRemoteSegments(
  records: readonly PendingRemoteSegmentRecord[],
): readonly PendingRemoteSegmentRecord[] {
  return Object.freeze(
    [...records].sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt);
      if (createdAt !== 0) return createdAt;
      return left.pendingRemoteSegmentId.localeCompare(right.pendingRemoteSegmentId);
    }),
  );
}

function digestKey(digest: ObjectDigest): string {
  return `${digest.algorithm}:${digest.digest}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('stable JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('stable JSON value must be a record');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function sourceDiagnosticsFromError(
  error: unknown,
): readonly PendingRemotePromotionSourceDiagnostic[] | undefined {
  if (error instanceof VersionStoreProviderError) return error.diagnostics;
  if (!isRecord(error) || !Array.isArray(error.diagnostics)) return undefined;
  return error.diagnostics.filter(isPromotionSourceDiagnostic);
}

function diagnosticCodeFromError(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.diagnostic)) return undefined;
  return typeof error.diagnostic.code === 'string' ? error.diagnostic.code : undefined;
}

function isPromotionSourceDiagnostic(value: unknown): value is PendingRemotePromotionSourceDiagnostic {
  return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}
