import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  expectBlockedPromotion,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderAuthorityBlockingScenarios(): void {
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
}
