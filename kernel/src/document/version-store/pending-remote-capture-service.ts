import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from './object-digest';
import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import type { VersionAccessContext, VersionGraphRegistry, VersionStoreProvider } from './provider';
import type { VersionGraphStore } from './provider-graph-store';
import {
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentIdempotencyKey,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
} from './pending-remote-segment-store';
import {
  pendingRemoteHistorySuspension,
  pendingRemoteHistorySuspensionFromRecord,
  pendingRemoteHistorySuspensionOperationContext,
} from './pending-remote-capture-history-suspension';
import {
  pendingRemoteCaptureDiagnostic,
  pendingRemoteCaptureDiagnosticFromObjectStore,
  pendingRemoteCaptureDiagnosticFromSegmentStore,
  type VersionPendingRemoteCaptureObjectRecords,
  type VersionPendingRemoteCaptureResult,
  type VersionPendingRemoteHistorySuspension,
} from './pending-remote-capture-results';
import {
  isPendingRemoteOperationContext,
  matchingPendingRemoteRecords,
  pendingRemoteKeyMaterial,
  sanitizePendingRemoteCaptureOperationContext,
  sanitizePendingRemoteMutationPayload,
  type PendingRemoteSemanticMutationCaptureRecord,
} from './pending-remote-capture-validation';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';

export type { PendingRemoteSemanticMutationCaptureRecord } from './pending-remote-capture-validation';
export type {
  VersionPendingRemoteCaptureDiagnostic,
  VersionPendingRemoteCaptureDiagnosticCode,
  VersionPendingRemoteCaptureObjectRecords,
  VersionPendingRemoteCaptureResult,
  VersionPendingRemoteHistorySuspension,
} from './pending-remote-capture-results';

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

export type VersionPendingRemoteCapture = (
  input: VersionPendingRemoteCaptureInput,
) => Promise<VersionPendingRemoteCaptureResult> | VersionPendingRemoteCaptureResult;

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
