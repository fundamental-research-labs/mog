import type { ResolvedColor } from './chart-color-types';

export function normalizeChartHexColor(
  value: string,
  options: { uppercase?: boolean } = {},
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

export function normalizeDirectColorString(value: string): string | undefined {
  const trimmed = value.trim();
  return normalizeChartHexColor(trimmed) ?? (trimmed.startsWith('#') ? trimmed : undefined);
}

export function resolveDirectColor(color: string | undefined): ResolvedColor | undefined {
  if (!color) return undefined;
  const normalized = normalizeChartHexColor(color, { uppercase: true });
  return normalized ? { color: normalized } : { color };
}
