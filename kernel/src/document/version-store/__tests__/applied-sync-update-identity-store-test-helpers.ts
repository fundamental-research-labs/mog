import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { AdmittedSyncApplyContext } from '../../../bridges/compute/sync-apply-admission';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  type ReserveAppliedSyncUpdateIdentityInput,
} from '../applied-sync-update-identity-store';
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

export function installAppliedSyncUpdateIdentityStoreIndexedDbCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export async function appliedIdentityInput(
  operationContext: VersionOperationContext = syncOperationContext(),
): Promise<ReserveAppliedSyncUpdateIdentityInput> {
  const keys = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(operationContext);
  return {
    identityKey: keys.identityKey,
    operationContext,
    createdAt: operationContext.createdAt,
  };
}

export function admittedContextFor(
  operationContext: VersionOperationContext,
): AdmittedSyncApplyContext {
  const collaboration = operationContext.collaboration!;
  return {
    source: 'provider-inbound',
    docId: operationContext.workbookId ?? 'workbook-1',
    envelopeVersion: 'v2',
    providerRefId: collaboration.providerId,
    providerEpoch: collaboration.epoch,
    updateId: collaboration.updateId,
    payloadHash: collaboration.payloadHash,
    provenance: {} as never,
    validationDiagnostics: [],
    operationContext,
  } as AdmittedSyncApplyContext;
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
): VersionOperationContext {
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
    payloadHash: '3'.repeat(64),
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
