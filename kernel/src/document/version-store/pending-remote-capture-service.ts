import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from './object-digest';
import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import type {
  VersionAccessContext,
  VersionGraphRegistry,
  VersionStoreProvider,
} from './provider';
import type { VersionGraphStore } from './provider-graph-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
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
  const capture: VersionPendingRemoteCaptureInput & {
    readonly operationContext: PendingRemoteSegmentOperationContext;
  } = { ...input.capture, operationContext };

  const keyMaterial = await pendingRemoteKeyMaterial(operationContext);
  if (!keyMaterial.ok) return keyMaterial.failure;

  const matchingRecords = await matchingPendingRemoteRecords(
    input.records,
    operationContext,
    keyMaterial.idempotencyKey,
  );

  if (matchingRecords.length === 0) {
    return existingPendingRemoteSegment(capture, keyMaterial.idempotencyKey);
  }

  const objectRecords = await materializePendingRemoteObjects({
    ...capture,
    records: matchingRecords,
    mutationSegmentPayload: input.mutationSegmentPayload,
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
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
      operationContext,
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
    capturedRecordSequences: matchingRecords.map((record) => record.sequence),
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
  | { readonly ok: false; readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }> }
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
    if (!record.operationContext) continue;
    if (record.operationContext.operationId !== operationContext.operationId) continue;
    if (record.operationContext.kind !== operationContext.kind) continue;
    if (classifySemanticMutationCaptureLane(record.operationContext) !== 'pendingRemote') continue;
    try {
      const recordKey = await pendingRemoteSegmentKeyMaterialForOperationContext(
        record.operationContext,
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
  idempotencyKey: Awaited<ReturnType<typeof pendingRemoteSegmentKeyMaterialForOperationContext>>['idempotencyKey'],
): Promise<VersionPendingRemoteCaptureResult> {
  const read = await input.pendingRemoteSegmentStore.readByIdempotencyKey(idempotencyKey);
  if (read.status === 'found') {
    return {
      status: 'success',
      reservationStatus: 'existing',
      record: read.record,
      capturedRecordSequences: [],
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
>(input: VersionPendingRemoteCaptureInput & {
  readonly operationContext: PendingRemoteSegmentOperationContext;
  readonly records: readonly TRecord[];
  readonly mutationSegmentPayload: (record: TRecord) => unknown;
  readonly pendingRemoteSegmentId: string;
}): Promise<
  | { readonly status: 'success'; readonly records: VersionPendingRemoteCaptureObjectRecords }
  | { readonly status: 'failed'; readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }> }
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
  | { readonly status: 'failed'; readonly failure: Extract<VersionPendingRemoteCaptureResult, { status: 'failed' }> }
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
    mutations: input.records.map((record) => input.mutationSegmentPayload(record)),
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
    diagnostic.message,
    diagnostic.recoverability,
    'pendingRemoteSegmentStore',
    diagnostic.details,
  );
}

function pendingRemoteCaptureDiagnosticFromObjectStore(
  diagnostic: VersionObjectStoreDiagnostic,
): VersionPendingRemoteCaptureDiagnostic {
  return pendingRemoteCaptureDiagnostic(
    'VERSION_OBJECT_STORE_FAILURE',
    diagnostic.message,
    'retry',
    'objectStore',
    {
      sourceCode: diagnostic.code,
      objectType: diagnostic.objectType ?? null,
      digest: diagnostic.digest?.digest ?? null,
    },
  );
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
