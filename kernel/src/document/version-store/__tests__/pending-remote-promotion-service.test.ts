import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createVersionProviderWriteActivityTracker } from '../provider-write-activity';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  deferred,
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  expectSingleCommit,
  initializeProvider,
  markSyncBatchFailed,
  objectRecord,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
  providerWithCommitConflict,
  providerWithCompletionFailures,
  providerWithGatedCommit,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it('promotes a pending remote segment into a graph commit and completes it', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
      skipped: [],
    });
    const commitId = expectSingleCommit(result.commitIds);
    const readCommit = await graph.readCommit(commitId);
    expect(readCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          author: fixture.input.operationContext.author,
          createdAt: fixture.input.operationContext.createdAt,
          snapshotRootDigest: fixture.input.snapshotRootDigest,
          semanticChangeSetDigest: fixture.input.semanticChangeSetDigest,
          mutationSegmentDigests: [fixture.input.mutationSegmentDigest],
        },
      },
    });
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'promoted',
        updatedAt: PROMOTION_NOW.toISOString(),
        terminal: { status: 'promoted', commitId },
      },
    });
  });

  it.each([
    ['unknown', { authorityRef: null }, 'provider-authority-unknown', null, []],
    ['stale', { epoch: null }, 'provider-authority-stale', null, []],
    [
      'malformed readback',
      {
        collaboration: {
          validationDiagnosticCount: 0,
          exclusionReason: 'provider-secret-ref',
          exclusionSubreason: 'raw-authority-id',
        },
      },
      'provider-authority-unknown',
      {
        gate: 'provider-cycle-readback',
        field: 'exclusionReason',
        expected: 'absent-when-validation-clean',
        malformed: true,
      },
      ['provider-secret-ref', 'raw-authority-id', 'provider-1', 'authority-1'],
    ],
  ] as const)(
    'skips %s provider authority before creating a graph commit',
    async (_label, options, reason, expectedDetails, redactedRawIds) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const namespace = await initializeProvider(provider, `graph-${reason}`);
      const graph = await provider.openGraph(namespace);
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const fixture = await pendingSegmentFixture(namespace, options);
      await persistAndReservePendingSegment(graph, store, fixture);
      const headBefore = await expectReadHeadSuccess(graph);

      const result = await createPendingRemotePromotionService({
        provider,
        now: () => PROMOTION_NOW,
      }).promotePendingRemoteSegments();

      expect(result).toMatchObject({
        status: 'failed',
        commitIds: [],
        skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason }],
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
            reason,
            ...(expectedDetails === null
              ? {}
              : { details: expect.objectContaining(expectedDetails) }),
          }),
        ],
      });
      for (const raw of redactedRawIds) expect(JSON.stringify(result)).not.toContain(raw);
      await expectGraphHead(graph, headBefore);
      await expect(
        store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
      ).resolves.toMatchObject({ status: 'found', record: { state: 'pending' } });
    },
  );

  it('promotes explicit grouped segments together with deterministic metadata', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const snapshotRootRecord = await objectRecord(
      'workbook.snapshotRoot.v1',
      { sheets: [] },
      namespace,
    );
    const semanticChangeSetRecord = await objectRecord(
      'workbook.semanticChangeSet.v1',
      { schemaVersion: 1, changes: [{ id: 'remote-change-1' }, { id: 'remote-change-2' }] },
      namespace,
    );
    const first = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:03.000Z',
      groupId: 'remote-group-1',
      mutationSegmentId: 'remote-segment-1',
      payloadHash: '3'.repeat(64),
      sequence: '1',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-1',
    });
    const second = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      groupId: 'remote-group-1',
      mutationSegmentId: 'remote-segment-2',
      payloadHash: '4'.repeat(64),
      sequence: '2',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-2',
    });
    await expect(
      graph.putObjects([...first.objectRecords, ...second.objectRecords]),
    ).resolves.toMatchObject({
      status: 'success',
    });
    await expect(store.reserveSegment(first.input)).resolves.toMatchObject({ status: 'created' });
    await expect(store.reserveSegment(second.input)).resolves.toMatchObject({ status: 'created' });

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(result.commitIds);
    expect(result).toMatchObject({
      status: 'success',
      promotedSegmentIds: [second.input.pendingRemoteSegmentId, first.input.pendingRemoteSegmentId],
      skipped: [],
    });
    const readCommit = await graph.readCommit(commitId);
    expect(readCommit).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          createdAt: second.input.operationContext.createdAt,
          mutationSegmentDigests: [
            second.input.mutationSegmentDigest,
            first.input.mutationSegmentDigest,
          ],
        },
      },
    });
    await expect(store.readBySegmentId(first.input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { terminal: { commitId } },
    });
    await expect(store.readBySegmentId(second.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { terminal: { commitId } },
      },
    );
  });

  it('recovers an already-created promotion commit when completion failed', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);

    const first = await createPendingRemotePromotionService({
      provider: providerWithCompletionFailures(provider, (attempt) => attempt === 1),
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(first.commitIds);
    expect(first).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [
        {
          segmentId: fixture.input.pendingRemoteSegmentId,
          reason: 'completion-failed',
          commitId,
        },
      ],
    });
    const headAfterFirst = await expectReadHeadSuccess(graph);
    expect(headAfterFirst.commitId).toBe(commitId);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });

    const second = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(second).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
      commitIds: [commitId],
      skipped: [],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED' }],
    });
    await expectGraphHead(graph, headAfterFirst);
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: {
        state: 'promoted',
        terminal: {
          status: 'promoted',
          commitId,
          promotionDigest: { algorithm: 'sha256', digest: expect.any(String) },
        },
      },
    });
  });

  it('recovers remaining grouped segments from a promoted peer without a replacement commit', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const snapshotRootRecord = await objectRecord(
      'workbook.snapshotRoot.v1',
      { sheets: [] },
      namespace,
    );
    const semanticChangeSetRecord = await objectRecord(
      'workbook.semanticChangeSet.v1',
      { schemaVersion: 1, changes: [{ id: 'remote-change-1' }, { id: 'remote-change-2' }] },
      namespace,
    );
    const first = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:03.000Z',
      groupId: 'remote-group-recovery',
      mutationSegmentId: 'remote-segment-1',
      payloadHash: '5'.repeat(64),
      sequence: '1',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-1',
    });
    const second = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      groupId: 'remote-group-recovery',
      mutationSegmentId: 'remote-segment-2',
      payloadHash: '6'.repeat(64),
      sequence: '2',
      sharedSnapshotRootRecord: snapshotRootRecord,
      sharedSemanticChangeSetRecord: semanticChangeSetRecord,
      updateId: 'remote-update-2',
    });
    await expect(
      graph.putObjects([...first.objectRecords, ...second.objectRecords]),
    ).resolves.toMatchObject({
      status: 'success',
    });
    await expect(store.reserveSegment(first.input)).resolves.toMatchObject({ status: 'created' });
    await expect(store.reserveSegment(second.input)).resolves.toMatchObject({ status: 'created' });

    const firstRun = await createPendingRemotePromotionService({
      provider: providerWithCompletionFailures(provider, (attempt) => attempt === 2),
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    const commitId = expectSingleCommit(firstRun.commitIds);
    expect(firstRun).toMatchObject({
      status: 'partial',
      promotedSegmentIds: [second.input.pendingRemoteSegmentId],
      skipped: [
        {
          segmentId: first.input.pendingRemoteSegmentId,
          reason: 'completion-failed',
          commitId,
        },
      ],
    });
    const headAfterFirst = await expectReadHeadSuccess(graph);
    expect(headAfterFirst.commitId).toBe(commitId);

    const secondRun = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(secondRun).toMatchObject({
      status: 'success',
      promotedSegmentIds: [first.input.pendingRemoteSegmentId],
      commitIds: [commitId],
      skipped: [],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_RECOVERED' }],
    });
    await expectGraphHead(graph, headAfterFirst);
    await expect(store.readBySegmentId(first.input.pendingRemoteSegmentId)).resolves.toMatchObject({
      status: 'found',
      record: { terminal: { commitId } },
    });
    await expect(store.readBySegmentId(second.input.pendingRemoteSegmentId)).resolves.toMatchObject(
      {
        status: 'found',
        record: { terminal: { commitId } },
      },
    );
  });

  it('skips missing snapshot roots and missing required objects without mutating refs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const missingSnapshotDigest = await pendingSegmentFixture(namespace, {
      includeSnapshotRoot: false,
      updateId: 'remote-update-missing-snapshot-digest',
    });
    await persistAndReservePendingSegment(graph, store, missingSnapshotDigest);
    const missingSnapshotObject = await pendingSegmentFixture(namespace, {
      updateId: 'remote-update-missing-snapshot-object',
    });
    await graph.putObjects(
      missingSnapshotObject.objectRecords.filter(
        (record) => record.preimage.objectType !== 'workbook.snapshotRoot.v1',
      ),
    );
    await expect(store.reserveSegment(missingSnapshotObject.input)).resolves.toMatchObject({
      status: 'created',
    });
    const headBefore = await expectReadHeadSuccess(graph);

    const result = await createPendingRemotePromotionService({
      provider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result.status).toBe('failed');
    expect(result.commitIds).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segmentId: missingSnapshotDigest.input.pendingRemoteSegmentId,
          reason: 'missing-snapshot-root',
        }),
        expect.objectContaining({
          segmentId: missingSnapshotObject.input.pendingRemoteSegmentId,
          reason: 'missing-required-object',
        }),
      ]),
    );
    await expectGraphHead(graph, headBefore);
    await expect(
      store.readBySegmentId(missingSnapshotDigest.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
    await expect(
      store.readBySegmentId(missingSnapshotObject.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('leaves pending records pending when the visible graph ref conflicts', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const conflictProvider = providerWithCommitConflict(provider, namespace);

    const result = await createPendingRemotePromotionService({
      provider: conflictProvider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason: 'graph-write-failed' }],
      diagnostics: [
        {
          code: 'VERSION_PENDING_REMOTE_PROMOTION_GRAPH_WRITE_FAILED',
          sourceDiagnostics: [{ code: 'VERSION_REF_CONFLICT' }],
        },
      ],
    });
    await expect(
      store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('blocks failed sync batches and allows absent batch status records', async () => {
    const absentProvider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const absentNamespace = await initializeProvider(absentProvider, 'graph-absent-batch');
    const absentGraph = await absentProvider.openGraph(absentNamespace);
    const absentStore = await absentProvider.openPendingRemoteSegmentStore(absentNamespace);
    const absentFixture = await pendingSegmentFixture(absentNamespace);
    await persistAndReservePendingSegment(absentGraph, absentStore, absentFixture);
    await expect(
      createPendingRemotePromotionService({
        provider: absentProvider,
        now: () => PROMOTION_NOW,
      }).promotePendingRemoteSegments(),
    ).resolves.toMatchObject({
      status: 'success',
      promotedSegmentIds: [absentFixture.input.pendingRemoteSegmentId],
      skipped: [],
    });

    const failedProvider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const failedNamespace = await initializeProvider(failedProvider, 'graph-failed-batch');
    const failedGraph = await failedProvider.openGraph(failedNamespace);
    const failedStore = await failedProvider.openPendingRemoteSegmentStore(failedNamespace);
    const failedFixture = await pendingSegmentFixture(failedNamespace);
    await persistAndReservePendingSegment(failedGraph, failedStore, failedFixture);
    await markSyncBatchFailed(failedProvider, failedFixture.input.operationContext);

    const result = await createPendingRemotePromotionService({
      provider: failedProvider,
      now: () => PROMOTION_NOW,
    }).promotePendingRemoteSegments();

    expect(result).toMatchObject({
      status: 'failed',
      promotedSegmentIds: [],
      skipped: [
        {
          segmentId: failedFixture.input.pendingRemoteSegmentId,
          reason: 'batch-status-terminal',
        },
      ],
      diagnostics: [{ code: 'VERSION_PENDING_REMOTE_PROMOTION_BATCH_BLOCKED' }],
    });
    await expect(
      failedStore.readBySegmentId(failedFixture.input.pendingRemoteSegmentId),
    ).resolves.toMatchObject({
      status: 'found',
      record: { state: 'pending' },
    });
  });

  it('serializes concurrent promotions and reports active promotion activity', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const graph = await provider.openGraph(namespace);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    await persistAndReservePendingSegment(graph, store, fixture);
    const commitGate = deferred<void>();
    let commitAttempts = 0;
    const providerWriteActivityTracker = createVersionProviderWriteActivityTracker();
    const service = createPendingRemotePromotionService({
      provider: providerWithGatedCommit(provider, {
        beforeCommit: () => {
          commitAttempts += 1;
          commitGate.start();
          return commitGate.promise;
        },
      }),
      providerWriteActivityTracker,
      now: () => PROMOTION_NOW,
    });

    const first = service.promotePendingRemoteSegments();
    await commitGate.started;
    const second = service.promotePendingRemoteSegments();
    await Promise.resolve();

    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 1,
      pendingRemotePromotionQueuedCount: 1,
    });

    commitGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [fixture.input.pendingRemoteSegmentId],
    });
    expect(secondResult).toMatchObject({
      status: 'success',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [],
      diagnostics: [],
    });
    expect(commitAttempts).toBe(1);
    expect(providerWriteActivityTracker.readActivity()).toMatchObject({
      pendingRemotePromotionActiveCount: 0,
      pendingRemotePromotionQueuedCount: 0,
    });
  });
});
