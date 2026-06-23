import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { createVersionProviderWriteActivityTracker } from '../../../document/version-store/provider-write-activity';
import {
  DOCUMENT_SCOPE,
  createWorkbook,
  expectInitializeSuccess,
  initializeInput,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
} from './version-checkout-test-utils';

describe('WorkbookVersion checkout provider write preconditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks checkout while remote sync changes are waiting for promotion', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-pending-remote-checkout');
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-pending-remote-checkout', 'root'),
    );
    expectInitializeSuccess(initialized);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const wb = createWorkbook({ versioning: { provider } });

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
  });

  it('blocks checkout while provider write activity is in flight', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-active-provider-writes', 'root'),
    );
    expectInitializeSuccess(initialized);
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    let releaseActivity!: () => void;
    const activityHold = new Promise<void>((resolve) => {
      releaseActivity = resolve;
    });
    const inFlightActivity = providerWriteActivityTracker.trackRemoteSyncApply(
      async () => activityHold,
    );
    const wb = createWorkbook({
      versioning: {
        provider,
        providerWriteActivityTracker,
      },
    });

    try {
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWrites',
              data: expect.objectContaining({ remoteSyncApplyActiveCount: 1 }),
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
                  remoteSyncApplyActiveCount: 1,
                }),
              }),
            }),
          ],
        },
      });
    } finally {
      releaseActivity();
      await inFlightActivity;
    }
  });

  it('blocks checkout while pending remote promotion activity is in flight', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-active-promotion', 'root'),
    );
    expectInitializeSuccess(initialized);
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    let releasePromotion!: () => void;
    let markPromotionStarted!: () => void;
    const promotionHold = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    const promotionStarted = new Promise<void>((resolve) => {
      markPromotionStarted = resolve;
    });
    const inFlightPromotion = providerWriteActivityTracker.runExclusivePendingRemotePromotion(
      async () => {
        markPromotionStarted();
        await promotionHold;
      },
    );
    await promotionStarted;
    const wb = createWorkbook({
      versioning: {
        provider,
        providerWriteActivityTracker,
      },
    });

    try {
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          pendingProviderWrites: true,
          checkoutSafe: false,
          unsafeReasons: [
            expect.objectContaining({
              code: 'version.surfaceStatus.pendingProviderWrites',
              data: expect.objectContaining({ pendingRemotePromotionActiveCount: 1 }),
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
                  pendingRemotePromotionActiveCount: 1,
                }),
              }),
            }),
          ],
        },
      });
    } finally {
      releasePromotion();
      await inFlightPromotion;
    }
  });
});
