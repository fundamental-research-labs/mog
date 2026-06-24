import type {
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionCheckoutAdmissionBlock } from './version-checkout-admission';

const SYNC_BATCH_STATUS_PAYLOAD_KEYS = [
  'pendingRemoteSegmentCount',
  'syncBatchStatusPendingCount',
  'syncBatchStatusBlockedCount',
  'syncBatchStatusTerminalCount',
  'syncBatchStatusFailedAfterMutationCount',
  'syncBatchStatusDroppedCount',
  'syncBatchStatusRejectedCount',
  'syncBatchStatusReadFailedCount',
  'syncBatchStatusFirstState',
  'syncBatchStatusFirstReason',
  'syncBatchStatusFirstSegmentId',
  'syncBatchStatusFirstBatchStatusId',
] as const;

type SyncBatchStatusAdmissionBlock = Extract<
  VersionCheckoutAdmissionBlock,
  { reason: 'syncBatchStatusBlocked' }
>;

export type VersionCheckoutHistoryDenialClass =
  | 'access-denied'
  | 'stale-history'
  | 'missing-graph-state'
  | 'corrupt-graph-state';

const ACCESS_DENIED_CHECKOUT_ISSUES = new Set(['VERSION_PERMISSION_DENIED']);

const STALE_HISTORY_CHECKOUT_ISSUES = new Set([
  'VERSION_CHECKOUT_REF_READ_FAILED',
  'VERSION_CHECKOUT_COMMIT_READ_FAILED',
  'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED',
  'VERSION_CHECKOUT_PROVIDER_ERROR',
  'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
  'VERSION_CHECKOUT_SYNC_BATCH_STATUS_BLOCKED',
  'VERSION_CHECKOUT_PENDING_RECALC',
  'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
  'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
  'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
  'VERSION_CHECKOUT_WRITE_FENCE_STALE',
  'VERSION_CHECKOUT_ROLLBACK_DEGRADED',
  'VERSION_CHECKOUT_LEASE_RELEASE_FAILED',
  'VERSION_CHECKOUT_STALE_SAVE_TOKEN',
  'VERSION_CHECKOUT_STALE_RUNTIME_TOKEN',
  'VERSION_REF_CONFLICT',
  'VERSION_STALE_PAGE_CURSOR',
]);

const MISSING_GRAPH_STATE_CHECKOUT_ISSUES = new Set([
  'VERSION_CHECKOUT_MISSING_COMMIT',
  'VERSION_CHECKOUT_MISSING_DEPENDENCY',
  'VERSION_DANGLING_REF',
  'VERSION_MISSING_OBJECT',
  'VERSION_MISSING_PARENT',
  'VERSION_MISSING_DEPENDENCY',
  'VERSION_OBJECT_NOT_FOUND',
]);

const CORRUPT_GRAPH_STATE_CHECKOUT_ISSUES = new Set([
  'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
  'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
  'VERSION_GRAPH_CONFLICT',
  'VERSION_INVALID_COMMIT_ID',
  'VERSION_INVALID_COMMIT_PAYLOAD',
  'VERSION_OBJECT_CORRUPTION',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_UNSUPPORTED_PARENT_COMMIT',
  'VERSION_UNSUPPORTED_SCHEMA',
  'VERSION_WRONG_DOCUMENT',
  'VERSION_WRONG_NAMESPACE',
]);

export function checkoutSyncBatchStatusBlockedDiagnostic(
  block: SyncBatchStatusAdmissionBlock,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  const issueCode = 'VERSION_CHECKOUT_SYNC_BATCH_STATUS_BLOCKED';
  return {
    issueCode,
    severity: 'error',
    recoverability: 'retry',
    messageTemplateId: `version.checkout.${issueCode}`,
    safeMessage: safeMessageForCheckoutIssue(issueCode),
    payload: {
      ...payload,
      reason: block.reason,
      ...syncBatchStatusPayload(block),
    },
    redacted: true,
  };
}

