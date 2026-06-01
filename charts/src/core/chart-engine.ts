/**
 * Chart Engine - Pure computation functions for chart rendering
 *
 * This module provides pure functions with no DOM dependencies:
 * - configToSpec: Convert ChartConfig + ChartData to ChartSpec
 * - collectMarks: Flatten CompileResult into renderable mark array
 *
 * For DOM-based chart rendering (canvas, resize observer, etc.),
 * use the dom/chart-engine module instead.
 */
import type { CompileResult } from '../grammar/compiler';
import type { ChartSpec } from '../grammar/spec';
import type { AnyMark } from '../primitives/types';
import type { ChartConfig, ChartData } from '../types';
import { configToSpec as configToSpecImpl } from './config-to-spec';

/**
 * Convert ChartConfig + ChartData to ChartSpec format for the grammar compiler.
 * Pure function - no DOM dependencies.
 *
 * Delegates to the comprehensive implementation in config-to-spec.ts which
 * maps ALL ChartConfig fields losslessly (the old inline implementation
 * only mapped ~3 of 30+ fields).
 */
export function configToSpec(config: ChartConfig, data: ChartData): ChartSpec {
  return configToSpecImpl(config, data);
}

function isAxisGridline(mark: AnyMark): boolean {
  const datum = mark.datum as { axisPart?: unknown } | undefined;
  return datum?.axisPart === 'grid';
}

/**
 * Collect all marks from a CompileResult into a single flat array
 * in the correct render order.
 * Pure function - no DOM dependencies.
 */
export function collectMarks(result: CompileResult): AnyMark[] {
  const axisGridlines = result.axes.filter(isAxisGridline);
  const axisForeground = result.axes.filter((mark) => !isAxisGridline(mark));

  return [
    ...(result.background || []),
    ...axisGridlines,
    ...result.marks,
    ...axisForeground,
    ...result.legends,
    ...(result.title || []),
  ];
}
