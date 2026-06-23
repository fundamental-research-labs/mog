import type { WorkbookCommit } from './commit-store';
import { objectDigestFor } from './merge-apply-intent-store';
import type { WorkbookCommitId } from './object-digest';
import type {
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  type PendingRemotePromotionDiagnostic,
} from './pending-remote-promotion-diagnostics';
import type {
  ExistingPromotionCommitResolution,
  PreparedPendingRemotePromotionGroup,
  PromotedRecoveryRecord,
  PromotionCompletion,
} from './pending-remote-promotion-helpers-types';
import {
  digestKey,
  digestKeys,
  readPendingRemotePromotionVisibleClosure,
  sortPendingRemoteSegments,
  stableJson,
  validatePendingRemotePromotionGroupConsistency,
} from './pending-remote-promotion-validation';
import type { VersionGraphStore } from './provider-graph-store';

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
