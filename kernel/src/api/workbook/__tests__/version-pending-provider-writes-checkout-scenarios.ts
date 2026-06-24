import { expect, it, jest } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import { readVersionPendingProviderWrites } from '../version/pending/provider-writes';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';
import {
  cleanSurfaceDirtyStatus,
  createCtx,
  GRAPH_REGISTRY,
  pendingRemoteSegmentRecord,
} from './version-pending-provider-writes-test-utils';

export function registerPendingProviderWritesCheckoutScenarios(): void {
  it('blocks checkout through the structured admission diagnostic when provider writes are pending', async () => {
    const checkout = jest.fn();
    const pendingRecord = await pendingRemoteSegmentRecord();
    const pendingStore = {
      listByState: jest.fn(async () => ({
        status: 'success',
        records: [pendingRecord],
        diagnostics: [],
      })),
    };
    const provider = {
      readGraphRegistry: jest.fn(async () => ({
        status: 'ok',
        registry: GRAPH_REGISTRY,
        diagnostics: [],
      })),
      openGraph: jest.fn(),
      openPendingRemoteSegmentStore: jest.fn(async () => pendingStore),
    };
    let ctx: any;
    ctx = createCtx(
      versioningWithDomainSupportManifest({
        provider,
        checkoutService: { checkout },
        surfaceStatusService: {
          readDirtyStatus: async () => {
            const pending = await readVersionPendingProviderWrites(ctx);
            return cleanSurfaceDirtyStatus({
              statusRevision: `dirty:${pending.statusRevision}`,
              checkoutPreflightToken: `token:${pending.statusRevision}`,
              pendingProviderWrites: pending.pendingProviderWrites,
              checkoutSafe: !pending.pendingProviderWrites,
              unsafeReasons: pending.unsafeReasons,
              diagnostics: pending.diagnostics,
            });
          },
        },
      }),
    );

    await expect(checkoutWorkbookVersion(ctx, { kind: 'head' })).resolves.toMatchObject({
      status: 'degraded',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
          recoverability: 'retry',
          payload: expect.objectContaining({
            reason: 'pendingProviderWrites',
            targetKind: 'head',
            refName: 'HEAD',
            pendingRemoteSegmentCount: 1,
          }),
        }),
      ],
    });
    expect(checkout).not.toHaveBeenCalled();
  });
}
