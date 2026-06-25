import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';
import {
  createPromotionAuthorizedCtx,
  createWorkbook,
  DOCUMENT_SCOPE,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROVENANCE_TRUTH_SERVICE,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderPublicOpsBoundaryScenarios(): void {
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
            code: 'VERSION_REVERT_PENDING_PROVIDER_WRITES',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                reason: 'pendingProviderWrites',
                pendingRemoteSegmentCount: 1,
              }),
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
}
