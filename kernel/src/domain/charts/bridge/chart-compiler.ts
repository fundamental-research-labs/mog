import {
  collectMarks,
  compile,
  configToSpec,
  type BarGeometryTrace,
  type CartesianGeometryTrace,
  type ChartConfig,
  type ChartData,
  type ChartSpec,
  type DataRow,
  type LegendTrace,
  type PieDoughnutLabelLayoutTrace,
  type SurfaceApproximationTrace,
  type StockGlyphTrace,
  type TextMeasurementContext,
  type ThreeDApproximationTrace,
} from '@mog/charts';
import type {
  ChartError,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ChartRenderFrameSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { ResolvedChartRangeReferences } from '../chart-range-references';
import { extractLayoutSnapshot } from './chart-layout-snapshot';
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
  chartArea: { width: number; height: number };
  plotArea: { width: number; height: number } | null;
  compilerPathId: ChartCompilerPathId;
  compileInput: ChartSpec;
  barGeometryTrace?: BarGeometryTrace;
  cartesianGeometryTrace?: CartesianGeometryTrace;
  stockGlyphTrace?: StockGlyphTrace;
  legendTrace?: LegendTrace;
  pieDoughnutLabelLayoutTrace?: PieDoughnutLabelLayoutTrace;
  threeDApproximationTrace?: ThreeDApproximationTrace;
  surfaceApproximationTrace?: SurfaceApproximationTrace;
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
  renderFrame?: ChartRenderFrameSnapshot;
}

export type ChartCompileStage = 'configToSpec' | 'compile' | 'collectMarks' | 'layout';

type CompileChartMarksOutcome =
  | { ok: true; result: CompileChartMarksResult }
  | { ok: false; stage: ChartCompileStage; cause: unknown };

class ChartCompileException extends Error {
  stage: ChartCompileStage;
  cause: unknown;

  constructor(stage: ChartCompileStage, cause: unknown) {
    super(normalizeCaughtError(cause).message || 'Chart compilation failed');
    this.name = 'ChartCompileException';
    this.stage = stage;
    this.cause = cause;
  }
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
  const outcome = compileChartMarksOutcome(input);
  if (!outcome.ok) throw new ChartCompileException(outcome.stage, outcome.cause);
  return outcome.result;
}

export function compileChartMarksOrError(
  chartId: string,
  input: CompileChartMarksInput,
): CompileChartMarksResult | ChartError {
  const outcome = compileChartMarksOutcome(input);
  if (!outcome.ok) return chartCompileError(chartId, outcome.cause, outcome.stage);
  return outcome.result;
}

export function chartCompileError(
  chartId: string,
  cause: unknown,
  stage: ChartCompileStage = 'compile',
): ChartError {
  const failure = normalizeCompileFailure(cause, stage);
  return {
    code: 'COMPILE_FAILED',
    message: failure.normalized.message
      ? `Chart compilation failed: ${failure.normalized.message}`
      : 'Chart compilation failed',
    chartId,
    details: {
      stage: failure.stage,
      ...failure.normalized.details,
    },
  };
}

function normalizeCompileFailure(
  cause: unknown,
  fallbackStage: ChartCompileStage,
): { stage: ChartCompileStage; normalized: ReturnType<typeof normalizeCaughtError> } {
  if (cause instanceof ChartCompileException) {
    return {
      stage: cause.stage,
      normalized: normalizeCaughtError(cause.cause),
    };
  }

  return {
    stage: fallbackStage,
    normalized: normalizeCaughtError(cause),
  };
}

