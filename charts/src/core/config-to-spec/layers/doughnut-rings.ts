import type { EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { seriesConfigForDataSeries } from '../../series-identity';
import { SERIES_INDEX_FIELD } from '../fields';
import { buildPieDoughnutGeometry } from '../pie-doughnut-geometry';
import { hasMultipleDoughnutSeries } from '../pie-like';
import { isNoFillNoLineSeries } from '../style';

export function shouldBuildDoughnutRingLayers(config: ChartConfig, data: ChartData): boolean {
  return hasMultipleDoughnutSeries(config, data) && visibleSeriesIndices(config, data).length > 1;
}

export function buildDoughnutRingLayers(input: {
  config: ChartConfig;
  data: ChartData;
  mark: UnitSpec['mark'];
  encoding: EncodingSpec;
}): UnitSpec[] {
  const seriesIndices = visibleSeriesIndices(input.config, input.data);
  const baseMark = arcMarkSpec(input.mark);
  const geometry = buildPieDoughnutGeometry({
    config: input.config,
    data: input.data,
    chartWidth: 2,
    chartHeight: 2,
    plotArea: { x: 0, y: 0, width: 2, height: 2 },
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeries(seriesConfig),
  });

  return seriesIndices.map((seriesIndex, ringIndex) => {
    const band = geometry?.rings[ringIndex] ?? { innerRadiusRatio: 0, outerRadiusRatio: 1 };
    return {
      mark: {
        ...baseMark,
        innerRadius: band.innerRadiusRatio,
        outerRadius: band.outerRadiusRatio,
      },
      encoding: input.encoding,
      transform: [{ type: 'filter', filter: { field: SERIES_INDEX_FIELD, equal: seriesIndex } }],
    };
  });
}

function visibleSeriesIndices(config: ChartConfig, data: ChartData): number[] {
  const seriesConfigs = config.series ?? [];
  const indices: number[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    const series = data.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, index);
    if (isNoFillNoLineSeries(seriesConfig)) continue;
    indices.push(index);
  }
  return indices;
}

function arcMarkSpec(mark: UnitSpec['mark']): MarkSpec {
  return typeof mark === 'object' && mark.type === 'arc' ? mark : { type: 'arc' };
}
