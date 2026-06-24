import {
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function registerSemanticMutationCaptureFilterAndSortReceiptTests(): void {
  it('captures filter and sort mutation receipts as semantic records', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_auto_filter_column',
      result: mutationResult({
        filterChanges: [
          {
            sheetId: 'sheet-1',
            filterId: 'auto-filter-1',
            filterKind: 'autoFilter',
            capability: 'supported',
            hasActiveFilter: true,
            clearable: true,
            action: 'setColumn',
            hiddenRowCount: 3,
            visibleRowCount: 7,
            kind: 'Set',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_sort_range',
      result: mutationResult({
        sortingChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            startRow: 0,
            startCol: 0,
            endRow: 9,
            endCol: 2,
            rowsMoved: 6,
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
            changeId: 'mutation-1:filter:0',
            domain: 'filters',
            entityId: 'sheet-1!filter:auto-filter-1',
            propertyPath: ['state'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'kind', value: 'Set' },
                { key: 'filterId', value: 'auto-filter-1' },
                { key: 'filterKind', value: 'autoFilter' },
                { key: 'capability', value: 'supported' },
                { key: 'hasActiveFilter', value: true },
                { key: 'clearable', value: true },
                { key: 'action', value: 'setColumn' },
                { key: 'hiddenRowCount', value: 3 },
                { key: 'visibleRowCount', value: 7 },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'sheet-1!filter:auto-filter-1' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sort:0',
            domain: 'sorts',
            entityId: 'sheet-1!A1:C10',
            propertyPath: ['order'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'kind', value: 'Set' },
                { key: 'range', value: 'A1:C10' },
                { key: 'rowsMoved', value: 6 },
              ],
            },
          },
          display: { address: { kind: 'value', value: 'A1:C10' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual(
      [
        expect.objectContaining({
          segmentId: 'mutation-1',
          operation: 'compute_set_auto_filter_column',
          changeIds: ['mutation-1:filter:0'],
        }),
        expect.objectContaining({
          segmentId: 'mutation-2',
          operation: 'compute_sort_range',
          changeIds: ['mutation-2:sort:0'],
        }),
      ],
    );
  });

  it('skips filter and sort receipts without stable identity evidence', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_auto_filter_column',
      result: mutationResult({
        filterChanges: [
          {
            sheetId: '',
            filterId: 'missing-sheet',
            kind: 'Set',
          },
        ],
        sortingChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            startRow: 5,
            startCol: 0,
            endRow: 4,
            endCol: 2,
            rowsMoved: 1,
          },
        ],
      }),
    });

    expectCaptureMissingChangeSet(await capture.captureNormalCommit(captureInput()));
  });
}
