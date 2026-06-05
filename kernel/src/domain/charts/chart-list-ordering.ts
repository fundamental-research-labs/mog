/**
 * Chart collection ordering helpers.
 */

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';

function importedDrawingFrameAnchorIndex(chart: ChartFloatingObject): number | undefined {
  const anchorIndex = chart.ooxml?.drawingFrame?.anchorIndex;
  return typeof anchorIndex === 'number' && Number.isFinite(anchorIndex) ? anchorIndex : undefined;
}

export function orderChartsForList(charts: ChartFloatingObject[]): ChartFloatingObject[] {
  const entries = charts.map((chart, originalIndex) => ({
    chart,
    originalIndex,
    anchorIndex: importedDrawingFrameAnchorIndex(chart),
  }));

  const orderedImportedEntries = entries
    .filter(
      (entry): entry is typeof entry & { anchorIndex: number } => entry.anchorIndex !== undefined,
    )
    .sort((a, b) => a.anchorIndex - b.anchorIndex || a.originalIndex - b.originalIndex);

  let importedEntryIndex = 0;
  return entries.map((entry) => {
    if (entry.anchorIndex === undefined) return entry.chart;
    return orderedImportedEntries[importedEntryIndex++].chart;
  });
}