export function safeMessageForCheckoutIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_CHECKOUT_INVALID_TARGET':
      return 'The checkout target is invalid for the public version facade.';
    case 'VERSION_CHECKOUT_UNSUPPORTED_TARGET':
    case 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED':
    case 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED':
      return 'The requested checkout target is unsupported by this public checkout facade.';
    case 'VERSION_CHECKOUT_MISSING_REF_READER':
    case 'VERSION_CHECKOUT_MISSING_HEAD_READER':
    case 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE':
      return 'No document-scoped checkout materialization service is attached for this target.';
    case 'VERSION_CHECKOUT_REF_READ_FAILED':
      return 'The checkout service could not resolve the target ref.';
    case 'VERSION_CHECKOUT_MISSING_REF':
      return 'The checkout target ref was not found.';
    case 'VERSION_CHECKOUT_MISSING_COMMIT':
      return 'The checkout target commit was not found.';
    case 'VERSION_CHECKOUT_COMMIT_READ_FAILED':
      return 'The checkout service could not read the target commit.';
    case 'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC':
      return 'The target commit has non-blocking checkout completeness diagnostics.';
    case 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT':
      return 'The target commit is not materializable by the attached checkout service.';
    case 'VERSION_CHECKOUT_MISSING_DEPENDENCY':
      return 'The target commit is missing required checkout materialization dependencies.';
    case 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED':
      return 'The checkout service could not preflight materialization dependencies.';
    case 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE':
      return 'No document-scoped checkout snapshot materializer is attached for this target.';
    case 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED':
      return 'The checkout service could not read the target snapshot root.';
    case 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED':
      return 'The checkout snapshot materializer could not apply the target snapshot.';
    case 'VERSION_CHECKOUT_DIRTY_WORKING_STATE':
      return 'Checkout requires a clean workbook and did not apply the target snapshot.';
    case 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES':
      return 'Checkout is blocked while remote sync changes are waiting to be promoted into version history.';
    case 'VERSION_CHECKOUT_SYNC_BATCH_STATUS_BLOCKED':
      return 'Checkout is blocked while remote sync batch status records are pending or terminal failed.';
    case 'VERSION_CHECKOUT_PENDING_RECALC':
      return 'Checkout is blocked while workbook recalculation is not settled.';
    case 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE':
      return 'Checkout is blocked while live collaboration or its provider lifecycle cannot be proven idle.';
    case 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD':
      return 'Checkout is blocked because the active checkout session is stale relative to its ref head.';
    case 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED':
      return 'Checkout cannot discard dirty working state; requireClean:false is not supported.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE':
      return 'Checkout could not acquire a local write fence before materialization.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_STALE':
      return 'Workbook state changed while checkout materialization was in progress.';
    case 'VERSION_CHECKOUT_ROLLBACK_DEGRADED':
      return 'Checkout rollback degraded; reload before retrying workbook writes.';
    case 'VERSION_CHECKOUT_LEASE_RELEASE_FAILED':
      return 'Checkout lease release could not be proven complete; reload before retrying workbook writes.';
    case 'VERSION_CHECKOUT_STALE_SAVE_TOKEN':
      return 'Checkout is blocked because the save token is stale for this workbook lifecycle.';
    case 'VERSION_CHECKOUT_STALE_RUNTIME_TOKEN':
      return 'Checkout is blocked because the runtime write token is stale for this workbook lifecycle.';
    case 'VERSION_PERMISSION_DENIED':
      return 'Checkout is not authorized for the requested version target.';
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for checkout.';
    case 'VERSION_REF_CONFLICT':
      return 'Checkout is blocked because the version ref changed during checkout planning.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'Checkout history metadata is stale and must be refreshed before checkout.';
    case 'VERSION_DANGLING_REF':
      return 'Checkout cannot resolve the target because version history points at missing graph state.';
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_NOT_FOUND':
      return 'Checkout cannot resolve the target because required version graph state is missing.';
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_MISSING_DEPENDENCY':
      return 'Checkout cannot materialize the target because required version history dependencies are missing.';
    case 'VERSION_GRAPH_CONFLICT':
    case 'VERSION_INVALID_COMMIT_ID':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_UNSUPPORTED_PARENT_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
    case 'VERSION_WRONG_DOCUMENT':
    case 'VERSION_WRONG_NAMESPACE':
      return 'Checkout cannot materialize the target because version graph state is corrupt or unsupported.';
    default:
      return 'The checkout materialization service could not complete checkout planning.';
  }
}

export function historyDenialClassForCheckoutIssue(
  issueCode: string,
): VersionCheckoutHistoryDenialClass | null {
  if (ACCESS_DENIED_CHECKOUT_ISSUES.has(issueCode)) return 'access-denied';
  if (STALE_HISTORY_CHECKOUT_ISSUES.has(issueCode)) return 'stale-history';
  if (MISSING_GRAPH_STATE_CHECKOUT_ISSUES.has(issueCode)) return 'missing-graph-state';
  if (CORRUPT_GRAPH_STATE_CHECKOUT_ISSUES.has(issueCode)) return 'corrupt-graph-state';
  return null;
}

export function recoverabilityForCheckoutIssue(
  issueCode: string,
): VersionStoreDiagnostic['recoverability'] {
  const historyDenialClass = historyDenialClassForCheckoutIssue(issueCode);
  if (historyDenialClass === 'stale-history') return 'retry';
  if (
    historyDenialClass === 'missing-graph-state' ||
    historyDenialClass === 'corrupt-graph-state'
  ) {
    return 'repair';
  }
  if (historyDenialClass === 'access-denied') return 'unsupported';

  switch (issueCode) {
    case 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED':
      return 'retry';
    case 'VERSION_CHECKOUT_UNSUPPORTED_TARGET':
    case 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED':
    case 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED':
    case 'VERSION_CHECKOUT_MISSING_REF_READER':
    case 'VERSION_CHECKOUT_MISSING_HEAD_READER':
    case 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE':
    case 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE':
    case 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED':
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'unsupported';
    default:
      return 'none';
  }
}

function syncBatchStatusPayload(
  block: SyncBatchStatusAdmissionBlock,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {};
  for (const key of SYNC_BATCH_STATUS_PAYLOAD_KEYS) {
    const value = block[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      payload[key] = value;
    }
  }
  return payload;
}
