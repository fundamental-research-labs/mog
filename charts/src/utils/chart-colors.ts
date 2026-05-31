import type { ChartColor, ChartFill, ChartFormat } from '../types';

export type ChartThemeColorReference = {
  theme: string;
  tintShade?: number;
  tint_shade?: number;
};

export type ChartWorkbookThemeColorPalette = Record<string, string>;

export type ChartWorkbookThemeColorEntry = {
  name: string;
  color: string;
};

type ResolveChartColorOptions = {
  palette?: ChartWorkbookThemeColorPalette;
};

type NormalizeHexOptions = {
  uppercase?: boolean;
};

export function normalizeChartHexColor(
  value: string,
  options: NormalizeHexOptions = {},
): string | undefined {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const format = (normalized: string) =>
    `#${options.uppercase ? normalized.toUpperCase() : normalized}`;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return format(hex);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return format(
      hex
        .split('')
        .map((ch) => ch + ch)
        .join(''),
    );
  }
  return undefined;
}

function normalizeDirectColorString(value: string): string | undefined {
  const trimmed = value.trim();
  return normalizeChartHexColor(trimmed) ?? (trimmed.startsWith('#') ? trimmed : undefined);
}

export function ooxmlSchemeColorHex(value: string): string | undefined {
  switch (value) {
    case 'Dk1':
    case 'dk1':
    case 'Tx1':
    case 'tx1':
      return '#000000';
    case 'Lt1':
    case 'lt1':
    case 'Bg1':
    case 'bg1':
      return '#FFFFFF';
    case 'Dk2':
    case 'dk2':
    case 'Tx2':
    case 'tx2':
      return '#1F497D';
    case 'Lt2':
    case 'lt2':
    case 'Bg2':
    case 'bg2':
      return '#EEECE1';
    case 'Accent1':
    case 'accent1':
      return '#4472C4';
    case 'Accent2':
    case 'accent2':
      return '#ED7D31';
    case 'Accent3':
    case 'accent3':
      return '#A5A5A5';
    case 'Accent4':
    case 'accent4':
      return '#FFC000';
    case 'Accent5':
    case 'accent5':
      return '#5B9BD5';
    case 'Accent6':
    case 'accent6':
      return '#70AD47';
    case 'Hlink':
    case 'hlink':
      return '#0563C1';
    case 'FolHlink':
    case 'folHLink':
    case 'folHlink':
      return '#954F72';
    default:
      return undefined;
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

export function applyChartTintShade(hexColor: string, tintShade: number | undefined): string {
  if (tintShade === undefined || tintShade === 0) return hexColor;
  const tintAmount =
    tintShade > 0 && tintShade <= 1 ? (tintShade > 0.5 ? 1 - tintShade : tintShade) : tintShade;
  const normalized = normalizeChartHexColor(hexColor);
  if (!normalized) return hexColor;
  const hex = normalized.slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [h, s, l] = rgbToHsl(r, g, b);
  const adjustedL =
    tintAmount > 0 ? l * (1 - tintAmount) + tintAmount : l * Math.max(0, 1 + tintAmount);
  const [outR, outG, outB] = hslToRgb(h, s, Math.max(0, Math.min(1, adjustedL)));
  const channels = [outR, outG, outB].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * 255))),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function chartThemeSlotKey(theme: string): string {
  switch (theme.toLowerCase()) {
    case 'tx1':
      return 'dk1';
    case 'bg1':
      return 'lt1';
    case 'tx2':
      return 'dk2';
    case 'bg2':
      return 'lt2';
    case 'folhlink':
      return 'folhlink';
    default:
      return theme.toLowerCase();
  }
}

export function chartThemeColorKey(color: ChartColor | undefined): string | undefined {
  return typeof color === 'object' && color !== null ? color.theme.toLowerCase() : undefined;
}

