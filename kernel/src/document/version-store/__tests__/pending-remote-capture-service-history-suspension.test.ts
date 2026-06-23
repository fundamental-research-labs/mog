import { capturePendingRemoteSemanticMutations } from '../pending-remote-capture-service';
import {
  createPendingRemoteCaptureFixture,
  createPendingRemoteCaptureFixtureWithSegmentStore,
  expectHistorySuspensionMutationSegment,
  expectNoRawProviderIdentity,
  failingReservePendingRemoteSegmentStore,
  graphWithObjectWriteFailure,
  pendingRemoteOperationContext,
} from './pending-remote-capture-service-test-utils';

describe('pending remote capture service history suspension', () => {
  it('persists a verified history-suspension marker when no matching semantic mutations exist', async () => {
    const { provider, namespace, graph, registry, pendingRemoteSegmentStore } =
      await createPendingRemoteCaptureFixtureWithSegmentStore();
    const operationContext = pendingRemoteOperationContext({
      operationId: 'operation-history-suspension',
      collaboration: {
        updateId: 'remote-update-history-suspension',
        payloadHash: '6'.repeat(64),
      },
    });

    const result = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext,
        snapshotRootByteSyncPort: {
          encodeDiff: async () => new Uint8Array([0x01, 0x02, 0x03]),
        },
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(result).toMatchObject({
      status: 'success',
      reservationStatus: 'created',
      capturedRecordSequences: [],
      historySuspension: {
        status: 'verified',
        reason: 'no-matching-semantic-mutations',
        capturePolicy: 'historyGap',
        writeAdmissionMode: 'captureSuspendedWithGap',
      },
      record: {
        operationContext: {
          capturePolicy: 'historyGap',
          writeAdmissionMode: 'captureSuspendedWithGap',
        },
      },
    });
    if (result.status !== 'success') throw new Error('expected history-suspension marker');
    expectNoRawProviderIdentity(result.record.operationContext.collaboration);
    expectHistorySuspensionMutationSegment(result.objectRecords?.mutationSegmentRecord);
    await expect(
      pendingRemoteSegmentStore.readBySegmentId(result.record.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        pendingRemoteSegmentId: result.record.pendingRemoteSegmentId,
        state: 'pending',
        operationContext: {
          capturePolicy: 'historyGap',
          writeAdmissionMode: 'captureSuspendedWithGap',
        },
      },
    });
  });

  it('fails closed with redacted diagnostics when verified marker object writes fail', async () => {
    const { provider, namespace, graph, registry, pendingRemoteSegmentStore } =
      await createPendingRemoteCaptureFixtureWithSegmentStore();

    const result = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph: graphWithObjectWriteFailure(graph),
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext: pendingRemoteOperationContext({
          operationId: 'operation-object-write-failure',
          collaboration: {
            updateId: 'remote-update-object-write-failure',
            payloadHash: '7'.repeat(64),
          },
        }),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(result).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-objects-written',
      retryable: true,
      diagnostics: [
        {
          code: 'VERSION_OBJECT_STORE_FAILURE',
          source: 'objectStore',
          details: {
            sourceCode: 'VERSION_STORE_UNAVAILABLE',
            objectType: 'workbook.mutationSegment.v1',
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('provider-raw');
    expect(JSON.stringify(result)).not.toContain('authority-raw');
    expect(JSON.stringify(result)).not.toContain('remote-session-raw');
  });

  it('fails closed with redacted diagnostics when verified marker reservation fails', async () => {
    const { provider, namespace, graph, registry } = await createPendingRemoteCaptureFixture();

    const result = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore: failingReservePendingRemoteSegmentStore(namespace),
        operationContext: pendingRemoteOperationContext({
          operationId: 'operation-reservation-failure',
          collaboration: {
            updateId: 'remote-update-reservation-failure',
            payloadHash: '8'.repeat(64),
          },
        }),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(result).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'objects-written-segment-not-reserved',
      retryable: true,
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          source: 'pendingRemoteSegmentStore',
          details: { stableDetail: 'kept' },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('provider-raw');
    expect(JSON.stringify(result)).not.toContain('ProviderA');
    expect(JSON.stringify(result)).not.toContain('authority-raw');
    expect(JSON.stringify(result)).not.toContain('remote-session-raw');
  });
});
