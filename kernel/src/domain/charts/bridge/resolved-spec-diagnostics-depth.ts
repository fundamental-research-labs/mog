import type { ChartConfig } from '@mog/charts';

export function chartGapDepth(config: ChartConfig): number | undefined {
  return finiteNumber(config.gapDepth) ?? findNumberField(config.extra, ['gapDepth', 'gap_depth']);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findNumberField(value: unknown, keys: readonly string[], depth = 0): number | undefined {
  if (depth > 16 || typeof value !== 'object' || value === null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberField(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = finiteNumber(record[key]);
    if (found !== undefined) return found;
  }
  for (const child of Object.values(record)) {
    const found = findNumberField(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
