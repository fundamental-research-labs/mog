import {
  collectMarks,
  compile,
  configToSpec,
  type ChartConfig,
  type ChartData,
  type ChartSpec,
  type CompileResult,
  type DataRow,
} from '@mog/charts';
import type {
  ChartLayoutRect,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { buildResolvedChartSpecSnapshot, hashJson } from './resolved-spec-snapshot';

/** Typed interface for chart WASM exports injected from compute-bridge. */
export interface ChartWasmExports {
  /** Index signature for compatibility with generic WASM module loaders. */
  [fn_name: string]: (...args: unknown[]) => unknown;
  chart_apply_transforms: (data: unknown, transforms: unknown) => unknown;
  chart_compute_regression: (
    points: unknown,
    method: unknown,
    degree: unknown,
    options: unknown,
  ) => unknown;
  chart_compute_stacking: (inputs: unknown, mode: unknown) => unknown;
  chart_compute_bins: (values: unknown, maxbins: unknown, step: unknown, nice: unknown) => unknown;
  chart_compute_statistics: (values: unknown) => unknown;
  chart_compute_density: (values: unknown, bandwidth: unknown, steps: unknown) => unknown;
}

export type ChartCompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];

export interface ChartCompileSize {
  width: number;
  height: number;
}

export interface CompileChartMarksInput {
  config: ChartConfig;
  chartData: ChartData;
  size?: ChartCompileSize;
}

export interface CompileChartMarksResult {
  marks: ChartMark[];
  layout: ChartLayoutSnapshot | null;
  compilerPathId: ChartCompilerPathId;
  compileInput: ChartSpec;
}

export interface CompileChartRenderSnapshotAtSizeInput {
  chart: ChartFloatingObject;
  sheetId: SheetId;
  chartId: string;
  config: ChartConfig;
  chartData: ChartData;
  resolvedRanges: ResolvedChartRangeReferences;
  exportOptions: ChartExportOptionsSnapshot;
  width: number;
  height: number;
}

let chartWasmExports: ChartWasmExports | null = null;

/**
 * Initialize the chart WASM backend.
 * Called by compute-bridge after loading @mog-sdk/wasm.
 */
export function initChartWasm(exports: ChartWasmExports): void {
  chartWasmExports = exports;
}

/**
 * Compile marks for a chart config/data pair.
 *
 * This is the shared compiler path used by cache-backed rendering and
 * dimension-specific export rendering. It deliberately does not know about
 * bridge cache lifecycle, pending compilations, listeners, or data resolution.
 */
export function compileChartMarks(input: CompileChartMarksInput): CompileChartMarksResult {
  const spec = configToSpec(input.config, input.chartData);
  const compileInput = buildCompileInput(spec);
  const compileResult = input.size
    ? compile(compileInput.spec, undefined, {
        width: input.size.width,
        height: input.size.height,
      })
    : compile(compileInput.spec);

  return {
    marks: collectMarks(compileResult) as ChartMark[],
    layout: extractLayoutSnapshot(compileResult),
    compilerPathId: compileInput.compilerPathId,
    compileInput: compileInput.spec,
  };
}

export function compileChartRenderSnapshotAtSize(
  input: CompileChartRenderSnapshotAtSizeInput,
): ChartRenderSnapshot {
  const compiled = compileChartMarks({
    config: input.config,
    chartData: input.chartData,
    size: { width: input.width, height: input.height },
  });

  return {
    marks: compiled.marks,
    resolvedChartSpec: buildResolvedChartSpecSnapshot({
      chart: input.chart,
      sheetId: input.sheetId,
      config: input.config,
      chartData: input.chartData,
      resolvedRanges: input.resolvedRanges,
      exportOptions: input.exportOptions,
      compilerPathId: compiled.compilerPathId,
      compilerInputHash: hashJson({
        chartId: input.chartId,
        sheetId: input.sheetId,
        config: input.config,
        chartData: input.chartData,
        resolvedRanges: input.resolvedRanges,
        compileInput: compiled.compileInput,
      }),
      layout: compiled.layout,
    }),
  };
}

function buildCompileInput(spec: ChartSpec): {
  spec: ChartSpec;
  compilerPathId: ChartCompilerPathId;
} {
  const wasmSpec = tryWasmTransformSpec(spec);
  if (!wasmSpec?.applied) {
    return {
      spec,
      compilerPathId: 'ts-grammar',
    };
  }

  return {
    spec: wasmSpec.spec,
    compilerPathId: 'wasm-transforms+ts-grammar',
  };
}

function isChartWasmAvailable(): boolean {
  return chartWasmExports !== null;
}

function tryWasmTransformSpec(spec: ChartSpec): { spec: ChartSpec; applied: boolean } | null {
  if (!isChartWasmAvailable()) return null;

  try {
    return applyWasmTransformsToSpec(spec);
  } catch (err) {
    console.warn('[ChartBridge] WASM transform failed, falling back to TS:', err);
    return null;
  }
}

function applyWasmTransformsToSpec(
  spec: ChartSpec,
  inheritedData?: DataRow[],
): { spec: ChartSpec; applied: boolean } {
  const localData = inlineDataRows(spec.data) ?? inheritedData;
  let nextSpec = spec;
  let nextData = localData;
  let applied = false;

  if (spec.transform && spec.transform.length > 0 && localData) {
    const { transform: _transform, ...withoutTransform } = nextSpec;
    nextData = chartWasmExports!.chart_apply_transforms(localData, spec.transform) as DataRow[];
    nextSpec = { ...withoutTransform, data: { values: nextData } };
    applied = true;
  }

  if ('layer' in nextSpec && nextSpec.layer) {
    const transformedLayers = nextSpec.layer.map((layer) =>
      applyWasmTransformsToSpec(layer, nextData),
    );
    if (transformedLayers.some((layer) => layer.applied)) {
      nextSpec = { ...nextSpec, layer: transformedLayers.map((layer) => layer.spec) };
      applied = true;
    }
  }

  return { spec: nextSpec, applied };
}

function inlineDataRows(data: ChartSpec['data']): DataRow[] | undefined {
  return data && 'values' in data && Array.isArray(data.values)
    ? (data.values as DataRow[])
    : undefined;
}

/**
 * Extract a ChartLayoutSnapshot from a CompileResult.
 *
 * Converts the compiler's absolute pixel layout into normalized (0-1)
 * coordinates relative to the total chart dimensions, which is what the
 * OfficeJS-style getPlotAreaLayout / getLegendLayout / getTitleLayout APIs
 * return.
 */
function extractLayoutSnapshot(result: CompileResult): ChartLayoutSnapshot | null {
  const layout = result.layout;
  if (!layout) return null;

  const totalW = layout.width || 1;
  const totalH = layout.height || 1;

  const normalize = (
    rect: { x: number; y: number; width: number; height: number } | undefined,
  ): ChartLayoutRect | undefined => {
    if (!rect) return undefined;
    return {
      left: rect.x / totalW,
      top: rect.y / totalH,
      width: rect.width / totalW,
      height: rect.height / totalH,
    };
  };

  const plotArea = normalize(layout.plotArea);
  if (!plotArea) return null;

  return {
    plotArea,
    legend: normalize(layout.legend),
    title: normalize(layout.title),
    // dataLabels: The compile result doesn't provide a separate data labels
    // region; this would need mark-level bounding box computation later.
    dataLabels: undefined,
  };
}
