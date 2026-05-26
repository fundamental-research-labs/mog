/**
 * Transform Module Exports
 *
 * Data transforms for the chart grammar system.
 * Transforms are pure functions that take data and return transformed data.
 */

// Filter transform
export { applyFilter, filterNonEmpty, filterOneOf, filterRange, filterValid } from './filter';

// Sort transform
export {
  applySort,
  getSortedUniqueValues,
  reverseData,
  sortAscending,
  sortByComparator,
  sortByCustomOrder,
  sortByFields,
  sortDescending,
  stableSort,
} from './sort';

// Aggregate transform
export { applyAggregate, count, countBy, extent, max, mean, min, sum, unique } from './aggregate';

// Bin transform
export {
  applyBin,
  cumulativeHistogram,
  getBinBoundaries,
  histogram,
  histogramFromData,
  normalizedHistogram,
} from './bin';

// Regression transform
export {
  applyRegression,
  computeRegression,
  exponentialRegression,
  generateTrendline,
  getRegressionEquation,
  linearRegression,
  logarithmicRegression,
  polynomialRegression,
  powerRegression,
  type RegressionResult,
} from './regression';

// Density transform
export {
  applyDensity,
  biweightKernel,
  densityAt,
  epanechnikovKernel,
  findMode,
  gaussianKernel,
  isMultimodal,
  kernelDensityEstimation,
  silvermanBandwidth,
  triangularKernel,
  uniformKernel,
  violinShape,
  type DensityResult,
} from './density';

// Re-export types and type guards
export type {
  AggregateSpec,
  BinSpec,
  DataRow,
  DensitySpec,
  FilterSpec,
  RegressionSpec,
  SortSpec,
  Transform,
  TransformType,
} from '../spec';

export {
  isAggregateTransform,
  isBinTransform,
  isCalculateTransform,
  isDensityTransform,
  isFilterTransform,
  isFoldTransform,
  isRegressionTransform,
  isSortTransform,
} from '../spec';

// =============================================================================
// Transform Pipeline
// =============================================================================

import type { DataRow, Transform } from '../spec';
import {
  isDensityTransform as isDensityTransformGuard,
  isFoldTransform as isFoldTransformGuard,
  isRegressionTransform as isRegressionTransformGuard,
} from '../spec';
import { applyAggregate } from './aggregate';
import { applyBin } from './bin';
import { applyDensity } from './density';
import { applyFilter } from './filter';
import { applyRegression } from './regression';
import { applySort } from './sort';

/**
 * Apply a sequence of transforms to data.
 *
 * @param transforms - Array of transform specifications
 * @param data - Input data rows
 * @returns Transformed data rows
 */
export function applyTransforms(transforms: Transform[], data: DataRow[]): DataRow[] {
  let result = data;

  for (const transform of transforms) {
    result = applyTransform(transform, result);
  }

  return result;
}

/**
 * Apply a single transform to data.
 */
export function applyTransform(transform: Transform, data: DataRow[]): DataRow[] {
  // Filter transform
  if ('filter' in transform) {
    return applyFilter(data, transform.filter);
  }

  // Aggregate transform
  if ('aggregate' in transform) {
    // Handle both single spec and array of specs
    const specs = Array.isArray(transform.aggregate) ? transform.aggregate : [transform.aggregate];
    let result = data;
    for (const spec of specs) {
      result = applyAggregate(result, spec);
    }
    return result;
  }

  // Bin transform
  if ('bin' in transform) {
    return applyBin(data, transform.bin);
  }

  // Sort transform
  if ('sort' in transform) {
    return applySort(data, transform.sort);
  }

  // Calculate transform
  if ('calculate' in transform && 'as' in transform) {
    return applyCalculate(data, transform.calculate, transform.as);
  }

  // Fold transform
  if (isFoldTransformGuard(transform)) {
    const as = transform.as ?? ['key', 'value'];
    return applyFold(data, transform.fold, as);
  }

  // Regression transform
  if (isRegressionTransformGuard(transform)) {
    return applyRegression(data, transform);
  }

  // Density transform
  if (isDensityTransformGuard(transform)) {
    return applyDensity(data, transform);
  }

  // Unknown transform - return data unchanged
  return data;
}

/**
 * Apply a calculate transform (derive new field).
 */
function applyCalculate(data: DataRow[], expr: string, as: string): DataRow[] {
  return data.map((datum) => {
    const value = evaluateExpression(expr, datum);
    return { ...datum, [as]: value };
  });
}

/**
 * Evaluate a simple expression for calculate transform.
 */
function evaluateExpression(expr: string, datum: DataRow): unknown {
  // Remove 'datum.' prefix
  const normalizedExpr = expr.replace(/datum\./g, '');

  // Handle simple field reference
  if (/^\w+$/.test(normalizedExpr)) {
    return datum[normalizedExpr];
  }

  // Handle simple arithmetic: field + field, field * 2, etc.
  const arithmeticMatch = normalizedExpr.match(/^(\w+)\s*([+\-*/])\s*(\w+|\d+\.?\d*)$/);

  if (arithmeticMatch) {
    const [, leftField, op, rightPart] = arithmeticMatch;
    const left = datum[leftField] as number;
    const right = /^\d/.test(rightPart) ? parseFloat(rightPart) : (datum[rightPart] as number);

    if (typeof left !== 'number' || typeof right !== 'number') {
      return null;
    }

    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right !== 0 ? left / right : null;
    }
  }

  // Handle string concatenation: field + " " + field
  const concatMatch = normalizedExpr.match(/^(\w+)\s*\+\s*["'](.*)["']\s*\+\s*(\w+)$/);

  if (concatMatch) {
    const [, field1, sep, field2] = concatMatch;
    return String(datum[field1]) + sep + String(datum[field2]);
  }

  // Unsupported expression - return null
  return null;
}

/**
 * Apply a fold transform (wide to long format).
 */
function applyFold(data: DataRow[], fields: string[], as: [string, string]): DataRow[] {
  const [keyField, valueField] = as;
  const result: DataRow[] = [];

  for (const row of data) {
    for (const field of fields) {
      const newRow: DataRow = {};

      // Copy non-fold fields
      for (const key of Object.keys(row)) {
        if (!fields.includes(key)) {
          newRow[key] = row[key];
        }
      }

      // Add fold fields
      newRow[keyField] = field;
      newRow[valueField] = row[field];

      result.push(newRow);
    }
  }

  return result;
}
