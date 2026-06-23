import type { ObjectDigest } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import type {
  PendingRemotePromotionGroup,
  PreparePendingRemotePromotionGroupResult,
} from './pending-remote-promotion-helpers-types';
import { skipGroup } from './pending-remote-promotion-helpers-result';
import {
  pendingRemotePromotionBatchStatusDecision,
  readPendingRemotePromotionRequiredObject,
  sortPendingRemoteSegments,
  validatePendingRemotePromotionGroupConsistency,
  validatePendingRemotePromotionRecordEligibility,
} from './pending-remote-promotion-validation';
import type { VersionGraphStore } from './provider-graph-store';
import type { SyncBatchStatusStore } from './sync-batch-status-store';

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
