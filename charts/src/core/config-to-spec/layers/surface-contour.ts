import type {
  ChartSpec,
  ContourBandSpec,
  EncodingSpec,
  SurfaceBandFormatSpec,
  UnitSpec,
} from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { resolveChartColor } from '../../../utils/chart-colors';
import { interpolateOklab } from '../../../utils/colors';
import { resolverContextFromConfig } from '../../style-resolver';
import { buildConfigSpec } from '../config-spec';
import { buildLegendSpec } from '../legend';
import { buildUnitSpec, type ChartDimensions } from '../spec-assembly';
import { chartDataToRows } from '../data-rows';

const DEFAULT_BAND_COUNT = 5;
const DEFAULT_SURFACE_3D_BAND_COUNT = 8;
const MAX_AUTO_BAND_COUNT = 12;

const DEFAULT_SURFACE_CONTOUR_COLORS = [
  '#4f81bd',
  '#c0504d',
  '#9bbb59',
  '#8064a2',
  '#31859b',
] as const;

const DEFAULT_SURFACE_3D_COLORS = [
  '#4f81bd',
  '#c0504d',
  '#9bbb59',
  '#8064a2',
  '#31859b',
  '#f79646',
  '#8faadc',
  '#c0504d',
] as const;

type SurfaceContourBandOptions = {
  defaultBandCount?: number;
  defaultColors?: readonly string[];
  labelFractionDigits?: number;
};

export function shouldRenderSurfaceContour(config: ChartConfig): boolean {
  const type = config.type;
  if (type === 'surface' || type === 'surfaceTopView' || type === 'surfaceTopViewWireframe') {
    return true;
  }
  return config.surfaceTopView === true && (type === 'surface3d' || type === 'surfaceWireframe');
}

export function buildSurfaceContourSpec(input: {
  config: ChartConfig;
  data: ChartData;
  dimensions: ChartDimensions;
  title: ChartSpec['title'];
}): UnitSpec {
  const bands = buildSurfaceContourBands(input.config, input.data);
  const rows = chartDataToRows(input.data, input.config);
  const encoding = buildSurfaceContourEncoding(input.config, bands);
  const configSpec = buildConfigSpec(input.config, encoding, input.data);

  return buildUnitSpec({
    dimensions: input.dimensions,
    rows,
    mark: {
      type: 'contour',
      contourBands: bands,
      sourceSurfaceBandFormats: sourceSurfaceBandFormats(input.config),
      contourWireframe:
        input.config.wireframe === true ||
        input.config.type === 'surfaceWireframe' ||
        input.config.type === 'surfaceTopViewWireframe',
    },
    encoding,
    title: input.title,
    config: configSpec,
  });
}

export function buildSurfaceContourBands(
  config: ChartConfig,
  data: ChartData,
  options: SurfaceContourBandOptions = {},
): ContourBandSpec[] {
  const values = finiteSurfaceValues(data);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const defaultBandCount = options.defaultBandCount ?? DEFAULT_BAND_COUNT;
  const valueAxis = config.axis?.valueAxis ?? config.axis?.yAxis;
  const explicitMin = finiteNumber(valueAxis?.min);
  const explicitMax = finiteNumber(valueAxis?.max);
  const explicitStep = finiteNumber(valueAxis?.majorUnit);
  const domainMinSeed = explicitMin ?? (minValue >= 0 ? 0 : minValue);
  const step =
    explicitStep ?? niceStep(Math.max(EPSILON, (maxValue - domainMinSeed) / defaultBandCount));
  const domainMin = explicitMin ?? Math.floor(domainMinSeed / step) * step;
  let domainMax = explicitMax ?? Math.ceil(maxValue / step) * step;
  if (domainMax <= domainMin) domainMax = domainMin + step;

  const bandCount = Math.max(
    1,
    Math.min(MAX_AUTO_BAND_COUNT, Math.ceil((domainMax - domainMin) / step)),
  );
  const colors = surfaceContourColors(config, bandCount, options.defaultColors);
  const labelFractionDigits = options.labelFractionDigits ?? 2;
  const bands: ContourBandSpec[] = [];

  for (let index = 0; index < bandCount; index += 1) {
    const min = domainMin + index * step;
    const max = index === bandCount - 1 ? domainMax : domainMin + (index + 1) * step;
    bands.push({
      min,
      max,
      label: `${formatBandValue(min, labelFractionDigits)}-${formatBandValue(
        max,
        labelFractionDigits,
      )}`,
      color:
        colors[index] ??
        DEFAULT_SURFACE_CONTOUR_COLORS[index % DEFAULT_SURFACE_CONTOUR_COLORS.length],
    });
  }

  return bands;
}

