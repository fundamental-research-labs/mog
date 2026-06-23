import { expect } from '@jest/globals';

import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../../../document/version-store/pending-remote-segment-store';
import type {
  VersionGraphNamespace,
  VersionGraphStore,
} from '../../../document/version-store/provider';
import type { VersionObjectRecord } from '../../../document/version-store/object-store';
import {
  DOCUMENT_SCOPE,
  SOURCE_BATCH_ID,
} from './version-pending-remote-promotion-provider-helpers-constants';
import { objectRecord } from './version-pending-remote-promotion-provider-helpers-graph-fixtures';

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly payloadHash?: string;
    readonly sourceBatch?: boolean;
    readonly updateId?: string;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext(options);
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
    snapshotId: 'remote-boundary-snapshot-1',
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
    schemaVersion: 1,
    changes: [{ id: 'remote-change-1' }],
  });
  const mutationSegmentRecord = await objectRecord(namespace, 'workbook.mutationSegment.v1', {
    segmentId: 'remote-segment-1',
    domainId: 'runtime-diagnostics',
  });

  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      snapshotRootDigest: snapshotRootRecord.digest,
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: operationContext.createdAt,
    },
    objectRecords: [snapshotRootRecord, semanticChangeSetRecord, mutationSegmentRecord],
  };
}

export async function persistAndReservePendingSegment(
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: PendingSegmentFixture,
): Promise<void> {
  await expect(graph.putObjects(fixture.objectRecords)).resolves.toMatchObject({
    status: 'success',
  });
  await expect(
    reservePersistedPendingRemoteSegment({ graph, store, input: fixture.input }),
  ).resolves.toMatchObject({ status: 'created' });
}

function syncOperationContext(
  options: {
    readonly payloadHash?: string;
    readonly sourceBatch?: boolean;
    readonly updateId?: string;
    readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  } = {},
): PendingRemoteSegmentOperationContext {
  const updateId = options.updateId ?? 'remote-update-1';
  const payloadHash = options.payloadHash ?? '3'.repeat(64);
  return {
    operationId: `sync:providerLiveInbound:${updateId}`,
    kind: 'sync-import',
    author: {
      authorId: 'subject-ref-1',
      actorKind: 'user',
      sessionId: 'remote-session-1',
    },
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: DOCUMENT_SCOPE.documentId,
    domainIds: ['runtime-diagnostics'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId,
      sequence: '7',
      payloadHash,
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'correlation-1',
      causationIds: ['cause-1'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      ...(options.sourceBatch
        ? {
            batchId: SOURCE_BATCH_ID,
            subUpdateIndex: 0,
            subUpdateCount: 1,
          }
        : {}),
      validationDiagnosticCount: 0,
      ...options.collaboration,
    },
  };
}
