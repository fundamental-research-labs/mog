import { jest } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  attachStaleMaterializationVersioning,
  bindProviderLifecycleGetAllSheetIds,
  DOCUMENT_SCOPE,
  expectPublicDiagnosticsNotToLeak,
  initializeVersionGraph,
  installProviderLifecycleMetadataNoops,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  providerWithFailingRegistryRead,
  providerWithStaleRegistryRead,
  replaceVisibleRegistryGraph,
  versioningRuntimeForHandle,
} from './version-checkout-provider-lifecycle-test-utils';
import {
  installVersionDomainDetectorNoopsOnHandles,
  withVersionManifest,
} from './version-domain-support-test-utils';
import {
  createInMemoryVersionStoreProvider,
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';

let documentCreateSpy: { mockRestore(): void } | undefined;
let staleMaterializationVersioningScope: typeof DOCUMENT_SCOPE | null = null;
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

  it.each([
    ['registry reads fail', async (provider: ReturnType<typeof createInMemoryVersionStoreProvider>) => providerWithFailingRegistryRead(provider)],
    ['provider lifecycle is closed', async (provider: ReturnType<typeof createInMemoryVersionStoreProvider>) => { await provider.close(); return { provider, openGraphCalls: () => 0 }; }],
  ] as const)('fails closed when %s cannot prove writes are settled', async (_name, attach) => {
    const { provider, initialized } = await initializeVersionGraph();
    const failing = await attach(provider);
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
