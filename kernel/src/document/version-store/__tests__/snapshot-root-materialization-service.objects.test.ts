import { materializeAuthoredWorkbook } from './snapshot-root-materialization-service.test-helpers';

describe('SnapshotRootMaterializationService floating object replay', () => {
  it('materializes charts and shapes from a committed snapshot root', async () => {
    const fixture = await materializeAuthoredWorkbook({
      sourceDocumentId: 'objects-source-doc',
      materializedDocumentId: 'objects-materialized-doc',
      graphId: 'graph-floating-objects',
      author: async (workbook) => {
        await workbook.activeSheet.setCell('Q1', 'Quarter');
        await workbook.activeSheet.setCell('R1', 'Bookings');
        await workbook.activeSheet.setCell('Q2', 'Q1');
        await workbook.activeSheet.setCell('R2', 10);
        await workbook.activeSheet.setCell('Q3', 'Q2');
        await workbook.activeSheet.setCell('R3', 16);
        await workbook.activeSheet.setCell('Q4', 'Q3');
        await workbook.activeSheet.setCell('R4', 12);
        const chartReceipt = await workbook.activeSheet.charts.add({
          type: 'column',
          title: 'Replay Bookings',
          dataRange: 'Q1:R4',
          anchorRow: 5,
          anchorCol: 16,
          width: 360,
          height: 240,
        });
        const shapeReceipt = await workbook.activeSheet.shapes.add({
          type: 'rect',
          name: 'Replay Anchor',
          anchorRow: 7,
          anchorCol: 3,
          xOffset: 8,
          yOffset: 12,
          width: 96,
          height: 48,
          anchorMode: 'oneCell',
        });

        return {
          chartId: chartReceipt.chart.id,
          shapeId: shapeReceipt.id,
        };
      },
    });

    try {
      const materializedSheet = fixture.materialized.workbook.activeSheet;
      await expect(materializedSheet.charts.get(fixture.artifacts.chartId)).resolves.toMatchObject({
        id: fixture.artifacts.chartId,
        type: 'column',
        title: 'Replay Bookings',
        dataRange: 'Q1:R4',
        anchorRow: 5,
        anchorCol: 16,
        width: 360,
        height: 240,
      });
      await expect(materializedSheet.charts.findBySourceRange('Q1:R4')).resolves.toEqual([
        expect.objectContaining({
          chartId: fixture.artifacts.chartId,
          rangeKind: 'dataRange',
        }),
      ]);

      await expect(
        materializedSheet.objects.getInfo(fixture.artifacts.shapeId),
      ).resolves.toMatchObject({
        id: fixture.artifacts.shapeId,
        type: 'shape',
        name: 'Replay Anchor',
        width: 96,
        height: 48,
        anchorType: 'oneCell',
      });
      await expect(
        materializedSheet.objects.getFullObject(fixture.artifacts.shapeId),
      ).resolves.toMatchObject({
        id: fixture.artifacts.shapeId,
        type: 'shape',
        name: 'Replay Anchor',
        position: expect.objectContaining({
          anchorType: 'oneCell',
          width: 96,
          height: 48,
          from: expect.objectContaining({
            xOffset: 8,
            yOffset: 12,
          }),
        }),
      });

      await fixture.sourceWorkbook.activeSheet.charts.clear();
      const sourceObjects = await fixture.sourceWorkbook.activeSheet.objects.list();
      await fixture.sourceWorkbook.activeSheet.objects.removeMany(
        sourceObjects.map((object) => object.id),
      );
      await expect(materializedSheet.charts.get(fixture.artifacts.chartId)).resolves.toMatchObject({
        id: fixture.artifacts.chartId,
      });
      await expect(
        materializedSheet.objects.getInfo(fixture.artifacts.shapeId),
      ).resolves.toMatchObject({
        id: fixture.artifacts.shapeId,
      });
    } finally {
      await fixture.dispose();
    }
  });
});
