import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ImageExportOptions } from '@mog-sdk/contracts/data/charts';

import { bytesToDataUrl } from './data-url';
import {
  normalizeImageExportOptions,
  rasterOptionsForRequest,
  type NormalizedRasterImageExportOptions,
} from './image-options';
import {
  serializeChartMarks,
  translateSerializableChartMarks,
  type SerializableChartMark,
} from './mark-serialization';
import {
  assertChartRasterBackendSupports,
  resolveChartRasterBackend,
  type ChartRasterBackend,
  type ChartRasterBackendResolver,
} from './raster-backend';
import { renderChartMarksSvg } from './svg-renderer';

export interface ChartMarkImageExporterOptions {
  readonly chartBridge: IChartBridge;
  readonly rasterBackendResolver?: ChartRasterBackendResolver;
}

export class ChartMarkImageExporter implements ChartImageExporter {
  private rasterBackend: ChartRasterBackend | null = null;

  constructor(private readonly options: ChartMarkImageExporterOptions) {}

  async exportImage(
    sheetId: string,
    chartId: string,
    options?: ImageExportOptions,
  ): Promise<string> {
    const normalized = normalizeImageExportOptions(options);
    const rasterBackend =
      normalized.kind === 'raster' ? await this.resolveRasterBackend(normalized) : null;

    const marks = await this.options.chartBridge.getMarksAtSize(
      sheetId as SheetId,
      chartId,
      normalized.frame.contentWidth,
      normalized.frame.contentHeight,
    );

    if (!Array.isArray(marks)) {
      throw new Error(`Chart mark compilation failed: ${marks.message}`);
    }
    if (marks.length === 0) {
      throw new Error('Chart mark compilation returned no marks');
    }

    const serializedMarks = translateSerializableChartMarks(
      serializeChartMarks(marks),
      normalized.frame.contentX,
      normalized.frame.contentY,
    );

    if (normalized.kind === 'vector') {
      return renderChartMarksSvg({
        marks: serializedMarks,
        options: normalized,
      }).dataUrl;
    }

    const rendered = await rasterBackend!.render({
      version: 1,
      marks: serializedMarks,
      options: rasterOptionsForRequest(normalized),
    });

    validateRasterResult(rendered, normalized);

    return bytesToDataUrl(normalized.mimeType, rendered.bytes);
  }

  private async resolveRasterBackend(
    normalized: NormalizedRasterImageExportOptions,
  ): Promise<ChartRasterBackend> {
    if (this.rasterBackend) {
      assertChartRasterBackendSupports(this.rasterBackend, normalized.format);
      return this.rasterBackend;
    }

    if (!this.options.rasterBackendResolver) {
      throw new Error(
        `Chart raster backend is unavailable for ${normalized.format} export in this runtime`,
      );
    }

    try {
      const backend = await resolveChartRasterBackend(this.options.rasterBackendResolver);
      assertChartRasterBackendSupports(backend, normalized.format);
      this.rasterBackend = backend;
      return backend;
    } catch (error) {
      throw createChartRasterUnavailableError(normalized.format, error);
    }
  }
}

function validateRasterResult(
  rendered: { readonly format: string; readonly width: number; readonly height: number },
  normalized: NormalizedRasterImageExportOptions,
): void {
  if (
    rendered.format !== normalized.format ||
    rendered.width !== normalized.physicalWidth ||
    rendered.height !== normalized.physicalHeight
  ) {
    throw new Error(
      `Chart raster backend returned ${rendered.format} ${rendered.width}x${rendered.height}, expected ${normalized.format} ${normalized.physicalWidth}x${normalized.physicalHeight}`,
    );
  }
}

function createChartRasterUnavailableError(format: 'png' | 'jpeg', cause: unknown): Error {
  const message = `Chart raster backend is unavailable for ${format} export`;
  if (cause instanceof Error && cause.message) {
    return new Error(`${message}: ${cause.message}`, { cause });
  }
  return new Error(message, { cause });
}

export type { SerializableChartMark };
