import type { EncodingSpec, MarkSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { seriesConfigForDataSeries } from '../../series-identity';
import { SERIES_INDEX_FIELD } from '../fields';
import { doughnutRingBand, hasMultipleDoughnutSeries } from '../pie-like';
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

  return seriesIndices.map((seriesIndex, ringIndex) => {
    const band = doughnutRingBand({
      config: input.config,
      ringCount: seriesIndices.length,
      ringIndex,
    });
    return {
      mark: {
        ...baseMark,
        innerRadius: band.innerRadius,
        outerRadius: band.outerRadius,
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
