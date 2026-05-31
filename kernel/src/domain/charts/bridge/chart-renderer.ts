import { renderMark } from '@mog/charts';
import type { ChartBounds, ChartError, ChartMark } from '@mog-sdk/contracts/bridges';

/**
 * Render a placeholder rectangle (cold-cache / loading state).
 *
 * Coordinate semantics: paints at `(bounds.x, bounds.y, bounds.w, bounds.h)`
 * in the engine-translated frame. Do not translate to (0, 0) first.
 */
export function renderChartPlaceholder(
  ctx: CanvasRenderingContext2D,
  bounds: ChartBounds,
  label: string,
): void {
  const { x, y, width, height } = bounds;

  ctx.save();
  ctx.fillStyle = '#f0f0f0';
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = '#999999';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, y + height / 2, width - 8);
  ctx.restore();
}

export function renderChartError(
  ctx: CanvasRenderingContext2D,
  bounds: ChartBounds,
  error: ChartError,
): void {
  const { x, y, width, height } = bounds;

  ctx.save();
  ctx.fillStyle = '#f8d7da';
  ctx.fillRect(x, y, width, height);

  ctx.strokeStyle = '#f5c6cb';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = '#721c24';
  ctx.font = '14px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxChars = Math.floor(width / 8);
  const message =
    error.message.length > maxChars
      ? `${error.message.substring(0, maxChars - 3)}...`
      : error.message;

  ctx.fillText(message, x + width / 2, y + height / 2);
  ctx.restore();
}

export function renderChartMarks(
  ctx: CanvasRenderingContext2D,
  marks: ChartMark[],
  bounds: ChartBounds,
): void {
  ctx.save();
  ctx.translate(bounds.x, bounds.y);

  ctx.beginPath();
  ctx.rect(0, 0, bounds.width, bounds.height);
  ctx.clip();

  for (const mark of marks) {
    renderMark(ctx, mark as Parameters<typeof renderMark>[1]);
  }

  ctx.restore();
}
