import type {
  VersionCheckoutResult,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionCheckoutAdmissionBlock } from './version-checkout-admission';
import {
  checkoutSyncBatchStatusBlockedDiagnostic,
  recoverabilityForCheckoutIssue,
} from './version-checkout-diagnostics';
import type { CheckoutFailureMutationGuarantee } from './version-checkout-shared';

export function serviceUnavailableDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
    'No document-scoped checkout materialization service is attached; no workbook state is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

export function invalidTargetDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_CHECKOUT_INVALID_TARGET', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

export function invalidOptionsDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

export function requireCleanUnsupportedDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED',
    'Checkout cannot discard dirty working state; requireClean:false is not supported.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { option: 'requireClean', requireClean: false },
    },
  );
}

export function checkoutAdmissionDiagnostic(
  block: VersionCheckoutAdmissionBlock,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  switch (block.reason) {
    case 'dirtyWorkingState':
      return checkoutDirtyWorkingStateDiagnostic({ ...payload, reason: block.reason });
    case 'pendingProviderWrites':
      return checkoutPendingProviderWritesDiagnostic({
        ...payload,
        reason: block.reason,
        ...(block.pendingRemoteSegmentCount === undefined
          ? {}
          : { pendingRemoteSegmentCount: block.pendingRemoteSegmentCount }),
        ...(block.remoteSyncApplyActiveCount === undefined
          ? {}
          : { remoteSyncApplyActiveCount: block.remoteSyncApplyActiveCount }),
        ...(block.pendingRemotePromotionActiveCount === undefined
          ? {}
          : { pendingRemotePromotionActiveCount: block.pendingRemotePromotionActiveCount }),
        ...(block.pendingRemotePromotionQueuedCount === undefined
          ? {}
          : { pendingRemotePromotionQueuedCount: block.pendingRemotePromotionQueuedCount }),
      });
    case 'syncBatchStatusBlocked':
      return checkoutSyncBatchStatusBlockedDiagnostic(block, payload);
    case 'pendingRecalc':
      return checkoutPendingRecalcDiagnostic({ ...payload, reason: block.reason });
    case 'liveCollaborationActive':
      return checkoutLiveCollaborationActiveDiagnostic({
        ...payload,
        reason: block.reason,
        ...(block.collaborationState ? { collaborationState: block.collaborationState } : {}),
        ...(block.roomId ? { roomId: block.roomId } : {}),
        ...(block.sidecarStatus ? { sidecarStatus: block.sidecarStatus } : {}),
        ...(block.activeParticipantCount === undefined
          ? {}
          : { activeParticipantCount: block.activeParticipantCount }),
        ...(block.remoteProviderAttached === undefined
          ? {}
          : { remoteProviderAttached: block.remoteProviderAttached }),
        ...(block.inFlightRemoteUpdateCount === undefined
          ? {}
          : { inFlightRemoteUpdateCount: block.inFlightRemoteUpdateCount }),
        ...(block.syncApplyRemoteQueueDepth === undefined
          ? {}
          : { syncApplyRemoteQueueDepth: block.syncApplyRemoteQueueDepth }),
      });
    case 'checkoutAlreadyInProgress':
    case 'checkoutPreflightUnsafe':
      return checkoutWriteFenceUnavailableDiagnostic({ ...payload, reason: block.reason });
    case 'checkoutPreflightStale':
      return checkoutWriteFenceStaleDiagnostic({ ...payload, reason: block.reason });
    case 'staleWorkspaceHead':
      return checkoutStaleWorkspaceHeadDiagnostic({
        ...payload,
        reason: block.reason,
        staleReason: block.staleReason,
        ...(block.branchName ? { branchName: block.branchName } : {}),
        ...(block.checkedOutCommitId ? { checkedOutCommitId: block.checkedOutCommitId } : {}),
        ...(block.refHeadAtMaterialization
          ? { refHeadAtMaterialization: block.refHeadAtMaterialization }
          : {}),
        ...(block.currentRefHeadId ? { currentRefHeadId: block.currentRefHeadId } : {}),
      });
  }
}

export function checkoutDirtyWorkingStateDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
    'Checkout requires a clean workbook and did not apply the target snapshot.',
    {
      severity: 'error',
      recoverability: 'none',
      payload,
    },
  );
}

function checkoutPendingProviderWritesDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
    'Checkout is blocked while remote sync changes are waiting to be promoted into version history.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutPendingRecalcDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PENDING_RECALC',
    'Checkout is blocked while workbook recalculation is not settled.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutLiveCollaborationActiveDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
    'Checkout is blocked while live collaboration is active or cannot be proven idle.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutStaleWorkspaceHeadDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
    'Checkout is blocked because the active checkout session is stale relative to its ref head.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function checkoutWriteFenceUnavailableDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
    'Checkout could not acquire a local write fence before materialization.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function checkoutWriteFenceStaleDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_WRITE_FENCE_STALE',
    'Workbook state changed while checkout materialization was in progress.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function invalidPayloadDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The checkout materialization service returned an invalid public checkout plan.',
    {
      severity: 'error',
      recoverability: 'repair',
      payload,
    },
  );
}

export function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PROVIDER_ERROR',
    'The checkout materialization service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForCheckoutIssue(issueCode),
    messageTemplateId: `version.checkout.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

export function degradedCheckout(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: CheckoutFailureMutationGuarantee = 'no-workbook-mutation',
): VersionCheckoutResult {
  return {
    status: 'degraded',
    materialization: 'not-applied',
    plan: null,
    diagnostics,
    mutationGuarantee,
  };
}
