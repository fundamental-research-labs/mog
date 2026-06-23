import type { VersionGraphNamespace, VersionObjectRecord } from '../object-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentOperationContext,
  type ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import { DOCUMENT_SCOPE } from './pending-remote-promotion-service-helpers-constants';
import { objectRecord } from './pending-remote-promotion-service-helpers-object-records';

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export type PendingSegmentFixtureOptions = {
  readonly createdAt?: string;
  readonly authorityRef?: string | null;
  readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  readonly epoch?: string | null;
  readonly groupId?: string;
  readonly includeSnapshotRoot?: boolean;
  readonly mutationSegmentId?: string;
  readonly payloadHash?: string;
  readonly sequence?: string;
  readonly sharedSnapshotRootRecord?: VersionObjectRecord<unknown>;
  readonly sharedSemanticChangeSetRecord?: VersionObjectRecord<unknown>;
  readonly updateId?: string;
};

type SyncOperationContextOptions = Pick<
  PendingSegmentFixtureOptions,
  | 'createdAt'
  | 'authorityRef'
  | 'collaboration'
  | 'epoch'
  | 'groupId'
  | 'payloadHash'
  | 'sequence'
  | 'updateId'
>;

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: PendingSegmentFixtureOptions = {},
): Promise<PendingSegmentFixture> {
  const includeSnapshotRoot = options.includeSnapshotRoot ?? true;
  const operationContext = syncOperationContext(options);
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord =
    options.sharedSnapshotRootRecord ??
    (await objectRecord(
      'workbook.snapshotRoot.v1',
      { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
      namespace,
    ));
  const semanticChangeSetRecord =
    options.sharedSemanticChangeSetRecord ??
    (await objectRecord(
      'workbook.semanticChangeSet.v1',
      { schemaVersion: 1, changes: [{ id: 'remote-change-1' }] },
      namespace,
    ));
  const mutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    {
      segmentId: options.mutationSegmentId ?? 'remote-segment-1',
      domainId: 'runtime-diagnostics',
    },
    namespace,
  );
  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      ...(includeSnapshotRoot ? { snapshotRootDigest: snapshotRootRecord.digest } : {}),
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: operationContext.createdAt,
    },
    objectRecords: [
      ...(includeSnapshotRoot ? [snapshotRootRecord] : []),
      semanticChangeSetRecord,
      mutationSegmentRecord,
    ],
  };
}

function syncOperationContext(
  options: SyncOperationContextOptions = {},
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
    createdAt: options.createdAt ?? '2026-06-21T00:00:01.000Z',
    workbookId: DOCUMENT_SCOPE.documentId,
    domainIds: ['runtime-diagnostics'],
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      ...(options.authorityRef === null
        ? {}
        : { authorityRef: options.authorityRef ?? 'authority-1' }),
      roomId: 'room-1',
      ...(options.epoch === null ? {} : { epoch: options.epoch ?? 'epoch-1' }),
      updateId,
      sequence: options.sequence ?? '7',
      payloadHash,
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'correlation-1',
      causationIds: ['cause-1'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
      ...options.collaboration,
    },
  };
}
