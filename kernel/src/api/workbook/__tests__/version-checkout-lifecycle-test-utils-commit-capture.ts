import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';

import { CREATED_AT, VERSION_AUTHOR } from './version-checkout-lifecycle-test-utils-constants';
import { objectRecord } from './version-checkout-lifecycle-test-utils-records';

export function createCellEditNormalCommitCapture(input: {
  readonly address: 'A1' | 'B1';
  readonly value: string;
  readonly label: string;
  readonly onCapture?: () => void;
}): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => {
    input.onCapture?.();
    const semanticChange = {
      structural: {
        kind: 'metadata',
        changeId: `${input.address.toLowerCase()}-${input.value}`,
        domain: 'cell',
        entityId: `Sheet1!${input.address}`,
        propertyPath: ['value'],
      },
      before: { kind: 'value', value: null },
      after: { kind: 'value', value: input.value },
      display: { address: { kind: 'value', value: input.address } },
    };
    return {
      status: 'success',
      input: {
        semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
          schemaVersion: 1,
          label: input.label,
          changes: [semanticChange],
          reviewChanges: [semanticChange],
        }),
        mutationSegmentRecords: [
          await objectRecord(namespace, 'workbook.mutationSegment.v1', {
            segmentId: `${input.address.toLowerCase()}-${input.value}`,
            baseCommitId: currentRef.commitId,
            operations: [
              {
                operation: 'worksheet.setCell',
                sheet: 'Sheet1',
                address: input.address,
                value: input.value,
              },
            ],
          }),
        ],
        author: VERSION_AUTHOR,
        createdAt: CREATED_AT,
        completenessDiagnostics: [],
      },
    };
  };
}
