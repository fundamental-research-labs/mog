import type {
  PendingRemoteSegmentOperationContext,
  ReservePendingRemoteSegmentInput,
} from '../pending-remote-segment-store';
import { pendingRemoteSegmentKeyMaterialForOperationContext } from '../pending-remote-segment-store';
import type { VersionGraphNamespace, VersionObjectRecord } from '../object-store';
import { objectRecord } from './pending-remote-segment-store-fixtures-objects';
import { syncOperationContext } from './pending-remote-segment-store-fixtures-operation-context';

export type PendingSegmentFixture = {
  readonly input: ReservePendingRemoteSegmentInput;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
};

export async function pendingSegmentFixture(
  namespace: VersionGraphNamespace,
  options: {
    readonly createdAt?: string;
    readonly includeSnapshotRoot?: boolean;
    readonly payloadHash?: string;
    readonly updateId?: string;
  } = {},
): Promise<PendingSegmentFixture> {
  const operationContext: PendingRemoteSegmentOperationContext = syncOperationContext({
    payloadHash: options.payloadHash,
    updateId: options.updateId,
  });
  const keys = await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext);
  const snapshotRootRecord = await objectRecord(
    'workbook.snapshotRoot.v1',
    { snapshotId: 'remote-boundary-snapshot-1', sheets: [] },
    namespace,
  );
  const semanticChangeSetRecord = await objectRecord(
    'workbook.semanticChangeSet.v1',
    { schemaVersion: 1, changes: [] },
    namespace,
  );
  const mutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    { segmentId: 'remote-segment-1', domainId: 'runtime-diagnostics' },
    namespace,
  );
  return {
    input: {
      pendingRemoteSegmentId: keys.pendingRemoteSegmentId,
      idempotencyKey: keys.idempotencyKey,
      operationContext,
      mutationSegmentDigest: mutationSegmentRecord.digest,
      ...(options.includeSnapshotRoot ? { snapshotRootDigest: snapshotRootRecord.digest } : {}),
      semanticChangeSetDigest: semanticChangeSetRecord.digest,
      createdAt: options.createdAt ?? '2026-06-21T00:00:00.000Z',
    },
    objectRecords: [
      ...(options.includeSnapshotRoot ? [snapshotRootRecord] : []),
      semanticChangeSetRecord,
      mutationSegmentRecord,
    ],
  };
}
