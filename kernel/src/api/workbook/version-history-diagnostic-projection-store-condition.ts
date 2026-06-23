import {
  isRecord,
  isSensitiveDiagnosticScanKey,
} from './version-history-diagnostic-projection-store-redaction';

const MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH = 12;
export const STALE_HEAD_REASON = 'stale-head';
export const HISTORY_GAP_REASON = 'history-gap';

export function diagnosticHistoryCondition(
  value: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): typeof STALE_HEAD_REASON | typeof HISTORY_GAP_REASON | null {
  if (hasHistoryGapMarker(value) || payload.completenessCondition === HISTORY_GAP_REASON) {
    return HISTORY_GAP_REASON;
  }
  if (hasStaleHeadMarker(value, payload)) return STALE_HEAD_REASON;
  return null;
}

function hasHistoryGapMarker(value: unknown, depth = 0): boolean {
  if (depth > MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH) return false;
  if (Array.isArray(value)) return value.some((entry) => hasHistoryGapMarker(entry, depth + 1));
  if (!isRecord(value)) return false;
  if (
    value.completenessCondition === HISTORY_GAP_REASON ||
    value.reason === HISTORY_GAP_REASON ||
    value.condition === HISTORY_GAP_REASON
  ) {
    return true;
  }
  return Object.entries(value).some(([key, entry]) => {
    if (isSensitiveDiagnosticScanKey(key)) return false;
    return hasHistoryGapMarker(entry, depth + 1);
  });
}

function hasStaleHeadMarker(
  value: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  if (
    payload.reason === 'staleTargetHead' ||
    payload.reason === 'staleWorkspaceHead' ||
    payload.reason === STALE_HEAD_REASON ||
    payload.condition === STALE_HEAD_REASON ||
    payload.completenessCondition === 'stale'
  ) {
    return true;
  }
  const details = isRecord(value.details) ? value.details : null;
  return (
    value.issueCode === 'VERSION_REF_CONFLICT' ||
    value.code === 'VERSION_REF_CONFLICT' ||
    details?.completenessCondition === 'stale' ||
    (typeof details?.expectedHead === 'string' && typeof details?.actualHead === 'string') ||
    (typeof details?.expectedHeadCommitId === 'string' &&
      typeof details?.actualHeadCommitId === 'string') ||
    (typeof value.expectedHead === 'string' && typeof value.actualHead === 'string')
  );
}
