import type { VersionNormalCommitCaptureResult } from '../commit-service';
import type { CoreMutationCaptureContext } from './semantic-mutation-capture-core-setup';
import {
  COMMIT_ID,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
} from './semantic-mutation-capture-test-helpers';

type CapturedNormalCommit = Extract<VersionNormalCommitCaptureResult, { status: 'success' }>;

export async function expectCapturedCoreCommit(
  context: CoreMutationCaptureContext,
): Promise<CapturedNormalCommit> {
  return expectCaptureSuccess(await context.captureCommit());
}

export function expectDirectCellEditCapture(captured: CapturedNormalCommit): void {
  expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
    schemaVersion: 1,
    source: { kind: 'rustSemanticDiff' },
    reviewChanges: [
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-1:cell:0',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
        before: { kind: 'value', value: { kind: 'formula', formula: '=1', result: 1 } },
        after: { kind: 'value', value: { kind: 'formula', formula: '=1+1', result: 2 } },
        display: { address: { kind: 'value', value: 'A1' } },
      },
    ],
  });
  expect(captured.input.mutationSegmentRecords).toHaveLength(1);
  expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
    schemaVersion: 1,
    segmentId: 'mutation-1',
    operation: 'compute_batch_set_cells_by_position',
    changeIds: ['mutation-1:cell:0'],
    directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' }],
  });
}

export async function expectDirectCellEditLifecycleDrainsAfterSuccessfulFinalize(
  context: CoreMutationCaptureContext,
  first: CapturedNormalCommit,
): Promise<void> {
  const retryBeforeFinalize = await expectCapturedCoreCommit(context);
  expect(retryBeforeFinalize.input.mutationSegmentRecords).toHaveLength(1);

  first.finalize?.({ status: 'failed' });
  const retryAfterFailure = await expectCapturedCoreCommit(context);
  expect(retryAfterFailure.input.mutationSegmentRecords).toHaveLength(1);

  first.finalize?.({ status: 'success', commitId: COMMIT_ID });
  expectCaptureMissingChangeSet(await context.captureCommit());
}

export function expectDateAndTimeValueWriteCapture(captured: CapturedNormalCommit): void {
  expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
    schemaVersion: 1,
    source: { kind: 'rustSemanticDiff' },
    reviewChanges: [
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-1:cell:0',
          domain: 'cell',
          entityId: 'sheet-1!C2',
          propertyPath: ['value'],
        },
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 45291 },
        display: { address: { kind: 'value', value: 'C2' } },
      },
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-2:cell:0',
          domain: 'cell',
          entityId: 'sheet-1!D3',
          propertyPath: ['value'],
        },
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 0.5 },
        display: { address: { kind: 'value', value: 'D3' } },
      },
    ],
  });
  expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
    expect.objectContaining({
      segmentId: 'mutation-1',
      operation: 'compute_set_date_value',
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2, address: 'C2' }],
    }),
    expect.objectContaining({
      segmentId: 'mutation-2',
      operation: 'compute_set_time_value',
      directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3, address: 'D3' }],
    }),
  ]);
}
