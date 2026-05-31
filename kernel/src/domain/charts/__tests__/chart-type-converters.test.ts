import {
  axisConfigToWire,
  seriesConfigToWire,
  wireToAxisConfig,
  wireChartTypeToConfig,
  wireToLegendConfig,
  wireToSeriesConfig,
} from '../chart-type-converters';

describe('chart-type-converters', () => {
  it('narrows canonical and aliased chart type strings at the wire boundary', () => {
    expect(wireChartTypeToConfig('funnel')).toEqual({ type: 'funnel', diagnostics: [] });
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
      categoryCache: {
        pointCount: 4,
        formatCode: 'm/d/yyyy',
        points: [{ idx: 0, value: '45292' }],
      },
      bubbleSizeCache: {
        pointCount: 2,
        points: [{ idx: 1, value: '10' }],
      },
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
    expect(seriesConfig.bubbleSizeCache?.points).toEqual([{ idx: 1, value: '10' }]);
    expect(seriesConfigToWire(seriesConfig)).toEqual(
      expect.objectContaining({
        valueCache: seriesConfig.valueCache,
        categoryCache: seriesConfig.categoryCache,
        bubbleSizeCache: seriesConfig.bubbleSizeCache,
      }),
    );
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
        linkNumberFormat: true,
        crossesAt: 'custom',
        crossesAtValue: 7.5,
      },
      seriesAxis: { axisType: 'serAx' },
    });
  });
});
