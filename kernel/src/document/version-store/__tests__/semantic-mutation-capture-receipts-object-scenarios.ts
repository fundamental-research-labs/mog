import {
  capturedChanges,
  captureInput,
  createTestSemanticMutationCapture,
  expectCaptureSuccess,
  floatingObjectData,
  mutationResult,
} from './semantic-mutation-capture-test-helpers';

export function registerSemanticMutationCaptureObjectReceiptTests(): void {
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
}
