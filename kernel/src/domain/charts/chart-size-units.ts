const CHART_WIDTH_PX_PER_CELL = 80;
const CHART_HEIGHT_PX_PER_CELL = 20;
const CHART_PX_PER_PT = 96 / 72;
const CHART_EMU_PER_PT = 12700;
const CHART_EMU_PER_PX = 9525;

export const DEFAULT_CHART_WIDTH_PT = 480;
export const DEFAULT_CHART_HEIGHT_PT = 225;
export const DEFAULT_CHART_WIDTH_PX = DEFAULT_CHART_WIDTH_PT * CHART_PX_PER_PT;
export const DEFAULT_CHART_HEIGHT_PX = DEFAULT_CHART_HEIGHT_PT * CHART_PX_PER_PT;

export interface StoredChartSizeSource {
  anchor?: {
    extentCxEmu?: number | null;
    extentCyEmu?: number | null;
  } | null;
  widthPt?: number | null;
  heightPt?: number | null;
  // `width` and `height` are stored pixel fields on ChartFloatingObject.
  // Public ChartConfig dimensions are points and should use widthPt/heightPt.
  width?: number | null;
  height?: number | null;
  widthCells?: number | null;
  heightCells?: number | null;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveNumber(value: number | null | undefined): value is number {
  return finiteNumber(value) && value > 0;
}

export function chartWidthCellsToPixels(widthCells: number | null | undefined): number | undefined {
  return positiveNumber(widthCells) ? widthCells * CHART_WIDTH_PX_PER_CELL : undefined;
}

export function chartHeightCellsToPixels(
  heightCells: number | null | undefined,
): number | undefined {
  return positiveNumber(heightCells) ? heightCells * CHART_HEIGHT_PX_PER_CELL : undefined;
}

export function chartPointsToPixels(points: number | null | undefined): number | undefined {
  return finiteNumber(points) ? points * CHART_PX_PER_PT : undefined;
}

export function chartPixelsToPoints(pixels: number | null | undefined): number | undefined {
  return finiteNumber(pixels) ? pixels / CHART_PX_PER_PT : undefined;
}

export function chartPointsToEmu(points: number | null | undefined): number | undefined {
  return finiteNumber(points) ? points * CHART_EMU_PER_PT : undefined;
}

export function chartPixelsToEmu(pixels: number | null | undefined): number | undefined {
  return finiteNumber(pixels) ? pixels * CHART_EMU_PER_PX : undefined;
}

export function chartEmuToPoints(emu: number | null | undefined): number | undefined {
  return finiteNumber(emu) ? emu / CHART_EMU_PER_PT : undefined;
}

function chartDimensionPixelsToPoints(pixels: number | null | undefined): number | undefined {
  return positiveNumber(pixels) ? pixels / CHART_PX_PER_PT : undefined;
}

function chartDimensionEmuToPoints(emu: number | null | undefined): number | undefined {
  const points = chartEmuToPoints(emu);
  return positiveNumber(points) ? points : undefined;
}

function chartWidthCellsToPoints(widthCells: number | null | undefined): number | undefined {
  return chartDimensionPixelsToPoints(chartWidthCellsToPixels(widthCells));
}

function chartHeightCellsToPoints(heightCells: number | null | undefined): number | undefined {
  return chartDimensionPixelsToPoints(chartHeightCellsToPixels(heightCells));
}

export function chartWidthPixelsToCells(widthPx: number | null | undefined): number | undefined {
  return positiveNumber(widthPx) ? widthPx / CHART_WIDTH_PX_PER_CELL : undefined;
}

export function chartHeightPixelsToCells(heightPx: number | null | undefined): number | undefined {
  return positiveNumber(heightPx) ? heightPx / CHART_HEIGHT_PX_PER_CELL : undefined;
}

export function resolveStoredChartWidthPoints(chart: StoredChartSizeSource): number | undefined {
  return (
    chartDimensionEmuToPoints(chart.anchor?.extentCxEmu) ??
    (positiveNumber(chart.widthPt) ? chart.widthPt : undefined) ??
    chartDimensionPixelsToPoints(chart.width) ??
    chartWidthCellsToPoints(chart.widthCells)
  );
}

export function resolveStoredChartHeightPoints(chart: StoredChartSizeSource): number | undefined {
  return (
    chartDimensionEmuToPoints(chart.anchor?.extentCyEmu) ??
    (positiveNumber(chart.heightPt) ? chart.heightPt : undefined) ??
    chartDimensionPixelsToPoints(chart.height) ??
    chartHeightCellsToPoints(chart.heightCells)
  );
}

export function resolveStoredChartWidthPixels(chart: StoredChartSizeSource): number | undefined {
  return chartPointsToPixels(resolveStoredChartWidthPoints(chart));
}

export function resolveStoredChartHeightPixels(chart: StoredChartSizeSource): number | undefined {
  return chartPointsToPixels(resolveStoredChartHeightPoints(chart));
}

export function resolveStoredChartWidthCellSpan(chart: StoredChartSizeSource): number | undefined {
  return chartWidthPixelsToCells(resolveStoredChartWidthPixels(chart));
}

export function resolveStoredChartHeightCellSpan(chart: StoredChartSizeSource): number | undefined {
  return chartHeightPixelsToCells(resolveStoredChartHeightPixels(chart));
}
