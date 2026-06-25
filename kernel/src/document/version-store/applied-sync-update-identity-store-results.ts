import type {
  AppliedSyncUpdateIdentityCompleteResult,
  AppliedSyncUpdateIdentityReadResult,
  AppliedSyncUpdateIdentityRecord,
  AppliedSyncUpdateIdentityReserveResult,
  AppliedSyncUpdateIdentityStoreDiagnostic,
} from './applied-sync-update-identity-store';

export function conflictReserveAppliedSyncUpdateIdentityResult(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): Extract<AppliedSyncUpdateIdentityReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [
      appliedSyncUpdateIdentityDiagnostic('VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, 'none'),
    ],
  };
}

export function conflictCompleteAppliedSyncUpdateIdentityResult(
  record: AppliedSyncUpdateIdentityRecord,
  message: string,
): AppliedSyncUpdateIdentityCompleteResult {
  return {
    status: 'conflict',
    record,
    diagnostics: [
      appliedSyncUpdateIdentityDiagnostic('VERSION_APPLIED_SYNC_UPDATE_CONFLICT', message, 'none'),
    ],
  };
}

export function failedReserveAppliedSyncUpdateIdentityResult(
  message: string,
): Extract<AppliedSyncUpdateIdentityReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    diagnostics: [appliedSyncUpdateIdentityDiagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

export function missingAppliedSyncUpdateIdentityReadResult(
  message: string,
): AppliedSyncUpdateIdentityReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [
      appliedSyncUpdateIdentityDiagnostic(
        'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND',
        message,
        'repair',
      ),
    ],
  };
}

export function missingAppliedSyncUpdateIdentityCompleteResult(): AppliedSyncUpdateIdentityCompleteResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [
      appliedSyncUpdateIdentityDiagnostic(
        'VERSION_APPLIED_SYNC_UPDATE_NOT_FOUND',
        'Applied sync update identity was not found.',
        'repair',
      ),
    ],
  };
}

function appliedSyncUpdateIdentityDiagnostic(
  code: AppliedSyncUpdateIdentityStoreDiagnostic['code'],
  message: string,
  recoverability: AppliedSyncUpdateIdentityStoreDiagnostic['recoverability'],
  details?: AppliedSyncUpdateIdentityStoreDiagnostic['details'],
): AppliedSyncUpdateIdentityStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}
