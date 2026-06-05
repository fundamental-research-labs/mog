import type { ImageExportOptions } from '../types';

export type ChartRasterImageExportFormat = 'png' | 'jpeg';
export type ChartVectorImageExportFormat = 'svg';
export type SupportedImageExportFormat =
  | ChartRasterImageExportFormat
  | ChartVectorImageExportFormat;
export type ChartImageFittingMode = 'fill' | 'fit' | 'fitAndCenter';

export interface ChartImageFrame {
  readonly exportWidth: number;
  readonly exportHeight: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly contentX: number;
  readonly contentY: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export interface NormalizeImageExportFrameInput {
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
}

export interface NormalizedVectorImageExportOptions {
  readonly kind: 'vector';
  readonly format: 'svg';
  readonly mimeType: 'image/svg+xml';
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: string;
  readonly fittingMode: ChartImageFittingMode;
  readonly frame: ChartImageFrame;
}

export interface NormalizedRasterImageExportOptions {
  readonly kind: 'raster';
  readonly format: ChartRasterImageExportFormat;
  readonly mimeType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly backgroundColor: string;
  readonly quality?: number;
  readonly fittingMode: ChartImageFittingMode;
  readonly frame: ChartImageFrame;
}

export type NormalizedImageExportOptions =
  | NormalizedVectorImageExportOptions
  | NormalizedRasterImageExportOptions;

export type NormalizedChartImageExportOptions = NormalizedImageExportOptions;

export interface NormalizedChartRasterOptions {
  readonly format: ChartRasterImageExportFormat;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly backgroundColor: string;
  readonly quality?: number;
  readonly fittingMode: ChartImageFittingMode;
  readonly frame: ChartImageFrame;
}

export class ChartImageExportOptionsError extends Error {
  readonly code = 'CHART_IMAGE_EXPORT_OPTIONS_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ChartImageExportOptionsError';
  }
}

function finitePositive(name: string, value: unknown, defaultValue: number): number {
  const normalized = value === undefined ? defaultValue : value;
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized <= 0) {
    throw new ChartImageExportOptionsError(`${name} must be a finite positive number`);
  }
  return normalized;
}

function optionalPositiveDimension(name: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  return finitePositive(name, value, 0);
}

function normalizeFormat(format: ImageExportOptions['format']): SupportedImageExportFormat {
  const normalized = format ?? 'png';
  if (normalized === 'png' || normalized === 'jpeg' || normalized === 'svg') return normalized;
  throw new ChartImageExportOptionsError(
    `Unsupported chart image format "${normalized}". Supported formats are "png", "jpeg", and "svg".`,
  );
}

function normalizeBackgroundColor(backgroundColor: unknown): string {
  const normalized = backgroundColor ?? '#ffffff';
  if (typeof normalized !== 'string' || normalized.trim() === '') {
    throw new ChartImageExportOptionsError('backgroundColor must be a non-empty CSS color string');
  }
  return normalized;
}

function normalizeQuality(
  format: SupportedImageExportFormat,
  quality: unknown,
): number | undefined {
  if (quality === undefined) return format === 'jpeg' ? 0.92 : undefined;
  if (format !== 'jpeg') {
    throw new ChartImageExportOptionsError('quality is only supported for JPEG chart exports');
  }
  if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new ChartImageExportOptionsError('quality must be a finite number between 0 and 1');
  }
  return quality;
}

function normalizeFittingMode(
  fittingMode: ImageExportOptions['fittingMode'],
): ChartImageFittingMode {
  const normalized = fittingMode ?? 'fill';
  if (normalized === 'fill' || normalized === 'fit' || normalized === 'fitAndCenter') {
    return normalized;
  }
  throw new ChartImageExportOptionsError(
    `Unsupported chart image fittingMode "${normalized}". Supported modes are "fill", "fit", and "fitAndCenter".`,
  );
}

function physicalDimension(name: string, value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded <= 0) {
    throw new ChartImageExportOptionsError(`${name} must resolve to a positive pixel dimension`);
  }
  if (Math.abs(value - rounded) > Number.EPSILON * Math.max(1, Math.abs(value)) * 8) {
    throw new ChartImageExportOptionsError(
      `${name} must resolve to an integer physical pixel dimension`,
    );
  }
  return rounded;
}

export function normalizeImageExportOptions(
  options: ImageExportOptions = {},
  frameInput: NormalizeImageExportFrameInput = {},
): NormalizedImageExportOptions {
  const format = normalizeFormat(options.format);
  const width = finitePositive('width', options.width, 640);
  const height = finitePositive('height', options.height, 480);
  const backgroundColor = normalizeBackgroundColor(options.backgroundColor);
  const quality = normalizeQuality(format, options.quality);
  const fittingMode = normalizeFittingMode(options.fittingMode);
  const frame = resolveChartImageFrame(width, height, fittingMode, frameInput);

  if (format === 'svg') {
    if (options.pixelRatio !== undefined) {
      finitePositive('pixelRatio', options.pixelRatio, 2);
    }
    return {
      kind: 'vector',
      format,
      mimeType: 'image/svg+xml',
      width,
      height,
      backgroundColor,
      fittingMode,
      frame,
    };
  }

  const pixelRatio = finitePositive('pixelRatio', options.pixelRatio, 2);
  const physicalWidth = physicalDimension('width * pixelRatio', width * pixelRatio);
  const physicalHeight = physicalDimension('height * pixelRatio', height * pixelRatio);

  return {
    kind: 'raster',
    format,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width,
    height,
    pixelRatio,
    physicalWidth,
    physicalHeight,
    backgroundColor,
    quality,
    fittingMode,
    frame,
  };
}

export function rasterOptionsForRequest(
  normalized: NormalizedRasterImageExportOptions,
): NormalizedChartRasterOptions {
  return {
    format: normalized.format,
    width: normalized.width,
    height: normalized.height,
    pixelRatio: normalized.pixelRatio,
    backgroundColor: normalized.backgroundColor,
    quality: normalized.quality,
    fittingMode: normalized.fittingMode,
    frame: normalized.frame,
  };
}

function resolveChartImageFrame(
  exportWidth: number,
  exportHeight: number,
  fittingMode: ChartImageFittingMode,
  input: NormalizeImageExportFrameInput,
): ChartImageFrame {
  const sourceWidth = optionalPositiveDimension('sourceWidth', input.sourceWidth);
  const sourceHeight = optionalPositiveDimension('sourceHeight', input.sourceHeight);
  const base = {
    exportWidth,
    exportHeight,
    ...(sourceWidth !== undefined ? { sourceWidth } : {}),
    ...(sourceHeight !== undefined ? { sourceHeight } : {}),
  };

  if (fittingMode === 'fill' || sourceWidth === undefined || sourceHeight === undefined) {
    return {
      ...base,
      contentX: 0,
      contentY: 0,
      contentWidth: exportWidth,
      contentHeight: exportHeight,
    };
  }

  const scale = Math.min(exportWidth / sourceWidth, exportHeight / sourceHeight);
  const contentWidth = sourceWidth * scale;
  const contentHeight = sourceHeight * scale;

  return {
    ...base,
    contentX: fittingMode === 'fitAndCenter' ? (exportWidth - contentWidth) / 2 : 0,
    contentY: fittingMode === 'fitAndCenter' ? (exportHeight - contentHeight) / 2 : 0,
    contentWidth,
    contentHeight,
  };
}
