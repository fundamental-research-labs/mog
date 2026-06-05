import { jest } from '@jest/globals';

import { WorkbookDiagnosticsImpl } from '../workbook/diagnostics';

describe('WorkbookDiagnosticsImpl', () => {
  it('queries runtime diagnostics from compute and normalizes public fields', async () => {
    const ctx = {
      computeBridge: {
        getRuntimeDiagnostics: jest.fn(async () => ({
          diagnostics: [
            {
              id: 'runtime-diagnostic-1',
              sequence: '1',
              code: 'unsupported_filter_reapply',
              severity: 'unexpected',
              recoverability: 'unsupported_preserved',
              operation: 'applyFilter',
              sheetId: 'sheet-1',
              filterId: 'filter-1',
              filterKind: 'not-a-filter-kind',
              reason: 'iconFilterUnsupported',
              reasons: ['iconFilterUnsupported'],
            },
            {
              id: 'runtime-diagnostic-2',
              sequence: '2',
              code: 'unsupported_filter_reapply',
              severity: 'error',
              recoverability: 'unsupported_preserved',
              operation: 'applyFilter',
              sheetId: 'sheet-1',
              filterId: 'filter-2',
              filterKind: 'tableFilter',
            },
          ],
          nextSequence: '2',
          truncated: false,
        })),
      },
    };
    const diagnostics = new WorkbookDiagnosticsImpl(ctx as any);

    await expect(diagnostics.runtime({ sinceSequence: '1', limit: 10 })).resolves.toEqual({
      diagnostics: [
        expect.objectContaining({
          id: 'runtime-diagnostic-1',
          severity: 'warning',
          filterKind: undefined,
        }),
        expect.objectContaining({
          id: 'runtime-diagnostic-2',
          severity: 'error',
          filterKind: 'tableFilter',
        }),
      ],
      nextSequence: '2',
      truncated: false,
    });
    expect(ctx.computeBridge.getRuntimeDiagnostics).toHaveBeenCalledWith({
      sinceSequence: '1',
      limit: 10,
    });
  });

  it('captures a resolved chart spec through workbook diagnostics without exporting pixels', async () => {
    const resolvedChartSpec = {
      schemaVersion: 1,
      chartId: 'chart-1',
      sheetId: 'sheet-1',
      chartObject: { id: 'chart-1' },
      export: {
        kind: 'raster',
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
        fittingMode: 'fill',
        frame: {
          exportWidth: 320,
          exportHeight: 180,
          contentX: 0,
          contentY: 0,
          contentWidth: 320,
          contentHeight: 180,
        },
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
        kind: 'raster',
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 2,
        physicalWidth: 640,
        physicalHeight: 360,
        backgroundColor: '#ffffff',
        fittingMode: 'fill',
        frame: {
          exportWidth: 320,
          exportHeight: 180,
          contentX: 0,
          contentY: 0,
          contentWidth: 320,
          contentHeight: 180,
        },
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
