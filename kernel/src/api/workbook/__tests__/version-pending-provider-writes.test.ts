import { jest } from '@jest/globals';

import { checkoutWorkbookVersion } from '../version-checkout';
import { readVersionPendingProviderWrites } from '../version-pending-provider-writes';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';
import {
  pendingRemoteSegmentKeyMaterialForOperationContext,
  type PendingRemoteSegmentRecord,
} from '../../../document/version-store/pending-remote-segment-store';
import { versionGraphNamespaceKey } from '../../../document/version-store/object-store';
import {
  namespaceForRegistry,
  versionDocumentScopeKey,
} from '../../../document/version-store/registry';

const ROOT_COMMIT_ID = `commit:sha256:${'0'.repeat(64)}`;
const RAW_CURSOR = 'mog-pending-remote-v1.pending.cursor-secret';
const RAW_BATCH_STATUS_ID = `sync-batch-status:sha256:${'9'.repeat(64)}`;
const RAW_SEGMENT_ID = `pending-remote-segment:sha256:${'8'.repeat(64)}`;
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

function cleanSurfaceDirtyStatus(overrides: Record<string, unknown> = {}) {
  return {
    statusRevision: 'dirty-revision-clean',
    checkoutPreflightToken: 'checkout-preflight-token-clean',
    hasUncommittedLocalChanges: false,
    commitEligibleChanges: false,
    unsupportedDirtyDomains: [],
    pendingProviderWrites: false,
    pendingRecalc: false,
    checkoutSafe: true,
    unsafeReasons: [],
    source: 'VC-05' as const,
    diagnostics: [],
    ...overrides,
  };
}

function createProviderWithPendingListResult(listResult: unknown) {
  const pendingStore = {
    listByState: jest.fn(async () => listResult),
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
  return { provider, pendingStore };
}

async function pendingRemoteSegmentRecord(): Promise<PendingRemoteSegmentRecord> {
  const operationContext = {
    operationId: 'operation-1',
    kind: 'remoteSyncApply',
    author: { actorKind: 'user', displayName: 'User One', redacted: true },
    createdAt: '2026-06-22T00:00:01.000Z',
    domainIds: [],
    capturePolicy: 'semantic',
    writeAdmissionMode: 'provider',
    collaboration: {
      sourceKind: 'provider',
      originKind: 'remote',
      stableOriginId: 'stable-origin-1',
      providerId: 'provider-1',
      authorityRef: 'authority-1',
      roomId: 'room-1',
      epoch: 'epoch-1',
      updateId: 'update-1',
      sequence: 'sequence-1',
      payloadHash: 'payload-hash-1',
    },
  } as any;
  const keyMaterial = await pendingRemoteSegmentKeyMaterialForOperationContext(
    operationContext,
  );
  return {
    schemaVersion: 1,
    recordKind: 'pendingRemoteSegment',
    pendingRemoteSegmentId: keyMaterial.pendingRemoteSegmentId,
    idempotencyKey: keyMaterial.idempotencyKey,
    namespaceKey: versionGraphNamespaceKey(namespaceForRegistry(GRAPH_REGISTRY as any)),
    documentScopeKey: versionDocumentScopeKey({ documentId: 'document-1' }),
    syncIdentity: keyMaterial.syncIdentity,
    operationContext,
    mutationSegmentDigest: {
      algorithm: 'sha256',
      digest: '2'.repeat(64),
    },
    state: 'pending',
    createdAt: '2026-06-22T00:00:01.000Z',
    updatedAt: '2026-06-22T00:00:01.000Z',
  };
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

  it('fails closed when provider-write activity is missing settled-state evidence', async () => {
    const tracker = {
      readActivity: jest.fn(() => ({
        statusRevision: 'revision:missing-counts',
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
      statusRevision: 'providerActivity:unknown|provider:none',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: expect.objectContaining({
            redacted: true,
            providerPayload: 'activitySnapshot',
            payloadIssue: 'invalidCounts',
          }),
        }),
      ],
    });
  });

  it('fails closed when pending remote records carry stale write identifiers', async () => {
    const staleRecord = {
      ...(await pendingRemoteSegmentRecord()),
      pendingRemoteSegmentId: `pending-remote-segment:sha256:${'9'.repeat(64)}`,
    };
    const { provider } = createProviderWithPendingListResult({
      status: 'success',
      records: [staleRecord],
      diagnostics: [],
    });

    const status = await readVersionPendingProviderWrites(createCtx({ provider }));

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'pendingRemote:unknown',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: expect.objectContaining({
            redacted: true,
            providerPayload: 'pendingRemoteSegmentList',
            payloadIssue: 'staleWriteIdentifier',
            recordIndex: 0,
          }),
        }),
      ],
    });
    expect(status.unsafeReasons[0]?.data).not.toHaveProperty('pendingRemoteSegmentCount');
  });

  it('redacts unsafe provider diagnostic payloads on pending remote read failures', async () => {
    const { provider } = createProviderWithPendingListResult({
      status: 'failed',
      records: [],
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          message: `Provider failed with ${RAW_CURSOR}`,
          recoverability: 'retry',
          details: {
            cursor: RAW_CURSOR,
            batchStatusId: RAW_BATCH_STATUS_ID,
            segmentId: RAW_SEGMENT_ID,
            providerId: 'provider-secret',
            safeCount: 2,
            nested: { secret: 'not-public' },
          },
        },
      ],
    });

    const status = await readVersionPendingProviderWrites(createCtx({ provider }));
    const serialized = JSON.stringify(status);

    expect(status).toMatchObject({
      pendingProviderWrites: true,
      statusRevision: 'pendingRemote:unknown',
      unsafeReasons: [
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: expect.objectContaining({
            redacted: true,
            providerDiagnosticCount: 1,
            providerDiagnosticCode: 'VERSION_PROVIDER_FAILED',
            providerDiagnosticRecoverability: 'retry',
            cursor: 'redacted',
            batchStatusId: 'redacted',
            segmentId: 'redacted',
            providerId: 'redacted',
            safeCount: 2,
          }),
        }),
      ],
    });
    expect(serialized).not.toContain(RAW_CURSOR);
    expect(serialized).not.toContain(RAW_BATCH_STATUS_ID);
    expect(serialized).not.toContain(RAW_SEGMENT_ID);
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('not-public');
  });

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
});
