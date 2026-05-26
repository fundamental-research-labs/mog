/**
 * Aggregate Transform
 *
 * Groups data by fields and applies aggregate functions.
 *
 * Pure functions - no side effects.
 */

import type { AggregateSpec, DataRow } from '../spec';

// =============================================================================
// Safe Min/Max Helpers (avoid call stack overflow with large arrays)
// =============================================================================

function safeMin(values: number[]): number {
  let min = Infinity;
  for (const v of values) {
    if (v < min) min = v;
  }
  return min;
}

function safeMax(values: number[]): number {
  let max = -Infinity;
  for (const v of values) {
    if (v > max) max = v;
  }
  return max;
}

/**
 * Extended aggregate operation type that includes all supported operations.
 * This extends the spec AggregateOp with additional statistical operations.
 */
type ExtendedAggregateOp =
  | 'count'
  | 'sum'
  | 'mean'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'variance'
  | 'stdev'
  | 'q1'
  | 'q3'
  | 'ci0'
  | 'ci1'
  | 'distinct'
  | 'values';

// =============================================================================
// Aggregate Transform
// =============================================================================

/**
 * Apply an aggregate transform to data.
 *
 * @param data - Input data rows
 * @param spec - Aggregate specification
 * @returns Aggregated data rows
 */
export function applyAggregate(data: DataRow[], spec: AggregateSpec): DataRow[] {
  const { groupby, aggregate } = spec;

  // Group data
  const groups = groupBy(data, groupby);

  // Aggregate each group
  const results: DataRow[] = [];

  for (const [_key, groupData] of groups.entries()) {
    const row: DataRow = {};

    // Add groupby fields
    if (groupData.length > 0) {
      for (const field of groupby) {
        row[field] = groupData[0][field];
      }
    }

    // Apply aggregations
    for (const agg of aggregate) {
      row[agg.as] = computeAggregate(groupData, agg.op, agg.field);
    }

    results.push(row);
  }

  return results;
}

/**
 * Group data by fields.
 */
function groupBy(data: DataRow[], fields: string[]): Map<string, DataRow[]> {
  const groups = new Map<string, DataRow[]>();

  for (const row of data) {
    const key = JSON.stringify(fields.map((f) => row[f]));

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  return groups;
}

/**
 * Compute an aggregate value for a group.
 */
function computeAggregate(
  data: DataRow[],
  op: ExtendedAggregateOp,
  field?: string,
): number | unknown[] | null {
  if (data.length === 0) {
    return op === 'count' ? 0 : null;
  }

  // Get numeric values for the field
  const values = field
    ? (data.map((d) => d[field]).filter((v) => typeof v === 'number' && !isNaN(v)) as number[])
    : [];

  switch (op) {
    case 'count':
      return data.length;

    case 'sum':
      return values.reduce((sum, v) => sum + v, 0);

    case 'mean':
    case 'average':
      return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

    case 'median':
      return computeMedian(values);

    case 'min':
      return values.length > 0 ? safeMin(values) : null;

    case 'max':
      return values.length > 0 ? safeMax(values) : null;

    case 'variance':
      return computeVariance(values);

    case 'stdev':
      const variance = computeVariance(values);
      return variance !== null ? Math.sqrt(variance) : null;

    case 'q1':
      return computeQuantile(values, 0.25);

    case 'q3':
      return computeQuantile(values, 0.75);

    case 'ci0':
      // 95% confidence interval lower bound
      return computeConfidenceInterval(values, 0.95)[0];

    case 'ci1':
      // 95% confidence interval upper bound
      return computeConfidenceInterval(values, 0.95)[1];

    case 'distinct':
      return field ? new Set(data.map((d) => d[field])).size : data.length;

    case 'values':
      return field ? data.map((d) => d[field]) : data;

    default:
      return null;
  }
}

// =============================================================================
// Statistical Functions
// =============================================================================

/**
 * Compute median of values.
 */
function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute variance of values.
 */
function computeVariance(values: number[]): number | null {
  if (values.length < 2) return null;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));

  // Sample variance (n-1)
  return squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1);
}

/**
 * Compute a quantile of values.
 */
function computeQuantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Compute confidence interval for the mean.
 */
function computeConfidenceInterval(
  values: number[],
  level: number = 0.95,
): [number | null, number | null] {
  if (values.length < 2) return [null, null];

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = computeVariance(values);

  if (variance === null) return [null, null];

  const se = Math.sqrt(variance / values.length);

  // Use z-score for large samples
  const z = getZScore(level);

  return [mean - z * se, mean + z * se];
}

/**
 * Get z-score for a confidence level.
 */
function getZScore(level: number): number {
  // Common z-scores
  if (level >= 0.99) return 2.576;
  if (level >= 0.95) return 1.96;
  if (level >= 0.9) return 1.645;
  return 1.96; // Default to 95%
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Simple count aggregate without grouping.
 */
export function count(data: DataRow[]): number {
  return data.length;
}

/**
 * Sum a field.
 */
export function sum(data: DataRow[], field: string): number {
  return data.reduce((total, row) => {
    const value = row[field];
    return total + (typeof value === 'number' && !isNaN(value) ? value : 0);
  }, 0);
}

/**
 * Calculate mean of a field.
 */
export function mean(data: DataRow[], field: string): number | null {
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Find min value of a field.
 */
export function min(data: DataRow[], field: string): number | null {
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  return values.length > 0 ? safeMin(values) : null;
}

/**
 * Find max value of a field.
 */
export function max(data: DataRow[], field: string): number | null {
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  return values.length > 0 ? safeMax(values) : null;
}

/**
 * Calculate extent (min and max) of a field.
 */
export function extent(data: DataRow[], field: string): [number, number] | null {
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  if (values.length === 0) return null;
  return [safeMin(values), safeMax(values)];
}

/**
 * Get unique values of a field.
 */
export function unique(data: DataRow[], field: string): unknown[] {
  return [...new Set(data.map((d) => d[field]))];
}

/**
 * Group and count occurrences.
 */
export function countBy(data: DataRow[], field: string): Map<unknown, number> {
  const counts = new Map<unknown, number>();

  for (const row of data) {
    const value = row[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}
