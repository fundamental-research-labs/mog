import 'fake-indexeddb/auto';

import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { AdmittedSyncApplyContext } from '../../../bridges/compute/sync-apply-admission';
import { prepareAppliedSyncUpdateIdentityBeforeApply } from '../../applied-sync-update-identity-wiring';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  type ReserveAppliedSyncUpdateIdentityInput,
} from '../applied-sync-update-identity-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'remote-user-1',
  actorKind: 'user',
  displayName: 'Remote User One',
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('applied sync update identity store', () => {
  it('computes stable document-scoped identity keys independent of lifecycle source', async () => {
    const first =
      await appliedSyncUpdateIdentityKeyMaterialForOperationContext(syncOperationContext());
    const replay = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({
        createdAt: '2026-06-21T00:00:02.000Z',
        collaboration: { sourceKind: 'providerReplay', replay: true, system: true },
      }),
    );
    const changedUpdate = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { updateId: 'remote-update-2' } }),
    );
    const changedPayload = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
    );
    const localEchoWithRotatedRawProvider =
      await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
        syncOperationContext({
          operationId: 'operation-local-echo',
          collaboration: {
            providerId: 'provider-rotated-2',
            providerKind: 'other-provider',
            authorityRef: 'authority-rotated-2',
            remoteSessionId: 'remote-session-rotated-2',
            correlationId: 'correlation-rotated-2',
            causationIds: ['cause-rotated-2'],
          },
        }),
      );

    expect(first.identityKey).toMatch(/^applied-sync-update:sha256:[0-9a-f]{64}$/);
    expect(first).toEqual(replay);
    expect(first).toEqual(localEchoWithRotatedRawProvider);
    expect(first.identityKey).not.toBe(changedUpdate.identityKey);
    expect(first.identityKey).toBe(changedPayload.identityKey);
    expect(first.identity).toEqual({
      schemaVersion: 1,
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      epoch: 'epoch-1',
      updateId: 'remote-update-1',
    });
  });

  it('reserves, completes, deduplicates, and snapshots in-memory identities', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { identityKey: input.identityKey, state: 'reserved' },
    });
    const reserved = await store.readByIdentityKey(input.identityKey);
    if (reserved.status !== 'found') throw new Error('expected reserved identity');
    expectNoRawProviderIdentity(reserved.record.operationContext.collaboration);
    await expect(
      store.reserveIdentity({
        ...input,
        createdAt: '2026-06-21T00:00:02.000Z',
        operationContext: syncOperationContext({
          createdAt: '2026-06-21T00:00:02.000Z',
          operationId: 'operation-local-echo',
          collaboration: {
            providerId: 'provider-rotated-2',
            providerKind: 'other-provider',
            authorityRef: 'authority-rotated-2',
            remoteSessionId: 'remote-session-rotated-2',
            correlationId: 'correlation-rotated-2',
            causationIds: ['cause-rotated-2'],
          },
        }),
      }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { identityKey: input.identityKey, state: 'reserved' },
    });
    await expect(
      store.reserveIdentity({
        ...input,
        operationContext: syncOperationContext({ collaboration: { payloadHash: '4'.repeat(64) } }),
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: 'pending-remote-segment:sha256:' + 'a'.repeat(64),
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'applied' },
    });
    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'duplicate',
      record: { state: 'applied' },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'applied',
          pendingRemoteSegmentId: 'pending-remote-segment:sha256:' + 'a'.repeat(64),
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:03.000Z' },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'retryable',
          reason: 'transient-write-failure',
        },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openAppliedSyncUpdateIdentityStore()).readByIdentityKey(
        input.identityKey,
      ),
    ).resolves.toMatchObject({
      status: 'found',
      record: { identityKey: input.identityKey, state: 'applied' },
    });
    const reloadedRead = await (
      await reloadedProvider.openAppliedSyncUpdateIdentityStore()
    ).readByIdentityKey(input.identityKey);
    if (reloadedRead.status !== 'found') throw new Error('expected reloaded identity');
    expectNoRawProviderIdentity(reloadedRead.record.operationContext.collaboration);
  });

  it('rejects invalid reservation identity keys without creating rows', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();
    const changedUpdate = await appliedIdentityInput(
      syncOperationContext({ collaboration: { updateId: 'remote-update-2' } }),
    );

    await expect(
      store.reserveIdentity({
        ...input,
        identityKey: changedUpdate.identityKey,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readByIdentityKey(input.identityKey)).resolves.toMatchObject({
      status: 'missing',
    });
    await expect(store.readByIdentityKey(changedUpdate.identityKey)).resolves.toMatchObject({
      status: 'missing',
    });
  });

  it('persists IndexedDB identities before graph initialization and isolates document scopes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({
      status: 'reserved',
      record: { documentScopeKey: expect.stringContaining(DOCUMENT_SCOPE.documentId) },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'failedAfterMutation', reason: 'rebuild-failed' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'failedAfterMutation' },
    });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openAppliedSyncUpdateIdentityStore();
    await expect(reloadedStore.readByIdentityKey(input.identityKey)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'failedAfterMutation' },
    });
    const reloadedIdentity = await reloadedStore.readByIdentityKey(input.identityKey);
    if (reloadedIdentity.status !== 'found') throw new Error('expected persisted identity');
    expectNoRawProviderIdentity(reloadedIdentity.record.operationContext.collaboration);
    await expect(reloadedStore.reserveIdentity(input)).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'failedAfterMutation' },
    });
    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store: reloadedStore,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'applied-sync-update-identity-failed-after-mutation',
    });
    await expect(
      reloadedStore.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'applied' },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_APPLIED_SYNC_UPDATE_CONFLICT' }],
    });

    const otherProvider = createIndexedDbVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
    });
    await expect(
      (await otherProvider.openAppliedSyncUpdateIdentityStore()).readByIdentityKey(
        input.identityKey,
      ),
    ).resolves.toMatchObject({
      status: 'missing',
    });
  });

  it('rejects terminal rejected identities before applying sync bytes', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({ status: 'reserved' });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'rejected', reason: 'provider-validation-rejected' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'rejected' },
    });

    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      reason: 'applied-sync-update-identity-terminal-rejected',
    });
  });

  it('allows retryable identities to complete after a retry', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAppliedSyncUpdateIdentityStore();
    const input = await appliedIdentityInput();

    await expect(store.reserveIdentity(input)).resolves.toMatchObject({ status: 'reserved' });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:03.000Z',
        terminal: { status: 'retryable', reason: 'transient-before-mutation' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'retryable' },
    });

    await expect(
      prepareAppliedSyncUpdateIdentityBeforeApply({
        store,
        admittedContext: admittedContextFor(input.operationContext),
        inboundUpdateAlreadySeen: false,
      }),
    ).resolves.toMatchObject({
      status: 'apply',
      reservation: { identityKey: input.identityKey },
    });
    await expect(
      store.completeIdentity({
        identityKey: input.identityKey,
        payloadHash: '3'.repeat(64),
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'applied' },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { state: 'applied', terminal: { status: 'applied' } },
    });
  });
});

async function appliedIdentityInput(
  operationContext: VersionOperationContext = syncOperationContext(),
): Promise<ReserveAppliedSyncUpdateIdentityInput> {
  const keys = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(operationContext);
  return {
    identityKey: keys.identityKey,
    operationContext,
    createdAt: operationContext.createdAt,
  };
}

function admittedContextFor(operationContext: VersionOperationContext): AdmittedSyncApplyContext {
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

function expectNoRawProviderIdentity(
  collaboration: NonNullable<VersionOperationContext['collaboration']>,
): void {
  expect(collaboration).not.toHaveProperty('providerId');
  expect(collaboration).not.toHaveProperty('providerKind');
  expect(collaboration).not.toHaveProperty('authorityRef');
  expect(collaboration).not.toHaveProperty('remoteSessionId');
  expect(collaboration).not.toHaveProperty('correlationId');
  expect(collaboration).not.toHaveProperty('causationIds');
}

function syncOperationContext(
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
