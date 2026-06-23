import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from './object-digest';
import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import type { VersionAccessContext, VersionGraphRegistry, VersionStoreProvider } from './provider';
import type { VersionGraphStore } from './provider-graph-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentStore,
  type PendingRemoteSegmentStoreDiagnostic,
} from './pending-remote-segment-store';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';
import { classifySemanticMutationCaptureLane } from './semantic-mutation-capture-lanes';

export type PendingRemoteSemanticMutationCaptureRecord = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly operationContext?: VersionOperationContext;
  readonly changes: readonly unknown[];
};

export type VersionPendingRemoteCaptureInput = {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly accessContext: VersionAccessContext;
  readonly namespace: VersionGraphNamespace;
  readonly registry: VersionGraphRegistry;
  readonly pendingRemoteSegmentStore: PendingRemoteSegmentStore;
  readonly operationContext: VersionOperationContext;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
};

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

export type VersionPendingRemoteCapture = (
  input: VersionPendingRemoteCaptureInput,
) => Promise<VersionPendingRemoteCaptureResult> | VersionPendingRemoteCaptureResult;

type PendingRemoteHistorySuspensionVerificationResult =
  | { readonly status: 'success' }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly details: Readonly<Record<string, string | number | boolean | null>>;
    };

export async function capturePendingRemoteSemanticMutations<
  TRecord extends PendingRemoteSemanticMutationCaptureRecord,
>(input: {
  readonly capture: VersionPendingRemoteCaptureInput;
  readonly records: readonly TRecord[];
  readonly mutationSegmentPayload: (record: TRecord) => unknown;
}): Promise<VersionPendingRemoteCaptureResult> {
  const operationContext = input.capture.operationContext;
  if (!isPendingRemoteOperationContext(operationContext)) {
    return { status: 'ignored', reason: 'not-pending-remote', diagnostics: [] };
  }
  const identityOperationContext = sanitizePendingRemoteCaptureOperationContext(operationContext);
  const capture: VersionPendingRemoteCaptureInput & {
    readonly operationContext: PendingRemoteSegmentOperationContext;
  } = { ...input.capture, operationContext: identityOperationContext };

  const keyMaterial = await pendingRemoteKeyMaterial(identityOperationContext);
  if (!keyMaterial.ok) return keyMaterial.failure;

  const matchingRecords = await matchingPendingRemoteRecords(
    input.records,
    identityOperationContext,
    keyMaterial.idempotencyKey,
  );
  const capturedRecordSequences = matchingRecords.map((record) => record.sequence);

  const existing = await existingPendingRemoteSegment(
    capture,
    keyMaterial.idempotencyKey,
    capturedRecordSequences,
  );
  if (existing.status === 'success' || existing.status === 'failed') {
    return existing;
  }

  const historySuspension =
    matchingRecords.length === 0
      ? pendingRemoteHistorySuspension(identityOperationContext)
      : undefined;
  if (historySuspension?.status === 'failed') return historySuspension.failure;

  const persistedOperationContext =
    historySuspension?.status === 'success'
      ? pendingRemoteHistorySuspensionOperationContext(identityOperationContext)
      : identityOperationContext;
  const persistedCapture: VersionPendingRemoteCaptureInput & {
    readonly operationContext: PendingRemoteSegmentOperationContext;
  } = { ...capture, operationContext: persistedOperationContext };

  const objectRecords = await materializePendingRemoteObjects({
    ...persistedCapture,
    records: matchingRecords,
    mutationSegmentPayload: input.mutationSegmentPayload,
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    ...(historySuspension?.status === 'success'
      ? { historySuspension: historySuspension.historySuspension }
      : {}),
  });
  if (objectRecords.status !== 'success') return objectRecords.failure;

  const persisted = await persistPendingRemoteObjects(input.capture.graph, objectRecords.records);
  if (persisted.status !== 'success') return persisted.failure;

  const reserved = await reservePersistedPendingRemoteSegment({
    graph: capture.graph,
    store: capture.pendingRemoteSegmentStore,
    input: {
      pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
      idempotencyKey: keyMaterial.idempotencyKey,
      operationContext: persistedOperationContext,
      mutationSegmentDigest: objectRecords.records.mutationSegmentRecord.digest,
      ...(objectRecords.records.snapshotRootRecord
        ? { snapshotRootDigest: objectRecords.records.snapshotRootRecord.digest }
        : {}),
      ...(objectRecords.records.semanticChangeSetRecord
        ? { semanticChangeSetDigest: objectRecords.records.semanticChangeSetRecord.digest }
        : {}),
      createdAt: operationContext.createdAt,
    },
  });

  if (reserved.status !== 'created' && reserved.status !== 'existing') {
    return {
      status: 'failed',
      diagnostics: reserved.diagnostics.map((diagnostic) =>
        pendingRemoteCaptureDiagnosticFromSegmentStore(diagnostic),
      ),
      mutationGuarantee: 'objects-written-segment-not-reserved',
      retryable: reserved.status === 'failed',
    };
  }

  return {
    status: 'success',
    reservationStatus: reserved.status,
    record: reserved.record,
    objectRecords: objectRecords.records,
    capturedRecordSequences,
    ...(historySuspension?.status === 'success'
      ? { historySuspension: historySuspension.historySuspension }
      : {}),
    diagnostics: [],
  };
}

