import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedCtx,
  createPromotionAuthorizedWorkbook,
  createWorkbook,
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  expectSingleCommit,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROVENANCE_TRUTH_SERVICE,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderPromotionScenarios(): void {
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
}
