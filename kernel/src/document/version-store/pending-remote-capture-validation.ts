import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentKeyMaterial,
  type PendingRemoteSegmentOperationContext,
} from './pending-remote-segment-store';
import {
  pendingRemoteCaptureDiagnostic,
  type VersionPendingRemoteCaptureFailure,
} from './pending-remote-capture-results';
import { classifySemanticMutationCaptureLane } from './semantic-mutation-capture-lanes';

export type PendingRemoteSemanticMutationCaptureRecord = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly operationContext?: VersionOperationContext;
  readonly changes: readonly unknown[];
};

export function isPendingRemoteOperationContext(
  context: VersionOperationContext,
): context is PendingRemoteSegmentOperationContext {
  return classifySemanticMutationCaptureLane(context) === 'pendingRemote';
}

export async function pendingRemoteKeyMaterial(
  operationContext: PendingRemoteSegmentOperationContext,
): Promise<
  | (PendingRemoteSegmentKeyMaterial & {
      readonly ok: true;
    })
  | {
      readonly ok: false;
      readonly failure: VersionPendingRemoteCaptureFailure;
    }
> {
  try {
    return {
      ok: true,
      ...(await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext)),
    };
  } catch {
    return {
      ok: false,
      failure: {
        status: 'failed',
        diagnostics: [
          pendingRemoteCaptureDiagnostic(
            'VERSION_INVALID_OPTIONS',
            'Pending remote capture requires a valid sync operation context.',
            'none',
            'pendingRemoteCapture',
          ),
        ],
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      },
    };
  }
}

export async function matchingPendingRemoteRecords<
  TRecord extends PendingRemoteSemanticMutationCaptureRecord,
>(
  records: readonly TRecord[],
  operationContext: PendingRemoteSegmentOperationContext,
  idempotencyKey: PendingRemoteSegmentIdempotencyKey,
): Promise<readonly TRecord[]> {
  const matching: TRecord[] = [];
  for (const record of records) {
    const recordOperationContext = record.operationContext;
    if (!recordOperationContext) continue;
    if (recordOperationContext.kind !== operationContext.kind) continue;
    if (!isPendingRemoteOperationContext(recordOperationContext)) continue;
    try {
      const recordKey = await pendingRemoteSegmentKeyMaterialForOperationContext(
        sanitizePendingRemoteCaptureOperationContext(recordOperationContext),
      );
      if (recordKey.idempotencyKey === idempotencyKey) matching.push(record);
    } catch {
      continue;
    }
  }
  return matching;
}

export function sanitizePendingRemoteCaptureOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): PendingRemoteSegmentOperationContext {
  const collaboration = operationContext.collaboration;
  return clonePendingRemoteCaptureJson({
    ...operationContext,
    collaboration: sanitizePendingRemoteCaptureCollaboration(collaboration),
  });
}

export function sanitizePendingRemoteMutationPayload(payload: unknown): unknown {
  if (
    !isRecord(payload) ||
    !isPendingRemoteMutationPayloadOperationContext(payload.operationContext)
  ) {
    return payload;
  }
  return clonePendingRemoteCaptureJson({
    ...payload,
    operationContext: sanitizePendingRemoteCaptureOperationContext(payload.operationContext),
  });
}

export function clonePendingRemoteCaptureJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sanitizePendingRemoteCaptureCollaboration(
  collaboration: VersionSyncOperationContext,
): VersionSyncOperationContext {
  return {
    sourceKind: normalizedPendingRemoteSourceKind(collaboration),
    originKind: collaboration.originKind,
    payloadHash: collaboration.payloadHash,
    trustStatus: collaboration.trustStatus,
    authorState: collaboration.authorState,
    replay: collaboration.replay,
    system: collaboration.system,
    commitGrouping: collaboration.commitGrouping,
    validationDiagnosticCount: collaboration.validationDiagnosticCount,
    ...(collaboration.stableOriginId === undefined
      ? {}
      : { stableOriginId: collaboration.stableOriginId }),
    ...(collaboration.roomId === undefined ? {} : { roomId: collaboration.roomId }),
    ...(collaboration.epoch === undefined ? {} : { epoch: collaboration.epoch }),
    ...(collaboration.updateId === undefined ? {} : { updateId: collaboration.updateId }),
    ...(collaboration.sequence === undefined ? {} : { sequence: collaboration.sequence }),
    ...(collaboration.provenancePayloadHash === undefined
      ? {}
      : { provenancePayloadHash: collaboration.provenancePayloadHash }),
    ...(collaboration.batchId === undefined ? {} : { batchId: collaboration.batchId }),
    ...(collaboration.subUpdateIndex === undefined
      ? {}
      : { subUpdateIndex: collaboration.subUpdateIndex }),
    ...(collaboration.subUpdateCount === undefined
      ? {}
      : { subUpdateCount: collaboration.subUpdateCount }),
    ...(collaboration.batchStatusId === undefined
      ? {}
      : { batchStatusId: collaboration.batchStatusId }),
    ...(collaboration.batchStatusState === undefined
      ? {}
      : { batchStatusState: collaboration.batchStatusState }),
    ...(collaboration.exclusionReason === undefined
      ? {}
      : { exclusionReason: collaboration.exclusionReason }),
    ...(collaboration.exclusionSubreason === undefined
      ? {}
      : { exclusionSubreason: collaboration.exclusionSubreason }),
  };
}

function normalizedPendingRemoteSourceKind(
  collaboration: VersionSyncOperationContext,
): VersionSyncOperationContext['sourceKind'] {
  if (collaboration.originKind === 'provider') return 'providerLiveInbound';
  if (collaboration.originKind === 'room') return 'collaborationLiveRemote';
  return collaboration.sourceKind;
}

function isPendingRemoteMutationPayloadOperationContext(
  value: unknown,
): value is PendingRemoteSegmentOperationContext {
  return isRecord(value) && isRecord(value.collaboration);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
