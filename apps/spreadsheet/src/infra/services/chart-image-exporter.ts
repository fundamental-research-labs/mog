/**
 * ChartImageExporterImpl -- Shell-layer chart image exporter.
 *
 * This implementation lives in the app layer because it requires DOM access
 * (document.createElement('canvas'), CanvasRenderingContext2D). The kernel
 * is headless and delegates image export to this injected dependency.
 *
 * Pipeline:
 * 1. Compile marks at target export dimensions via IChartBridge.getMarksAtSize()
 * 2. Create an off-screen canvas scaled by pixelRatio
 * 3. Fill background
 * 4. Render marks using the charts library's renderMarks()
 * 5. Export to data URL
 */

import { renderMarks } from '@mog/charts';
import { normalizeImageExportOptions } from '@mog/charts/export';
import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ImageExportOptions } from '@mog-sdk/contracts/data/charts';

export class ChartImageExporterImpl implements ChartImageExporter {
  constructor(private readonly chartBridge: IChartBridge) {}

  async exportImage(
    sheetId: string,
    chartId: string,
    options?: ImageExportOptions,
  ): Promise<string | null> {
    const normalized = normalizeImageExportOptions(options);

    // 1. Compile marks at the target export dimensions.
    // Marks are dimension-dependent (axis ticks, label positions, etc.)
    // so we must recompile rather than reuse cached marks.
    const marks = await this.chartBridge.getMarksAtSize(
      sheetId as SheetId,
      chartId,
      normalized.width,
      normalized.height,
    );

    // ChartError has a 'code' field; mark arrays do not.
    if (!Array.isArray(marks)) {
      throw new Error(`Chart mark compilation failed: ${marks.message}`);
    }
    if (marks.length === 0) {
      throw new Error('Chart mark compilation returned no marks');
    }

    // 2. Create off-screen canvas at the physical pixel dimensions
    const canvas = document.createElement('canvas');
    canvas.width = normalized.physicalWidth;
    canvas.height = normalized.physicalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 3. Scale for pixel ratio so mark coordinates remain in CSS pixels
    ctx.scale(normalized.pixelRatio, normalized.pixelRatio);

    // 4. Fill background
    ctx.fillStyle = normalized.backgroundColor;
    ctx.fillRect(0, 0, normalized.width, normalized.height);

    // 5. Render marks using the charts library renderer
    try {
      renderMarks(ctx, marks as Parameters<typeof renderMarks>[1]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Chart mark rendering failed: ${reason}`);
    }

    // 6. Export to data URL
    return canvas.toDataURL(normalized.mimeType, normalized.quality);
  }
}
