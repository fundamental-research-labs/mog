import type { TableStyle, TableStylePreset } from '@mog-sdk/contracts/tables';

type TableStyleFamily = 'light' | 'medium' | 'dark';

const TABLE_STYLE_RANGES: Record<TableStyleFamily, number> = {
  light: 28,
  medium: 28,
  dark: 11,
};

function normalizeStyleInput(styleName: string | undefined | null): string | null {
  if (styleName == null) return null;
  const normalized = styleName.trim();
  return normalized ? normalized : null;
}

function isValidBuiltInStyle(family: string, index: string): family is TableStyleFamily {
  const normalizedFamily = family.toLowerCase() as TableStyleFamily;
  const max = TABLE_STYLE_RANGES[normalizedFamily];
  if (!max) return false;
  const numericIndex = Number(index);
  return Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= max;
}

function canonicalFamily(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
}

export function tableStylePresetFromStyleId(
  styleName: string | undefined | null,
): TableStylePreset | undefined {
  const normalized = normalizeStyleInput(styleName);
  if (!normalized) return undefined;
  if (normalized === 'none') return 'none';

  const full = normalized.match(/^TableStyle(Light|Medium|Dark)(\d+)$/i);
  if (full && isValidBuiltInStyle(full[1], full[2])) {
    return `${full[1].toLowerCase()}${Number(full[2])}` as TableStylePreset;
  }

  const short = normalized.match(/^(light|medium|dark)(\d+)$/i);
  if (short && isValidBuiltInStyle(short[1], short[2])) {
    return `${short[1].toLowerCase()}${Number(short[2])}` as TableStylePreset;
  }

  return undefined;
}

export function tableStyleIdForCompute(styleName: string | undefined | null): string | null {
  const normalized = normalizeStyleInput(styleName);
  if (!normalized) return null;
  if (normalized === 'none') return 'none';

  const full = normalized.match(/^TableStyle(Light|Medium|Dark)(\d+)$/i);
  if (full && isValidBuiltInStyle(full[1], full[2])) {
    return `TableStyle${canonicalFamily(full[1])}${Number(full[2])}`;
  }

  const short = normalized.match(/^(light|medium|dark)(\d+)$/i);
  if (short && isValidBuiltInStyle(short[1], short[2])) {
    return `TableStyle${canonicalFamily(short[1])}${Number(short[2])}`;
  }

  return normalized;
}

export function tableStyleIdForTableEngine(
  styleName: string | undefined | null,
  fallback: string = 'TableStyleMedium2',
): string {
  const computeId = tableStyleIdForCompute(styleName);
  if (!computeId || computeId === 'none') return fallback;
  return tableStylePresetFromStyleId(computeId) ? computeId : fallback;
}

export function tableStyleForEventConfig(
  styleName: string | undefined | null,
  flags: Omit<TableStyle, 'preset' | 'custom'> = {},
): TableStyle {
  const preset = tableStylePresetFromStyleId(styleName);
  return preset ? { preset, ...flags } : { ...flags };
}

export function publicTableStyleId(styleName: string | undefined | null): string | undefined {
  const normalized = normalizeStyleInput(styleName);
  if (!normalized) return undefined;
  return tableStyleIdForCompute(normalized) ?? normalized;
}
