import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';

export function defaultExportOptionsForSize(
  width: number,
  height: number,
): ChartExportOptionsSnapshot {
  return {
    format: 'png',
    width,
    height,
    pixelRatio: 1,
    physicalWidth: Math.max(1, Math.round(width)),
    physicalHeight: Math.max(1, Math.round(height)),
    backgroundColor: '#ffffff',
  };
}

export function snapshotScalar(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

export function hashJson(value: unknown): string {
  const text = stableStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x811c9dc5 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x01000193);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
