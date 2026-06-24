import type {
  VersionPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteStatus,
  VersionResult,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  PENDING_REMOTE_SEGMENT_ID_RE,
  REDACTED_DETAIL_KEYS,
  SKIP_REASONS,
  SYNC_BATCH_STATUS_ID_RE,
  WORKBOOK_COMMIT_ID_RE,
} from './remote-constants';
import { publicDiagnostic } from './remote-diagnostics';
import { isPublicPayloadValue, isRecord } from './remote-utils';
import { versionFailureFromStoreDiagnostics } from '../../version-result';

export function mapPromotionResult(
  value: unknown,
  options: VersionPromotePendingRemoteOptions,
): VersionResult<VersionPromotePendingRemoteResult> {
  if (!isRecord(value)) return invalidPayloadResult();

  const rawStatus = toStatus(value.status);
  const promotedSegmentIds = toStringArray(value.promotedSegmentIds, toSegmentId);
  const commitIds = toStringArray(value.commitIds, toCommitId);
  const skipped = toSkippedSegments(value.skipped);
  if (!rawStatus || !promotedSegmentIds || !commitIds || !skipped) return invalidPayloadResult();

  const diagnostics = mapDiagnostics(value.diagnostics);
  const status = failClosedPromotionStatus(rawStatus, promotedSegmentIds, skipped, diagnostics);
  return {
    ok: true,
    value: {
      status,
      promotedSegmentIds,
      commitIds,
      skipped,
      diagnostics: options.includeDiagnostics === false && status === 'success' ? [] : diagnostics,
    },
  };
}

function failClosedPromotionStatus(
  status: VersionPromotePendingRemoteStatus,
  promotedSegmentIds: readonly VersionPromotePendingRemoteSkippedSegment['segmentId'][],
  skipped: readonly VersionPromotePendingRemoteSkippedSegment[],
  diagnostics: readonly VersionPromotePendingRemoteDiagnostic[],
): VersionPromotePendingRemoteStatus {
  const blocked = skipped.length > 0 || diagnostics.some((item) => item.severity === 'error');
  if (!blocked) return status;
  if (promotedSegmentIds.length === 0) return 'failed';
  return status === 'success' ? 'partial' : status;
}

function invalidPayloadResult(): VersionResult<VersionPromotePendingRemoteResult> {
  return versionFailureFromStoreDiagnostics('promotePendingRemote', [
    publicDiagnostic(
      'VERSION_INVALID_COMMIT_PAYLOAD',
      'The pending remote promotion service returned an invalid result payload.',
      'error',
      'repair',
    ),
  ]);
}

function toStatus(value: unknown): VersionPromotePendingRemoteStatus | null {
  return value === 'success' || value === 'partial' || value === 'failed' ? value : null;
}

function toStringArray<T extends string>(
  value: unknown,
  map: (value: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const mapped: T[] = [];
  for (const item of value) {
    const result = map(item);
    if (!result) return null;
    mapped.push(result);
  }
  return Object.freeze(mapped);
}

function toSkippedSegments(
  value: unknown,
): readonly VersionPromotePendingRemoteSkippedSegment[] | null {
  if (!Array.isArray(value)) return null;
  const skipped: VersionPromotePendingRemoteSkippedSegment[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const segmentId = toSegmentId(item.segmentId);
    const reason = toSkipReason(item.reason);
    const message = typeof item.message === 'string' ? item.message : null;
    const commitId = item.commitId === undefined ? undefined : toCommitId(item.commitId);
    if (!segmentId || !reason || !message || (item.commitId !== undefined && !commitId)) {
      return null;
    }
    skipped.push({
      segmentId,
      reason,
      message,
      ...(commitId ? { commitId } : {}),
    });
  }
  return Object.freeze(skipped);
}

function toSegmentId(
  value: unknown,
): VersionPromotePendingRemoteSkippedSegment['segmentId'] | null {
  return typeof value === 'string' && PENDING_REMOTE_SEGMENT_ID_RE.test(value)
    ? (value as VersionPromotePendingRemoteSkippedSegment['segmentId'])
    : null;
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function mapDiagnostics(value: unknown): readonly VersionPromotePendingRemoteDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value.map(mapDiagnostic));
}

function mapDiagnostic(value: unknown): VersionPromotePendingRemoteDiagnostic {
  if (!isRecord(value)) {
    return {
      code: 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
      severity: 'error',
      message: 'The pending remote promotion service returned an invalid diagnostic.',
    };
  }
  const code =
    typeof value.code === 'string'
      ? value.code
      : 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE';
  const severity = value.severity;
  const commitId = toCommitId(value.commitId);
  const reason = toSkipReason(value.reason);
  return {
    code: code as VersionPromotePendingRemoteDiagnostic['code'],
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' ? severity : 'error',
    message:
      typeof value.message === 'string'
        ? value.message
        : 'Pending remote promotion produced a diagnostic.',
    ...(reason ? { reason } : {}),
    ...(typeof value.segmentId === 'string' && PENDING_REMOTE_SEGMENT_ID_RE.test(value.segmentId)
      ? { segmentId: value.segmentId as VersionPromotePendingRemoteDiagnostic['segmentId'] }
      : {}),
    ...(commitId ? { commitId } : {}),
    ...(isRecord(value.details) ? { data: sanitizeDetails(value.details) } : {}),
  };
}

function toSkipReason(value: unknown): VersionPromotePendingRemoteSkipReason | null {
  return typeof value === 'string' &&
    SKIP_REASONS.has(value as VersionPromotePendingRemoteSkipReason)
    ? (value as VersionPromotePendingRemoteSkipReason)
    : null;
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>>,
): VersionPromotePendingRemoteDiagnostic['data'] {
  const data: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isPublicPayloadValue(value)) data[key] = sanitizeDetailValue(key, value);
  }
  return data;
}

function sanitizeDetailValue(
  key: string,
  value: string | number | boolean | null,
): string | number | boolean | null {
  if (shouldRedactDetailValue(key, value)) return 'redacted';
  return value;
}

function shouldRedactDetailValue(key: string, value: string | number | boolean | null): boolean {
  const normalizedKey = key.toLowerCase();
  if (REDACTED_DETAIL_KEYS.has(normalizedKey)) return true;
  if (
    normalizedKey === 'cursor' ||
    normalizedKey === 'pagetoken' ||
    normalizedKey === 'nextpagetoken'
  ) {
    return true;
  }
  if (normalizedKey.endsWith('batchid') || normalizedKey.endsWith('batchstatusid')) {
    return true;
  }
  return typeof value === 'string' && SYNC_BATCH_STATUS_ID_RE.test(value);
}
