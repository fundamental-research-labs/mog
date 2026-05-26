/**
 * Chart PDF Renderer — renders pre-rasterized charts into the PDF.
 *
 * Strategy: Charts are complex objects (axes, legends, data series,
 * animations) that would require a full charting engine to render natively.
 * The v1 approach is to rasterize them at high DPI via OffscreenCanvas
 * in the webview layer, then embed the resulting image in the PDF.
 *
 * The webview layer is responsible for:
 * 1. Rendering the chart to an OffscreenCanvas at 3x scale
 * 2. Encoding the result as JPEG (for gradients) or PNG (for transparency)
 * 3. Passing the image bytes via ChartInfo.imageData
 *
 * This renderer simply places the pre-rasterized image at the correct
 * page position using the RenderBackend's drawImage() method.
 */

import type { ImageFormat, RenderBackend } from '@mog/pdf-graphics';
import type { FloatingObjectAnchor, PositionResolver } from './position-resolver';

// ============================================================================
// Types
// ============================================================================

/**
 * Chart information from the data provider.
 *
 * The imageData field contains the pre-rasterized chart image.
 * If imageData is undefined, the chart has not been rasterized and
 * will be skipped with a console warning.
 */
export interface ChartInfo {
  /** Unique chart identifier. */
  id: string;
  /** Anchor position in sheet coordinates. */
  anchor: FloatingObjectAnchor;
  /** Chart width in points. */
  width: number;
  /** Chart height in points. */
  height: number;
  /** Pre-rasterized image data (JPEG or PNG bytes). */
  imageData?: Uint8Array;
  /** Image format of the rasterized data. */
  imageFormat?: ImageFormat;
  /** Chart title for accessibility / debugging. */
  title?: string;
}

// ============================================================================
// Renderer
// ============================================================================

/**
 * Renders pre-rasterized charts to a PDF page via the RenderBackend.
 *
 * Usage:
 *   const renderer = new ChartPdfRenderer(backend);
 *   renderer.renderChart(chartInfo, { x: 100, y: 200 });
 *
 * Or for a full page:
 *   renderer.renderCharts(charts, positionResolver, pageIndex);
 */
export class ChartPdfRenderer {
  constructor(private backend: RenderBackend) {}

  /**
   * Render a single chart at a resolved page position.
   *
   * If the chart has no imageData, a warning is logged and the chart
   * is skipped — this gracefully handles cases where rasterization
   * failed or was not performed.
   *
   * @param chart    Chart info with optional pre-rasterized image
   * @param position Resolved (x, y) position on the page in points
   */
  renderChart(chart: ChartInfo, position: { x: number; y: number }): void {
    if (!chart.imageData) {
      // Chart has not been rasterized — skip gracefully
      console.warn(
        `ChartPdfRenderer: chart "${chart.id}" has no imageData, skipping.` +
          (chart.title ? ` Title: "${chart.title}"` : ''),
      );
      return;
    }

    this.backend.drawImage(
      chart.imageData,
      chart.imageFormat ?? 'png',
      position.x,
      position.y,
      chart.width,
      chart.height,
    );
  }

  /**
   * Render all charts that belong to a specific page.
   *
   * For each chart, the anchor is resolved to a page position.
   * Charts whose anchor falls on a different page (or off all pages)
   * are silently skipped.
   *
   * @param charts           All charts for the sheet
   * @param positionResolver Converts sheet anchors to page positions
   * @param pageIndex        The target page (0-indexed)
   */
  renderCharts(charts: ChartInfo[], positionResolver: PositionResolver, pageIndex: number): void {
    for (const chart of charts) {
      const pos = positionResolver.resolvePosition(
        chart.anchor.row,
        chart.anchor.col,
        chart.anchor.xOffset,
        chart.anchor.yOffset,
      );
      if (pos && pos.pageIndex === pageIndex) {
        this.renderChart(chart, { x: pos.x, y: pos.y });
      }
    }
  }
}
