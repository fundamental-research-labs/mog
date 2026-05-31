import type {
  ChartBounds,
  ChartRenderFrame,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ChartRenderFrameSnapshot } from '@mog-sdk/contracts/data/charts';

export type NormalizedChartRenderFrame = ChartRenderFrame & {
  width: number;
  height: number;
};

export function normalizeChartRenderFrame(
  bounds: Pick<ChartBounds, 'width' | 'height'>,
  frame: Partial<ChartRenderFrame> = {},
): NormalizedChartRenderFrame {
  return {
    ...frame,
    kind: frame.kind ?? 'embedded',
    width: normalizeRenderDimension(frame.width ?? bounds.width),
    height: normalizeRenderDimension(frame.height ?? bounds.height),
  };
}

export function normalizeRenderDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

export function chartRenderFrameCacheSuffix(frame?: NormalizedChartRenderFrame): string | null {
  if (!frame) return null;
  const parts = [`frame=${frame.kind}`, `w=${frame.width}`, `h=${frame.height}`];
  if (frame.windowViewId !== undefined) parts.push(`view=${frame.windowViewId}`);
  if (frame.zoomToFit !== undefined) parts.push(`zoomToFit=${frame.zoomToFit ? 1 : 0}`);
  if (frame.pageContext !== undefined) {
    parts.push(`page=${stableFrameValue(frame.pageContext)}`);
  }
  return parts.join('::');
}

export function toRenderFrameSnapshot(input: {
  sheetId: SheetId;
  chartId: string;
  frame: NormalizedChartRenderFrame;
}): ChartRenderFrameSnapshot {
  return {
    kind: input.frame.kind,
    sheetId: String(input.sheetId),
    chartId: input.chartId,
    width: input.frame.width,
    height: input.frame.height,
    windowViewId: input.frame.windowViewId,
    zoomToFit: input.frame.zoomToFit,
    pageContext: input.frame.pageContext,
  };
}

function stableFrameValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableFrameValue).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableFrameValue(entryValue)}`)
    .join(',')}}`;
}
