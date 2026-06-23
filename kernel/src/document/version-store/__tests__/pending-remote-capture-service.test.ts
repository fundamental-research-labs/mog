import {
  capturePendingRemoteSemanticMutations,
  type PendingRemoteSemanticMutationCaptureRecord,
} from '../pending-remote-capture-service';
import {
  createPendingRemoteCaptureFixture,
  createPendingRemoteCaptureFixtureWithSegmentStore,
  expectMutationSegmentHasNoRawProviderIdentity,
  expectNoRawProviderIdentity,
  failingReadPendingRemoteSegmentStore,
  pendingRemoteOperationContext,
  semanticChange,
} from './pending-remote-capture-service-test-utils';

describe('pending remote capture service', () => {
  it('captures by sanitized stable remote identity across raw provider local echoes', async () => {
    const { provider, namespace, graph, registry, pendingRemoteSegmentStore } =
      await createPendingRemoteCaptureFixtureWithSegmentStore();

    const recordedContext = pendingRemoteOperationContext({
      operationId: 'operation-recorded',
      providerId: 'provider-raw-a',
      authorityRef: 'authority-raw-a',
      remoteSessionId: 'remote-session-raw-a',
      correlationId: 'correlation-raw-a',
      causationIds: ['cause-raw-a'],
    });
    const echoContext = pendingRemoteOperationContext({
      operationId: 'operation-local-echo',
      providerId: 'provider-raw-b',
      authorityRef: 'authority-raw-b',
      remoteSessionId: 'remote-session-raw-b',
      correlationId: 'correlation-raw-b',
      causationIds: ['cause-raw-b'],
    });
    const records: readonly PendingRemoteSemanticMutationCaptureRecord[] = [
      {
        sequence: 1,
        operation: 'compute_apply_sync_update',
        capturedAt: recordedContext.createdAt,
        operationContext: recordedContext,
        changes: [semanticChange('change-1')],
      },
    ];

    const first = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext: echoContext,
      },
      records,
      mutationSegmentPayload: (record) => ({
        schemaVersion: 1,
        operationContext: record.operationContext,
      }),
    });

    expect(first.status).toBe('success');
    if (first.status !== 'success') throw new Error('expected first capture success');
    expect(first.reservationStatus).toBe('created');
    expect(first.capturedRecordSequences).toEqual([1]);
    expectNoRawProviderIdentity(first.record.operationContext.collaboration);
    expect(first.record.syncIdentity).not.toHaveProperty('providerId');
    expect(first.record.syncIdentity).not.toHaveProperty('authorityRef');
    expectMutationSegmentHasNoRawProviderIdentity(first.objectRecords?.mutationSegmentRecord);

    const second = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore,
        operationContext: pendingRemoteOperationContext({
          operationId: 'operation-local-echo-2',
          providerId: 'provider-raw-c',
          authorityRef: 'authority-raw-c',
          remoteSessionId: 'remote-session-raw-c',
          correlationId: 'correlation-raw-c',
          causationIds: ['cause-raw-c'],
        }),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(second).toMatchObject({
      status: 'success',
      reservationStatus: 'existing',
      record: { pendingRemoteSegmentId: first.record.pendingRemoteSegmentId },
      capturedRecordSequences: [],
    });
  });

  it('redacts raw provider identity from pending remote capture diagnostics', async () => {
    const { provider, namespace, graph, registry } = await createPendingRemoteCaptureFixture();

    const result = await capturePendingRemoteSemanticMutations({
      capture: {
        provider,
        graph,
        accessContext: provider.accessContext,
        namespace,
        registry,
        pendingRemoteSegmentStore: failingReadPendingRemoteSegmentStore(namespace),
        operationContext: pendingRemoteOperationContext(),
      },
      records: [],
      mutationSegmentPayload: (record) => record,
    });

    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: [
        {
          code: 'VERSION_PROVIDER_FAILED',
          details: { stableDetail: 'kept' },
        },
      ],
    });
    if (result.status !== 'failed') throw new Error('expected failed capture');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('providerId');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('providerRefId');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('authorityRef');
    expect(result.diagnostics[0]?.details).not.toHaveProperty('remoteSessionId');
  });
});
