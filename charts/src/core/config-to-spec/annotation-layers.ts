import type { ChartSpec, DataRow, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import {
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  MARKER_VISIBLE_FIELD,
  POINT_STYLE_VISIBLE_FIELD,
} from './fields';
import { buildAnalysisLineLayers } from './layers/analysis-lines';
import { buildDataLabelLayers, buildLeaderLineLayers } from './layers/data-labels';
import { buildDataTableLayers } from './layers/data-table';
import { buildErrorBarLayers } from './layers/error-bars';
import { buildMarkerLayers, buildPointStyleLayers } from './layers/markers';
import { buildTrendlineLayers } from './layers/trendlines';

export function buildAnnotationLayers(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
  rows: DataRow[],
  options: { includeMarkers?: boolean } = {},
): ChartSpec[] {
  return [
    ...buildAnalysisLineLayers(config, encoding, rows),
    ...(hasRowFlag(rows, ERROR_BAR_VISIBLE_FIELD) ? buildErrorBarLayers(encoding, rows) : []),
    ...buildTrendlineLayers(config, data, encoding, rows),
    ...(hasRowFlag(rows, DATA_LABEL_LEADER_VISIBLE_FIELD) ? buildLeaderLineLayers(encoding) : []),
    ...(hasRowFlag(rows, DATA_LABEL_VISIBLE_FIELD) ? buildDataLabelLayers(encoding) : []),
    ...buildDataTableLayers(config, data),
    ...(isAreaChart(config.type) && hasRowFlag(rows, POINT_STYLE_VISIBLE_FIELD)
      ? buildPointStyleLayers(encoding)
      : []),
    ...(options.includeMarkers !== false && hasRowFlag(rows, MARKER_VISIBLE_FIELD)
      ? buildMarkerLayers(encoding)
      : []),
  ];
}

function hasRowFlag(rows: DataRow[], field: string): boolean {
  return rows.some((row) => row[field] === true);
}

function isAreaChart(type: ChartConfig['type']): boolean {
  return type === 'area' || type === 'area3d';
}
