import type { VersionRecordRevision, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { CommitVersionGraphInput } from '../../../document/version-store/graph';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionGraphStore } from '../../../document/version-store/provider-graph-store';
import {
  AUTHOR,
  CREATED_AT,
  type VersionGraphWriteSuccess,
} from './version-apply-merge-idempotency-stale-ordering-helpers-core';
import { expectGraphWriteSuccess } from './version-apply-merge-idempotency-stale-ordering-helpers-expectations';

export async function commitGraph(
  graph: VersionGraphStore,
  namespace: VersionGraphNamespace,
  input: {
    readonly label: string;
    readonly targetRef: string;
    readonly expectedHeadCommitId: WorkbookCommitId;
    readonly expectedTargetRefVersion: VersionRecordRevision;
    readonly parentCommitIds: readonly WorkbookCommitId[];
  },
): Promise<VersionGraphWriteSuccess> {
  const commit = await graph.commit({
    ...(await graphCommitContent(namespace, input.label)),
    targetRef: input.targetRef,
    expectedHeadCommitId: input.expectedHeadCommitId,
    expectedTargetRefVersion: input.expectedTargetRefVersion,
    parentCommitIds: input.parentCommitIds,
  } satisfies CommitVersionGraphInput);
  expectGraphWriteSuccess(commit);
  return commit;
}

export async function graphCommitContent(
  namespace: VersionGraphNamespace,
  label: string,
): Promise<
  Pick<
    CommitVersionGraphInput,
    | 'snapshotRootRecord'
    | 'semanticChangeSetRecord'
    | 'mutationSegmentRecords'
    | 'author'
    | 'createdAt'
    | 'completenessDiagnostics'
  >
> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      label,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  };
}

export async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
