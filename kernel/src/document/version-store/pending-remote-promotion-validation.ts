import type { VersionGraphReadHeadResult } from './graph-store';
import type { WorkbookCommit } from './commit-store';
import type { ObjectDigest, VersionObjectType, WorkbookCommitId } from './object-digest';
import type { VersionObjectRecord } from './object-store';
import { validatePendingRemoteProviderAuthority } from './pending-remote-authority-gate';
import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';
import type { VersionGraphStore } from './provider-graph-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  diagnosticCodeFromPromotionError as diagnosticCodeFromError,
  pendingRemotePromotionErrorMessage as errorMessage,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionDiagnosticCode,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import {
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusRecord,
  type SyncBatchStatusStore,
} from './sync-batch-status-store';

type PendingRemotePromotionGroupConsistencyResult =
  | { readonly status: 'ok' }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

type RecordEligibilityResult =
  | { readonly status: 'eligible' }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostic: PendingRemotePromotionDiagnostic;
    };

export type PendingRemotePromotionReadRequiredObjectResult =
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

export type PendingRemotePromotionBatchStatusDecision =
  | { readonly status: 'ok'; readonly diagnostics: readonly PendingRemotePromotionDiagnostic[] }
  | {
      readonly status: 'blocked';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PendingRemotePromotionCurrentHeadReadResult =
  | Extract<VersionGraphReadHeadResult, { status: 'success' }>
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

export type PendingRemotePromotionVisibleClosureReadResult =
  | { readonly status: 'success'; readonly commits: readonly WorkbookCommit[] }
  | {
      readonly status: 'skipped';
      readonly reason: PendingRemotePromotionSkipReason;
      readonly message: string;
      readonly diagnostics: readonly PendingRemotePromotionDiagnostic[];
    };

const SAFE_ACTUAL_DETAIL_FIELDS = new Set([
  'actorKind',
  'authorState',
  'capturePolicy',
  'originKind',
  'replay',
  'sourceKind',
  'system',
  'trustStatus',
  'validationDiagnosticCount',
  'writeAdmissionMode',
]);

export function validatePendingRemotePromotionGroupConsistency(
  records: readonly PendingRemoteSegmentRecord[],
): PendingRemotePromotionGroupConsistencyResult {
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
      const message =
        'Grouped pending remote segments must share commit-level objects and author metadata.';
      return {
        status: 'skipped',
        reason: 'inconsistent-group',
        message,
        diagnostics: [
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
      };
    }
  }

  return { status: 'ok' };
}

export function validatePendingRemotePromotionRecordEligibility(
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

  const readbackDiagnostics = validateProviderCycleReadbackDiagnostics(record);
  if (readbackDiagnostics.status === 'skipped') return readbackDiagnostics;

  const authority = validatePendingRemoteProviderAuthority(record);
  if (authority.status === 'blocked') {
    return ineligibleRecord(
      record,
      authority.reason,
      authority.message,
      'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
      sanitizeProviderAuthorityDetails(authority.details),
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

export async function pendingRemotePromotionBatchStatusDecision(
  record: PendingRemoteSegmentRecord,
  store: SyncBatchStatusStore | undefined,
): Promise<PendingRemotePromotionBatchStatusDecision> {
  if (store === undefined) return { status: 'ok', diagnostics: [] };

  let batchStatusId: SyncBatchStatusId;
  try {
    batchStatusId = (await syncBatchStatusKeyMaterialForOperationContext(record.operationContext))
      .batchStatusId;
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
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED', 'error', message, {
          reason: 'batch-status-read-failed',
          segmentId: record.pendingRemoteSegmentId,
          sourceDiagnostics: read.diagnostics,
        }),
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
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED', 'warning', message, {
          reason: 'batch-status-terminal',
          segmentId: record.pendingRemoteSegmentId,
          details: { batchStatusState: read.record.state },
        }),
      ],
    };
  }

  return { status: 'ok', diagnostics: [] };
}

export async function readPendingRemotePromotionRequiredObject(
  graph: VersionGraphStore,
  objectType: VersionObjectType,
  digest: ObjectDigest,
  field: string,
): Promise<PendingRemotePromotionReadRequiredObjectResult> {
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

export async function readPendingRemotePromotionCurrentHead(
  graph: VersionGraphStore,
): Promise<PendingRemotePromotionCurrentHeadReadResult> {
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
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          details: { cause: errorMessage(error) },
        }),
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
      diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
        reason: 'graph-ref-unavailable',
        sourceDiagnostics: head.diagnostics,
      }),
    ],
  };
}

