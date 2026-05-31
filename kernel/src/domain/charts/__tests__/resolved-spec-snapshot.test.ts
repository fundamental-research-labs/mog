import type { ChartConfig, ChartData } from '@mog/charts';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import {
  buildResolvedChartSpecSnapshot,
  defaultExportOptionsForSize,
  hashJson,
} from '../bridge/resolved-spec-snapshot';

describe('resolved spec snapshot helpers', () => {
  it('builds default export options from requested dimensions', () => {
    expect(defaultExportOptionsForSize(320.4, 179.6)).toEqual({
      format: 'png',
      width: 320.4,
      height: 179.6,
      pixelRatio: 1,
      physicalWidth: 320,
      physicalHeight: 180,
      backgroundColor: '#ffffff',
    });
    expect(defaultExportOptionsForSize(0, -5)).toMatchObject({
      physicalWidth: 1,
      physicalHeight: 1,
    });
  });

  it('hashes object keys stably regardless of input order', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(hashJson({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('preserves compiler, range, unsupported-feature, and resolved data fields', () => {
    const sheetId = toSheetId('sheet-1');
    const config: ChartConfig = {
      type: 'surface',
      subType: 'stacked',
      anchorRow: 1,
      anchorCol: 2,
      width: 4,
      height: 5,
      title: 'Quarterly',
      legend: {
        show: true,
        visible: true,
        position: 'right',
        entries: [{ idx: 1, delete: true }],
      },
      axis: {
        xAxis: { title: 'Month', visible: true, axisType: 'category', reverse: true },
        yAxis: { title: 'Value', visible: true, min: 0, max: 20 },
      },
      series: [
        {
          name: 'Visible',
          values: 'Sheet1!B2:C2',
          categories: 'Sheet1!B1:C1',
          bubbleSize: 'Sheet1!B4:C4',
          color: '#111111',
          idx: 4,
        },
        {
          name: 'Hidden',
          values: 'Sheet1!B3:C3',
          categories: 'Sheet1!B1:C1',
          format: { fill: { type: 'none' } },
        },
      ],
      plotVisibleOnly: true,
      gapWidth: 150,
    };
    const chartData: ChartData = {
      categories: ['Jan', 'Feb'],
      series: [
        {
          name: 'Visible',
          yAxisIndex: 1,
          data: [
            { x: 'Jan', y: 10 },
            { x: 'Feb', y: 0, valueState: 'blank' },
          ],
        },
        {
          name: 'Hidden',
          data: [
            { x: 'Jan', y: 2 },
            { x: 'Feb', y: 3 },
          ],
        },
      ],
    };
    const range = {
      kind: 'dataRange',
      source: 'a1',
      ref: 'Sheet1!A1:C3',
      range: {
        sheetId,
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      },
    } as const;

    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
        widthPt: 320,
        heightPt: 180,
      } as any,
      sheetId,
      config,
      chartData,
      resolvedRanges: {
        dataRange: range,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [
          {
            index: 0,
            values: { ...range, kind: 'seriesValues', ref: 'Sheet1!B2:C2' },
            categories: { ...range, kind: 'seriesCategories', ref: 'Sheet1!B1:C1' },
            bubbleSizes: { ...range, kind: 'seriesBubbleSizes', ref: 'Sheet1!B4:C4' },
          },
        ],
        diagnostics: [
          {
            kind: 'seriesValues',
            code: 'UNKNOWN_SHEET',
            ref: 'Missing!A1:B2',
            sheetName: 'Missing',
            message: 'Unknown sheet "Missing"',
          },
        ],
      },
      exportOptions: {
        format: 'png',
        width: 320,
        height: 180,
        pixelRatio: 1,
        physicalWidth: 320,
        physicalHeight: 180,
        backgroundColor: '#ffffff',
      },
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.implementation).toMatchObject({
      renderAuthority: 'chartBridge',
      renderStatus: 'renderable',
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
      compilerVersion: 1,
    });
    expect(snapshot.resolved).toMatchObject({
      chartType: 'surface',
      grouping: 'stacked',
      title: { present: true, text: 'Quarterly' },
      categories: ['Jan', 'Feb'],
      plot: { plotVisibleOnly: true, gapWidth: 150 },
    });
    expect(snapshot.resolved.legend.visibleEntries).toEqual(['Visible']);
    expect(snapshot.resolved.axes.category).toMatchObject({
      present: true,
      title: 'Month',
      axisType: 'category',
      reverse: true,
    });
    expect(snapshot.resolved.series[0]).toMatchObject({
      index: 0,
      order: 4,
      name: 'Visible',
      axisGroup: 'secondary',
      categories: ['Jan', 'Feb'],
      values: [10, null],
      blankMask: [false, true],
      source: {
        values: 'Sheet1!B2:C2',
        categories: 'Sheet1!B1:C1',
        bubbleSize: 'Sheet1!B4:C4',
      },
    });
    expect(snapshot.resolved.ranges.seriesReferences[0].bubbleSize).toMatchObject({
      kind: 'seriesBubbleSizes',
      ref: 'Sheet1!B4:C4',
      range: {
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      },
    });
    expect(snapshot.resolved.ranges.dataRange).toMatchObject({
      kind: 'dataRange',
      ref: 'Sheet1!A1:C3',
      range: {
        sheetId: 'sheet-1',
        startRow: 0,
        startCol: 0,
        endRow: 2,
        endCol: 2,
      },
    });
    expect(snapshot.resolved.ranges.diagnostics).toEqual([
      {
        kind: 'seriesValues',
        code: 'UNKNOWN_SHEET',
        ref: 'Missing!A1:B2',
        sheetName: 'Missing',
        message: 'Unknown sheet "Missing"',
      },
    ]);
    expect(snapshot.diagnostics.compiler).toEqual(['Unknown sheet "Missing"']);
    expect(snapshot.diagnostics.unsupportedFeatures).toEqual([
      'surface chart rendering is not fully semantic',
    ]);
    expect(snapshot.resolved.dataHashes.categoriesHash).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot.resolved.series[0].dataHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reports deterministic chart type and axis unsupported feature diagnostics', () => {
    const sheetId = toSheetId('sheet-1');
    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
      } as any,
      sheetId,
      config: {
        type: 'regionMap',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
        extra: { isChartEx: true },
        axis: {
          secondaryCategoryAxis: { visible: true, tickLabelSpacing: 2 },
          valueAxis: {
            visible: true,
            scaleType: 'logarithmic',
            displayUnit: 'millions',
            linkNumberFormat: true,
          },
          secondaryValueAxis: { visible: true },
        },
      } as ChartConfig,
      chartData: { categories: [], series: [] },
      resolvedRanges: {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
      exportOptions: defaultExportOptionsForSize(320, 180),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.diagnostics.unsupportedFeatures).toEqual([
      'region map rendering uses placeholder geometry',
      'ChartEx regionMap data projection is not implemented',
      'value log axis scale is not fully rendered',
      'value axis display units are not rendered',
      'value axis source-linked number format is not resolved',
      'secondary category axes are preserved but not rendered',
      'secondary category axis explicit tick skipping is not rendered',
    ]);
  });

  it('does not flag supported secondary value axes as unsupported', () => {
    const sheetId = toSheetId('sheet-1');
    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
      } as any,
      sheetId,
      config: {
        type: 'combo',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
        axis: {
          valueAxis: { visible: true },
          secondaryValueAxis: { visible: true },
        },
        series: [{ name: 'Percent', yAxisIndex: 1 }],
      } as ChartConfig,
      chartData: {
        categories: ['A'],
        series: [{ name: 'Percent', yAxisIndex: 1, data: [{ x: 'A', y: 0.2 }] }],
      },
      resolvedRanges: {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [],
        diagnostics: [],
      },
      exportOptions: defaultExportOptionsForSize(320, 180),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.diagnostics.unsupportedFeatures).toEqual([]);
  });
});
