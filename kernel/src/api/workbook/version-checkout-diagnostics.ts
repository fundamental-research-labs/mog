import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

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
    case 'VERSION_CHECKOUT_PENDING_RECALC':
      return 'Checkout is blocked while workbook recalculation is not settled.';
    case 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE':
      return 'Checkout is blocked while live collaboration is active or cannot be proven idle.';
    case 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD':
      return 'Checkout is blocked because the active checkout session is stale relative to its ref head.';
    case 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED':
      return 'Checkout cannot discard dirty working state; requireClean:false is not supported.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE':
      return 'Checkout could not acquire a local write fence before materialization.';
    case 'VERSION_CHECKOUT_WRITE_FENCE_STALE':
      return 'Workbook state changed while checkout materialization was in progress.';
    default:
      return 'The checkout materialization service could not complete checkout planning.';
  }
}

export function recoverabilityForCheckoutIssue(
  issueCode: string,
): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_CHECKOUT_REF_READ_FAILED':
    case 'VERSION_CHECKOUT_COMMIT_READ_FAILED':
    case 'VERSION_CHECKOUT_DEPENDENCY_READ_FAILED':
    case 'VERSION_CHECKOUT_PROVIDER_ERROR':
    case 'VERSION_CHECKOUT_SNAPSHOT_READ_FAILED':
    case 'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE':
    case 'VERSION_CHECKOUT_WRITE_FENCE_STALE':
    case 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES':
    case 'VERSION_CHECKOUT_PENDING_RECALC':
    case 'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE':
    case 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD':
      return 'retry';
    case 'VERSION_CHECKOUT_MISSING_COMMIT':
    case 'VERSION_CHECKOUT_MISSING_DEPENDENCY':
    case 'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED':
      return 'repair';
    case 'VERSION_CHECKOUT_UNSUPPORTED_TARGET':
    case 'VERSION_CHECKOUT_DETACHED_TARGET_UNSUPPORTED':
    case 'VERSION_CHECKOUT_DETACHED_HEAD_UNSUPPORTED':
    case 'VERSION_CHECKOUT_MISSING_REF_READER':
    case 'VERSION_CHECKOUT_MISSING_HEAD_READER':
    case 'VERSION_CHECKOUT_MISSING_REF':
    case 'VERSION_CHECKOUT_SERVICE_UNAVAILABLE':
    case 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE':
    case 'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED':
      return 'unsupported';
    default:
      return 'none';
  }
}
