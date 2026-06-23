import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createMockCtx,
  createWorkbook,
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROVENANCE_TRUTH_SERVICE,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderHostGateBoundaryScenarios(): void {
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
}
