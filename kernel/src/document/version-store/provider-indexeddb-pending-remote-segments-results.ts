import type {
  PendingRemoteSegmentCompleteResult,
  PendingRemoteSegmentListResult,
  PendingRemoteSegmentReadResult,
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentReserveResult,
  PendingRemoteSegmentStoreDiagnostic,
} from './pending-remote-segment-store';

export function invalidReservation(message: string): PendingRemoteSegmentReserveResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_INVALID_OPTIONS', message, recoverability: 'none' }],
  };
}

export function failedReserve(message: string): PendingRemoteSegmentReserveResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

export function conflictReserve(
  record: PendingRemoteSegmentRecord,
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT', message, recoverability: 'none' }],
  };
}

export function failedList(message: string): PendingRemoteSegmentListResult {
  return {
    status: 'failed',
    records: [],
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

export function missingComplete(message: string): PendingRemoteSegmentCompleteResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_NOT_FOUND', message, recoverability: 'repair' }],
  };
}

export function conflictComplete(
  record: PendingRemoteSegmentRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: PendingRemoteSegmentRecord;
  readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT', message, recoverability: 'none' }],
  };
}

export function failedComplete(message: string): PendingRemoteSegmentCompleteResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}

export function missingRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_NOT_FOUND', message, recoverability: 'repair' }],
  };
}

export function failedRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'failed',
    record: null,
    diagnostics: [{ code: 'VERSION_PROVIDER_FAILED', message, recoverability: 'retry' }],
  };
}
