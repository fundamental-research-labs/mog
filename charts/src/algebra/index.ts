/**
 * Compositional Algebra for Chart Data Operations
 *
 * Shared, well-tested operations used by all chart pipelines:
 * - Grammar compiler (compiler.ts)
 * - Statistical chart builders (boxplot, histogram, violin)
 * - OOXML export (data-util.ts)
 *
 * Import from '@mog/charts/algebra' for direct access,
 * or from '@mog/charts' for commonly-used re-exports.
 */

// Grouping
export { countByField, groupBy, groupByAccessor, groupByFields, uniqueValues } from './group-by';

// Stacking
export {
  categoryTotals,
  computeStack,
  dataToStackInputs,
  type StackInput,
  type StackMode,
  type StackOptions,
  type StackOutput,
} from './stack';

// Color resolution
export {
  DEFAULT_CATEGORY_COLORS,
  resolveColor,
  resolveFillColor,
  resolveStrokeColor,
  type ColorResolveOptions,
} from './color';

// Data sanitization
export { extendDataForLayerFields, sanitizeDataForScales } from './data-sanitize';
