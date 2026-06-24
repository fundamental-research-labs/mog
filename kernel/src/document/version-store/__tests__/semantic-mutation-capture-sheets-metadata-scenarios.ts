import {
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function describeSheetMetadataScenarios(): void {
  it('captures local sheet renames and skips observer renames without old names', async () => {
    const capture = createTestSemanticMutationCapture();

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
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: [
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
    const capture = createTestSemanticMutationCapture();

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
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: [
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
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual(
      [
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
      ],
    );
  });

  it('captures direct frozen-pane changes as sheet view metadata', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_frozen_panes',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'frozen',
            oldFrozenRows: 0,
            oldFrozenCols: 0,
            frozenRows: 3,
            frozenCols: 2,
          },
          {
            sheetId: 'sheet-2',
            kind: 'Set',
            field: 'frozen',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      reviewChanges: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['frozen'],
          },
          before: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'rows', value: 0 },
                { key: 'cols', value: 0 },
              ],
            },
          },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'rows', value: 3 },
                { key: 'cols', value: 2 },
              ],
            },
          },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual(
      [
        expect.objectContaining({
          segmentId: 'mutation-1',
          operation: 'compute_set_frozen_panes',
          changeIds: ['mutation-1:sheet:0'],
        }),
      ],
    );
  });
}
