type PivotStyleFamily = 'light' | 'medium' | 'dark';

const PIVOT_STYLE_RANGES: Record<PivotStyleFamily, number> = {
  light: 28,
  medium: 28,
  dark: 28,
};

function normalizeStyleInput(styleName: string | undefined | null): string | null {
  if (styleName == null) return null;
  const normalized = styleName.trim();
  return normalized ? normalized : null;
}

function isValidBuiltInStyle(family: string, index: string): family is PivotStyleFamily {
  const normalizedFamily = family.toLowerCase() as PivotStyleFamily;
  const max = PIVOT_STYLE_RANGES[normalizedFamily];
  if (!max) return false;
  const numericIndex = Number(index);
  return Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= max;
}

function canonicalFamily(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
}

export function pivotStyleIdForCompute(styleName: string | undefined | null): string | null {
  const normalized = normalizeStyleInput(styleName);
  if (!normalized) return null;

  const full = normalized.match(/^PivotStyle(Light|Medium|Dark)(\d+)$/i);
  if (full && isValidBuiltInStyle(full[1], full[2])) {
    return `PivotStyle${canonicalFamily(full[1])}${Number(full[2])}`;
  }

  const short = normalized.match(/^(light|medium|dark)(\d+)$/i);
  if (short && isValidBuiltInStyle(short[1], short[2])) {
    return `PivotStyle${canonicalFamily(short[1])}${Number(short[2])}`;
  }

  return normalized;
}

export function publicPivotStyleId(styleName: string | undefined | null): string | undefined {
  return pivotStyleIdForCompute(styleName) ?? undefined;
}
