import { jest } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';
import type { DocumentContext } from '../../../context';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  reservePersistedPendingRemoteSegment,
  type PendingRemoteSegmentOperationContext,
  type PendingRemoteSegmentStore,
  type ReservePendingRemoteSegmentInput,
} from '../../../document/version-store/pending-remote-segment-store';
import {
  createVersionGraphRegistry,
  createInMemoryVersionStoreProvider,
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphStore,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-provider-lifecycle-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

let documentCreateSpy: { mockRestore(): void } | undefined;
let staleMaterializationVersioningScope: VersionDocumentScope | null = null;
let internalMaterializationCreateCount = 0;

beforeEach(() => {
  staleMaterializationVersioningScope = null;
  internalMaterializationCreateCount = 0;
  const createDocument = DocumentFactory.create.bind(DocumentFactory);
  const spy = jest.spyOn(DocumentFactory, 'create');
  spy.mockImplementation(async (options?: any) => {
    const handle = await createDocument(options);
    const getAllSheetIds = bindProviderLifecycleGetAllSheetIds(handle);
    installVersionDomainDetectorNoopsOnHandles(handle);
    installProviderLifecycleMetadataNoops(handle, getAllSheetIds);
    if (options?.internal === true) {
      internalMaterializationCreateCount += 1;
      if (staleMaterializationVersioningScope) {
        attachStaleMaterializationVersioning(handle, staleMaterializationVersioningScope);
      }
    }
    return handle;
  });
  documentCreateSpy = spy;
});

afterEach(() => {
  documentCreateSpy?.mockRestore();
  documentCreateSpy = undefined;
  staleMaterializationVersioningScope = null;
  internalMaterializationCreateCount = 0;
});

describe('WorkbookVersion provider-backed checkout lifecycle admission', () => {
  it('surfaces pending provider writes and blocks provider-backed checkout admission', async () => {
    const { provider } = await initializeVersionGraph();
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const graph = await provider.openGraph(namespace);
    const pendingStore = await provider.openPendingRemoteSegmentStore(namespace);
    await persistAndReservePendingSegment(
      graph,
      pendingStore,
      await pendingSegmentFixture(namespace),
    );
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      wb.markClean();

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWrites',
              data: expect.objectContaining({ pendingRemoteSegmentCount: 1 }),
            }),
          ],
        },
      });

      await expect(wb.version.checkout({ kind: 'head' })).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                recoverability: 'retry',
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  targetKind: 'head',
                  refName: 'HEAD',
                  pendingRemoteSegmentCount: 1,
                }),
              }),
            }),
          ],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('fails closed when provider checkout admission cannot prove writes are settled', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const failing = providerWithFailingRegistryRead(provider);
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: withVersionManifest({ provider: failing.provider }),
      });
      wb.markClean();

      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
            }),
          ],
        },
      });

      await expect(
        wb.version.checkout({ kind: 'commit', id: initialized.rootCommit.id }),
      ).resolves.toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
              data: expect.objectContaining({
                recoverability: 'retry',
                payload: expect.objectContaining({
                  reason: 'pendingProviderWrites',
                  targetKind: 'commit',
                  commitId: initialized.rootCommit.id,
                }),
              }),
            }),
          ],
        },
      });
      expect(failing.openGraphCalls()).toBe(0);
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('blocks provider-backed checkout when the checked-out provider ref head is stale', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'branch-v1');
      const branchBaseResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!branchBaseResult.ok) {
        throw new Error(`expected branch base commit success: ${branchBaseResult.error.code}`);
      }
      const branchBase = branchBaseResult.value;
      sourceWb.markClean();

      const created = await sourceWb.version.createBranch({
        name: 'scenario/provider-admission' as any,
        targetCommitId: branchBase.id,
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();
      await expect(
        checkoutWb.version.checkout({
          kind: 'ref',
          name: 'refs/heads/scenario/provider-admission' as any,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });

      await sourceWb.activeSheet.setCell('A2', 'branch-v2');
      const movedResult = await sourceWb.version.commit({
        targetRef: 'refs/heads/scenario/provider-admission' as any,
        expectedHead: {
          commitId: branchBase.id,
          revision: created.value.revision,
        },
      });
      if (!movedResult.ok) {
        throw new Error(`expected moved branch commit success: ${movedResult.error.code}`);
      }
      const moved = movedResult.value;
      sourceWb.markClean();

      await expect(checkoutWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: branchBase.id,
          branchName: 'scenario/provider-admission',
          refHeadAtMaterialization: branchBase.id,
          currentRefHeadId: moved.id,
          detached: false,
          stale: true,
          staleReason: 'refMoved',
        },
        dirty: {
          pendingProviderWrites: false,
          checkoutSafe: true,
        },
      });

      const staleCheckout = await checkoutWb.version.checkout({
        kind: 'ref',
        name: 'refs/heads/scenario/provider-admission' as any,
      });
      expect(staleCheckout).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
              data: expect.objectContaining({
                recoverability: 'retry',
                payload: expect.objectContaining({
                  reason: 'staleWorkspaceHead',
                  staleReason: 'refMoved',
                  targetKind: 'ref',
                  refName: 'refs/heads/scenario/provider-admission',
                  branchName: 'scenario/provider-admission',
                  checkedOutCommitId: branchBase.id,
                  currentRefHeadId: moved.id,
                  refHeadAtMaterialization: branchBase.id,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(staleCheckout, ['providerDocumentScopeKey']);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'branch-v1',
      });
      await expect(checkoutWb.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: null,
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('leaves runtime head unchanged when the provider graph registry is stale during checkout', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const { provider, initialized } = await initializeVersionGraph({ backend });
    const stale = providerWithStaleRegistryRead(provider, initialized.registry);
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-before-stale-registry');
      const committedResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected commit success: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider: stale.provider }),
      });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-stale-registry-checkout');
      checkoutWb.markClean();

      await replaceVisibleRegistryGraph(backend, 'graph-2', 'replacement-root');
      stale.useStaleRegistryAfterLiveReads(1);

      const identityResult = await checkoutWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(identityResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_PROVIDER_ERROR',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'checkout',
                  targetKind: 'commit',
                  commitId: committed.id,
                }),
              }),
            }),
          ],
        },
      });
      expect(stale.openGraphCalls()).toBe(1);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-stale-registry-checkout',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('fails closed when provider identity changes after checkout services are attached', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-provider-identity');
      const committedResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected commit success: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await checkoutWb.activeSheet.setCell('A1', 'active-before-provider-identity-fence');
      checkoutWb.markClean();

      const runtimeVersioning = versioningRuntimeForHandle(checkoutHandle);
      runtimeVersioning.provider = createInMemoryVersionStoreProvider({
        documentScope: {
          ...DOCUMENT_SCOPE,
          documentId: 'checkout-provider-lifecycle-other-doc',
        },
      });

      const identityResult = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });
      expect(identityResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  commitId: committed.id,
                  cause: 'VersionCheckoutRebindProviderIdentityError',
                  identityFenceReason: 'providerDocumentMismatch',
                  providerIdentityClass: 'document',
                  mutationGuarantee: 'unknown-after-partial-mutation',
                  rollbackSafe: false,
                  partialSnapshot: true,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(identityResult, ['checkout-provider-lifecycle-other-doc', 'providerDocumentScopeKey']);
      await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'active-before-provider-identity-fence',
      });
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('keeps dirty and rebound provider identity checkout diagnostics redacted after close and reopen', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const reboundProvider = createInMemoryVersionStoreProvider({
      documentScope: {
        ...DOCUMENT_SCOPE,
        documentId: 'checkout-provider-lifecycle-rebound-doc',
      },
    });
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('A1', 'target-before-provider-rebound');
      const committedResult = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected commit success: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: withVersionManifest({ provider }) });
      checkoutWb.markClean();
      await expect(
        checkoutWb.version.checkout({ kind: 'commit', id: committed.id }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      await checkoutWb.close('skipSave');
      checkoutWb = undefined;

      reopenedWb = await checkoutHandle.workbook({
        versioning: withVersionManifest({ provider }),
      });
      versioningRuntimeForHandle(checkoutHandle).provider = reboundProvider;
      await reopenedWb.activeSheet.setCell('B1', 'dirty-after-rebound-reopen');

      const dirtyResult = await reopenedWb.version.checkout({ kind: 'commit', id: committed.id });
      expect(dirtyResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  reason: 'dirtyWorkingState',
                  targetKind: 'commit',
                  commitId: committed.id,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(dirtyResult, [
        'checkout-provider-lifecycle-rebound-doc',
        'providerDocumentScopeKey',
      ]);
      await expect(reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });

      reopenedWb.markClean();
      const reboundResult = await reopenedWb.version.checkout({
        kind: 'commit',
        id: committed.id,
      });
      expect(reboundResult).toMatchObject({
        ok: false,
        error: {
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
              data: expect.objectContaining({
                redacted: true,
                payload: expect.objectContaining({
                  operation: 'checkout',
                  targetKind: 'commit',
                  commitId: committed.id,
                  cause: 'VersionCheckoutRebindProviderIdentityError',
                  identityFenceReason: 'providerDocumentMismatch',
                  providerIdentityClass: 'document',
                  mutationGuarantee: 'unknown-after-partial-mutation',
                  rollbackSafe: false,
                  partialSnapshot: true,
                }),
              }),
            }),
          ],
        },
      });
      expectPublicDiagnosticsNotToLeak(reboundResult, [
        'checkout-provider-lifecycle-rebound-doc',
        'providerDocumentScopeKey',
      ]);
      await expect(reopenedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'dirty-after-rebound-reopen',
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it.each([
    ['workspace', { ...DOCUMENT_SCOPE, workspaceId: 'workspace-2' }, ['workspace-2']],
    ['document', { ...DOCUMENT_SCOPE, documentId: 'checkout-provider-lifecycle-stale-materialized-doc' }, ['checkout-provider-lifecycle-stale-materialized-doc']],
    ['principal', { ...DOCUMENT_SCOPE, principalScope: 'principal-2' }, ['principal-2']],
  ] as const)(
    'fails closed when a fresh checkout reload carries stale %s materializer identity',
    async (providerIdentityClass, materializationScope, forbiddenRawIds) => {
      const { provider, initialized } = await initializeVersionGraph();
      const sourceHandle = await DocumentFactory.create({
        documentId: DOCUMENT_SCOPE.documentId,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      const checkoutHandle = await DocumentFactory.create({
        documentId: DOCUMENT_SCOPE.documentId,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      let sourceWb: Workbook | undefined;
      let checkoutWb: Workbook | undefined;

      try {
        sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
        await sourceWb.activeSheet.setCell('A1', 'target-materialization-identity');
        const committedResult = await sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        });
        if (!committedResult.ok) {
          throw new Error(`expected commit success: ${committedResult.error.code}`);
        }
        const committed = committedResult.value;
        sourceWb.markClean();

        checkoutWb = await checkoutHandle.workbook({
          versioning: withVersionManifest({ provider }),
        });
        await checkoutWb.activeSheet.setCell('A1', 'active-before-materialization-identity-fence');
        checkoutWb.markClean();
        staleMaterializationVersioningScope = materializationScope;

        const checkoutResult = await checkoutWb.version.checkout({
          kind: 'commit',
          id: committed.id,
        });
        expect(checkoutResult).toMatchObject({
          ok: false,
          error: {
            diagnostics: [
              expect.objectContaining({
                code: 'VERSION_CHECKOUT_SNAPSHOT_APPLY_FAILED',
                data: expect.objectContaining({
                  redacted: true,
                  payload: expect.objectContaining({
                    commitId: committed.id,
                    cause: 'VersionCheckoutRebindMaterializationIdentityError',
                    identityFenceReason: 'materializationIdentityStale',
                    providerIdentityClass,
                    mutationGuarantee: 'unknown-after-partial-mutation',
                    rollbackSafe: false,
                    partialSnapshot: true,
                  }),
                }),
              }),
            ],
          },
        });
        expectPublicDiagnosticsNotToLeak(checkoutResult, [...forbiddenRawIds, 'providerDocumentScopeKey']);
        expect(internalMaterializationCreateCount).toBeGreaterThan(0);
        await expect(checkoutWb.activeSheet.getCell('A1')).resolves.toMatchObject({
          value: 'active-before-materialization-identity-fence',
        });
      } finally {
        if (checkoutWb) await checkoutWb.close('skipSave');
        if (sourceWb) await sourceWb.close('skipSave');
        await checkoutHandle.dispose();
        await sourceHandle.dispose();
      }
    },
  );
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeVersionGraph(
  options: { readonly backend?: InMemoryVersionDocumentProviderBackend } = {},
): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    ...(options.backend ? { backend: options.backend } : {}),
  });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function replaceVisibleRegistryGraph(
  backend: InMemoryVersionDocumentProviderBackend,
  graphId: string,
  label: string,
): Promise<void> {
  const input = await initializeInput(graphId, label);
  const graph = backend.getOrCreateGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  const initialized = await graph.initializeGraph(input.rootWrite);
  if (initialized.status !== 'success') {
    throw new Error(
      `expected replacement graph initialize success: ${initialized.diagnostics[0]?.code}`,
    );
  }
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId,
    rootCommitId: initialized.commit.id,
    createdAt: initialized.commit.payload.createdAt,
  });
  backend.setRegistry(DOCUMENT_SCOPE, registry);
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
): Promise<PendingSegmentFixture> {
  const operationContext = syncOperationContext();
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
    snapshotId: 'checkout-provider-lifecycle-pending-snapshot',
    sheets: [],
  });
  const semanticChangeSetRecord = await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
    schemaVersion: 1,
    changes: [{ id: 'checkout-provider-lifecycle-pending-change' }],
  });
  const mutationSegmentRecord = await objectRecord(namespace, 'workbook.mutationSegment.v1', {
    segmentId: 'checkout-provider-lifecycle-pending-segment',
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

function syncOperationContext(): PendingRemoteSegmentOperationContext {
  return {
    operationId: 'sync:providerLiveInbound:checkout-provider-lifecycle-remote-update',
    kind: 'sync-import',
    author: {
      authorId: 'remote-user-1',
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
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'checkout-provider-lifecycle-remote-update',
      sequence: '7',
      payloadHash: '3'.repeat(64),
      trustStatus: 'verified',
      authorState: 'singleRemote',
      remoteSessionId: 'remote-session-1',
      correlationId: 'checkout-provider-lifecycle-correlation',
      causationIds: ['checkout-provider-lifecycle-cause'],
      replay: false,
      system: false,
      commitGrouping: 'pendingRemote',
      validationDiagnosticCount: 0,
    },
  };
}

async function persistAndReservePendingSegment(
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

function providerWithFailingRegistryRead<T extends VersionStoreProvider>(
  provider: T,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
} {
  let openGraphCalls = 0;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          throw new Error('registry unavailable during checkout admission');
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
  };
}

function providerWithStaleRegistryRead<T extends VersionStoreProvider>(
  provider: T,
  registry: VersionGraphRegistry,
): {
  readonly provider: T;
  readonly openGraphCalls: () => number;
  readonly useStaleRegistryAfterLiveReads: (count: number) => void;
} {
  let openGraphCalls = 0;
  let liveRegistryReadsBeforeStale = Number.POSITIVE_INFINITY;
  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'readGraphRegistry') {
        return async () => {
          if (liveRegistryReadsBeforeStale > 0) {
            liveRegistryReadsBeforeStale -= 1;
            return target.readGraphRegistry();
          }
          return {
            status: 'ok' as const,
            registry,
            diagnostics: [],
          };
        };
      }
      if (prop === 'openGraph') {
        return async (...args: Parameters<VersionStoreProvider['openGraph']>) => {
          openGraphCalls += 1;
          return target.openGraph(...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;

  return {
    provider: wrapped,
    openGraphCalls: () => openGraphCalls,
    useStaleRegistryAfterLiveReads: (count: number) => {
      liveRegistryReadsBeforeStale = count;
    },
  };
}

function versioningRuntimeForHandle(handle: Awaited<ReturnType<typeof DocumentFactory.create>>) {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  if (!isMutableRecord(context.versioning)) {
    throw new Error('expected attached versioning runtime');
  }
  return context.versioning;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function bindProviderLifecycleGetAllSheetIds(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
): (() => Promise<unknown>) | null {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge) || typeof bridge.getAllSheetIds !== 'function') return null;
  const getAllSheetIds = bridge.getAllSheetIds;
  return () => getAllSheetIds.call(bridge);
}

function installProviderLifecycleMetadataNoops(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  getAllSheetIds: (() => Promise<unknown>) | null,
): void {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge)) return;
  if (getAllSheetIds) bridge.getAllSheetIds = getAllSheetIds;
  bridge.getSheetName = async () => 'Sheet1';
  bridge.isSheetHidden = async () => false;
}

function expectPublicDiagnosticsNotToLeak(result: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(result);
  for (const value of forbidden) {
    expect(serialized).not.toContain(value);
  }
}

function attachStaleMaterializationVersioning(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  documentScope: VersionDocumentScope,
): void {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  context.versioning = {
    provider: createInMemoryVersionStoreProvider({ documentScope }),
    checkoutService: {
      checkout: jest.fn(),
    },
  };
}
