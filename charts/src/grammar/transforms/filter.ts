/**
 * Filter Transform
 *
 * Filters data rows based on predicate conditions.
 *
 * Pure functions - no side effects.
 */

import type { DataRow, FilterSpec } from '../spec';

// =============================================================================
// Filter Transform
// =============================================================================

/**
 * Apply a filter transform to data.
 *
 * @param data - Input data rows
 * @param filter - Filter specification or expression string
 * @returns Filtered data rows
 */
export function applyFilter(data: DataRow[], filter: FilterSpec | string): DataRow[] {
  // Handle string expression (simple JS-like expression)
  if (typeof filter === 'string') {
    return filterByExpression(data, filter);
  }

  // Handle FilterSpec object
  return filterBySpec(data, filter);
}

/**
 * Filter data by FilterSpec object.
 */
function filterBySpec(data: DataRow[], spec: FilterSpec): DataRow[] {
  const { field } = spec;

  return data.filter((row) => {
    const value = row[field];

    // Apply ALL matching predicates as AND conditions
    if (spec.equal !== undefined && value !== spec.equal) return false;
    if (spec.lt !== undefined && !(typeof value === 'number' && value < spec.lt)) return false;
    if (spec.lte !== undefined && !(typeof value === 'number' && value <= spec.lte)) return false;
    if (spec.gt !== undefined && !(typeof value === 'number' && value > spec.gt)) return false;
    if (spec.gte !== undefined && !(typeof value === 'number' && value >= spec.gte)) return false;
    if (spec.oneOf !== undefined && !spec.oneOf.includes(value)) return false;
    if (spec.range !== undefined) {
      const [min, max] = spec.range;
      if (!(typeof value === 'number' && value >= min && value <= max)) return false;
    }
    return true;
  });
}

/**
 * Filter data by expression string.
 * Supports simple expressions like "datum.field > 10" or "datum.category === 'A'"
 */
function filterByExpression(data: DataRow[], expr: string): DataRow[] {
  // Parse and evaluate the expression for each row
  return data.filter((datum) => evaluateExpression(expr, datum));
}

/**
 * Evaluate a simple expression against a datum.
 * This is a safe, limited expression evaluator (no eval()).
 */
function evaluateExpression(expr: string, datum: DataRow): boolean {
  // Remove 'datum.' prefix from expression
  const normalizedExpr = expr.replace(/datum\./g, '');

  // Parse simple comparisons
  const comparisonMatch = normalizedExpr.match(/^(\w+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);

  if (comparisonMatch) {
    const [, field, op, rawValue] = comparisonMatch;
    const fieldValue = datum[field];
    const compareValue = parseValue(rawValue.trim());

    switch (op) {
      case '===':
      case '==':
        return fieldValue === compareValue;
      case '!==':
      case '!=':
        return fieldValue !== compareValue;
      case '>':
        return typeof fieldValue === 'number' && fieldValue > (compareValue as number);
      case '>=':
        return typeof fieldValue === 'number' && fieldValue >= (compareValue as number);
      case '<':
        return typeof fieldValue === 'number' && fieldValue < (compareValue as number);
      case '<=':
        return typeof fieldValue === 'number' && fieldValue <= (compareValue as number);
    }
  }

  // Parse "field in [values]" syntax
  const inMatch = normalizedExpr.match(/^(\w+)\s+in\s+\[(.+)\]$/);
  if (inMatch) {
    const [, field, valuesStr] = inMatch;
    const fieldValue = datum[field];
    const values = valuesStr.split(',').map((v) => parseValue(v.trim()));
    return values.includes(fieldValue);
  }

  // Parse logical operators — check || first (lower precedence) then && within each clause
  if (normalizedExpr.includes('||')) {
    const parts = normalizedExpr.split('||').map((p) => p.trim());
    return parts.some((part) => evaluateExpression(part, datum));
  }

  if (normalizedExpr.includes('&&')) {
    const parts = normalizedExpr.split('&&').map((p) => p.trim());
    return parts.every((part) => evaluateExpression(part, datum));
  }

  // Check for truthy field value
  const fieldMatch = normalizedExpr.match(/^(\w+)$/);
  if (fieldMatch) {
    return Boolean(datum[fieldMatch[1]]);
  }

  // Check for negation
  const negMatch = normalizedExpr.match(/^!(\w+)$/);
  if (negMatch) {
    return !datum[negMatch[1]];
  }

  // Default: include the row if we can't parse the expression
  console.warn(`Could not parse filter expression: ${expr}`);
  return true;
}

/**
 * Parse a value from a string representation.
 */
function parseValue(str: string): unknown {
  // Remove quotes for string values
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('"') && str.endsWith('"'))) {
    return str.slice(1, -1);
  }

  // Check for null/undefined
  if (str === 'null') return null;
  if (str === 'undefined') return undefined;

  // Check for boolean
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Try to parse as number
  const num = parseFloat(str);
  if (!isNaN(num)) return num;

  // Return as string
  return str;
}

// =============================================================================
// Filter Utilities
// =============================================================================

/**
 * Create a filter for valid (non-null, non-undefined, non-NaN) values.
 */
export function filterValid(data: DataRow[], field: string): DataRow[] {
  return data.filter((row) => {
    const value = row[field];
    return value !== null && value !== undefined && !(typeof value === 'number' && isNaN(value));
  });
}

/**
 * Create a filter for non-empty string values.
 */
export function filterNonEmpty(data: DataRow[], field: string): DataRow[] {
  return data.filter((row) => {
    const value = row[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

/**
 * Create a filter for values in a given range.
 */
export function filterRange(data: DataRow[], field: string, min: number, max: number): DataRow[] {
  return data.filter((row) => {
    const value = row[field];
    return typeof value === 'number' && value >= min && value <= max;
  });
}

/**
 * Create a filter for values matching one of the given options.
 */
export function filterOneOf(data: DataRow[], field: string, values: unknown[]): DataRow[] {
  const valueSet = new Set(values);
  return data.filter((row) => valueSet.has(row[field]));
}
