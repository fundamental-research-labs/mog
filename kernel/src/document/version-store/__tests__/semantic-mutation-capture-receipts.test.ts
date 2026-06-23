import {
  capturedChanges,
  captureInput,
  createTestSemanticMutationCapture,
  encodedRangeChange,
  expectCaptureMissingChangeSet,
  expectCaptureSuccess,
  floatingObjectData,
  mutationResult,
  semanticAfterObject,
} from './semantic-mutation-capture-test-helpers';

describe('semantic mutation capture domain receipts', () => {
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
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
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
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
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
    ]);
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

  it('captures named range, table, and comment receipts with stable identities', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_vc06_domain_receipts',
      result: mutationResult({
        namedRangeChanges: [
          { name: 'RevenueTotal', kind: 'Set' },
          { name: 'OldName', kind: 'Removed' },
          { name: '3 names imported', kind: 'Set' },
        ],
        tableChanges: [
          { sheetId: 'sheet-1', tableId: 'table-1', name: 'SalesTable', kind: 'Set' },
          { sheetId: 'sheet-1', tableId: 'table-old', name: 'OldTable', kind: 'Removed' },
          { sheetId: '', name: 'StyleOnly', kind: 'Set' },
        ],
        commentChanges: [
          { sheetId: 'sheet-1', cellId: 'cell-a1', position: { row: 0, col: 0 }, kind: 'Set' },
          { sheetId: 'sheet-1', cellId: 'cell-b2', position: { row: 1, col: 1 }, kind: 'Removed' },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(6);
    expect(changes.map((change) => change.structural)).toEqual([
      { kind: 'metadata', changeId: 'mutation-1:named-range:0', domain: 'named-ranges', entityId: 'name:RevenueTotal', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:named-range:1', domain: 'named-ranges', entityId: 'name:OldName', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:table:0', domain: 'tables', entityId: 'sheet-1!table:table-1', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:table:1', domain: 'tables', entityId: 'sheet-1!table:table-old', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:comment:0', domain: 'comments-notes', entityId: 'sheet-1!comment:cell-a1', propertyPath: ['cell'] },
      { kind: 'metadata', changeId: 'mutation-1:comment:1', domain: 'comments-notes', entityId: 'sheet-1!comment:cell-b2', propertyPath: ['cell'] },
    ]);
    expect(changes[0].after).toEqual(semanticAfterObject([{ key: 'kind', value: 'Set' }, { key: 'name', value: 'RevenueTotal' }]));
    expect(changes[2].after).toEqual(semanticAfterObject([{ key: 'kind', value: 'Set' }, { key: 'tableId', value: 'table-1' }, { key: 'name', value: 'SalesTable' }, { key: 'sheetId', value: 'sheet-1' }]));
    expect(changes[4]).toMatchObject({ display: { address: { kind: 'value', value: 'A1' } } });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      changeIds: ['mutation-1:named-range:0', 'mutation-1:named-range:1', 'mutation-1:table:0', 'mutation-1:table:1', 'mutation-1:comment:0', 'mutation-1:comment:1'],
    });
  });

  it('captures row and column structure receipts as rows-columns mutations', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_structure_change',
      result: mutationResult({
        structureChanges: [
          { sheetId: 'sheet-1', changeType: 'insertRows', at: 1, count: 1 },
          { sheetId: 'sheet-1', changeType: 'deleteCols', at: 2, count: 1 },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes.map((change) => change.structural)).toEqual([
      {
        kind: 'metadata',
        changeId: 'mutation-1:row:0',
        domain: 'rows-columns',
        entityId: 'sheet-1!row:1',
        propertyPath: ['order'],
      },
      {
        kind: 'metadata',
        changeId: 'mutation-1:column:1',
        domain: 'rows-columns',
        entityId: 'sheet-1!column:2',
        propertyPath: ['order'],
      },
    ]);
    expect(changes[0]).toMatchObject({
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'axis', value: 'row' },
            { key: 'sheetId', value: 'sheet-1' },
            { key: 'index', value: 1 },
            { key: 'displayRef', value: '2:2' },
          ]),
        }),
      },
      display: { address: { kind: 'value', value: '2:2' } },
    });
    expect(changes[1]).toMatchObject({
      before: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'axis', value: 'column' },
            { key: 'sheetId', value: 'sheet-1' },
            { key: 'index', value: 2 },
            { key: 'displayRef', value: 'C:C' },
          ]),
        }),
      },
      after: { kind: 'value', value: null },
      display: { address: { kind: 'value', value: 'C:C' } },
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      operation: 'compute_structure_change',
      changeIds: ['mutation-1:row:0', 'mutation-1:column:1'],
    });
  });

  it('captures conditional-format and range metadata receipts conservatively', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_cf_and_range_receipts',
      result: mutationResult({
        cfChanges: [
          { sheetId: 'sheet-1', ruleId: 'cf-rule-1', kind: 'Set' },
          { sheetId: 'sheet-1', ruleId: 'cf-rule-old', kind: 'Removed' },
          { sheetId: 'sheet-1', kind: 'Set' },
        ],
        rangeChanges: [
          encodedRangeChange('sheet-1', 'validation-range', 'Created', 'Validation'),
          encodedRangeChange('sheet-1', 'cf-range', 'Removed', 'CondFormat'),
          encodedRangeChange('sheet-1', 'data-range', 'Created', 'Data'),
          { sheetId: 'sheet-1', rangeId: 'bad-range', kind: 'Created', data: new Uint8Array([1]) },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(4);
    expect(changes.map((change) => change.structural.domain)).toEqual([
      'conditional-formatting',
      'conditional-formatting',
      'data-validation',
      'conditional-formatting',
    ]);
    expect(changes[2]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'mutation-1:range:0',
        domain: 'data-validation',
        entityId: 'sheet-1!range:validation-range',
        propertyPath: ['range'],
      },
      before: { kind: 'value', value: null },
      after: semanticAfterObject([
        { key: 'kind', value: 'Created' },
        { key: 'rangeKind', value: 'Validation' },
        { key: 'rangeId', value: 'validation-range' },
        { key: 'encoding', value: 'None' },
        { key: 'rowCount', value: 2 },
        { key: 'colCount', value: 2 },
        {
          key: 'anchor',
          value: {
            kind: 'object',
            fields: [
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 'row-1' },
              { key: 'endRow', value: 'row-2' },
              { key: 'startCol', value: 'col-1' },
              { key: 'endCol', value: 'col-2' },
            ],
          },
        },
      ]),
    });
    expect(changes[3]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:range:1',
        domain: 'conditional-formatting',
        entityId: 'sheet-1!range:cf-range',
      }),
      after: { kind: 'value', value: null },
    });
  });

  it('captures floating object anchors and chart source range receipts', async () => {
    const capture = createTestSemanticMutationCapture();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_floating_and_chart_receipts',
      result: mutationResult({
        floatingObjectChanges: [
          {
            sheetId: 'sheet-1',
            objectId: 'picture-1',
            objectType: 'picture',
            kind: { type: 'updated', changedFields: ['anchor', 'width'] },
            data: floatingObjectData('picture-1', 'picture', { src: 'image.png' }),
            bounds: { x: 10, y: 20, width: 320, height: 180, rotation: 0 },
          },
          {
            sheetId: 'sheet-1',
            objectId: 'chart-1',
            objectType: 'chart',
            kind: { type: 'created' },
            data: floatingObjectData('chart-1', 'chart', {
              chartType: 'bar',
              dataRange: 'A1:B10',
              seriesRange: 'A1:A10',
              categoryRange: 'B1:B10',
            }),
          },
          { sheetId: '', objectId: 'missing-sheet', kind: { type: 'removed' } },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:floating-object:0',
        domain: 'floating-objects.anchors',
        entityId: 'sheet-1!object:picture-1',
      }),
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'objectType', value: 'picture' },
            { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
            { key: 'width', value: 320 },
          ]),
        }),
      },
    });
    expect(changes[1]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:chart:1',
        domain: 'charts.source-range',
        entityId: 'sheet-1!chart:chart-1',
      }),
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'objectType', value: 'chart' },
            { key: 'chartType', value: 'bar' },
            { key: 'dataRange', value: 'A1:B10' },
            { key: 'seriesRange', value: 'A1:A10' },
            { key: 'categoryRange', value: 'B1:B10' },
          ]),
        }),
      },
    });
  });
});
