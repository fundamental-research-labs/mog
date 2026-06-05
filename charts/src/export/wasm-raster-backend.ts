import type { ChartRasterBackend, ChartRasterRequest, ChartRasterResult } from './raster-backend';

export interface WasmChartRasterImageResult {
  readonly bytes: Uint8Array | (() => Uint8Array);
  readonly format: string | (() => string);
  readonly width: number | (() => number);
  readonly height: number | (() => number);
}

export interface WasmChartRasterModule {
  readonly render_chart_marks_image: (requestJson: string) => WasmChartRasterImageResult;
}

export type WasmChartRasterModuleSource =
  | WasmChartRasterModule
  | Promise<WasmChartRasterModule>
  | (() => WasmChartRasterModule | Promise<WasmChartRasterModule>);

export interface WasmChartRasterBackendOptions {
  readonly id?: string;
  readonly supportedFormats?: readonly ('png' | 'jpeg')[];
}

export function createWasmChartRasterBackend(
  moduleSource: WasmChartRasterModuleSource,
  options: WasmChartRasterBackendOptions = {},
): ChartRasterBackend {
  let modulePromise: Promise<WasmChartRasterModule> | null = null;

  const resolveModule = () => {
    modulePromise ??= Promise.resolve(
      typeof moduleSource === 'function' ? moduleSource() : moduleSource,
    );
    return modulePromise;
  };

  return {
    id: options.id ?? '@mog-sdk/chart-raster-wasm',
    runtime: 'wasm',
    supportedFormats: options.supportedFormats ?? ['png', 'jpeg'],
    async render(request: ChartRasterRequest): Promise<ChartRasterResult> {
      const module = await resolveModule();
      const render = module.render_chart_marks_image;
      if (typeof render !== 'function') {
        throw new Error('WASM chart raster module is missing render_chart_marks_image');
      }

      return normalizeWasmChartRasterResult(render(JSON.stringify(request)));
    },
  };
}

function normalizeWasmChartRasterResult(result: WasmChartRasterImageResult): ChartRasterResult {
  const bytes = readResultProperty(result.bytes);
  const format = readResultProperty(result.format);
  const width = readResultProperty(result.width);
  const height = readResultProperty(result.height);

  if (!(bytes instanceof Uint8Array)) {
    throw new Error('WASM chart raster module returned invalid bytes');
  }
  if (format !== 'png' && format !== 'jpeg') {
    throw new Error(`WASM chart raster module returned unsupported format "${format}"`);
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`WASM chart raster module returned invalid dimensions ${width}x${height}`);
  }

  return {
    bytes: new Uint8Array(bytes),
    format,
    width,
    height,
  };
}

function readResultProperty<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}
