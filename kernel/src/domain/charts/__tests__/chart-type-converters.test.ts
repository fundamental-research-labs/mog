import {
  axisConfigToWire,
  chartFormatToWire,
  seriesConfigToWire,
  wireToAxisConfig,
  wireToChartFormat,
  wireChartTypeToConfig,
  wireToLegendConfig,
  wireToSeriesConfig,
  wireToSizeRepresents,
} from '../chart-type-converters';

describe('chart-type-converters', () => {
  it('narrows canonical and aliased chart type strings at the wire boundary', () => {
    for (const type of [
      'waterfall',
      'treemap',
      'sunburst',
      'funnel',
      'histogram',
      'pareto',
      'boxplot',
      'regionMap',
    ] as const) {
      expect(wireChartTypeToConfig(type)).toEqual({ type, diagnostics: [] });
    }
    expect(wireChartTypeToConfig('surface3D')).toEqual({
      type: 'surface3d',
      diagnostics: [
        {
          code: 'acceptedChartTypeAlias',
          message: 'Imported chart type "surface3D" was canonicalized to "surface3d"',
          rawType: 'surface3D',
          canonicalType: 'surface3d',
        },
      ],
    });
    expect(wireChartTypeToConfig('boxWhisker')).toMatchObject({
      type: 'boxplot',
      diagnostics: [{ code: 'acceptedChartTypeAlias', canonicalType: 'boxplot' }],
    });
    expect(wireChartTypeToConfig('paretoLine')).toMatchObject({
      type: 'pareto',
      diagnostics: [{ code: 'acceptedChartTypeAlias', canonicalType: 'pareto' }],
    });
  });

  it('rejects unknown chart type strings instead of smuggling them into ChartConfig', () => {
    expect(wireChartTypeToConfig('chartEx:unknown')).toEqual({
      type: undefined,
      diagnostics: [
        {
          code: 'unsupportedChartType',
          message: 'Imported chart type "chartEx:unknown" is not supported',
          rawType: 'chartEx:unknown',
        },
      ],
    });
    expect(wireChartTypeToConfig('chartEx:funnel')).toEqual({
      type: undefined,
      diagnostics: [
        {
          code: 'unsupportedChartType',
          message: 'Imported chart type "chartEx:funnel" is not supported',
          rawType: 'chartEx:funnel',
        },
      ],
    });
  });

  it('narrows bubble size representation strings at the wire boundary', () => {
    expect(wireToSizeRepresents('area')).toBe('area');
    expect(wireToSizeRepresents('w')).toBe('w');
    expect(wireToSizeRepresents('diameter')).toBeUndefined();
    expect(wireToSizeRepresents(undefined)).toBeUndefined();
  });

  it('reconciles imported legend visibility when OOXML preserved visible=true with show=false', () => {
    expect(
      wireToLegendConfig({
        show: false,
        visible: true,
        position: 'right',
      }),
    ).toEqual(
      expect.objectContaining({
        show: true,
        visible: true,
        position: 'right',
      }),
    );
  });

  it('converts nested chart format colors between wire tint_shade and contract tintShade', () => {
    expect(
      wireToChartFormat({
        fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.25 } },
      })?.fill,
    ).toEqual({ type: 'solid', color: { theme: 'accent1', tintShade: 0.25 } });

    expect(
      wireToChartFormat({
        fill: {
          type: 'gradient',
          gradientType: 'linear',
          stops: [
            { position: 0, color: { theme: 'accent2', tint_shade: -0.1 } },
            { position: 1, color: '#ffffff', transparency: 0.2 },
          ],
        },
      })?.fill,
    ).toEqual({
      type: 'gradient',
      gradientType: 'linear',
      stops: [
        { position: 0, color: { theme: 'accent2', tintShade: -0.1 } },
        { position: 1, color: '#ffffff', transparency: 0.2 },
      ],
    });

    expect(
      wireToChartFormat({
        fill: {
          type: 'pattern',
          pattern: 'pct5',
          foreground: { theme: 'accent3', tint_shade: 0.4 },
          background: { theme: 'lt1', tint_shade: -0.2 },
        },
      })?.fill,
    ).toEqual({
      type: 'pattern',
      pattern: 'pct5',
      foreground: { theme: 'accent3', tintShade: 0.4 },
      background: { theme: 'lt1', tintShade: -0.2 },
    });

    const converted = wireToChartFormat({
      line: { color: { theme: 'accent4', tint_shade: -0.15 }, width: 2 },
      font: { color: { theme: 'tx1', tint_shade: 0.05 }, bold: true },
      shadow: { color: { theme: 'dk1', tint_shade: 0.3 }, blur: 4 },
    });
    expect(converted?.line?.color).toEqual({ theme: 'accent4', tintShade: -0.15 });
    expect(converted?.font?.color).toEqual({ theme: 'tx1', tintShade: 0.05 });
    expect(converted?.shadow?.color).toEqual({ theme: 'dk1', tintShade: 0.3 });

    expect(
      chartFormatToWire({
        fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.25 } },
        line: { color: { theme: 'accent4', tintShade: -0.15 }, width: 2 },
        font: { color: { theme: 'tx1', tintShade: 0.05 }, bold: true },
        shadow: { color: { theme: 'dk1', tintShade: 0.3 }, blur: 4 },
      }),
    ).toEqual({
      fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.25 } },
      line: { color: { theme: 'accent4', tint_shade: -0.15 }, width: 2 },
      font: { color: { theme: 'tx1', tint_shade: 0.05 }, bold: true },
      shadow: { color: { theme: 'dk1', tint_shade: 0.3 }, blur: 4 },
    });
  });

  it('preserves imported category label format metadata on series configs', () => {
    expect(
      wireToSeriesConfig({
        name: 'Forecast',
        categoryLabelFormat: {
          formatCode: '"FY3/"0',
          points: [{ idx: 7, formatCode: '"FY3/"0"E"' }],
        },
      }),
    ).toEqual(
      expect.objectContaining({
        categoryLabelFormat: {
          formatCode: '"FY3/"0',
          points: [{ idx: 7, formatCode: '"FY3/"0"E"' }],
        },
      }),
    );
  });

  it('round-trips projected series identity metadata on series configs', () => {
    const seriesConfig = wireToSeriesConfig({
      name: 'Projected',
      sourceSeriesIndex: 5,
      sourceSeriesKey: 'series:5',
      visibleOrder: 1,
      pivotSeriesKey: 'field:region',
      pivotDataFieldIndex: 2,
      stockRole: 'close',
      projectionAuthority: 'pivotCache',
      projectionDiagnostics: [
        {
          reason: 'allItemsFiltered',
          severity: 'warning',
          sourceSeriesIndex: 5,
          sourceSeriesKey: 'series:5',
          message: 'All items are filtered',
        },
      ],
    });

    expect(seriesConfig).toEqual(
      expect.objectContaining({
        sourceSeriesIndex: 5,
        sourceSeriesKey: 'series:5',
        visibleOrder: 1,
        pivotSeriesKey: 'field:region',
        pivotDataFieldIndex: 2,
        stockRole: 'close',
        projectionAuthority: 'pivotCache',
        projectionDiagnostics: [
          {
            reason: 'allItemsFiltered',
            severity: 'warning',
            sourceSeriesIndex: 5,
            sourceSeriesKey: 'series:5',
            message: 'All items are filtered',
          },
        ],
      }),
    );
    expect(seriesConfigToWire(seriesConfig)).toEqual(
      expect.objectContaining({
        sourceSeriesIndex: 5,
        sourceSeriesKey: 'series:5',
        visibleOrder: 1,
        pivotSeriesKey: 'field:region',
        pivotDataFieldIndex: 2,
        stockRole: 'close',
        projectionAuthority: 'pivotCache',
        projectionDiagnostics: seriesConfig.projectionDiagnostics,
      }),
    );
  });

  it('round-trips imported sparse point caches on series configs', () => {
    const seriesConfig = wireToSeriesConfig({
      name: 'Imported',
      valueCache: {
        pointCount: 4,
        formatCode: 'General',
        points: [
          { idx: 1, value: '0', formatCode: '0%' },
          { idx: 3, value: '4.5' },
        ],
      },
      valueSourceKind: 'literal',
      categoryCache: {
        pointCount: 4,
        formatCode: 'm/d/yyyy',
        points: [{ idx: 0, value: '45292' }],
      },
      categorySourceKind: 'literal',
      categoryLevels: {
        pointCount: 4,
        levels: [
          {
            level: 0,
            pointCount: 4,
            points: [{ idx: 0, value: 'North' }],
          },
          {
            level: 1,
            pointCount: 4,
            points: [{ idx: 1, value: 'Q2' }],
          },
        ],
      },
      bubbleSizeCache: {
        pointCount: 2,
        points: [{ idx: 1, value: '10' }],
      },
      bubbleSizeSourceKind: 'literal',
    });

    expect(seriesConfig.valueCache).toEqual({
      pointCount: 4,
      formatCode: 'General',
      points: [
        { idx: 1, value: '0', formatCode: '0%' },
        { idx: 3, value: '4.5' },
      ],
    });
    expect(seriesConfig.categoryCache?.points).toEqual([{ idx: 0, value: '45292' }]);
    expect(seriesConfig.categoryLevels?.levels[1].points).toEqual([{ idx: 1, value: 'Q2' }]);
    expect(seriesConfig.bubbleSizeCache?.points).toEqual([{ idx: 1, value: '10' }]);
    expect(seriesConfigToWire(seriesConfig)).toEqual(
      expect.objectContaining({
        valueCache: seriesConfig.valueCache,
        valueSourceKind: 'literal',
        categoryCache: seriesConfig.categoryCache,
        categorySourceKind: 'literal',
        categoryLevels: seriesConfig.categoryLevels,
        bubbleSizeCache: seriesConfig.bubbleSizeCache,
        bubbleSizeSourceKind: 'literal',
      }),
    );
  });

  it('round-trips nested series format colors through the wire boundary', () => {
    const seriesConfig = wireToSeriesConfig({
      name: 'Styled',
      format: { fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.1 } } },
      leaderLineFormat: {
        line: { color: { theme: 'accent2', tint_shade: -0.1 }, width: 2 },
      },
      invertColor: { theme: 'accent3', tint_shade: 0.2 },
      markerBackgroundColor: { theme: 'accent4', tint_shade: 0.3 },
      markerForegroundColor: { theme: 'accent5', tint_shade: 0.4 },
      points: [
        {
          idx: 0,
          visualFormat: {
            line: { color: { theme: 'accent6', tint_shade: -0.2 } },
          },
          markerBackgroundColor: { theme: 'lt1', tint_shade: 0.5 },
          markerForegroundColor: { theme: 'dk1', tint_shade: -0.5 },
        },
      ],
      dataLabels: {
        show: true,
        visualFormat: { font: { color: { theme: 'tx1', tint_shade: 0.15 } } },
        richText: [{ text: 'A', font: { color: { theme: 'tx2', tint_shade: -0.15 } } }],
      },
      trendlines: [
        {
          lineFormat: { color: { theme: 'accent1', tint_shade: -0.35 } },
          label: {
            format: { shadow: { color: { theme: 'accent2', tint_shade: 0.35 } } },
          },
        },
      ],
    });

    expect(seriesConfig.format?.fill).toEqual({
      type: 'solid',
      color: { theme: 'accent1', tintShade: 0.1 },
    });
    expect(seriesConfig.leaderLineFormat?.line?.color).toEqual({
      theme: 'accent2',
      tintShade: -0.1,
    });
    expect(seriesConfig.invertColor).toEqual({ theme: 'accent3', tintShade: 0.2 });
    expect(seriesConfig.markerBackgroundColor).toEqual({ theme: 'accent4', tintShade: 0.3 });
    expect(seriesConfig.markerForegroundColor).toEqual({ theme: 'accent5', tintShade: 0.4 });
    expect(seriesConfig.points?.[0]?.visualFormat?.line?.color).toEqual({
      theme: 'accent6',
      tintShade: -0.2,
    });
    expect(seriesConfig.points?.[0]?.markerBackgroundColor).toEqual({
      theme: 'lt1',
      tintShade: 0.5,
    });
    expect(seriesConfig.dataLabels?.visualFormat?.font?.color).toEqual({
      theme: 'tx1',
      tintShade: 0.15,
    });
    expect(seriesConfig.dataLabels?.richText?.[0]?.font?.color).toEqual({
      theme: 'tx2',
      tintShade: -0.15,
    });
    expect(seriesConfig.trendlines?.[0]?.lineFormat?.color).toEqual({
      theme: 'accent1',
      tintShade: -0.35,
    });
    expect(seriesConfig.trendlines?.[0]?.label?.format?.shadow?.color).toEqual({
      theme: 'accent2',
      tintShade: 0.35,
    });

    expect(seriesConfigToWire(seriesConfig)).toMatchObject({
      format: { fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.1 } } },
      leaderLineFormat: {
        line: { color: { theme: 'accent2', tint_shade: -0.1 }, width: 2 },
      },
      invertColor: { theme: 'accent3', tint_shade: 0.2 },
      markerBackgroundColor: { theme: 'accent4', tint_shade: 0.3 },
      markerForegroundColor: { theme: 'accent5', tint_shade: 0.4 },
      points: [
        expect.objectContaining({
          visualFormat: {
            line: { color: { theme: 'accent6', tint_shade: -0.2 } },
          },
          markerBackgroundColor: { theme: 'lt1', tint_shade: 0.5 },
          markerForegroundColor: { theme: 'dk1', tint_shade: -0.5 },
        }),
      ],
      dataLabels: {
        show: true,
        visualFormat: { font: { color: { theme: 'tx1', tint_shade: 0.15 } } },
        richText: [{ text: 'A', font: { color: { theme: 'tx2', tint_shade: -0.15 } } }],
      },
      trendlines: [
        expect.objectContaining({
          lineFormat: { color: { theme: 'accent1', tint_shade: -0.35 } },
          label: {
            format: { shadow: { color: { theme: 'accent2', tint_shade: 0.35 } } },
          },
        }),
      ],
    });
  });

  it('round-trips extended axis render contract fields', () => {
    const axisConfig = wireToAxisConfig({
      secondaryCategoryAxis: {
        visible: true,
        axisType: 'dateAx',
        position: 't',
        tickLabelSpacing: 2,
        tickMarkSpacing: 3,
        tickLabelPosition: 'high',
      },
      valueAxis: {
        visible: true,
        scaleType: 'logarithmic',
        logBase: 2,
        displayUnit: 'millions',
        displayUnitLabel: 'Millions',
        displayUnitLabelLayout: { x: 0.25, yMode: 'edge' },
        format: {
          fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.1 } },
        },
        titleFormat: {
          font: { color: { theme: 'accent2', tint_shade: 0.2 } },
        },
        titleRichText: [
          { text: 'Millions', font: { color: { theme: 'accent3', tint_shade: 0.3 } } },
        ],
        gridlineFormat: { color: { theme: 'accent4', tint_shade: -0.1 }, width: 1 },
        minorGridlineFormat: { color: { theme: 'accent5', tint_shade: -0.2 }, width: 0.5 },
        displayUnitLabelFormat: {
          textRotation: 45,
          shadow: { color: { theme: 'accent6', tint_shade: 0.4 } },
        },
        linkNumberFormat: true,
        crossBetween: 'midCat',
        crossesAt: 'custom',
        crossesAtValue: 7.5,
        minorGridLines: true,
        minorTickMarks: 'cross',
      },
      seriesAxis: {
        visible: true,
        axisType: 'serAx',
      },
    });

    expect(axisConfig.secondaryCategoryAxis).toMatchObject({
      axisType: 'dateAx',
      tickLabelSpacing: 2,
      tickMarkSpacing: 3,
      tickLabelPosition: 'high',
    });
    expect(axisConfig.valueAxis).toMatchObject({
      scaleType: 'logarithmic',
      logBase: 2,
      displayUnit: 'millions',
      displayUnitLabel: 'Millions',
      displayUnitLabelLayout: { x: 0.25, yMode: 'edge' },
      format: { fill: { type: 'solid', color: { theme: 'accent1', tintShade: 0.1 } } },
      titleFormat: { font: { color: { theme: 'accent2', tintShade: 0.2 } } },
      titleRichText: [{ text: 'Millions', font: { color: { theme: 'accent3', tintShade: 0.3 } } }],
      gridlineFormat: { color: { theme: 'accent4', tintShade: -0.1 }, width: 1 },
      minorGridlineFormat: { color: { theme: 'accent5', tintShade: -0.2 }, width: 0.5 },
      displayUnitLabelFormat: {
        textRotation: 45,
        shadow: { color: { theme: 'accent6', tintShade: 0.4 } },
      },
      linkNumberFormat: true,
      crossBetween: 'midCat',
      crossesAt: 'custom',
      crossesAtValue: 7.5,
      minorGridLines: true,
      minorTickMarks: 'cross',
    });
    expect(axisConfigToWire(axisConfig)).toMatchObject({
      secondaryCategoryAxis: {
        tickLabelSpacing: 2,
        tickMarkSpacing: 3,
        tickLabelPosition: 'high',
      },
      valueAxis: {
        scaleType: 'logarithmic',
        displayUnit: 'millions',
        displayUnitLabelLayout: { x: 0.25, yMode: 'edge' },
        format: { fill: { type: 'solid', color: { theme: 'accent1', tint_shade: 0.1 } } },
        titleFormat: { font: { color: { theme: 'accent2', tint_shade: 0.2 } } },
        titleRichText: [
          { text: 'Millions', font: { color: { theme: 'accent3', tint_shade: 0.3 } } },
        ],
        gridlineFormat: { color: { theme: 'accent4', tint_shade: -0.1 }, width: 1 },
        minorGridlineFormat: { color: { theme: 'accent5', tint_shade: -0.2 }, width: 0.5 },
        displayUnitLabelFormat: {
          textRotation: 45,
          shadow: { color: { theme: 'accent6', tint_shade: 0.4 } },
        },
        linkNumberFormat: true,
        crossesAt: 'custom',
        crossesAtValue: 7.5,
      },
      seriesAxis: { axisType: 'serAx' },
    });
  });
});
