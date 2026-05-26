/**
 * Bin Transform
 *
 * Creates histogram bins for quantitative data.
 *
 * Pure functions - no side effects.
 */

import type { BinSpec, DataRow } from '../spec';

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

// =============================================================================
// Bin Transform
// =============================================================================

/**
 * Apply a bin transform to data.
 *
 * @param data - Input data rows
 * @param spec - Bin specification
 * @returns Data rows with bin fields added
 */
export function applyBin(data: DataRow[], spec: BinSpec): DataRow[] {
  const { field, as, maxbins = 10, step, nice = true } = spec;

  // Get numeric values
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  if (values.length === 0) {
    return data.map((row) => ({
      ...row,
      [as]: null,
      [`${as}_end`]: null,
    }));
  }

  // Calculate bin parameters
  const bins = calculateBins(values, { maxbins, step, nice });

  // Assign bins to data
  return data.map((row) => {
    const value = row[field];

    if (typeof value !== 'number' || isNaN(value)) {
      return {
        ...row,
        [as]: null,
        [`${as}_end`]: null,
      };
    }

    const binIndex = findBinIndex(value, bins);
    const binStart = bins.start + binIndex * bins.step;
    const binEnd = binStart + bins.step;

    return {
      ...row,
      [as]: binStart,
      [`${as}_end`]: binEnd,
    };
  });
}

/**
 * Bin parameters.
 */
interface BinParams {
  start: number;
  stop: number;
  step: number;
  count: number;
}

/**
 * Calculate bin parameters.
 */
function calculateBins(
  values: number[],
  options: { maxbins?: number; step?: number; nice?: boolean },
): BinParams {
  const { maxbins = 10, step: explicitStep, nice = true } = options;

  let min = safeMin(values);
  let max = safeMax(values);

  // Handle single value case
  if (min === max) {
    return {
      start: min - 0.5,
      stop: max + 0.5,
      step: 1,
      count: 1,
    };
  }

  let step: number;

  if (explicitStep !== undefined) {
    step = explicitStep;
  } else {
    // Calculate step based on range and maxbins
    const range = max - min;
    step = niceStep(range / maxbins);
  }

  // Adjust bounds for nice values
  if (nice) {
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;
  }

  const count = Math.ceil((max - min) / step);

  return {
    start: min,
    stop: max,
    step,
    count,
  };
}

/**
 * Find the bin index for a value.
 */
function findBinIndex(value: number, bins: BinParams): number {
  const index = Math.floor((value - bins.start) / bins.step);
  // Clamp to valid range (handle edge case where value === bins.stop)
  return Math.max(0, Math.min(bins.count - 1, index));
}

/**
 * Calculate a nice step value.
 */
function niceStep(step: number): number {
  const exp = Math.floor(Math.log10(step));
  const pow10 = Math.pow(10, exp);
  const fraction = step / pow10;

  let niceFraction: number;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * pow10;
}

// =============================================================================
// Histogram Utilities
// =============================================================================

/**
 * Create histogram bin counts.
 *
 * @param values - Numeric values to bin
 * @param options - Bin options
 * @returns Array of bin objects with count
 */
export function histogram(
  values: number[],
  options: { maxbins?: number; step?: number; nice?: boolean } = {},
): Array<{ bin0: number; bin1: number; count: number }> {
  const numericValues = values.filter((v) => !isNaN(v));

  if (numericValues.length === 0) {
    return [];
  }

  const bins = calculateBins(numericValues, options);
  const counts = new Array(bins.count).fill(0);

  for (const value of numericValues) {
    const index = findBinIndex(value, bins);
    counts[index]++;
  }

  return counts.map((count, i) => ({
    bin0: bins.start + i * bins.step,
    bin1: bins.start + (i + 1) * bins.step,
    count,
  }));
}

/**
 * Create histogram bin counts from data rows.
 */
export function histogramFromData(
  data: DataRow[],
  field: string,
  options: { maxbins?: number; step?: number; nice?: boolean } = {},
): Array<{ bin0: number; bin1: number; count: number }> {
  const values = data.map((d) => d[field]).filter((v) => typeof v === 'number') as number[];

  return histogram(values, options);
}

/**
 * Create cumulative distribution bins.
 */
export function cumulativeHistogram(
  values: number[],
  options: { maxbins?: number; step?: number; nice?: boolean } = {},
): Array<{ bin0: number; bin1: number; count: number; cumulative: number }> {
  const hist = histogram(values, options);
  let cumulative = 0;

  return hist.map((bin) => {
    cumulative += bin.count;
    return {
      ...bin,
      cumulative,
    };
  });
}

/**
 * Create normalized histogram (density).
 */
export function normalizedHistogram(
  values: number[],
  options: { maxbins?: number; step?: number; nice?: boolean } = {},
): Array<{ bin0: number; bin1: number; count: number; density: number }> {
  const hist = histogram(values, options);
  const total = hist.reduce((sum, bin) => sum + bin.count, 0);

  if (total === 0) {
    return hist.map((bin) => ({
      ...bin,
      density: 0,
    }));
  }

  const binWidth = hist.length > 0 ? hist[0].bin1 - hist[0].bin0 : 1;

  return hist.map((bin) => ({
    ...bin,
    density: bin.count / (total * binWidth),
  }));
}

/**
 * Get bin boundaries for a range.
 */
export function getBinBoundaries(
  min: number,
  max: number,
  options: { maxbins?: number; step?: number; nice?: boolean } = {},
): number[] {
  const bins = calculateBins([min, max], options);
  const boundaries: number[] = [];

  for (let i = 0; i <= bins.count; i++) {
    boundaries.push(bins.start + i * bins.step);
  }

  return boundaries;
}
