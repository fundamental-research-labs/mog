import {
  capturedChanges,
  captureInput,
  createTestSemanticMutationCapture,
  encodedRangeChange,
  expectCaptureSuccess,
  mutationResult,
  semanticAfterObject,
} from './semantic-mutation-capture-test-helpers';

export function registerSemanticMutationCaptureMetadataReceiptTests(): void {
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
}
