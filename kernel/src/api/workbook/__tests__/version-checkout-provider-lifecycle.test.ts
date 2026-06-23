import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import {
  DOCUMENT_SCOPE,
  initializeVersionGraph,
  installProviderLifecycleDocumentFactoryHooks,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  providerWithFailingRegistryRead,
} from './version-checkout-provider-lifecycle-test-utils';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';

installProviderLifecycleDocumentFactoryHooks();

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
                  refName: 'redacted',
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
    [
      'registry reads fail',
      async (provider: ReturnType<typeof createInMemoryVersionStoreProvider>) =>
        providerWithFailingRegistryRead(provider),
    ],
    [
      'provider lifecycle is closed',
      async (provider: ReturnType<typeof createInMemoryVersionStoreProvider>) => {
        await provider.close();
        return { provider, openGraphCalls: () => 0 };
      },
    ],
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
                  commitId: 'redacted',
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
});
