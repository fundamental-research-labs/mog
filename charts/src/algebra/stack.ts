/**
 * Universal stacking utilities for the charts package.
 *
 * Replaces 3+ duplicate stacking implementations across compiler.ts (bar marks),
 * compiler.ts (area marks), and histogram.ts with a single, well-tested module.
 *
 * All functions are pure (no side effects) and handle edge cases
 * (empty inputs, zero totals, non-finite values).
 */

import type { DataRow } from '../grammar/spec';

// =============================================================================
// Types
// =============================================================================

/**
 * Stack mode type - matches the ChartSpec ConfigSpec.stack type.
 */
export type StackMode = 'zero' | 'normalize' | 'center' | false;

/**
 * Input for a single stack segment.
 */
export interface StackInput {
  /** The category key (x-axis value for vertical charts) */
  category: string;
  /** The value to stack */
  value: number;
  /** The group/series key (for identifying which series this belongs to) */
  group: string;
}

/**
 * Output for a stacked segment.
 */
export interface StackOutput {
  /** The category key */
  category: string;
  /** The group/series key */
  group: string;
  /** The original value */
  value: number;
  /** Start position (cumulative bottom of segment) */
  start: number;
  /** End position (cumulative top of segment) */
  end: number;
}

/**
 * Options for stack computation.
 */
export interface StackOptions {
  /** Stack mode: 'zero' (default stack), 'normalize' (percent), 'center' (stream), false (no stack) */
  mode: StackMode;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sanitize a numeric value: non-finite values (NaN, Infinity, -Infinity) become 0.
 */
function sanitize(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

// =============================================================================
// Core
// =============================================================================

/**
 * Compute stacked positions for data segments.
 *
 * This is the core algebraic operation that all chart stacking uses.
 * It computes start/end positions for each segment based on the stack mode.
 *
 * For 'zero' mode:
 * - Positive values stack upward from 0
 * - Negative values stack downward from 0
 * - Each segment: start = previous cumulative, end = start + value
 *
 * For 'normalize' mode:
 * - Values are normalized to percentages per category
 * - Total per category = 100%
 * - Each segment: start/end are cumulative percentages [0, 100]
 *
 * For 'center' mode:
 * - Values are centered around 0
 * - offset = -(total for category) / 2
 * - Each segment is shifted by offset
 *
 * For false:
 * - No stacking, each segment starts at 0
 * - start = 0, end = value
 *
 * @param inputs - Array of StackInput (must be ordered: all items for group1 first, then group2, etc.)
 * @param options - Stack configuration
 * @returns Array of StackOutput with computed start/end positions
 */
export function computeStack(inputs: StackInput[], options: StackOptions): StackOutput[] {
  if (inputs.length === 0) return [];

  const { mode } = options;

  // false mode: no stacking
  if (mode === false) {
    return inputs.map((inp) => {
      const v = sanitize(inp.value);
      return {
        category: inp.category,
        group: inp.group,
        value: v,
        start: 0,
        end: v,
      };
    });
  }

  // 'zero' mode: separate positive and negative accumulators
  if (mode === 'zero') {
    const posAccum = new Map<string, number>();
    const negAccum = new Map<string, number>();

    return inputs.map((inp) => {
      const v = sanitize(inp.value);

      let start: number;
      let end: number;

      if (v >= 0) {
        start = posAccum.get(inp.category) ?? 0;
        end = start + v;
        posAccum.set(inp.category, end);
      } else {
        start = negAccum.get(inp.category) ?? 0;
        end = start + v;
        negAccum.set(inp.category, end);
      }

      return {
        category: inp.category,
        group: inp.group,
        value: v,
        start,
        end,
      };
    });
  }

  // 'normalize' mode: compute totals first, then normalize to percentages
  if (mode === 'normalize') {
    const totals = categoryTotals(inputs);
    const cumAccum = new Map<string, number>();

    return inputs.map((inp) => {
      const v = sanitize(inp.value);
      const total = totals.get(inp.category) ?? 0;

      // Avoid divide-by-zero: if total is 0, segment has zero size
      const pct = total === 0 ? 0 : (Math.abs(v) / total) * 100;

      const start = cumAccum.get(inp.category) ?? 0;
      const end = start + pct;
      cumAccum.set(inp.category, end);

      return {
        category: inp.category,
        group: inp.group,
        value: v,
        start,
        end,
      };
    });
  }

  // 'center' mode: compute totals per category, then offset by -(total/2)
  // First pass: compute total per category (sum of absolute values)
  const catTotals = new Map<string, number>();
  for (const inp of inputs) {
    const v = sanitize(inp.value);
    catTotals.set(inp.category, (catTotals.get(inp.category) ?? 0) + Math.abs(v));
  }

  // Second pass: stack with offset
  const cumAccum = new Map<string, number>();

  return inputs.map((inp) => {
    const v = sanitize(inp.value);
    const total = catTotals.get(inp.category) ?? 0;
    const offset = -(total / 2);

    const cumSoFar = cumAccum.get(inp.category) ?? 0;
    const start = offset + cumSoFar;
    const end = start + Math.abs(v);
    cumAccum.set(inp.category, cumSoFar + Math.abs(v));

    return {
      category: inp.category,
      group: inp.group,
      value: v,
      start,
      end,
    };
  });
}

// =============================================================================
// Convenience helpers
// =============================================================================

/**
 * Compute category totals (absolute values) for normalization.
 *
 * @param inputs - Array of StackInput
 * @returns Map of category -> total absolute value
 */
export function categoryTotals(inputs: StackInput[]): Map<string, number> {
  const totals = new Map<string, number>();

  for (const inp of inputs) {
    const v = sanitize(inp.value);
    totals.set(inp.category, (totals.get(inp.category) ?? 0) + Math.abs(v));
  }

  return totals;
}

/**
 * Prepare StackInputs from DataRow arrays.
 *
 * @param data - Array of data rows
 * @param categoryField - Field name for category
 * @param valueField - Field name for value
 * @param groupField - Field name for group/series (optional, defaults to single group '__default__')
 * @returns Array of StackInput
 */
export function dataToStackInputs(
  data: DataRow[],
  categoryField: string,
  valueField: string,
  groupField?: string,
): StackInput[] {
  return data.map((row) => {
    const rawValue = row[valueField];
    const value = typeof rawValue === 'number' ? sanitize(rawValue) : 0;

    return {
      category: String(row[categoryField] ?? ''),
      value,
      group: groupField !== undefined ? String(row[groupField] ?? '') : '__default__',
    };
  });
}
