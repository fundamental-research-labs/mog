import type { PendingRemoteSegmentStore } from '../pending-remote-segment-store';
import type { VersionGraphNamespace } from '../object-store';
import type { VersionGraphStore } from '../provider';
import {
  objectRecord,
  pendingSegmentFixture,
  type PendingSegmentFixture,
} from './pending-remote-promotion-service.test-helpers';

type GroupedPendingSegmentsFixtureOptions = {
  readonly groupId: string;
  readonly firstPayloadHash: string;
  readonly secondPayloadHash: string;
};

type GroupedPendingSegmentsFixture = {
  readonly first: PendingSegmentFixture;
  readonly second: PendingSegmentFixture;
};

export async function groupedPendingSegmentsFixture(
  namespace: VersionGraphNamespace,
  options: GroupedPendingSegmentsFixtureOptions,
): Promise<GroupedPendingSegmentsFixture> {
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
    groupId: options.groupId,
    mutationSegmentId: 'remote-segment-1',
    payloadHash: options.firstPayloadHash,
    sequence: '1',
    sharedSnapshotRootRecord: snapshotRootRecord,
    sharedSemanticChangeSetRecord: semanticChangeSetRecord,
    updateId: 'remote-update-1',
  });
  const second = await pendingSegmentFixture(namespace, {
    createdAt: '2026-06-21T00:00:02.000Z',
    groupId: options.groupId,
    mutationSegmentId: 'remote-segment-2',
    payloadHash: options.secondPayloadHash,
    sequence: '2',
    sharedSnapshotRootRecord: snapshotRootRecord,
    sharedSemanticChangeSetRecord: semanticChangeSetRecord,
    updateId: 'remote-update-2',
  });
  return { first, second };
}

export async function persistGroupedPendingSegments(
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: GroupedPendingSegmentsFixture,
): Promise<void> {
  await expect(
    graph.putObjects([...fixture.first.objectRecords, ...fixture.second.objectRecords]),
  ).resolves.toMatchObject({
    status: 'success',
  });
  await expect(store.reserveSegment(fixture.first.input)).resolves.toMatchObject({
    status: 'created',
  });
  await expect(store.reserveSegment(fixture.second.input)).resolves.toMatchObject({
    status: 'created',
  });
}
