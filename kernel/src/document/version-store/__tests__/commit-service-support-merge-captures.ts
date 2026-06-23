import type { VersionMergeChange } from '@mog-sdk/contracts/api';

import type { VersionMergeCommitCapture } from '../commit-service';

import { CREATED_AT, VERSION_AUTHOR, objectRecord } from './commit-service-support-fixtures';

export function createMergeCommitCapture(label: string): VersionMergeCommitCapture {
  return async ({ namespace, currentRef, base, ours, theirs, changes, resolutionCount }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        base,
        ours,
        theirs,
        target: currentRef.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes,
        resolutionCount,
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: base,
          oursCommitId: ours,
          theirsCommitId: theirs,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}

export function mergeChange(changeId: string): VersionMergeChange {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    },
    base: { kind: 'value', value: 'base' },
    ours: { kind: 'value', value: 'ours' },
    theirs: { kind: 'value', value: 'theirs' },
    merged: { kind: 'value', value: 'theirs' },
  };
}
