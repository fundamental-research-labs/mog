import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  expectBlockedPromotion,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  markSyncBatchTerminal,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  providerWithStaleHeadCommit,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderBlockingScenarios(): void {
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
}
