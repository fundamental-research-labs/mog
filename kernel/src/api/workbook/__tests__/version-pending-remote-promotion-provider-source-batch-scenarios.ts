import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  createPromotionAuthorizedWorkbook,
  DOCUMENT_SCOPE,
  expectSingleCommit,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  SOURCE_BATCH_ID,
} from './version-pending-remote-promotion-provider-test-utils';

export function registerPendingRemotePromotionProviderSourceBatchScenarios(): void {
  it('preserves source batch binding on provider-backed pending segments', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider, 'graph-source-batch-binding');
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace, { sourceBatch: true });
    await persistAndReservePendingSegment(graph, store, fixture);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        operationContext: {
          collaboration: {
            batchId: SOURCE_BATCH_ID,
            subUpdateIndex: 0,
            subUpdateCount: 1,
          },
        },
      },
    });
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
    if (!result.ok)
      throw new Error(`expected source batch promotion success: ${result.error.code}`);
    const commitId = expectSingleCommit(result.value.commitIds);
    await expect(graph.readCommit(commitId)).resolves.toMatchObject({
      status: 'success',
      commit: {
        payload: {
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
  });
}
