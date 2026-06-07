import type { NormalizedChartRasterOptions } from './image-options';
import type { SerializableChartMark } from './mark-serialization';

export interface ChartRasterRequest {
  readonly version: 1;
  readonly marks: readonly SerializableChartMark[];
  readonly options: NormalizedChartRasterOptions;
}

export interface ChartRasterResult {
  readonly bytes: Uint8Array;
  readonly format: 'png' | 'jpeg';
  readonly width: number;
  readonly height: number;
}

export interface ChartRasterBackend {
  readonly id: string;
  readonly runtime: 'browser-canvas' | 'native-node' | 'wasm' | 'custom';
  readonly supportedFormats: readonly ('png' | 'jpeg')[];
  render(request: ChartRasterRequest): Promise<ChartRasterResult> | ChartRasterResult;
}

export type ChartRasterBackendResolver =
  | ChartRasterBackend
  | (() => ChartRasterBackend | Promise<ChartRasterBackend>);

export async function resolveChartRasterBackend(
  resolver: ChartRasterBackendResolver,
): Promise<ChartRasterBackend> {
  return typeof resolver === 'function' ? resolver() : resolver;
}

export function assertChartRasterBackendSupports(
  backend: ChartRasterBackend,
  format: 'png' | 'jpeg',
): void {
  if (!backend.supportedFormats.includes(format)) {
    throw new Error(
      `Chart raster backend "${backend.id}" does not support ${format} in runtime ${backend.runtime}`,
    );
  }
}
