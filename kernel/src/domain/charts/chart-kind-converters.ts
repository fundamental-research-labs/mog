import type { ChartConfig, ChartType } from '@mog-sdk/contracts/data/charts';

const SIZE_REPRESENTS_VALUES = ['area', 'w'] as const satisfies readonly NonNullable<
  ChartConfig['sizeRepresents']
>[];
type SizeRepresents = (typeof SIZE_REPRESENTS_VALUES)[number];

const CHART_TYPES = [
  'bar',
  'column',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
  'bubble',
  'combo',
  'radar',
  'stock',
  'funnel',
  'waterfall',
  'surface',
  'surface3d',
  'ofPie',
  'bar3d',
  'column3d',
  'line3d',
  'pie3d',
  'area3d',
  'histogram',
  'boxplot',
  'heatmap',
  'violin',
  'pareto',
  'treemap',
  'sunburst',
  'regionMap',
  'pieExploded',
  'pie3dExploded',
  'doughnutExploded',
  'bubble3DEffect',
  'surfaceWireframe',
  'surfaceTopView',
  'surfaceTopViewWireframe',
  'lineMarkers',
  'lineMarkersStacked',
  'lineMarkersStacked100',
  'cylinderColClustered',
  'cylinderColStacked',
  'cylinderColStacked100',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'cylinderCol',
  'coneColClustered',
  'coneColStacked',
  'coneColStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'coneCol',
  'pyramidColClustered',
  'pyramidColStacked',
  'pyramidColStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
  'pyramidCol',
] as const satisfies readonly ChartType[];

export type ChartTypeNarrowingDiagnostic = {
  code: 'acceptedChartTypeAlias' | 'unsupportedChartType';
  message: string;
  rawType: string;
  canonicalType?: ChartType;
};

export type WireChartTypeToConfigResult =
  | { type: ChartType; diagnostics: ChartTypeNarrowingDiagnostic[] }
  | { type: undefined; diagnostics: ChartTypeNarrowingDiagnostic[] };

const CHART_TYPE_ALIASES: Record<string, ChartType> = {
  bar3D: 'bar3d',
  column3D: 'column3d',
  line3D: 'line3d',
  pie3D: 'pie3d',
  area3D: 'area3d',
  surface3D: 'surface3d',
  boxWhisker: 'boxplot',
  paretoLine: 'pareto',
};

/**
 * Narrow a loose wire string into one of the allowed literals, or `undefined`
 * if the wire value is absent or violates the contract.
 */
function narrowEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (value == null) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[chart-type-converters] dropping unknown ${fieldName}="${value}" — not in allowed set`,
    );
  }
  return undefined;
}

export function wireChartTypeToConfig(
  value: string | null | undefined,
): WireChartTypeToConfigResult {
  const rawType = value?.trim();
  if (!rawType) return { type: undefined, diagnostics: [] };

  if ((CHART_TYPES as readonly string[]).includes(rawType)) {
    return { type: rawType as ChartType, diagnostics: [] };
  }

  const alias = CHART_TYPE_ALIASES[rawType];
  if (alias) {
    return {
      type: alias,
      diagnostics: [
        {
          code: 'acceptedChartTypeAlias',
          message: `Imported chart type "${rawType}" was canonicalized to "${alias}"`,
          rawType,
          canonicalType: alias,
        },
      ],
    };
  }

  return {
    type: undefined,
    diagnostics: [
      {
        code: 'unsupportedChartType',
        message: `Imported chart type "${rawType}" is not supported`,
        rawType,
      },
    ],
  };
}

export function wireToSizeRepresents(
  value: string | null | undefined,
): ChartConfig['sizeRepresents'] {
  return narrowEnum<SizeRepresents>(value, SIZE_REPRESENTS_VALUES, 'Chart.sizeRepresents');
}
