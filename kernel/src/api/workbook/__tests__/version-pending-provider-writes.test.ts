import { jest } from '@jest/globals';

import { readVersionPendingProviderWrites } from '../version-pending-provider-writes';

const ROOT_COMMIT_ID = `commit:sha256:${'0'.repeat(64)}`;
const GRAPH_REGISTRY = Object.freeze({
  schemaVersion: 1,
  documentId: 'document-1',
  currentGraphId: 'graph-1',
  headRefName: 'refs/heads/main',
  rootCommitId: ROOT_COMMIT_ID,
  registryRevision: { kind: 'counter', value: '0' },
  registryChecksum: { algorithm: 'sha256', digest: '1'.repeat(64) },
  createdAt: '2026-06-22T00:00:00.000Z',
});

function createCtx(versioning: Record<string, unknown>) {
  return { versioning } as any;
}

describe('version pending provider writes status', () => {
  it('reads provider-write activity from an attached pending promotion service tracker', async () => {
    const tracker = {
      readActivity: jest.fn(() => ({
        remoteSyncApplyActiveCount: 0,
        pendingRemotePromotionActiveCount: 1,
        pendingRemotePromotionQueuedCount: 0,
        statusRevision: 'revision:7',
      })),
      trackRemoteSyncApply: jest.fn(),
      runExclusivePendingRemotePromotion: jest.fn(),
    };

    const status = await readVersionPendingProviderWrites(
      createCtx({
        pendingRemotePromotionService: {
          providerWriteActivityTracker: tracker,
          promotePendingRemoteSegments: jest.fn(),
        },
      }),
    );

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'providerActivity:revision:7|provider:none',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWrites',
          data: expect.objectContaining({
            pendingRemotePromotionActiveCount: 1,
          }),
        }),
      ],
    });
    expect(tracker.readActivity).toHaveBeenCalledTimes(1);
  });

  it('reports persisted pending remote segments from an attached provider', async () => {
    const pendingStore = {
      listByState: jest.fn(async () => ({
        status: 'success',
        records: [{}],
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

    const status = await readVersionPendingProviderWrites(createCtx({ provider }));

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'pendingRemote:1',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWrites',
          data: expect.objectContaining({
            pendingRemoteSegmentCount: 1,
          }),
        }),
      ],
    });
    expect(provider.readGraphRegistry).toHaveBeenCalledTimes(1);
    expect(provider.openPendingRemoteSegmentStore).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'document-1',
        graphId: 'graph-1',
      }),
    );
    expect(pendingStore.listByState).toHaveBeenCalledWith('pending');
  });
});
