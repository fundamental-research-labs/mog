import type { ImageExportOptions } from '../types';

export type SupportedImageExportFormat = 'png' | 'jpeg';

export interface NormalizedImageExportOptions {
  format: SupportedImageExportFormat;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  pixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  backgroundColor: string;
  quality?: number;
  fittingMode: 'fill';
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

function normalizeFormat(format: ImageExportOptions['format']): SupportedImageExportFormat {
  const normalized = format ?? 'png';
  if (normalized === 'png' || normalized === 'jpeg') return normalized;
  throw new ChartImageExportOptionsError(
    `Unsupported chart image format "${normalized}". Supported formats are "png" and "jpeg".`,
  );
}

function normalizeBackgroundColor(backgroundColor: unknown): string {
  const normalized = backgroundColor ?? '#ffffff';
  if (typeof normalized !== 'string' || normalized.trim() === '') {
    throw new ChartImageExportOptionsError('backgroundColor must be a non-empty CSS color string');
  }
  return normalized;
}

function normalizeQuality(format: SupportedImageExportFormat, quality: unknown): number | undefined {
  if (quality === undefined) return format === 'jpeg' ? 0.92 : undefined;
  if (format !== 'jpeg') {
    throw new ChartImageExportOptionsError('quality is only supported for JPEG chart exports');
  }
  if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) {
    throw new ChartImageExportOptionsError('quality must be a finite number between 0 and 1');
  }
  return quality;
}

function normalizeFittingMode(fittingMode: ImageExportOptions['fittingMode']): 'fill' {
  const normalized = fittingMode ?? 'fill';
  if (normalized === 'fill') return normalized;
  throw new ChartImageExportOptionsError(
    `fittingMode "${normalized}" is not implemented for chart image export; only "fill" is supported.`,
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
): NormalizedImageExportOptions {
  const format = normalizeFormat(options.format);
  const width = finitePositive('width', options.width, 640);
  const height = finitePositive('height', options.height, 480);
  const pixelRatio = finitePositive('pixelRatio', options.pixelRatio, 2);
  const physicalWidth = physicalDimension('width * pixelRatio', width * pixelRatio);
  const physicalHeight = physicalDimension('height * pixelRatio', height * pixelRatio);
  const backgroundColor = normalizeBackgroundColor(options.backgroundColor);
  const quality = normalizeQuality(format, options.quality);
  const fittingMode = normalizeFittingMode(options.fittingMode);

  return {
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
  };
}
