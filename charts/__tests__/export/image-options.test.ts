import {
  ChartImageExportOptionsError,
  normalizeImageExportOptions,
} from '../../src/export/image-options';

describe('normalizeImageExportOptions', () => {
  it('applies the shared chart image export defaults', () => {
    expect(normalizeImageExportOptions()).toEqual({
      format: 'png',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      pixelRatio: 2,
      physicalWidth: 1280,
      physicalHeight: 960,
      backgroundColor: '#ffffff',
      quality: undefined,
      fittingMode: 'fill',
    });
  });

  it('normalizes jpeg exports with explicit quality', () => {
    expect(
      normalizeImageExportOptions({
        format: 'jpeg',
        width: 320,
        height: 180,
        pixelRatio: 2,
        backgroundColor: '#f8f9fa',
        quality: 0.8,
      }),
    ).toEqual({
      format: 'jpeg',
      mimeType: 'image/jpeg',
      width: 320,
      height: 180,
      pixelRatio: 2,
      physicalWidth: 640,
      physicalHeight: 360,
      backgroundColor: '#f8f9fa',
      quality: 0.8,
      fittingMode: 'fill',
    });
  });

  it.each([
    [{ format: 'svg' as const }, 'Unsupported chart image format'],
    [{ width: 0 }, 'width must be a finite positive number'],
    [{ height: Number.POSITIVE_INFINITY }, 'height must be a finite positive number'],
    [{ pixelRatio: -1 }, 'pixelRatio must be a finite positive number'],
    [{ format: 'png' as const, quality: 0.8 }, 'quality is only supported for JPEG'],
    [{ format: 'jpeg' as const, quality: 2 }, 'quality must be a finite number between 0 and 1'],
    [{ fittingMode: 'fit' as const }, 'fittingMode "fit" is not implemented'],
    [{ width: 101, pixelRatio: 1.5 }, 'width * pixelRatio must resolve to an integer'],
  ])('rejects invalid options %#', (options, message) => {
    expect(() => normalizeImageExportOptions(options)).toThrow(ChartImageExportOptionsError);
    expect(() => normalizeImageExportOptions(options)).toThrow(message);
  });
});
