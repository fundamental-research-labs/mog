import { expect, it, jest } from '@jest/globals';

import { readVersionPendingProviderWrites } from '../version/pending/provider-writes';
import {
  createCtx,
  createProviderWithPendingListResult,
  GRAPH_REGISTRY,
  pendingRemoteSegmentRecord,
  RAW_BATCH_STATUS_ID,
  RAW_CURSOR,
  RAW_SEGMENT_ID,
} from './version-pending-provider-writes-test-utils';

export function registerPendingProviderWritesPersistedScenarios(): void {
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
}
