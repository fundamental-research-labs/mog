import { createHeadlessEngine, createWorkbook } from '../src/boot';
import { loadNodeSdkNapiAddon } from '../src/host-adapters/native-node-runtime';

describe('stable Node SDK error boundary', () => {
  it('converts ambiguous chart targets to rich MogSdkError feedback', async () => {
    const workbook = await createWorkbook({ userTimezone: 'UTC' });
    try {
      const worksheet = workbook.activeSheet;
      await worksheet.setCell('A1', 'Month');
      await worksheet.setCell('B1', 'Revenue');
      await worksheet.setCell('A2', 'Jan');
      await worksheet.setCell('B2', 12);
      const { chart } = await worksheet.charts.add({
        type: 'bar',
        name: 'Revenue chart',
        dataRange: 'A1:B2',
        anchorRow: 0,
        anchorCol: 3,
        width: 480,
        height: 300,
      });
      const duplicate = await worksheet.charts.duplicate({ id: chart.id });

      const operation = worksheet.charts.setLegendVisible('Revenue chart', false);
      await expect(operation).rejects.toMatchObject({
        name: 'MogSdkError',
        code: 'CONFLICT',
        operation: 'workbook.activeSheet.charts.setLegendVisible',
        path: ['chartTarget'],
        suggestion: expect.stringContaining(`{ id: "${chart.id}" }`),
        details: {
          resourceType: 'chart',
          received: 'Revenue chart',
          reason: 'ambiguous-target',
          candidates: expect.arrayContaining([
            { id: chart.id, name: 'Revenue chart', matchedBy: ['name'] },
            { id: duplicate.chart.id, name: 'Revenue chart', matchedBy: ['name'] },
          ]),
        },
        diagnostics: {
          domain: 'OBJ',
          property: 'chartTarget',
          issueCode: 'OBJ_CHART_TARGET_AMBIGUOUS',
          severity: 'error',
        },
      });
    } finally {
      await workbook.close('skipSave');
    }
  });

  it('leaves the deprecated internal createHeadlessEngine path raw', async () => {
    const engine = await createHeadlessEngine({
      computeAddon: loadNodeSdkNapiAddon(),
      userTimezone: 'UTC',
    });
    try {
      const operation = engine.workbook.activeSheet.charts.exportImage('missing-chart');
      await expect(operation).rejects.toMatchObject({
        name: 'KernelError',
        code: 'OBJ_CHART_NOT_FOUND',
      });
    } finally {
      await engine.dispose();
    }
  });
});
