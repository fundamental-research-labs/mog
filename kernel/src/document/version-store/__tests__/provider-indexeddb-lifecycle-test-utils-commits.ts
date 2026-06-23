import type { VersionNormalCommitCapture } from '../commit-service';
import { objectRecord, rootWrite } from './provider-indexeddb-test-utils';

export const captureNormalCommit: VersionNormalCommitCapture = async ({ namespace, options }) => {
  const label = options.message ?? 'normal commit';
  return {
    status: 'success',
    input: {
      ...(await rootWrite(label, namespace)),
      mutationSegmentRecords: [
        await objectRecord('workbook.mutationSegment.v1', { label, operations: [] }, namespace),
      ],
    },
  };
};
