import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  providerWithStaleHeadCommit,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderStaleHeadBlockingScenarios(): void {
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
