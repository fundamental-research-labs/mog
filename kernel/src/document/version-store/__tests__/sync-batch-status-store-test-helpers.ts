import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import {
  syncBatchStatusKeyMaterialForOperationContext,
  type ReserveSyncBatchStatusInput,
  type SyncBatchStatusOperationContext,
} from '../sync-batch-status-store';
import type { VersionDocumentScope } from '../provider';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

export const SUB_UPDATE_A = 'a'.repeat(64);
export const SUB_UPDATE_B = 'b'.repeat(64);
export const DEFAULT_PAYLOAD_HASH = '3'.repeat(64);

export function installSyncBatchStatusIndexedDbCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export async function syncBatchStatusInput(
  operationContext: SyncBatchStatusOperationContext = syncOperationContext(),
  orderedSubUpdatePayloadHashes: readonly string[] = [SUB_UPDATE_A, SUB_UPDATE_B],
  batchId = 'batch-1',
): Promise<ReserveSyncBatchStatusInput> {
  const keyMaterial = await syncBatchStatusKeyMaterialForOperationContext(operationContext, {
    batchId,
    orderedSubUpdatePayloadHashes,
  });
  return {
    batchStatusId: keyMaterial.batchStatusId,
    batchId,
    orderedSubUpdatePayloadHashes,
    operationContext,
    createdAt: operationContext.createdAt,
  };
}

export function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

export function syncOperationContext(
  overrides: Partial<VersionOperationContext> & {
    readonly collaboration?: Partial<NonNullable<VersionOperationContext['collaboration']>>;
  } = {},
): SyncBatchStatusOperationContext {
  const collaboration = {
    sourceKind: 'providerLiveInbound',
    originKind: 'provider',
    stableOriginId: 'provider-stable-1',
    providerId: 'provider-1',
    providerKind: 'indexeddb',
    authorityRef: 'authority-1',
    epoch: 'epoch-1',
    updateId: 'remote-update-1',
    sequence: '7',
    payloadHash: DEFAULT_PAYLOAD_HASH,
    provenancePayloadHash: '5'.repeat(64),
    trustStatus: 'verified',
    authorState: 'singleRemote',
    remoteSessionId: 'remote-session-1',
    correlationId: 'correlation-1',
    causationIds: ['cause-1'],
    replay: false,
    system: false,
    commitGrouping: 'pendingRemote',
    validationDiagnosticCount: 0,
    ...overrides.collaboration,
  } satisfies NonNullable<VersionOperationContext['collaboration']>;

  return {
    operationId: 'operation-1',
    kind: 'sync-import',
    author: AUTHOR,
    createdAt: '2026-06-21T00:00:01.000Z',
    workbookId: 'workbook-1',
    domainIds: ['cells.values'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
    collaboration,
  };
}