function isPendingRemoteOperationContext(
  context: VersionOperationContext,
): context is PendingRemoteSegmentOperationContext {
  return classifySemanticMutationCaptureLane(context) === 'pendingRemote';
}

async function pendingRemoteKeyMaterial(
  operationContext: PendingRemoteSegmentOperationContext,
): Promise<
  | (Awaited<ReturnType<typeof pendingRemoteSegmentKeyMaterialForOperationContext>> & {
      readonly ok: true;
    })
  | {
      readonly ok: false;
      readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }>;
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

async function matchingPendingRemoteRecords<
  TRecord extends PendingRemoteSemanticMutationCaptureRecord,
>(
  records: readonly TRecord[],
  operationContext: PendingRemoteSegmentOperationContext,
  idempotencyKey: string,
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

async function existingPendingRemoteSegment(
  input: VersionPendingRemoteCaptureInput & {
    readonly operationContext: PendingRemoteSegmentOperationContext;
  },
  idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  capturedRecordSequences: readonly number[],
): Promise<VersionPendingRemoteCaptureResult> {
  const read = await input.pendingRemoteSegmentStore.readByIdempotencyKey(idempotencyKey);
  if (read.status === 'found') {
    const historySuspension = pendingRemoteHistorySuspensionFromRecord(read.record);
    return {
      status: 'success',
      reservationStatus: 'existing',
      record: read.record,
      capturedRecordSequences,
      ...(historySuspension ? { historySuspension } : {}),
      diagnostics: [],
    };
  }
  if (read.status === 'missing') {
    return { status: 'ignored', reason: 'no-matching-mutations', diagnostics: [] };
  }
  return {
    status: 'failed',
    diagnostics: read.diagnostics.map((diagnostic) =>
      pendingRemoteCaptureDiagnosticFromSegmentStore(diagnostic),
    ),
    mutationGuarantee: 'no-write-attempted',
    retryable: true,
  };
}

async function materializePendingRemoteObjects<
  TRecord extends PendingRemoteSemanticMutationCaptureRecord,
>(
  input: VersionPendingRemoteCaptureInput & {
    readonly operationContext: PendingRemoteSegmentOperationContext;
    readonly records: readonly TRecord[];
    readonly mutationSegmentPayload: (record: TRecord) => unknown;
    readonly pendingRemoteSegmentId: string;
    readonly historySuspension?: VersionPendingRemoteHistorySuspension;
  },
): Promise<
  | { readonly status: 'success'; readonly records: VersionPendingRemoteCaptureObjectRecords }
  | {
      readonly status: 'failed';
      readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }>;
    }
> {
  try {
    const semanticChanges = input.records.flatMap((record) => [...record.changes]);
    const mutationSegmentRecord = await objectRecord(
      input.namespace,
      'workbook.mutationSegment.v1',
      pendingRemoteMutationSegmentPayload(input),
    );
    const semanticChangeSetRecord =
      semanticChanges.length === 0
        ? undefined
        : await objectRecord(input.namespace, 'workbook.semanticChangeSet.v1', {
            schemaVersion: 1,
            changes: semanticChanges,
          });
    const snapshotRootRecord = input.snapshotRootByteSyncPort
      ? await captureWorkbookSnapshotRootRecord(input.namespace, input.snapshotRootByteSyncPort)
      : undefined;

    return {
      status: 'success',
      records: {
        mutationSegmentRecord,
        ...(semanticChangeSetRecord ? { semanticChangeSetRecord } : {}),
        ...(snapshotRootRecord ? { snapshotRootRecord } : {}),
      },
    };
  } catch {
    return {
      status: 'failed',
      failure: {
        status: 'failed',
        diagnostics: [
          pendingRemoteCaptureDiagnostic(
            'VERSION_PROVIDER_FAILED',
            'Pending remote capture failed while materializing version objects.',
            'retry',
            input.snapshotRootByteSyncPort ? 'snapshotRootCapture' : 'pendingRemoteCapture',
          ),
        ],
        mutationGuarantee: 'no-write-attempted',
        retryable: true,
      },
    };
  }
}

async function persistPendingRemoteObjects(
  graph: VersionGraphStore,
  records: VersionPendingRemoteCaptureObjectRecords,
): Promise<
  | { readonly status: 'success' }
  | {
      readonly status: 'failed';
      readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }>;
    }