export async function readPendingRemotePromotionVisibleClosure(
  graph: VersionGraphStore,
  headCommitId: WorkbookCommitId,
): Promise<PendingRemotePromotionVisibleClosureReadResult> {
  const message =
    'The visible graph commit closure could not be read for pending remote promotion.';
  try {
    const closure = await graph.readCommitClosure(headCommitId);
    if (closure.status === 'success') return closure;
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          sourceDiagnostics: closure.diagnostics,
        }),
      ],
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: 'graph-ref-unavailable',
      message,
      diagnostics: [
        diagnostic('VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED', 'error', message, {
          reason: 'graph-ref-unavailable',
          details: { cause: errorMessage(error) },
        }),
      ],
    };
  }
}

export function sortPendingRemoteSegments(
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

export function digestKey(digest: ObjectDigest): string {
  return `${digest.algorithm}:${digest.digest}`;
}

export function digestKeys(digests: readonly ObjectDigest[]): readonly string[] {
  return digests.map(digestKey);
}

export function stableJson(value: unknown): string {
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

function validateProviderCycleReadbackDiagnostics(
  record: PendingRemoteSegmentRecord,
): RecordEligibilityResult {
  const collaboration = record.operationContext.collaboration;
  const count = collaboration.validationDiagnosticCount;
  if (!Number.isInteger(count) || count < 0) {
    return ineligibleRecord(
      record,
      'provider-authority-unknown',
      'Pending remote promotion requires well-formed provider-cycle readback diagnostics.',
      'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
      {
        gate: 'provider-cycle-readback',
        field: 'validationDiagnosticCount',
        expected: 'non-negative-integer',
        present: count !== undefined,
        malformed: true,
      },
    );
  }

  const exclusionReasonPresent = collaboration.exclusionReason !== undefined;
  const exclusionSubreasonPresent = collaboration.exclusionSubreason !== undefined;
  if (count === 0 && (exclusionReasonPresent || exclusionSubreasonPresent)) {
    return ineligibleRecord(
      record,
      'provider-authority-unknown',
      'Pending remote promotion requires validation-clean provider-cycle readback diagnostics.',
      'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
      {
        gate: 'provider-cycle-readback',
        field: exclusionReasonPresent ? 'exclusionReason' : 'exclusionSubreason',
        expected: 'absent-when-validation-clean',
        present: true,
        malformed: true,
      },
    );
  }

  if (count !== 0) {
    return ineligibleRecord(
      record,
      'provider-authority-unknown',
      'Pending remote promotion requires validation-clean durable sync receipt metadata.',
      'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
      {
        gate: 'provider-cycle-readback',
        field: 'validationDiagnosticCount',
        expected: 0,
        actual: count,
        exclusionReasonPresent,
        exclusionSubreasonPresent,
      },
    );
  }

  return { status: 'eligible' };
}

function sanitizeProviderAuthorityDetails(
  details: Readonly<Record<string, string | number | boolean | null>>,
): PendingRemotePromotionDiagnostic['details'] {
  const sanitized: Record<string, string | number | boolean | null> = {};
  const field = typeof details.field === 'string' ? details.field : null;
  for (const [key, value] of Object.entries(details)) {
    if (key === 'exclusionReason' || key === 'exclusionSubreason') {
      sanitized[`${key}Present`] = typeof value === 'string' && value.length > 0;
      continue;
    }
    if (key === 'actual' && field !== null && !SAFE_ACTUAL_DETAIL_FIELDS.has(field)) {
      sanitized.actualPresent = value !== null && value !== '';
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }
    if (value === null) sanitized[key] = null;
  }
  return sanitized;
}

function ineligibleRecord(
  record: PendingRemoteSegmentRecord,
  reason: PendingRemotePromotionSkipReason,
  message: string,
  code: PendingRemotePromotionDiagnosticCode = 'VERSION_PENDING_REMOTE_PROMOTION_INELIGIBLE',
  details?: PendingRemotePromotionDiagnostic['details'],
): Extract<RecordEligibilityResult, { status: 'skipped' }> {
  return {
    status: 'skipped',
    reason,
    message,
    diagnostic: diagnostic(code, 'warning', message, {
      reason,
      segmentId: record.pendingRemoteSegmentId,
      ...(details === undefined ? {} : { details }),
    }),
  };
}

function isTerminalBlockedBatchStatus(record: SyncBatchStatusRecord): boolean {
  return (
    record.state === 'failedAfterMutation' ||
    record.state === 'dropped' ||
    record.state === 'rejected'
  );
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
