import type { ChartColor, ChartColorMapOverride, ChartWorkbookThemeData } from '../types';
import type {
  ChartThemeColorReference,
  ChartWorkbookThemeColorEntry,
  ChartWorkbookThemeColorPalette,
} from './chart-color-types';
import { normalizeChartHexColor } from './chart-color-normalization';

export function ooxmlSchemeColorHex(value: string): string | undefined {
  switch (normalizeThemeSlotKey(value)) {
    case 'dk1':
    case 'tx1':
      return '#000000';
    case 'lt1':
    case 'bg1':
      return '#FFFFFF';
    case 'dk2':
    case 'tx2':
      return '#1F497D';
    case 'lt2':
    case 'bg2':
      return '#EEECE1';
    case 'accent1':
      return '#4472C4';
    case 'accent2':
      return '#ED7D31';
    case 'accent3':
      return '#A5A5A5';
    case 'accent4':
      return '#FFC000';
    case 'accent5':
      return '#5B9BD5';
    case 'accent6':
      return '#70AD47';
    case 'hlink':
      return '#0563C1';
    case 'folhlink':
      return '#954F72';
    default:
      return undefined;
  }
}

export function normalizeThemeSlotKey(theme: string): string {
  return theme.replace(/_/g, '').toLowerCase();
}

export function chartThemeSlotKey(theme: string): string {
  switch (normalizeThemeSlotKey(theme)) {
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
      return normalizeThemeSlotKey(theme);
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

export function isThemeColorReference(value: unknown): value is ChartThemeColorReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { theme?: unknown }).theme === 'string'
  );
}

export function colorSchemeField(slot: string): string {
  const key = chartThemeSlotKey(slot);
  return key === 'folhlink' ? 'fol_hlink' : key;
}

function colorMapValue(
  mapping: ChartColorMapOverride | undefined,
  logicalSlot: string,
): string | undefined {
  if (!mapping || mapping.type !== 'override') return undefined;
  const normalized = normalizeThemeSlotKey(logicalSlot);
  const raw = mapping.mapping as Record<string, string | undefined>;
  return raw[normalized] ?? raw[normalized === 'folhlink' ? 'folHlink' : normalized];
}

export function mappedThemeSlot(
  logicalSlot: string,
  colorMapOverride: ChartColorMapOverride | undefined,
): string {
  return colorMapValue(colorMapOverride, logicalSlot) ?? logicalSlot;
}

export function themePalette(
  theme: ChartWorkbookThemeData | null | undefined,
): ChartWorkbookThemeColorPalette {
  const palette: ChartWorkbookThemeColorPalette = {};
  for (const color of theme?.colors ?? []) {
    const normalized = normalizeChartHexColor(color.color, { uppercase: true });
    if (normalized) palette[chartThemeSlotKey(color.name)] = normalized;
  }
  return palette;
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
