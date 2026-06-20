const CHART_WIDTH_PX_PER_CELL = 80;
const CHART_HEIGHT_PX_PER_CELL = 20;
const CHART_PX_PER_PT = 96 / 72;
const CHART_EMU_PER_PT = 12700;
const CHART_EMU_PER_PX = 9525;

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function chartWidthCellsToPixels(widthCells: number | null | undefined): number | undefined {
  return finiteNumber(widthCells) ? widthCells * CHART_WIDTH_PX_PER_CELL : undefined;
}

export function chartHeightCellsToPixels(
  heightCells: number | null | undefined,
): number | undefined {
  return finiteNumber(heightCells) ? heightCells * CHART_HEIGHT_PX_PER_CELL : undefined;
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

export function chartWidthPixelsToCells(widthPx: number | null | undefined): number | undefined {
  return finiteNumber(widthPx) ? widthPx / CHART_WIDTH_PX_PER_CELL : undefined;
}

export function chartHeightPixelsToCells(heightPx: number | null | undefined): number | undefined {
  return finiteNumber(heightPx) ? heightPx / CHART_HEIGHT_PX_PER_CELL : undefined;
}

export function resolveChartWidthCells(
  widthCells: number | null | undefined,
  widthPx: number | null | undefined,
): number | undefined {
  return finiteNumber(widthCells) ? widthCells : chartWidthPixelsToCells(widthPx);
}

export function resolveChartHeightCells(
  heightCells: number | null | undefined,
  heightPx: number | null | undefined,
): number | undefined {
  return finiteNumber(heightCells) ? heightCells : chartHeightPixelsToCells(heightPx);
}
