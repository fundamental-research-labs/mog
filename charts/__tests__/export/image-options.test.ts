import {
  ChartImageExportOptionsError,
  normalizeImageExportOptions,
} from '../../src/export/image-options';

describe('normalizeImageExportOptions', () => {
  it('applies the shared raster chart image export defaults', () => {
    expect(normalizeImageExportOptions()).toEqual({
      kind: 'raster',
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
      frame: {
        exportWidth: 640,
        exportHeight: 480,
        contentX: 0,
        contentY: 0,
        contentWidth: 640,
        contentHeight: 480,
      },
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
      kind: 'raster',
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
      frame: {
        exportWidth: 320,
        exportHeight: 180,
        contentX: 0,
        contentY: 0,
        contentWidth: 320,
        contentHeight: 180,
      },
    });
  });

  it('normalizes svg as a vector export without raster-only physical dimensions', () => {
    expect(
      normalizeImageExportOptions({
        format: 'svg',
        width: 320,
        height: 180,
        backgroundColor: '#ffffff',
      }),
    ).toEqual({
      kind: 'vector',
      format: 'svg',
      mimeType: 'image/svg+xml',
      width: 320,
      height: 180,
      backgroundColor: '#ffffff',
      fittingMode: 'fill',
      frame: {
        exportWidth: 320,
        exportHeight: 180,
        contentX: 0,
        contentY: 0,
        contentWidth: 320,
        contentHeight: 180,
      },
    });
  });

  it('normalizes fit and fitAndCenter frames when intrinsic dimensions are supplied', () => {
    expect(
      normalizeImageExportOptions(
        { format: 'svg', width: 400, height: 400, fittingMode: 'fit' },
        { sourceWidth: 800, sourceHeight: 400 },
      ).frame,
    ).toEqual({
      exportWidth: 400,
      exportHeight: 400,
      sourceWidth: 800,
      sourceHeight: 400,
      contentX: 0,
      contentY: 0,
      contentWidth: 400,
      contentHeight: 200,
    });

    expect(
      normalizeImageExportOptions(
        { format: 'png', width: 400, height: 400, fittingMode: 'fitAndCenter' },
        { sourceWidth: 800, sourceHeight: 400 },
      ).frame,
    ).toEqual({
      exportWidth: 400,
      exportHeight: 400,
      sourceWidth: 800,
      sourceHeight: 400,
      contentX: 0,
      contentY: 100,
      contentWidth: 400,
      contentHeight: 200,
    });
  });

  it('falls fit modes back to fill when intrinsic dimensions are unavailable', () => {
    expect(normalizeImageExportOptions({ fittingMode: 'fitAndCenter' }).frame).toEqual({
      exportWidth: 640,
      exportHeight: 480,
      contentX: 0,
      contentY: 0,
      contentWidth: 640,
      contentHeight: 480,
    });
  });

  it.each([
    [{ format: 'gif' as never }, 'Unsupported chart image format'],
    [{ width: 0 }, 'width must be a finite positive number'],
    [{ height: Number.POSITIVE_INFINITY }, 'height must be a finite positive number'],
    [{ pixelRatio: -1 }, 'pixelRatio must be a finite positive number'],
    [{ format: 'png' as const, quality: 0.8 }, 'quality is only supported for JPEG'],
    [{ format: 'svg' as const, quality: 0.8 }, 'quality is only supported for JPEG'],
    [{ format: 'jpeg' as const, quality: 2 }, 'quality must be a finite number between 0 and 1'],
    [{ fittingMode: 'stretch' as never }, 'Unsupported chart image fittingMode'],
    [{ width: 101, pixelRatio: 1.5 }, 'width * pixelRatio must resolve to an integer'],
  ])('rejects invalid options %#', (options, message) => {
    expect(() => normalizeImageExportOptions(options)).toThrow(ChartImageExportOptionsError);
    expect(() => normalizeImageExportOptions(options)).toThrow(message);
  });
});
