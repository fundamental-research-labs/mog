import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphWriteResult } from './graph-store';
import type { WorkbookCommit } from './commit-store';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import { objectDigestFor } from './merge-apply-intent-store';
import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  pendingRemotePromotionErrorMessage as errorMessage,
  sourceDiagnosticsFromPromotionError as sourceDiagnosticsFromError,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import {
  digestKey,
  digestKeys,
  pendingRemotePromotionBatchStatusDecision,
  readPendingRemotePromotionRequiredObject,
  readPendingRemotePromotionVisibleClosure,
  sortPendingRemoteSegments,
  stableJson,
  validatePendingRemotePromotionGroupConsistency,
  validatePendingRemotePromotionRecordEligibility,
} from './pending-remote-promotion-validation';
import type { VersionGraphStore } from './provider-graph-store';
import type { SyncBatchStatusStore } from './sync-batch-status-store';

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

export type PendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
};

export type PreparedPendingRemotePromotionGroup = {
  readonly records: readonly PendingRemoteSegmentRecord[];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
};

export type PreparePendingRemotePromotionGroupResult =
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

export type PromotionCompletion = {
  readonly commitId: WorkbookCommitId;
  readonly promotionDigest: ObjectDigest;
};

export type ExistingPromotionCommitResolution =
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

export type PromotedRecoveryRecord = PendingRemoteSegmentRecord & {
  readonly terminal: {
    readonly status: 'promoted';
    readonly commitId: WorkbookCommitId;
    readonly promotionDigest?: ObjectDigest;
  };
};

export async function preparePendingRemotePromotionGroup(input: {
  readonly group: PendingRemotePromotionGroup;
  readonly graph: VersionGraphStore;
  readonly syncBatchStatusStore: SyncBatchStatusStore | undefined;
}): Promise<PreparePendingRemotePromotionGroupResult> {
  const records = input.group.records;
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
      input.syncBatchStatusStore,
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
    input.graph,
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
    input.graph,
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
      input.graph,
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

export async function completePendingRemotePromotionSegments(input: {
  readonly store: PendingRemoteSegmentStore;
  readonly records: readonly PendingRemoteSegmentRecord[];
  readonly completion: PromotionCompletion;
  readonly completedAt: string;
}): Promise<{
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
}> {
  const promotedSegmentIds: PendingRemoteSegmentId[] = [];
  const skipped: PendingRemotePromotionSkippedSegment[] = [];
  const diagnostics: PendingRemotePromotionDiagnostic[] = [];

  for (const record of input.records) {
    let completed: Awaited<ReturnType<PendingRemoteSegmentStore['completeSegment']>>;
    try {
      completed = await input.store.completeSegment({
        pendingRemoteSegmentId: record.pendingRemoteSegmentId,
        mutationSegmentDigest: record.mutationSegmentDigest,
        completedAt: input.completedAt,
        terminal: {
          status: 'promoted',
          commitId: input.completion.commitId,
          promotionDigest: input.completion.promotionDigest,
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
      commitId: input.completion.commitId,
    });
    diagnostics.push(
      diagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_COMPLETION_FAILED',
        'error',
        'Pending remote segment completion failed after graph commit creation.',
        {
          reason: 'completion-failed',
          segmentId: record.pendingRemoteSegmentId,
          commitId: input.completion.commitId,
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

export async function listPromotedRecoveryRecords(
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

export function promotedPeersForGroup(
  group: PendingRemotePromotionGroup,
  promotedRecords: readonly PromotedRecoveryRecord[],
): readonly PromotedRecoveryRecord[] {
  const first = group.records[0];
  if (!first) return [];
  const key = promotionGroupKey(first);
  return promotedRecords.filter((record) => promotionGroupKey(record) === key);
}

export async function resolveExistingPromotionCommit(input: {
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

export async function promotionCompletionForCommit(
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

export function groupPendingRemoteSegments(
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

export function skipGroup(
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

export function graphWriteDiagnostic(
  result: Extract<VersionGraphWriteResult, { status: 'failed' }>,
) {
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

export function graphWriteExceptionDiagnostic(error: unknown) {
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

export function failedPendingRemotePromotionResult(
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

export function buildPendingRemotePromotionResult(input: {
  readonly promotedSegmentIds: readonly PendingRemoteSegmentId[];
  readonly commitIds: readonly WorkbookCommitId[];
  readonly skipped: readonly PendingRemotePromotionSkippedSegment[];
  readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
}): PendingRemotePromotionResult {
  return {
    status: resultStatus(input.promotedSegmentIds, input.skipped, input.diagnostics),
    promotedSegmentIds: Object.freeze([...input.promotedSegmentIds]),
    commitIds: Object.freeze([...input.commitIds]),
    skipped: Object.freeze([...input.skipped]),
    diagnostics: Object.freeze([...input.diagnostics]),
  };
}

export function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
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
): Extract<PreparePendingRemotePromotionGroupResult, { status: 'skipped' }> {
  return {
    status: 'skipped',
    skipped: skipGroup(records, reason, message),
    diagnostics,
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
