/**
 * Shared types for the grammar compiler pipeline.
 *
 * Extracted from compiler.ts to break the cycle:
 *   compiler.ts -> layer-compiler.ts -> compiler.ts (for CompileOptions/CompileResult)
 *
 * Both compiler.ts and layer-compiler.ts import these shared types from here,
 * and compiler.ts re-exports them for backward compatibility with callers that
 * import CompileOptions / CompileResult from '../grammar/compiler'.
 */

import type { AnyMark } from '../primitives/types';
import type { ScaleMap } from './encoding-resolver';
import type { AxisOrient, FieldType, Layout, MarkType } from './spec';

export type CartesianGeometryCoordinateSystem = 'chartPixel';

export interface CartesianGeometryScaleTrace {
  field?: string;
  type?: FieldType;
  axisOrient?: AxisOrient;
  domain?: Array<string | number | null>;
  range?: [number, number];
  tickValues?: Array<string | number | null>;
  tickStep?: number;
}

export interface CartesianGeometryPointTrace {
  seriesIndex?: number;
  sourceSeriesIndex?: number;
  sourceSeriesKey?: string;
  pointIndex?: number;
  category?: string | number | null;
  xValue?: number;
  yValue?: number;
  normalizedSize?: number;
  rawBubbleSize?: number;
  xPixel: number;
  yPixel: number;
  plotX: number;
  plotY: number;
  chartX: number;
  chartY: number;
  renderedArea?: number;
  renderedRadius?: number;
  clipToPlotArea?: boolean;
  segmentIndex?: number;
  stackSign?: 'positive' | 'negative';
  stackValue?: number;
  percentValue?: number;
  baselinePixel?: number;
  topPixel?: number;
  bottomPixel?: number;
  baselinePlotY?: number;
  topPlotY?: number;
  bottomPlotY?: number;
}

export interface CartesianGeometryLayerTrace {
  layerIndex: number;
  markType: MarkType;
  xField?: string;
  yField?: string;
  sizeField?: string;
  xScale?: CartesianGeometryScaleTrace;
  yScale?: CartesianGeometryScaleTrace;
  sizeScale?: CartesianGeometryScaleTrace;
  points: CartesianGeometryPointTrace[];
  area?: {
    baselinePixel?: number;
    baselinePlotY?: number;
  };
}

export interface CartesianGeometryTrace {
  coordinateSystem: CartesianGeometryCoordinateSystem;
  chartWidth: number;
  chartHeight: number;
  plotArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layers: CartesianGeometryLayerTrace[];
}

/**
 * Compiled chart result.
 */
export interface CompileResult {
  /** Background marks that must render before all chart content */
  background?: AnyMark[];
  /** Data marks (bars, lines, points, etc.) */
  marks: AnyMark[];
  /** Axis marks (lines, ticks, labels) */
  axes: AnyMark[];
  /** Legend marks */
  legends: AnyMark[];
  /** Title marks */
  title?: AnyMark[];
  /** Chart bounds */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Layout information */
  layout: Layout;
  /** Scales used */
  scales: ScaleMap;
  /** Compiler-derived Cartesian point geometry, when applicable */
  cartesianGeometry?: CartesianGeometryTrace;
}

/**
 * Compilation options.
 */
export interface CompileOptions {
  /** Override chart dimensions */
  width?: number;
  height?: number;
  /** Default colors */
  colors?: string[];
  /** Skip axis generation */
  skipAxes?: boolean;
  /** Skip legend generation */
  skipLegend?: boolean;
  /** Skip title generation */
  skipTitle?: boolean;
}
