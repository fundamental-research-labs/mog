import { jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';
import {
  createMockCtx,
  createPromotionAuthorizedCtx,
  createPromotionAuthorizedWorkbook,
  createWorkbook,
  DOCUMENT_SCOPE,
  expectBlockedPromotion,
  expectGraphHead,
  expectReadHeadSuccess,
  expectSingleCommit,
  initializeProvider,
  markSyncBatchTerminal,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROVENANCE_TRUTH_SERVICE,
  providerWithStaleHeadCommit,
  SOURCE_BATCH_ID,
} from './version-pending-remote-promotion-provider-test-utils';

describe('WorkbookVersion pending remote promotion provider facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches a provider-backed pending remote promotion service', () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = createMockCtx();

    createWorkbook({
      ctx,
      versioning: { provider },
    });

    expect(ctx.versioning).toMatchObject({
      provider,
      pendingRemotePromotionService: {
        promotePendingRemoteSegments: expect.any(Function),
      },
      promotePendingRemoteSegments: expect.any(Function),
    });
  });

  it('promotes a seeded pending remote segment through wb.version.promotePendingRemote', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const wb = createPromotionAuthorizedWorkbook({ provider });

    const result = await wb.version.promotePendingRemote();

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
        skipped: [],
        diagnostics: [],
      },
    });
    if (!result.ok) throw new Error(`expected promotion success: ${result.error.code}`);
    const commitId = expectSingleCommit(result.value.commitIds);
    await expect(graph.readCommit(commitId)).resolves.toMatchObject({
      status: 'success',
      commit: {
        payload: {
          author: fixture.input.operationContext.author,
          createdAt: fixture.input.operationContext.createdAt,
          snapshotRootDigest: fixture.input.snapshotRootDigest,
          semanticChangeSetDigest: fixture.input.semanticChangeSetDigest,
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'promoted',
        terminal: { status: 'promoted', commitId },
      },
    });
    const headAfterPromotion = await expectReadHeadSuccess(graph);
    expect(headAfterPromotion.commitId).toBe(commitId);

    await expect(wb.version.promotePendingRemote({ includeDiagnostics: true })).resolves.toEqual({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [],
        diagnostics: [],
      },
    });
    await expectGraphHead(graph, headAfterPromotion);
    await expect(store.listByState('pending')).resolves.toMatchObject({
      status: 'success',
      records: [],
    });
    await expect(store.listByState('promoted')).resolves.toMatchObject({
      status: 'success',
      records: [
        expect.objectContaining({
          pendingRemoteSegmentId: fixture.input.pendingRemoteSegmentId,
          state: 'promoted',
        }),
      ],
    });
  });

  it('returns a failed VersionResult when no promotion service is attached', async () => {
    const wb = createWorkbook({
      ctx: createPromotionAuthorizedCtx(),
      versioning: { provenanceTruthService: PROVENANCE_TRUTH_SERVICE },
    });

    await expect(wb.version.promotePendingRemote()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.promotePendingRemote',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_SERVICE_UNAVAILABLE',
            data: expect.objectContaining({
              redacted: true,
              payload: expect.objectContaining({ operation: 'promotePendingRemote' }),
            }),
          }),
        ],
      },
    });
  });

  it.each([
    ['duplicate', { status: 'dropped', reason: 'duplicate-update-id' }, 'dropped'],
    ['gapWaiting', { status: 'rejected', reason: 'source-gap-waiting' }, 'rejected'],
    [
      'failedAfterMutation',
      { status: 'failedAfterMutation', reason: 'remote-import-failed' },
      'failedAfterMutation',
    ],
  ] as const)(
    'blocks %s source sync batches through wb.version.promotePendingRemote',
    async (_label, terminal, batchStatusState) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const namespace = await initializeProvider(
        provider,
        `graph-blocked-batch-${batchStatusState}`,
      );
      const graph = await provider.openGraph(namespace);
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const fixture = await pendingSegmentFixture(namespace);
      await persistAndReservePendingSegment(graph, store, fixture);
      await markSyncBatchTerminal(provider, fixture.input.operationContext, terminal);
      const headBefore = await expectReadHeadSuccess(graph);
      const wb = createPromotionAuthorizedWorkbook({ provider });

      const result = await wb.version.promotePendingRemote();

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: 'failed',
          promotedSegmentIds: [],
          commitIds: [],
          skipped: [
            {
              segmentId: fixture.input.pendingRemoteSegmentId,
              reason: 'batch-status-terminal',
            },
          ],
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED',
              reason: 'batch-status-terminal',
              segmentId: fixture.input.pendingRemoteSegmentId,
              data: expect.objectContaining({ batchStatusState }),
            }),
          ],
        },
      });
      await expectGraphHead(graph, headBefore);
      await expect(
        store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
      ).resolves.toMatchObject({
        status: 'found',
        record: { state: 'pending' },
      });
    },
  );

  it('blocks stale replay provider metadata without promoting or leaking provider identity', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-stale-provider-metadata');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace, {
      collaboration: {
        replay: true,
      },
    });
    await persistAndReservePendingSegment(graph, store, fixture);
    const headBefore = await expectReadHeadSuccess(graph);
    const wb = createPromotionAuthorizedWorkbook({ provider });

    const result = await wb.version.promotePendingRemote({ includeDiagnostics: true });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'failed',
        promotedSegmentIds: [],
        commitIds: [],
        skipped: [
          {
            segmentId: fixture.input.pendingRemoteSegmentId,
            reason: 'provider-authority-stale',
          },
        ],
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
            reason: 'provider-authority-stale',
            segmentId: fixture.input.pendingRemoteSegmentId,
            data: expect.objectContaining({
              gate: 'replay-high-water',
              field: 'replay',
              expected: false,
              actual: true,
              sourceKind: 'providerLiveInbound',
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('provider-1');
    expect(JSON.stringify(result)).not.toContain('authority-1');
    expect(JSON.stringify(result)).not.toContain('remote-session-1');
    await expectGraphHead(graph, headBefore);
    const staleRead = await store.readBySegmentId(fixture.input.pendingRemoteSegmentId);
    expect(staleRead).toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
    if (staleRead.status !== 'found') throw new Error('expected stale segment to remain pending');
    expect(staleRead.record.terminal).toBeUndefined();
  });

  it.each([
    [
      'unknown remote authority',
      'graph-unknown-provider-authority',
      { trustStatus: 'unverified' },
      'provider-authority-unknown',
    ],
    [
      'quarantine-required update',
      'graph-quarantine-required-update',
      {
        validationDiagnosticCount: 1,
        exclusionReason: 'missingProof',
        exclusionSubreason: 'missingProofAudience',
      },
      'provider-authority-unknown',
    ],
  ] as const)(
    'blocks %s through wb.version.promotePendingRemote without promoting',
    async (_label, graphId, collaboration, reason) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const namespace = await initializeProvider(provider, graphId);
      const graph = await provider.openGraph(namespace);
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const fixture = await pendingSegmentFixture(namespace, { collaboration });
      await persistAndReservePendingSegment(graph, store, fixture);
      const headBefore = await expectReadHeadSuccess(graph);
      const wb = createPromotionAuthorizedWorkbook({ provider });

      const result = await wb.version.promotePendingRemote({ includeDiagnostics: true });

      await expectBlockedPromotion(result, graph, store, fixture, headBefore, reason);
    },
  );

  it('blocks missing durable segment receipt without promoting', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-missing-durable-segment');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await expect(store.reserveSegment(fixture.input)).resolves.toMatchObject({
      status: 'created',
    });
    const headBefore = await expectReadHeadSuccess(graph);
    const wb = createPromotionAuthorizedWorkbook({ provider });

    const result = await wb.version.promotePendingRemote({ includeDiagnostics: true });

    await expectBlockedPromotion(
      result,
      graph,
      store,
      fixture,
      headBefore,
      'missing-required-object',
    );
  });

  it('blocks stale remote head promotion attempts without marking the segment promoted', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-stale-remote-head');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const wb = createPromotionAuthorizedWorkbook({
      provider: providerWithStaleHeadCommit(provider, namespace),
    });

    const result = await wb.version.promotePendingRemote({ includeDiagnostics: true });

    expect(result).toMatchObject({
      ok: true,
      value: { status: 'failed', promotedSegmentIds: [], commitIds: [] },
    });
    if (!result.ok) throw new Error(`expected stale head block: ${result.error.code}`);
    expect(result.value.skipped).toEqual([
      {
        segmentId: fixture.input.pendingRemoteSegmentId,
        reason: 'graph-write-failed',
        message: expect.any(String),
      },
    ]);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({ status: 'found', record: { state: 'pending' } });
  });

  it('preserves source batch binding on provider-backed pending segments', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-source-batch-binding');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace, { sourceBatch: true });
    await persistAndReservePendingSegment(graph, store, fixture);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        operationContext: {
          collaboration: {
            batchId: SOURCE_BATCH_ID,
            subUpdateIndex: 0,
            subUpdateCount: 1,
          },
        },
      },
    });
    const wb = createPromotionAuthorizedWorkbook({ provider });

    const result = await wb.version.promotePendingRemote();

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'success',
        promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
        skipped: [],
        diagnostics: [],
      },
    });
    if (!result.ok)
      throw new Error(`expected source batch promotion success: ${result.error.code}`);
    const commitId = expectSingleCommit(result.value.commitIds);
    await expect(graph.readCommit(commitId)).resolves.toMatchObject({
      status: 'success',
      commit: {
        payload: {
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
  });

  it('returns no-write diagnostics without invoking provider promotion when host gates are missing', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-no-write-gate');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const headBefore = await expectReadHeadSuccess(graph);
    const ctx = createMockCtx();
    const wb = createWorkbook({
      ctx,
      versioning: { provider, provenanceTruthService: PROVENANCE_TRUTH_SERVICE },
    });
    const promotePendingRemoteSegments = jest.spyOn(
      ctx.versioning.pendingRemotePromotionService,
      'promotePendingRemoteSegments',
    );

    const result = await wb.version.promotePendingRemote();

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'promotePendingRemote',
                requiredCapability: 'version:remotePromote',
              }),
            }),
          }),
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'promotePendingRemote',
                requiredCapability: 'version:provenance',
              }),
            }),
          }),
        ],
      },
    });
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
    await expectGraphHead(graph, headBefore);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('covers pending provider writes across checkout, merge preview, and disabled revert boundaries', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-pending-writes-public-ops');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const visibleHead = await expectReadHeadSuccess(graph);
    const mergeInput = {
      base: visibleHead.commitId,
      ours: visibleHead.commitId,
      theirs: visibleHead.commitId,
    };
    const checkout = jest.fn();
    const merge = jest.fn(async () => ({
      status: 'clean',
      ...mergeInput,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    }));
    const revert = jest.fn();
    const ctx = createPromotionAuthorizedCtx();
    installVersionDomainDetectorNoopsOnBridgeMock(ctx.computeBridge);
    const wb = createWorkbook({
      ctx,
      versioning: versioningWithDomainSupportManifest({
        provider,
        provenanceTruthService: PROVENANCE_TRUTH_SERVICE,
        checkoutService: { checkout },
        mergeService: { merge },
        revertService: { revert },
      }),
    });

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
              payload: expect.objectContaining({
                reason: 'pendingProviderWrites',
                pendingRemoteSegmentCount: 1,
              }),
            }),
          }),
        ],
      },
    });
    expect(checkout).not.toHaveBeenCalled();

    await expect(
      wb.version.merge(mergeInput, { mode: 'preview', includeDiagnostics: true }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'clean',
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledTimes(1);

    await expect(
      wb.version.revert(
        { target: { kind: 'commit', commitId: visibleHead.commitId } },
        { includeDiagnostics: true },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_REVERT_UNAVAILABLE',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ]),
      },
    });
    expect(revert).not.toHaveBeenCalled();
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });
});
