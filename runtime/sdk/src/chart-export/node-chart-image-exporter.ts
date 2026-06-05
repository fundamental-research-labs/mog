import {
  ChartMarkImageExporter,
  createWasmChartRasterBackend,
  type ChartRasterBackend,
  type ChartRasterBackendResolver,
  type ChartRasterRequest,
  type ChartRasterResult,
  type WasmChartRasterModule,
} from '@mog/charts/export';
import type { ChartImageExporter } from '@mog-sdk/contracts/api';
import type { IChartBridge } from '@mog-sdk/contracts/bridges';

export type NativeChartRasterAddon = {
  readonly render_chart_marks_image?: (requestJson: string) => ChartRasterResult;
};

type ChartRasterWasmInitInput = WebAssembly.Module | Promise<WebAssembly.Module>;
type ChartRasterWasmGlueModule = WasmChartRasterModule & {
  readonly default: (input?: {
    readonly module_or_path: ChartRasterWasmInitInput;
  }) => Promise<unknown>;
};
export type ChartRasterWasmGlueLoader = () => Promise<ChartRasterWasmGlueModule>;
type NativeChartRasterAddonResolver = () => NativeChartRasterAddon;
type NativeChartRasterBackendSource = NativeChartRasterAddon | NativeChartRasterAddonResolver;

export function createNodeChartImageExporterFactory(
  backendSource: NativeChartRasterBackendSource,
): (chartBridge: IChartBridge) => ChartImageExporter {
  return createChartImageExporterFactory(() => resolveNativeChartRasterBackend(backendSource));
}

export function createChartImageExporterFactory(
  rasterBackendResolver?: ChartRasterBackendResolver,
): (chartBridge: IChartBridge) => ChartImageExporter {
  return (chartBridge) =>
    new ChartMarkImageExporter({
      chartBridge,
      ...(rasterBackendResolver ? { rasterBackendResolver } : {}),
    });
}

export function createWasmChartImageExporterFactory(
  rasterModule: ChartRasterWasmInitInput,
  loadWasmGlue: ChartRasterWasmGlueLoader,
): (chartBridge: IChartBridge) => ChartImageExporter {
  return createChartImageExporterFactory(
    createWasmChartRasterBackend(async () => {
      const glue = await loadWasmGlue();
      await glue.default({ module_or_path: rasterModule });
      return glue;
    }),
  );
}

export function createNodeWasmChartImageExporterFactory(
  rasterModule: ChartRasterWasmInitInput,
): (chartBridge: IChartBridge) => ChartImageExporter {
  return createWasmChartImageExporterFactory(rasterModule, loadChartRasterWasmGlue);
}

function resolveNativeChartRasterBackend(
  source: NativeChartRasterBackendSource,
): ChartRasterBackend {
  const addon = typeof source === 'function' ? source() : source;
  return createNativeChartRasterBackend(addon);
}

function createNativeChartRasterBackend(addon: NativeChartRasterAddon): ChartRasterBackend {
  const render = addon.render_chart_marks_image;
  if (typeof render !== 'function') {
    throw new Error('render_chart_marks_image is missing from the @mog-sdk/node native addon');
  }

  return {
    id: '@mog-sdk/node:native-chart-raster',
    runtime: 'native-node',
    supportedFormats: ['png', 'jpeg'],
    render(request: ChartRasterRequest): ChartRasterResult {
      return render(JSON.stringify(request));
    },
  };
}

async function loadChartRasterWasmGlue(): Promise<ChartRasterWasmGlueModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<unknown>;
  return dynamicImport('@mog-sdk/chart-raster-wasm') as Promise<ChartRasterWasmGlueModule>;
}
