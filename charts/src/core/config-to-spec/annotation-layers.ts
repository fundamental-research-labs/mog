import type { ChartSpec, DataRow, EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import {
  BLANK_VALUE_FIELD,
  DATA_LABEL_LEADER_VISIBLE_FIELD,
  DATA_LABEL_VISIBLE_FIELD,
  ERROR_BAR_VISIBLE_FIELD,
  MARKER_SIZE_FIELD,
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
    ...(hasRowFlag(rows, DATA_LABEL_LEADER_VISIBLE_FIELD)
      ? buildLeaderLineLayers(encoding, config)
      : []),
    ...(hasRowFlag(rows, DATA_LABEL_VISIBLE_FIELD) ? buildDataLabelLayers(encoding, config) : []),
    ...buildDataTableLayers(config, data),
    ...(isAreaChart(config.type) && hasRowFlag(rows, POINT_STYLE_VISIBLE_FIELD)
      ? buildPointStyleLayers(encoding)
      : []),
    ...(options.includeMarkers !== false && hasRowFlag(rows, MARKER_VISIBLE_FIELD)
      ? buildMarkerLayers(encoding)
      : []),
  ];
}

export function composePrimaryAndAnnotationLayers(input: {
  config: ChartConfig;
  mark: ChartSpec['mark'];
  encoding: EncodingSpec;
  rows: DataRow[];
  annotationLayers: ChartSpec[];
}): ChartSpec[] {
  const primaryLayer: ChartSpec = { mark: input.mark, encoding: input.encoding };
  if (markerLayerReplacesPrimaryScatterPoints(input)) {
    return input.annotationLayers;
  }
  return [primaryLayer, ...input.annotationLayers];
}

function hasRowFlag(rows: DataRow[], field: string): boolean {
  return rows.some((row) => row[field] === true);
}

function markerLayerReplacesPrimaryScatterPoints(input: {
  config: ChartConfig;
  mark: ChartSpec['mark'];
  rows: DataRow[];
  annotationLayers: ChartSpec[];
}): boolean {
  if (input.config.type !== 'scatter') return false;
  const markType = typeof input.mark === 'string' ? input.mark : input.mark?.type;
  if (markType !== 'point') return false;
  if (input.rows.length === 0) return false;
  if (!input.annotationLayers.some((layer) => layer.encoding?.size?.field === MARKER_SIZE_FIELD)) {
    return false;
  }
  return input.rows.every(
    (row) => row[BLANK_VALUE_FIELD] === true || row[MARKER_VISIBLE_FIELD] === true,
  );
}

function isAreaChart(type: ChartConfig['type']): boolean {
  return type === 'area' || type === 'area3d';
}
