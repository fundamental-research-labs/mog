import type {
  PendingRemoteSegmentOperationContext,
  PendingRemoteSegmentRecord,
} from './pending-remote-segment-store';
import {
  pendingRemoteCaptureDiagnostic,
  type VersionPendingRemoteCaptureFailure,
  type VersionPendingRemoteHistorySuspension,
} from './pending-remote-capture-results';
import {
  clonePendingRemoteCaptureJson,
  isNonEmptyString,
} from './pending-remote-capture-validation';

type PendingRemoteHistorySuspensionVerificationResult =
  | { readonly status: 'success' }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    };

export function pendingRemoteHistorySuspensionOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): PendingRemoteSegmentOperationContext {
  return clonePendingRemoteCaptureJson({
    ...operationContext,
    capturePolicy: 'historyGap',
    writeAdmissionMode: 'captureSuspendedWithGap',
  });
}

export function pendingRemoteHistorySuspension(
  operationContext: PendingRemoteSegmentOperationContext,
):
  | {
      readonly status: 'success';
      readonly historySuspension: VersionPendingRemoteHistorySuspension;
    }
  | {
      readonly status: 'failed';
      readonly failure: VersionPendingRemoteCaptureFailure;
    } {
  const verification = verifyPendingRemoteHistorySuspension(operationContext);
  if (verification.status === 'failed') {
    return {
      status: 'failed',
      failure: {
        status: 'failed',
        diagnostics: [
          pendingRemoteCaptureDiagnostic(
            'VERSION_INVALID_OPTIONS',
            verification.message,
            'none',
            'pendingRemoteCapture',
            verification.details,
          ),
        ],
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      },
    };
  }
  return {
    status: 'success',
    historySuspension: verifiedPendingRemoteHistorySuspension(),
  };
}

export function pendingRemoteHistorySuspensionFromRecord(
  record: PendingRemoteSegmentRecord,
): VersionPendingRemoteHistorySuspension | undefined {
  return record.operationContext.capturePolicy === 'historyGap' &&
    record.operationContext.writeAdmissionMode === 'captureSuspendedWithGap'
    ? verifiedPendingRemoteHistorySuspension()
    : undefined;
}

function verifiedPendingRemoteHistorySuspension(): VersionPendingRemoteHistorySuspension {
  return {
    status: 'verified',
    reason: 'no-matching-semantic-mutations',
    capturePolicy: 'historyGap',
    writeAdmissionMode: 'captureSuspendedWithGap',
  };
}

function verifyPendingRemoteHistorySuspension(
  operationContext: PendingRemoteSegmentOperationContext,
): PendingRemoteHistorySuspensionVerificationResult {
  const collaboration = operationContext.collaboration;
  if (collaboration.trustStatus !== 'verified') {
    return failedHistorySuspensionVerification('trustStatus', 'verified', {
      actual: collaboration.trustStatus,
    });
  }
  if (collaboration.authorState !== 'singleRemote') {
    return failedHistorySuspensionVerification('authorState', 'singleRemote', {
      actual: collaboration.authorState,
      exclusionReasonPresent: isNonEmptyString(collaboration.exclusionReason),
      exclusionSubreasonPresent: isNonEmptyString(collaboration.exclusionSubreason),
    });
  }
  if (collaboration.replay) {
    return failedHistorySuspensionVerification('replay', false, { actual: true });
  }
  if (collaboration.system) {
    return failedHistorySuspensionVerification('system', false, { actual: true });
  }
  if (collaboration.validationDiagnosticCount !== 0) {
    return failedHistorySuspensionVerification('validationDiagnosticCount', 0, {
      actual:
        typeof collaboration.validationDiagnosticCount === 'number'
          ? collaboration.validationDiagnosticCount
          : null,
      exclusionReasonPresent: isNonEmptyString(collaboration.exclusionReason),
      exclusionSubreasonPresent: isNonEmptyString(collaboration.exclusionSubreason),
    });
  }
  if (collaboration.originKind !== 'provider' && collaboration.originKind !== 'room') {
    return failedHistorySuspensionVerification('originKind', 'provider|room', {
      actual: collaboration.originKind,
    });
  }
  const expectedSourceKind =
    collaboration.originKind === 'provider' ? 'providerLiveInbound' : 'collaborationLiveRemote';
  if (collaboration.sourceKind !== expectedSourceKind) {
    return failedHistorySuspensionVerification('sourceKind', expectedSourceKind, {
      actual: collaboration.sourceKind,
    });
  }
  const requiredStringFields = ['stableOriginId', 'epoch', 'updateId', 'payloadHash'] as const;
  for (const field of requiredStringFields) {
    if (!isNonEmptyString(collaboration[field])) {
      return failedHistorySuspensionVerification(field, 'present', { present: false });
    }
  }
  if (collaboration.originKind === 'room' && !isNonEmptyString(collaboration.roomId)) {
    return failedHistorySuspensionVerification('roomId', 'present', { present: false });
  }
  return { status: 'success' };
}

function failedHistorySuspensionVerification(
  field: string,
  expected: string | number | boolean,
  details: Readonly<Record<string, string | number | boolean | null>>,
): Extract<PendingRemoteHistorySuspensionVerificationResult, { status: 'failed' }> {
  return {
    status: 'failed',
    message:
      'Pending remote history suspension requires verified provider authority before writing a gap marker.',
    details: {
      gate: 'verified-history-suspension',
      field,
      expected,
      ...details,
    },
  };
}