export function buildSurface3DBands(config: ChartConfig, data: ChartData): ContourBandSpec[] {
  return buildSurfaceContourBands(config, data, {
    defaultBandCount: DEFAULT_SURFACE_3D_BAND_COUNT,
    defaultColors: DEFAULT_SURFACE_3D_COLORS,
    labelFractionDigits: 3,
  });
}

export function buildSurfaceContourEncoding(
  config: ChartConfig,
  bands: ContourBandSpec[],
): EncodingSpec {
  return {
    color: {
      field: '__mogContourBandLabel',
      type: 'nominal',
      scale: {
        domain: bands.map((band) => band.label),
        range: bands.map((band) => band.color),
      },
      legend: config.legend
        ? buildLegendSpec(config.legend, config, {
            reverse: true,
            values: bands.map((band) => band.label),
          })
        : undefined,
    },
  };
}

export function sourceSurfaceBandFormats(config: ChartConfig): SurfaceBandFormatSpec[] | undefined {
  const formats = (config.surfaceBandFormats ?? []).flatMap((format): SurfaceBandFormatSpec[] => {
    const index = finiteNumber(format.index);
    if (index === undefined) return [];
    const fillColor =
      typeof format.fillColor === 'string' && format.fillColor.length > 0
        ? format.fillColor
        : undefined;
    return [
      {
        index,
        ...(fillColor ? { fillColor } : {}),
        hasFormatting: format.hasFormatting === true || fillColor !== undefined,
        ...(format.source === 'ooxmlBandFmt' ? { source: 'ooxmlBandFmt' as const } : {}),
      },
    ];
  });
  return formats.length > 0 ? formats : undefined;
}

function finiteSurfaceValues(data: ChartData): number[] {
  const values: number[] = [];
  for (const series of data.series) {
    for (const point of series.data) {
      if (point.valueState !== undefined && point.valueState !== 'value') continue;
      if (finiteNumber(point?.y) !== undefined) values.push(point.y);
    }
  }
  return values;
}

function surfaceContourColors(
  config: ChartConfig,
  count: number,
  defaultColors: readonly string[] = DEFAULT_SURFACE_CONTOUR_COLORS,
): string[] {
  const context = resolverContextFromConfig(config, 'plotArea');
  const configColors = (config.colors ?? [])
    .map((color) => resolveChartColor(color, context))
    .filter((color): color is string => Boolean(color));
  const palette = configColors.length > 0 ? configColors : [...defaultColors];
  if (count <= 0) return [];
  if (count === palette.length) return palette;
  if (count === 1) return [palette[palette.length - 1] ?? DEFAULT_SURFACE_CONTOUR_COLORS[0]];

  const colors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    colors.push(samplePalette(palette, t));
  }
  return colors;
}

function samplePalette(palette: string[], t: number): string {
  if (palette.length === 1) return palette[0];
  const scaled = t * (palette.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(palette.length - 1, leftIndex + 1);
  const localT = scaled - leftIndex;
  const left = palette[leftIndex] ?? palette[0];
  const right = palette[rightIndex] ?? left;
  return interpolateOklab(left, right, localT) ?? left;
}

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = Math.pow(10, exponent);
  const fraction = rawStep / magnitude;
  const niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return niceFraction * magnitude;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatBandValue(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

const EPSILON = 1e-9;