export function chartColorTintShade(
  color: ChartColor | ChartThemeColorReference | undefined,
): number | undefined {
  if (!color || typeof color !== 'object') return undefined;
  const wireColor = color as ChartThemeColorReference;
  return wireColor.tintShade ?? wireColor.tint_shade;
}

function isThemeColorReference(value: unknown): value is ChartThemeColorReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { theme?: unknown }).theme === 'string'
  );
}

export function resolveChartThemeColorReference(
  color: ChartThemeColorReference,
  palette: ChartWorkbookThemeColorPalette,
): string | ChartThemeColorReference {
  const base = palette[chartThemeSlotKey(color.theme)];
  if (!base) return color;
  return applyChartTintShade(base, chartColorTintShade(color));
}

export function resolveChartColor(
  color: ChartColor | ChartThemeColorReference | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  if (typeof color === 'string') return normalizeDirectColorString(color) ?? color;
  if (!color || typeof color !== 'object') return undefined;
  const base =
    options.palette?.[chartThemeSlotKey(color.theme)] ?? ooxmlSchemeColorHex(color.theme);
  return base ? applyChartTintShade(base, chartColorTintShade(color)) : undefined;
}

export function resolveChartTextColor(color: ChartColor | undefined): string | undefined {
  if (chartColorTintShade(color) !== undefined) return resolveChartColor(color);
  if (chartThemeColorKey(color) === 'tx1') return '#595959';
  return resolveChartColor(color);
}

export function resolveGridlineColor(color: ChartColor | undefined): string | undefined {
  return resolveChartColor(color);
}

export function resolveSolidFillColor(fill: ChartFill | undefined): string | undefined {
  if (!fill || fill.type !== 'solid') return undefined;
  return resolveChartColor(fill.color);
}

export function resolveFormatFillColor(format: ChartFormat | undefined): string | undefined {
  return resolveSolidFillColor(format?.fill);
}

export function resolveFormatFillOpacity(format: ChartFormat | undefined): number | undefined {
  const transparency = format?.fill?.type === 'solid' ? format.fill.transparency : undefined;
  if (typeof transparency !== 'number' || !Number.isFinite(transparency)) return undefined;
  return Math.max(0, Math.min(1, 1 - transparency));
}

export function resolveLineColor(line: ChartFormat['line'] | undefined): string | undefined {
  return resolveChartColor(line?.color);
}

export function resolveFormatLineColor(format: ChartFormat | undefined): string | undefined {
  return resolveChartColor(format?.line?.color);
}

export function chartStyleRepeatThemeColor(
  theme: string | undefined,
  sourceSeriesIndex: number,
): string | undefined {
  if (sourceSeriesIndex < 6 || !theme) return undefined;
  switch (theme.toLowerCase()) {
    case 'accent1':
      return '#264478';
    case 'accent2':
      return '#9E480E';
    case 'accent3':
      return '#636363';
    default:
      return undefined;
  }
}

export function applyWorkbookThemePalette<T>(
  value: T,
  palette: ChartWorkbookThemeColorPalette,
): T {
  if (Array.isArray(value)) {
    return value.map((item) => applyWorkbookThemePalette(item, palette)) as T;
  }
  if (isThemeColorReference(value)) {
    return resolveChartThemeColorReference(value, palette) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = applyWorkbookThemePalette(item, palette);
    }
    return output as T;
  }
  return value;
}

export function createChartWorkbookThemeColorPalette(
  colors: readonly ChartWorkbookThemeColorEntry[] | null | undefined,
): ChartWorkbookThemeColorPalette | null {
  if (!Array.isArray(colors) || colors.length === 0) return null;

  const palette: ChartWorkbookThemeColorPalette = {};
  for (const color of colors) {
    const normalized = normalizeChartHexColor(color.color, { uppercase: true });
    if (normalized) palette[chartThemeSlotKey(color.name)] = normalized;
  }
  return Object.keys(palette).length > 0 ? palette : null;
}
