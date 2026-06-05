import type { ChartRasterRequest } from '../../src/export/raster-backend';
import {
  createWasmChartRasterBackend,
  type WasmChartRasterModule,
} from '../../src/export/wasm-raster-backend';

describe('createWasmChartRasterBackend', () => {
  it('adapts wasm-bindgen chart raster exports to the shared raster backend contract', async () => {
    let requestJson = '';
    const module: WasmChartRasterModule = {
      render_chart_marks_image(json) {
        requestJson = json;
        return {
          bytes: new Uint8Array([137, 80, 78, 71]),
          format: 'png',
          width: 64,
          height: 32,
        };
      },
    };
    const backend = createWasmChartRasterBackend(module);

    const result = await backend.render(request());

    expect(backend).toMatchObject({
      id: '@mog-sdk/chart-raster-wasm',
      runtime: 'wasm',
      supportedFormats: ['png', 'jpeg'],
    });
    expect(JSON.parse(requestJson)).toMatchObject({ version: 1, options: { format: 'png' } });
    expect(result).toEqual({
      bytes: new Uint8Array([137, 80, 78, 71]),
      format: 'png',
      width: 64,
      height: 32,
    });
  });

  it('resolves an async module source lazily and only once', async () => {
    let resolveCount = 0;
    const backend = createWasmChartRasterBackend(async () => {
      resolveCount += 1;
      return {
        render_chart_marks_image() {
          return {
            bytes: () => new Uint8Array([255, 216]),
            format: () => 'jpeg',
            width: () => 20,
            height: () => 10,
          };
        },
      };
    });

    await expect(backend.render(request({ format: 'jpeg' }))).resolves.toMatchObject({
      format: 'jpeg',
      width: 20,
      height: 10,
    });
    await expect(backend.render(request({ format: 'jpeg' }))).resolves.toMatchObject({
      format: 'jpeg',
    });
    expect(resolveCount).toBe(1);
  });

  it('throws when the wasm module returns an invalid result shape', async () => {
    const backend = createWasmChartRasterBackend({
      render_chart_marks_image() {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          format: 'webp',
          width: 64,
          height: 32,
        };
      },
    });

    await expect(backend.render(request())).rejects.toThrow(
      'WASM chart raster module returned unsupported format "webp"',
    );
  });
});

function request(
  overrides: Partial<ChartRasterRequest['options']> = {},
): ChartRasterRequest {
  return {
    version: 1,
    marks: [],
    options: {
      kind: 'raster',
      format: 'png',
      mimeType: 'image/png',
      width: 32,
      height: 16,
      pixelRatio: 2,
      physicalWidth: 64,
      physicalHeight: 32,
      backgroundColor: '#ffffff',
      quality: undefined,
      fittingMode: 'fill',
      frame: {
        exportWidth: 32,
        exportHeight: 16,
        contentX: 0,
        contentY: 0,
        contentWidth: 32,
        contentHeight: 16,
      },
      ...overrides,
    },
  };
}
