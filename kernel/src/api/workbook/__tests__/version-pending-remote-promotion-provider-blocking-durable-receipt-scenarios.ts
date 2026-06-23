import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  expectBlockedPromotion,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderDurableReceiptBlockingScenarios(): void {
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
}
