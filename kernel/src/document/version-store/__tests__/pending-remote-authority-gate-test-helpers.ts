import type { ObjectDigest } from '../object-digest';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentRecord,
} from '../pending-remote-segment-store';

export const AUTHOR: PendingRemoteSegmentOperationContext['author'] = {
  authorId: 'subject-ref-1',
  actorKind: 'user',
  sessionId: 'remote-session-1',
};

export interface PendingRemoteRecordOptions {
  readonly author?: PendingRemoteSegmentOperationContext['author'];
  readonly collaboration?: Partial<PendingRemoteSegmentOperationContext['collaboration']>;
  readonly operation?: Partial<
    Pick<PendingRemoteSegmentOperationContext, 'capturePolicy' | 'writeAdmissionMode'>
  >;
  readonly syncIdentity?: Partial<PendingRemoteSegmentRecord['syncIdentity']>;
}

export async function pendingRemoteRecord(
  options: PendingRemoteRecordOptions = {},
): Promise<PendingRemoteSegmentRecord> {
  const operationContext = pendingRemoteOperationContext(options);
  const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  return {
    schemaVersion: 1,
    recordKind: 'pendingRemoteSegment',
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    idempotencyKey: keyMaterial.idempotencyKey,
    namespaceKey: 'workspace-1:document-1:principal-1:graph-1',
    documentScopeKey: 'workspace-1:document-1:principal-1',
    syncIdentity: {
      ...keyMaterial.syncIdentity,
      ...options.syncIdentity,
    },
    operationContext,
    mutationSegmentDigest: digest('1'),
    snapshotRootDigest: digest('2'),
    semanticChangeSetDigest: digest('3'),
    state: 'pending',
    createdAt: operationContext.createdAt,
    updatedAt: operationContext.createdAt,
  };
}

function pendingRemoteOperationContext(
  options: Pick<PendingRemoteRecordOptions, 'author' | 'collaboration' | 'operation'> = {},
): PendingRemoteSegmentOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:remote-update-1',
    kind: 'sync-import',
    author: options.author ?? AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'document-1',
    domainIds: ['runtime-diagnostics'],
    capturePolicy: options.operation?.capturePolicy ?? 'commitEligible',
    writeAdmissionMode: options.operation?.writeAdmissionMode ?? 'capture',
    collaboration: {
      sourceKind: 'providerLiveInbound',
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
      sequence: '7',
      payloadHash: '4'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
      ...options.collaboration,
    },
  };
}

function digest(seed: string): ObjectDigest {
  return { algorithm: 'sha256', digest: seed.repeat(64) };
}