> {
  const batch = [
    records.mutationSegmentRecord,
    ...(records.semanticChangeSetRecord ? [records.semanticChangeSetRecord] : []),
    ...(records.snapshotRootRecord ? [records.snapshotRootRecord] : []),
  ] satisfies readonly VersionObjectRecord<unknown>[];

  try {
    const put = await graph.putObjects(batch);
    if (put.status === 'success') return { status: 'success' };
    return {
      status: 'failed',
      failure: {
        status: 'failed',
        diagnostics: put.diagnostics.map(pendingRemoteCaptureDiagnosticFromObjectStore),
        mutationGuarantee: 'no-objects-written',
        retryable: true,
      },
    };
  } catch {
    return {
      status: 'failed',
      failure: {
        status: 'failed',
        diagnostics: [
          pendingRemoteCaptureDiagnostic(
            'VERSION_OBJECT_STORE_FAILURE',
            'Pending remote capture failed while writing version objects.',
            'retry',
            'objectStore',
          ),
        ],
        mutationGuarantee: 'no-write-attempted',
        retryable: true,
      },
    };
  }
}

function pendingRemoteMutationSegmentPayload<
  TRecord extends PendingRemoteSemanticMutationCaptureRecord,
>(input: {
  readonly provider: VersionStoreProvider;
  readonly accessContext: VersionAccessContext;
  readonly registry: VersionGraphRegistry;
  readonly operationContext: PendingRemoteSegmentOperationContext;
  readonly records: readonly TRecord[];
  readonly mutationSegmentPayload: (record: TRecord) => unknown;
  readonly pendingRemoteSegmentId: string;
  readonly historySuspension?: VersionPendingRemoteHistorySuspension;
}): unknown {
  const changes = input.records.flatMap((record) => [...record.changes]);
  return {
    schemaVersion: 1,
    segmentId: input.pendingRemoteSegmentId,
    lane: 'pendingRemote',
    operation: 'sync.applyRemoteUpdate',
    operationContext: input.operationContext,
    capturedAt: input.operationContext.createdAt,
    graphId: input.registry.currentGraphId,
    documentId: input.provider.documentScope.documentId,
    changeIds: changes.map((change) => semanticChangeId(change)),
    ...(input.historySuspension ? { historySuspension: input.historySuspension } : {}),
    mutations: input.records.map((record) =>
      sanitizePendingRemoteMutationPayload(input.mutationSegmentPayload(record)),
    ),
  };
}

function semanticChangeId(change: unknown): string {
  if (
    typeof change === 'object' &&
    change !== null &&
    'structural' in change &&
    typeof change.structural === 'object' &&
    change.structural !== null &&
    'changeId' in change.structural &&
    typeof change.structural.changeId === 'string'
  ) {
    return change.structural.changeId;
  }
  return 'unknown';
}

function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: Extract<
    VersionObjectType,
    'workbook.semanticChangeSet.v1' | 'workbook.mutationSegment.v1'
  >,
  payload: unknown,
) {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function pendingRemoteCaptureDiagnosticFromSegmentStore(
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

function pendingRemoteCaptureDiagnosticFromObjectStore(
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

function pendingRemoteCaptureDiagnostic(
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

function sanitizePendingRemoteCaptureOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): PendingRemoteSegmentOperationContext {
  const collaboration = operationContext.collaboration;
  return cloneJson({
    ...operationContext,
    collaboration: sanitizePendingRemoteCaptureCollaboration(collaboration),
  });
}

function pendingRemoteHistorySuspensionOperationContext(
  operationContext: PendingRemoteSegmentOperationContext,
): PendingRemoteSegmentOperationContext {
  return cloneJson({
    ...operationContext,
    capturePolicy: 'historyGap',
    writeAdmissionMode: 'captureSuspendedWithGap',
  });
}

function pendingRemoteHistorySuspension(operationContext: PendingRemoteSegmentOperationContext):
  | {
      readonly status: 'success';
      readonly historySuspension: VersionPendingRemoteHistorySuspension;
    }
  | {
      readonly status: 'failed';
      readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }>;
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
    historySuspension: {
      status: 'verified',
      reason: 'no-matching-semantic-mutations',
      capturePolicy: 'historyGap',
      writeAdmissionMode: 'captureSuspendedWithGap',
    },
  };
}

function pendingRemoteHistorySuspensionFromRecord(
  record: PendingRemoteSegmentRecord,
): VersionPendingRemoteHistorySuspension | undefined {
  return record.operationContext.capturePolicy === 'historyGap' &&
    record.operationContext.writeAdmissionMode === 'captureSuspendedWithGap'
    ? {
        status: 'verified',
        reason: 'no-matching-semantic-mutations',
        capturePolicy: 'historyGap',
        writeAdmissionMode: 'captureSuspendedWithGap',
      }
    : undefined;
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

function sanitizePendingRemoteMutationPayload(payload: unknown): unknown {
  if (
    !isRecord(payload) ||
    !isPendingRemoteMutationPayloadOperationContext(payload.operationContext)
  ) {
    return payload;
  }
  return cloneJson({
    ...payload,
    operationContext: sanitizePendingRemoteCaptureOperationContext(payload.operationContext),
  });
}

function isPendingRemoteMutationPayloadOperationContext(
  value: unknown,
): value is PendingRemoteSegmentOperationContext {
  return isRecord(value) && isRecord(value.collaboration);
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
