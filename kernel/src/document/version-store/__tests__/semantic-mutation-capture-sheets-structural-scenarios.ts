import {
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function describeSheetStructuralScenarios(): void {
  it('captures sheet create, remove, copy, and move structural changes', async () => {
    const capture = createTestSemanticMutationCapture();

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
    const capture = createTestSemanticMutationCapture();

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

    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });
}
