import { jest } from '@jest/globals';

import { WorkbookDiagnosticsImpl } from '../workbook/diagnostics';

describe('WorkbookDiagnosticsImpl', () => {
  it('captures a resolved chart spec through workbook diagnostics without exporting pixels', async () => {
    const resolvedChartSpec = {
      schemaVersion: 1,
      chartId: 'chart-1',
      sheetId: 'sheet-1',
      chartObject: { id: 'chart-1' },
      export: {
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
      },
      implementation: {
        renderAuthority: 'chartBridge',
        renderStatus: 'renderable',
        compilerPathId: 'ts-grammar',
        compilerInputHash: 'hash',
        compilerVersion: 1,
      },
      resolved: {
        chartType: 'bar',
        title: { present: false },
        legend: { present: false, entries: [], visibleEntries: [] },
        axes: {},
        series: [],
        categories: [],
        plot: {},
        ranges: {
          dataRange: null,
          categoryRange: null,
          seriesRange: null,
          seriesReferences: [],
          diagnostics: [],
        },
        dataHashes: {
          categoriesHash: 'categories',
          seriesHash: 'series',
        },
      },
      diagnostics: {
        compiler: [],
        unsupportedFeatures: [],
      },
    };
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async () => ({
          marks: [],
          resolvedChartSpec,
        })),
      },
    };

    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(
      diagnostics.getResolvedChartSpec({
        sheetId: 'sheet-1' as any,
        chartId: 'chart-1',
        exportOptions: {
          format: 'png',
          width: 320,
          height: 180,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        },
      }),
    ).resolves.toBe(resolvedChartSpec);
    expect(ctx.charts.getRenderSnapshotAtSize).toHaveBeenCalledWith(
      'sheet-1',
      'chart-1',
      320,
      180,
      expect.objectContaining({
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
      }),
    );
  });

  it('maps chart bridge not-found diagnostics to the public chart-not-found error', async () => {
    const ctx = {
      charts: {
        getRenderSnapshotAtSize: jest.fn(async () => ({
          code: 'CHART_NOT_FOUND',
          message: 'Chart not found',
          chartId: 'missing-chart',
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(
      diagnostics.getResolvedChartSpec({
        sheetId: 'sheet-1' as any,
        chartId: 'missing-chart',
      }),
    ).rejects.toThrow('Chart "missing-chart" not found');
  });
});