function compileChartMarksOutcome(input: CompileChartMarksInput): CompileChartMarksOutcome {
  let stage: ChartCompileStage = 'configToSpec';
  try {
    const spec = configToSpec(input.config, input.chartData);
    stage = 'compile';
    const compileInput = buildCompileInput(spec);
    const textMeasurementContext = chartTextMeasurementContext();
    const textMeasurementOption = textMeasurementContext ? { textMeasurementContext } : {};
    const compileResult = input.size
      ? compile(compileInput.spec, undefined, {
          width: input.size.width,
          height: input.size.height,
          ...textMeasurementOption,
        })
      : compile(compileInput.spec, undefined, textMeasurementOption);

    stage = 'collectMarks';
    const marks = collectMarks(compileResult);
    stage = 'layout';
    const layout = extractLayoutSnapshot(compileResult);

    return {
      ok: true,
      result: {
        marks,
        layout,
        chartArea: {
          width: compileResult.layout.width,
          height: compileResult.layout.height,
        },
        plotArea: compileResult.layout.plotArea
          ? {
              width: compileResult.layout.plotArea.width,
              height: compileResult.layout.plotArea.height,
            }
          : null,
        compilerPathId: compileInput.compilerPathId,
        compileInput: compileInput.spec,
        barGeometryTrace: compileResult.barGeometryTrace,
        cartesianGeometryTrace: compileResult.cartesianGeometry,
        stockGlyphTrace: compileResult.stockGlyphTrace,
        legendTrace: compileResult.legendTrace,
        pieDoughnutLabelLayoutTrace: compileResult.pieDoughnutLabelLayoutTrace,
        threeDApproximationTrace: compileResult.threeDApproximationTrace,
        surfaceApproximationTrace: compileResult.surfaceApproximationTrace,
      },
    };
  } catch (cause) {
    return { ok: false, stage, cause };
  }
}

function normalizeCaughtError(cause: unknown): {
  message: string;
  details: Record<string, unknown>;
} {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      details: {
        errorName: cause.name,
        errorMessage: cause.message,
      },
    };
  }

  if (typeof cause === 'string') {
    return {
      message: cause,
      details: { errorMessage: cause },
    };
  }

  return {
    message: String(cause),
    details: { errorValue: cause },
  };
}

export function compileChartRenderSnapshotAtSize(
  input: CompileChartRenderSnapshotAtSizeInput,
): ChartRenderSnapshot {
  const renderFrame = input.renderFrame ?? {
    kind: 'embedded' as const,
    sheetId: String(input.sheetId),
    chartId: input.chartId,
    width: input.width,
    height: input.height,
  };
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
        renderFrame,
        config: input.config,
        chartData: input.chartData,
        resolvedRanges: input.resolvedRanges,
        compileInput: compiled.compileInput,
        renderSize: {
          width: input.width,
          height: input.height,
        },
      }),
      layout: compiled.layout,
      renderFrame,
      chartArea: compiled.chartArea,
      plotArea: compiled.plotArea,
      barGeometryTrace: compiled.barGeometryTrace,
      cartesianGeometryTrace: compiled.cartesianGeometryTrace,
      stockGlyphTrace: compiled.stockGlyphTrace,
      legendTrace: compiled.legendTrace,
      pieDoughnutLabelLayoutTrace: compiled.pieDoughnutLabelLayoutTrace,
      threeDApproximationTrace: compiled.threeDApproximationTrace,
      surfaceApproximationTrace: compiled.surfaceApproximationTrace,
    }),
  };
}

let cachedTextMeasurementContext: TextMeasurementContext | null | undefined;

function chartTextMeasurementContext(): TextMeasurementContext | undefined {
  if (cachedTextMeasurementContext !== undefined) {
    return cachedTextMeasurementContext ?? undefined;
  }

  cachedTextMeasurementContext = createTextMeasurementContext() ?? null;
  return cachedTextMeasurementContext ?? undefined;
}

function createTextMeasurementContext(): TextMeasurementContext | undefined {
  const offscreenCanvas = (
    globalThis as {
      OffscreenCanvas?: new (
        width: number,
        height: number,
      ) => { getContext(type: '2d'): TextMeasurementContext | null };
    }
  ).OffscreenCanvas;
  if (offscreenCanvas) {
    return new offscreenCanvas(1, 1).getContext('2d') ?? undefined;
  }

  const documentLike = (
    globalThis as {
      document?: {
        createElement(name: 'canvas'): {
          getContext(type: '2d'): TextMeasurementContext | null;
        };
      };
    }
  ).document;
  return documentLike?.createElement('canvas').getContext('2d') ?? undefined;
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
