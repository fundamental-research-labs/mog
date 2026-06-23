import { validatePendingRemoteProviderAuthority } from './pending-remote-authority-gate';
import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';
import {
  pendingRemotePromotionDiagnostic as diagnostic,
  type PendingRemotePromotionDiagnostic,
  type PendingRemotePromotionDiagnosticCode,
  type PendingRemotePromotionSkipReason,
} from './pending-remote-promotion-diagnostics';
import {
  digestKey,
  sortPendingRemoteSegments,
  stableJson,
} from './pending-remote-promotion-validation-utilities';

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
