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
          valueSourceKind: 'ref',
          categories: 'Sheet1!B1:C1',
          categorySourceKind: 'ref',
          bubbleSize: 'Sheet1!B4:C4',
          bubbleSizeSourceKind: 'ref',
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
        valueSourceKind: 'ref',
        categories: 'Sheet1!B1:C1',
        categorySourceKind: 'ref',
        bubbleSize: 'Sheet1!B4:C4',
        bubbleSizeSourceKind: 'ref',
      },
      renderAuthority: {
        values: 'live',
        categories: 'live',
        bubbleSize: 'live',
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
      'contour/top-view surface rendering is not implemented; chart is preserved as a placeholder',
    ]);
    expect(snapshot.resolved.dataHashes.categoriesHash).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot.resolved.series[0].dataHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('snapshots literal and fallback-cache render authority per series dimension', () => {
    const sheetId = toSheetId('sheet-1');
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      series: [
        {
          name: 'Cached',
          values: 'Missing!B2:C2',
          valueSourceKind: 'cacheFallback',
          valueCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '10' },
              { idx: 1, value: '20' },
            ],
          },
          categorySourceKind: 'literal',
          categoryCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '1' },
              { idx: 1, value: '2' },
            ],
          },
          bubbleSizeSourceKind: 'literal',
          bubbleSizeCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '5' },
              { idx: 1, value: '15' },
            ],
          },
        },
      ],
    };
    const chartData: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Cached',
          data: [
            { x: 1, y: 10, size: 5 },
            { x: 2, y: 20, size: 15 },
          ],
        },
      ],
    };

    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
      } as any,
      sheetId,
      config,
      chartData,
      resolvedRanges: {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [
          {
            index: 0,
            values: null,
            categories: null,
            bubbleSizes: null,
          },
        ],
        diagnostics: [],
      },
      exportOptions: defaultExportOptionsForSize(320, 180),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.resolved.series[0]).toMatchObject({
      source: {
        values: 'Missing!B2:C2',
        valueSourceKind: 'cacheFallback',
        categorySourceKind: 'literal',
        bubbleSizeSourceKind: 'literal',
      },
      renderAuthority: {
        values: 'fallbackCache',
        categories: 'literal',
        bubbleSize: 'literal',
      },
    });
  });

  it('does not report render authority from sparse cache points outside explicit zero pointCount', () => {
    const sheetId = toSheetId('sheet-1');
    const config: ChartConfig = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      series: [
        {
          name: 'Stale cache',
          valueSourceKind: 'cacheFallback',
          valueCache: {
            pointCount: 0,
            points: [{ idx: 0, value: '10' }],
          },
          categorySourceKind: 'literal',
          categoryCache: {
            pointCount: 0,
            points: [{ idx: 0, value: 'A' }],
          },
        },
      ],
    };

    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
      } as any,
      sheetId,
      config,
      chartData: { categories: [], series: [{ name: 'Stale cache', data: [] }] },
      resolvedRanges: {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [{ index: 0, values: null, categories: null, bubbleSizes: null }],
        diagnostics: [],
      },
      exportOptions: defaultExportOptionsForSize(320, 180),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.resolved.series[0].renderAuthority).toMatchObject({
      values: 'unavailable',
      categories: 'unavailable',
    });
  });

  it('snapshots multi-level category cache render authority', () => {
    const sheetId = toSheetId('sheet-1');
    const config: ChartConfig = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      series: [
        {
          name: 'Hierarchy',
          valueSourceKind: 'literal',
          valueCache: {
            pointCount: 2,
            points: [
              { idx: 0, value: '10' },
              { idx: 1, value: '20' },
            ],
          },
          categories: 'Missing!A1:B2',
          categorySourceKind: 'cacheFallback',
          categoryLevels: {
            pointCount: 2,
            levels: [
              {
                level: 0,
                pointCount: 2,
                points: [
                  { idx: 0, value: 'North' },
                  { idx: 1, value: 'South' },
                ],
              },
              {
                level: 1,
                pointCount: 2,
                points: [
                  { idx: 0, value: 'Q1' },
                  { idx: 1, value: 'Q2' },
                ],
              },
            ],
          },
        },
      ],
    };

    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
      } as any,
      sheetId,
      config,
      chartData: {
        categories: ['North / Q1', 'South / Q2'],
        categoryLevels: [
          { level: 0, labels: ['North', 'South'] },
          { level: 1, labels: ['Q1', 'Q2'] },
        ],
        series: [
          {
            name: 'Hierarchy',
            data: [
              { x: 'North / Q1', y: 10 },
              { x: 'South / Q2', y: 20 },
            ],
          },
        ],
      },
      resolvedRanges: {
        dataRange: null,
        categoryRange: null,
        seriesRange: null,
        seriesReferences: [{ index: 0, values: null, categories: null, bubbleSizes: null }],
        diagnostics: [],
      },
      exportOptions: defaultExportOptionsForSize(320, 180),
      compilerPathId: 'ts-grammar',
      compilerInputHash: 'input-hash',
    });

    expect(snapshot.resolved.series[0]).toMatchObject({
      source: {
        categories: 'Missing!A1:B2',
        categorySourceKind: 'cacheFallback',
      },
      renderAuthority: {
        values: 'literal',
        categories: 'fallbackCache',
      },
    });
  });

  it('uses sourceSeriesIndex as the dropped-series key fallback', () => {
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
        type: 'column',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 5,
        series: [
          { name: 'Rendered', values: 'Sheet1!A1:A2' },
          {
            name: 'Dropped projected source',
            values: 'Sheet1!F1:F2',
            sourceSeriesIndex: 5,
            projectionDiagnostics: [{ reason: 'allItemsFiltered' }],
          },
        ],
      },
      chartData: {
        categories: ['A'],
        series: [{ name: 'Rendered', data: [{ x: 'A', y: 1 }] }],
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

    expect(snapshot.resolved.seriesProjection.droppedSeries).toEqual([
      {
        sourceSeriesIndex: 5,
        sourceSeriesKey: 'series:5',
        name: 'Dropped projected source',
        reason: 'allItemsFiltered',
        message: undefined,
      },
    ]);
  });

  it('aligns unnamed series snapshot labels with chart data extraction fallback order', () => {
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
        type: 'line',
        anchorRow: 0,
        anchorCol: 0,
        width: 4,
        height: 5,
        series: [
          { values: 'A1:B1', idx: 0, order: 2 },
          { values: 'A2:B2', idx: 3, order: 1 },
          { values: 'A3:B3', order: 0 },
          { values: 'A4:B4' },
        ],
      },
      chartData: {
        categories: ['A', 'B'],
        series: [
          { name: '', data: [{ x: 'A', y: 1 }] },
          { name: '', data: [{ x: 'A', y: 2 }] },
          { name: '', data: [{ x: 'A', y: 3 }] },
          { name: '', data: [{ x: 'A', y: 4 }] },
        ],
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

    expect(snapshot.resolved.series.map((series) => series.name)).toEqual([
      'Series 3',
      'Series 3',
      'Series 1',
      'Series 4',
    ]);
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
      'value axis source-linked number format has no source format; using General',
      'ChartEx value axis metadata is preserved but rendered through the standard chart axis backend',
      'ChartEx secondary category axis metadata is preserved but rendered through the standard chart axis backend',
      'ChartEx secondary value axis metadata is preserved but rendered through the standard chart axis backend',
    ]);
    expect(snapshot.resolved.axes.secondaryCategory).toMatchObject({
      present: true,
      visible: true,
      tickLabelSpacing: 2,
    });
    expect(snapshot.resolved.axes.value).toMatchObject({
      present: true,
      scaleType: 'logarithmic',
      displayUnit: 'millions',
      linkNumberFormat: true,
    });
  });

  it.each([
    ['treemap', 'treemap rendering requires hierarchy layout semantics'],
    ['sunburst', 'sunburst rendering requires hierarchy layout semantics'],
    ['regionMap', 'region map rendering uses placeholder geometry'],
  ] as const)(
    'reports ChartEx %s render limits without hiding projected data',
    (type, expectedDiagnostic) => {
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
          type,
          anchorRow: 1,
          anchorCol: 2,
          width: 4,
          height: 5,
          dataRange: 'Sheet1!A1:B2',
          extra: { isChartEx: true },
        } as ChartConfig,
        chartData: {
          categories: ['A'],
          series: [{ name: 'Values', data: [{ x: 'A', y: 1 }] }],
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

      expect(snapshot.diagnostics.unsupportedFeatures).toContain(expectedDiagnostic);
      expect(snapshot.diagnostics.unsupportedFeatures).not.toContain(
        `ChartEx ${type} data projection is not implemented`,
      );
      expect(snapshot.resolved.series[0]).toMatchObject({
        name: 'Values',
        values: [1],
      });
    },
  );

  it('reports mismatched axis positions and secondary category independent domains', () => {
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
        type: 'column',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
        axis: {
          categoryAxis: { visible: true, position: 'l' },
          valueAxis: { visible: true, position: 't' },
          secondaryCategoryAxis: {
            visible: true,
            position: 'r',
            min: 1,
            max: 12,
            reverse: true,
          },
        },
      } as ChartConfig,
      chartData: { categories: ['A'], series: [{ name: 'Revenue', data: [{ x: 'A', y: 1 }] }] },
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
      'category axis position "l" does not match horizontal axis geometry',
      'value axis position "t" does not match vertical axis geometry',
      'secondary category axis position "r" does not match horizontal axis geometry',
      'secondary category axis independent scale/domain is preserved but rendered on the primary category scale (min, max, reverse)',
    ]);
  });

  it('reports preserve-only imported layout, data-table, 3D, and pivot surfaces', () => {
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
        type: 'column',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
        plotLayout: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
        titleLayout: { x: 0.2, y: 0.05 },
        legend: {
          show: true,
          visible: true,
          position: 'right',
          layout: { x: 0.8, y: 0.1 },
        },
        dataLabels: { show: true, showValue: true, layout: { x: 0.3, y: 0.4 } },
        trendlines: [{ label: { text: 'y = x', layout: { x: 0.4, y: 0.2 } } }],
        dataTable: { visible: true, showKeys: true },
        showAllFieldButtons: true,
        pivotOptions: { showAxisFieldButtons: false, showValueFieldButtons: true },
        view3d: { rotX: 30, rotY: 20 },
        floorFormat: { fill: { type: 'solid', color: '#eeeeee' } },
      } as ChartConfig,
      chartData: { categories: ['A'], series: [{ name: 'Revenue', data: [{ x: 'A', y: 1 }] }] },
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
      'pivot chart field buttons are preserved but not rendered (showAllFieldButtons, showAxisFieldButtons, showValueFieldButtons)',
      'manual plot layout is preserved but not rendered',
      'manual title layout is preserved but not rendered',
      'manual legend layout is preserved but not rendered',
      'manual data-label layout is preserved but not rendered',
      'chart data table is preserved but not rendered',
      'view3D camera/depth is preserved but rendered as a 2-D approximation',
      'floor/sideWall/backWall surfaces are preserved but not rendered',
    ]);
  });

  it('reports preserve-only chart annotation diagnostics', () => {
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
        type: 'ofPie',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
        dataLabels: { show: true, showValue: true, linkNumberFormat: true },
        seriesLines: { visible: true },
        series: [{ markerStyle: 'picture' }],
      } as ChartConfig,
      chartData: { categories: ['A'], series: [{ name: 'Revenue', data: [{ x: 'A', y: 1 }] }] },
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
      'picture markers are preserved for export but rendered as standard symbols',
      'source-linked data label number formats are preserved but rendered with modeled fallback formatting',
      'of-pie series lines require secondary-plot geometry and are preserved for export only',
    ]);
  });

  it('includes renderable import-status diagnostics in unsupported feature snapshots', () => {
    const sheetId = toSheetId('sheet-1');
    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
        importStatus: {
          source: 'xlsx',
          featureKind: 'chart',
          recoverability: 'partiallySupported',
          renderability: 'renderable',
          editability: 'partiallyEditable',
          diagnostics: [
            {
              code: 'unsupportedFeature',
              message:
                'Pivot chart formatting (c:pivotFmts, 1 entries) is preserved for export but not rendered; semantic style resolution is owned by the chart style plan',
            },
            {
              code: 'missingRelationshipTarget',
              message: 'Chart relationship `rIdVendor` has unsupported type `vendor`',
            },
          ],
        },
      } as any,
      sheetId,
      config: {
        type: 'bar',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
      } as ChartConfig,
      chartData: { categories: ['A'], series: [{ name: 'Revenue', data: [{ x: 'A', y: 1 }] }] },
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
      'Pivot chart formatting (c:pivotFmts, 1 entries) is preserved for export but not rendered; semantic style resolution is owned by the chart style plan',
      'Chart relationship `rIdVendor` has unsupported type `vendor`',
    ]);
  });

  it('snapshots stale standard chart package authority diagnostics', () => {
    const sheetId = toSheetId('sheet-1');
    const snapshot = buildResolvedChartSpecSnapshot({
      chart: {
        id: 'chart-1',
        name: 'Chart 1',
        anchor: { anchorRow: 1, anchorCol: 2 },
        widthCells: 4,
        heightCells: 5,
        ooxml: {
          standardChartProvenance: {
            originalPath: 'xl/charts/chart2.xml',
            projectionSchemaVersion: 3,
            projectionFingerprint: 'fp-import',
            relationships: [{ rId: 'rId1', target: '../media/image1.png' }],
            auxiliaryPaths: [],
          },
          standardChartExportAuthority: {
            schemaVersion: 3,
            validity: 'unsafe',
            chartPartRevision: 0,
            packageOwner: 'xl/charts/chart2.xml',
            relationshipClosureCurrent: false,
            projectionFingerprint: 'fp-import',
            staleReason: 'missing internal chart relationship target',
          },
        },
      } as any,
      sheetId,
      config: {
        type: 'bar',
        anchorRow: 1,
        anchorCol: 2,
        width: 4,
        height: 5,
      } as ChartConfig,
      chartData: { categories: ['A'], series: [{ name: 'Revenue', data: [{ x: 'A', y: 1 }] }] },
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

    expect(snapshot.packageAuthority).toMatchObject({
      source: 'xl/charts/chart2.xml',
      fingerprint: 'fp-import',
      status: 'stale',
      details: {
        kind: 'standardChart',
        validity: 'unsafe',
        relationshipClosureCurrent: false,
        staleReason: 'missing internal chart relationship target',
        relationshipCount: 1,
      },
    });
    expect(snapshot.diagnostics.unsupportedFeatures).toEqual([
      'standard chart package authority is unsafe: missing internal chart relationship target',
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

  it('does not flag source-linked value axis formats when imported cache formats resolve them', () => {
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
          valueAxis: { visible: true, linkNumberFormat: true },
          secondaryValueAxis: { visible: true, linkNumberFormat: true },
        },
        series: [
          { name: 'Revenue', valueCache: { formatCode: '$#,##0', points: [] } },
          {
            name: 'Margin',
            yAxisIndex: 1,
            valueCache: { formatCode: '0.0%', points: [] },
          },
        ],
      } as ChartConfig,
      chartData: {
        categories: ['A'],
        series: [
          { name: 'Revenue', data: [{ x: 'A', y: 1200 }] },
          { name: 'Margin', yAxisIndex: 1, data: [{ x: 'A', y: 0.2 }] },
        ],
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

  it('reports logarithmic axis base, domain, and bound-data diagnostics', () => {
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
          valueAxis: {
            visible: true,
            scaleType: 'logarithmic',
            logBase: 1,
            min: 0,
          },
          secondaryValueAxis: {
            visible: true,
            scaleType: 'logarithmic',
          },
        },
        series: [
          { name: 'Primary', valueCache: { points: [] } },
          { name: 'Secondary', yAxisIndex: 1, valueCache: { points: [] } },
        ],
      } as ChartConfig,
      chartData: {
        categories: ['A', 'B'],
        series: [
          {
            name: 'Primary',
            data: [
              { x: 'A', y: -5 },
              { x: 'B', y: 0 },
            ],
          },
          {
            name: 'Secondary',
            yAxisIndex: 1,
            data: [
              { x: 'A', y: 4 },
              { x: 'B', y: 8 },
            ],
          },
        ],
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

    expect(snapshot.diagnostics.unsupportedFeatures).toEqual([
      'value axis logarithmic scale has invalid base',
      'value axis logarithmic scale has non-positive min domain',
      'value axis logarithmic scale has no positive bound data values',
    ]);
  });
});
