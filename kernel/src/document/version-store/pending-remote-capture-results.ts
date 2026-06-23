import type { VersionObjectRecord, VersionObjectStoreDiagnostic } from './object-store';
import type {
  PendingRemoteSegmentRecord,
  PendingRemoteSegmentStoreDiagnostic,
} from './pending-remote-segment-store';

export type VersionPendingRemoteCaptureObjectRecords = {
  readonly mutationSegmentRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord?: VersionObjectRecord<unknown>;
  readonly snapshotRootRecord?: VersionObjectRecord<unknown>;
};

export type VersionPendingRemoteHistorySuspension = {
  readonly status: 'verified';
  readonly reason: 'no-matching-semantic-mutations';
  readonly capturePolicy: 'historyGap';
  readonly writeAdmissionMode: 'captureSuspendedWithGap';
};

export type VersionPendingRemoteCaptureDiagnosticCode =
  | 'VERSION_INVALID_OPTIONS'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | PendingRemoteSegmentStoreDiagnostic['code'];

export type VersionPendingRemoteCaptureDiagnostic = {
  readonly code: VersionPendingRemoteCaptureDiagnosticCode;
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly source:
    | 'pendingRemoteCapture'
    | 'objectStore'
    | 'pendingRemoteSegmentStore'
    | 'snapshotRootCapture';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type VersionPendingRemoteCaptureResult =
  | {
      readonly status: 'success';
      readonly reservationStatus: 'created' | 'existing';
      readonly record: PendingRemoteSegmentRecord;
      readonly objectRecords?: VersionPendingRemoteCaptureObjectRecords;
      readonly capturedRecordSequences: readonly number[];
      readonly historySuspension?: VersionPendingRemoteHistorySuspension;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'ignored';
      readonly reason: 'not-pending-remote' | 'no-matching-mutations';
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionPendingRemoteCaptureDiagnostic[];
      readonly mutationGuarantee:
        | 'no-write-attempted'
        | 'no-objects-written'
        | 'objects-written-segment-not-reserved';
      readonly retryable: boolean;
    };

export type VersionPendingRemoteCaptureFailure = Extract<
  VersionPendingRemoteCaptureResult,
  { status: 'failed' }
>;

export function pendingRemoteCaptureDiagnostic(
  code: VersionPendingRemoteCaptureDiagnosticCode,
  message: string,
  recoverability: VersionPendingRemoteCaptureDiagnostic['recoverability'],
  source: VersionPendingRemoteCaptureDiagnostic['source'],
  details?: VersionPendingRemoteCaptureDiagnostic['details'],
): VersionPendingRemoteCaptureDiagnostic {
  return details === undefined
    ? { code, message, recoverability, source }
    : { code, message, recoverability, source, details };
}

export function pendingRemoteCaptureDiagnosticFromSegmentStore(
  diagnostic: PendingRemoteSegmentStoreDiagnostic,
): VersionPendingRemoteCaptureDiagnostic {
  return pendingRemoteCaptureDiagnostic(
    diagnostic.code,
    pendingRemoteSegmentStoreDiagnosticMessage(diagnostic.code),
    diagnostic.recoverability,
    'pendingRemoteSegmentStore',
    sanitizePendingRemoteDiagnosticDetails(diagnostic.details),
  );
}

export function pendingRemoteCaptureDiagnosticFromObjectStore(
  diagnostic: VersionObjectStoreDiagnostic,
): VersionPendingRemoteCaptureDiagnostic {
  return pendingRemoteCaptureDiagnostic(
    'VERSION_OBJECT_STORE_FAILURE',
    'Pending remote capture object store operation failed.',
    'retry',
    'objectStore',
    {
      sourceCode: diagnostic.code,
      objectType: diagnostic.objectType ?? null,
      digest: diagnostic.digest?.digest ?? null,
    },
  );
}

function pendingRemoteSegmentStoreDiagnosticMessage(
  code: PendingRemoteSegmentStoreDiagnostic['code'],
): string {
  switch (code) {
    case 'VERSION_INVALID_OPTIONS':
      return 'Pending remote segment storage rejected invalid options.';
    case 'VERSION_PENDING_REMOTE_CONFLICT':
      return 'Pending remote segment storage found a conflicting marker.';
    case 'VERSION_PENDING_REMOTE_MISSING_OBJECT':
      return 'Pending remote segment storage could not verify a referenced object.';
    case 'VERSION_PENDING_REMOTE_OBJECT_CORRUPTION':
      return 'Pending remote segment storage found an invalid referenced object.';
    case 'VERSION_PENDING_REMOTE_NOT_FOUND':
      return 'Pending remote segment storage did not find the marker.';
    case 'VERSION_PROVIDER_FAILED':
      return 'Pending remote segment store operation failed.';
  }
}

function sanitizePendingRemoteDiagnosticDetails(
  details: VersionPendingRemoteCaptureDiagnostic['details'] | undefined,
): VersionPendingRemoteCaptureDiagnostic['details'] | undefined {
  if (details === undefined) return undefined;
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isRawProviderDiagnosticKey(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function isRawProviderDiagnosticKey(key: string): boolean {
  return (
    key === 'providerId' ||
    key === 'providerRefId' ||
    key === 'providerKind' ||
    key === 'authorityRef' ||
    key === 'remoteSessionId' ||
    key === 'correlationId' ||
    key === 'causationIds'
  );
}
