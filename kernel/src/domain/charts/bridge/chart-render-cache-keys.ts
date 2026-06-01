import type { SheetId } from '@mog-sdk/contracts/core';

export function matchingChartRenderCacheKeys(
  chartId: string,
  baseKey: string,
  sheetId: SheetId | undefined,
  keySources: Iterable<Iterable<string>>,
): Set<string> {
  const keys = new Set([chartId, baseKey]);
  const framePrefix = `${baseKey}::frame=`;

  for (const source of keySources) {
    for (const key of source) {
      if (isMatchingChartRenderCacheKey(key, chartId, baseKey, framePrefix, sheetId)) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function isMatchingChartRenderCacheKey(
  key: string,
  chartId: string,
  baseKey: string,
  framePrefix: string,
  sheetId?: SheetId,
): boolean {
  if (key === baseKey || key.startsWith(framePrefix)) return true;
  if (sheetId !== undefined) return false;
  return key.endsWith(`::${chartId}`) || key.includes(`::${chartId}::frame=`);
}
