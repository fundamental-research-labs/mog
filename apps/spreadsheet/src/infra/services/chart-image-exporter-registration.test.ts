import { jest } from '@jest/globals';

import { ChartImageExporterImpl, installChartImageExporter } from './index';

describe('installChartImageExporter', () => {
  it('registers the DOM chart image exporter against the document handle', () => {
    const registerChartImageExporter = jest.fn();

    installChartImageExporter({ registerChartImageExporter });

    expect(registerChartImageExporter).toHaveBeenCalledTimes(1);
    const factory = registerChartImageExporter.mock.calls[0][0];
    const chartBridge = { getMarksAtSize: jest.fn() };

    expect(factory(chartBridge)).toBeInstanceOf(ChartImageExporterImpl);
  });
});
