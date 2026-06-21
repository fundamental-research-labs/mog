import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import type { VersionGraphNamespace } from '../object-store';
import type { WorkbookCommitId } from '../object-digest';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

describe('semantic mutation capture', () => {
  it('captures only direct cell edits and drains after successful commit finalization', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldFormula: '=1',
              newFormula: '=1+1',
              oldValue: 1,
              value: 2,
              extraFlags: 0,
            },
            {
              cellId: 'cell-b1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 1 },
              oldValue: 10,
              value: 20,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const first = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(first.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
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
    expect(first.input.mutationSegmentRecords).toHaveLength(1);
    expect(first.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      schemaVersion: 1,
      segmentId: 'mutation-1',
      operation: 'compute_batch_set_cells_by_position',
      changeIds: ['mutation-1:cell:0'],
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' }],
    });

    const retryBeforeFinalize = expectCaptureSuccess(
      await capture.captureNormalCommit(captureInput()),
    );
    expect(retryBeforeFinalize.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'failed' });
    const retryAfterFailure = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(retryAfterFailure.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'success', commitId: COMMIT_ID });
    const afterSuccess = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(afterSuccess.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(afterSuccess.input.mutationSegmentRecords).toEqual([]);
  });

  it('captures local sheet renames and skips observer renames without old names', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'name',
            oldName: 'Sheet1',
            name: 'Forecast',
          },
          {
            sheetId: 'sheet-2',
            kind: 'Set',
            field: 'name',
            name: 'RemoteOnly',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['name'],
          },
          before: { kind: 'value', value: 'Sheet1' },
          after: { kind: 'value', value: 'Forecast' },
          display: { entityLabel: { kind: 'value', value: 'Forecast' } },
        },
      ],
    });
  });

  it('captures direct sheet tab color changes and skips empty tab color records', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_tab_color',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'tabColor',
            oldColor: '#FF0000',
            color: '#00FF00',
          },
          {
            sheetId: 'sheet-2',
            kind: 'Set',
            field: 'tabColor',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_tab_color',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'tabColor',
            oldColor: '#00FF00',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['tabColor'],
          },
          before: { kind: 'value', value: '#FF0000' },
          after: { kind: 'value', value: '#00FF00' },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['tabColor'],
          },
          before: { kind: 'value', value: '#00FF00' },
          after: { kind: 'value', value: null },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_set_tab_color',
        changeIds: ['mutation-1:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_set_tab_color',
        changeIds: ['mutation-2:sheet:0'],
      }),
    ]);
  });

  it('captures sheet create, remove, copy, and move structural changes', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'sheet',
            name: 'Forecast',
            index: 1,
          },
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'name',
            name: 'Forecast',
          },
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'order',
            index: 1,
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_delete_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-deleted',
            kind: 'Removed',
            field: 'sheet',
            name: 'Scratch',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_copy_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-copy',
            kind: 'Set',
            field: 'sheet',
            name: 'Forecast Copy',
            index: 2,
            sourceSheetId: 'sheet-created',
          },
          {
            sheetId: 'sheet-copy',
            kind: 'Set',
            field: 'order',
            index: 2,
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'order',
            oldIndex: 1,
            index: 0,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-created',
            propertyPath: ['sheet'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Forecast' },
                { key: 'index', value: 1 },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'Forecast' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-deleted',
            propertyPath: ['sheet'],
          },
          before: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [{ key: 'name', value: 'Scratch' }],
            },
          },
          after: { kind: 'value', value: null },
          display: { entityLabel: { kind: 'value', value: 'Scratch' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-3:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-copy',
            propertyPath: ['sheet'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Forecast Copy' },
                { key: 'index', value: 2 },
                { key: 'sourceSheetId', value: 'sheet-created' },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'Forecast Copy' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-4:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-created',
            propertyPath: ['order'],
          },
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 0 },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_create_sheet_with_default_col_width',
        changeIds: ['mutation-1:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_delete_sheet',
        changeIds: ['mutation-2:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-3',
        operation: 'compute_copy_sheet',
        changeIds: ['mutation-3:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-4',
        operation: 'compute_move_sheet',
        changeIds: ['mutation-4:sheet:0'],
      }),
    ]);
  });

  it('skips sheet structural records without stable identity or before/after evidence', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-index',
            kind: 'Set',
            field: 'sheet',
            name: 'No Index',
          },
          {
            sheetId: 'sheet-ambiguous-copy',
            kind: 'Set',
            field: 'sheet',
            name: 'Ambiguous',
            index: 1,
            sourceSheetId: 'source-sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_delete_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-name',
            kind: 'Removed',
            field: 'sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_copy_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Missing Source',
            index: 2,
          },
          {
            sheetId: 'sheet-empty-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Empty Source',
            index: 3,
            sourceSheetId: '',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-old-index',
            kind: 'Set',
            field: 'order',
            index: 0,
          },
          {
            sheetId: 'sheet-not-found-before',
            kind: 'Set',
            field: 'order',
            oldIndex: -1,
            index: 0,
          },
          {
            sheetId: '',
            kind: 'Set',
            field: 'order',
            oldIndex: 0,
            index: 1,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(captured.input.mutationSegmentRecords).toEqual([]);
  });

  it('captures direct date and time value writes', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_date_value',
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-c2',
              sheetId: 'sheet-1',
              position: { row: 1, col: 2 },
              oldValue: null,
              value: 45291,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_time_value',
      directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-d3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 3 },
              oldValue: null,
              value: 0.5,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
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
  });
});

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function captureInput(): VersionNormalCommitCaptureInput {
  return { namespace: NAMESPACE } as VersionNormalCommitCaptureInput;
}

function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}
