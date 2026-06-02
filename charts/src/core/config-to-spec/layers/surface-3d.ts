import type { ChartSpec, UnitSpec } from '../../../grammar/spec';
import type { ChartConfig, ChartData } from '../../../types';
import { buildConfigSpec } from '../config-spec';
import { chartDataToRows } from '../data-rows';
import { buildUnitSpec, type ChartDimensions } from '../spec-assembly';
import {
  buildSurface3DBands,
  buildSurfaceContourEncoding,
  sourceSurfaceBandFormats,
} from './surface-contour';

export function shouldRenderSurface3D(config: ChartConfig): boolean {
  if (config.surfaceTopView === true) return false;
  return config.type === 'surface3d' || config.type === 'surfaceWireframe';
}

export function buildSurface3DSpec(input: {
  config: ChartConfig;
  data: ChartData;
  dimensions: ChartDimensions;
  title: ChartSpec['title'];
}): UnitSpec {
  const bands = buildSurface3DBands(input.config, input.data);
  const rows = chartDataToRows(input.data, input.config);
  const encoding = buildSurfaceContourEncoding(input.config, bands);
  const configSpec = buildConfigSpec(input.config, encoding, input.data);

  return buildUnitSpec({
    dimensions: input.dimensions,
    rows,
    mark: {
      type: 'surface3d',
      contourBands: bands,
      sourceSurfaceBandFormats: sourceSurfaceBandFormats(input.config),
      contourWireframe: input.config.wireframe === true || input.config.type === 'surfaceWireframe',
      surfaceView3d: normalizeSurfaceView3D(input.config.view3d),
    },
    encoding,
    title: input.title,
    config: configSpec,
  });
}

function normalizeSurfaceView3D(config: ChartConfig['view3d']) {
  if (!config) return undefined;
  return {
    rotX: finiteNumber(config.rotX),
    rotY: finiteNumber(config.rotY),
    depthPercent: finiteNumber(config.depthPercent),
    rAngAx: typeof config.rAngAx === 'boolean' ? config.rAngAx : undefined,
    perspective: finiteNumber(config.perspective),
    heightPercent: finiteNumber(config.heightPercent),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
