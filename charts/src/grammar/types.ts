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
import type { Layout } from './spec';

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
