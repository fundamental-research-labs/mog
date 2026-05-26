/**
 * Contracts → Engine Type Conversion
 *
 * Converts filter types from @mog-sdk/contracts to table-engine types.
 * This module is the SINGLE source of truth for this conversion, used by both:
 * - kernel/bridges/table-bridge.ts (TableBridge)
 * - spreadsheet-model/src/filters.ts (filter evaluation)
 *
 * @packageDocumentation
 */

import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';

import type { FilterCriteria, FilterOperator } from './types';

function isLegacyBlankValue(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '');
}

/** Module-level mapping — avoids re-creating the object on every call. */
const OPERATOR_MAPPING: Record<string, FilterOperator> = {
  equals: 'equals',
  notEquals: 'notEquals',
  greaterThan: 'greaterThan',
  greaterThanOrEqual: 'greaterThanOrEqual',
  lessThan: 'lessThan',
  lessThanOrEqual: 'lessThanOrEqual',
  contains: 'contains',
  notContains: 'notContains',
  startsWith: 'beginsWith',
  endsWith: 'endsWith',
  between: 'between',
  notBetween: 'notBetween',
  beginsWith: 'beginsWith',
  isBlank: 'isBlank',
  isNotBlank: 'isNotBlank',
};

/**
 * Map a contracts filter operator string to table-engine FilterOperator.
 *
 * Returns the mapped operator, or null if unsupported.
 */
function mapOperatorString(op: string): FilterOperator | null {
  return OPERATOR_MAPPING[op] ?? null;
}

/**
 * Convert contracts ColumnFilterCriteria to table-engine FilterCriteria.
 *
 * Handles filter types:
 * - 'value' → ValueFilter
 * - 'condition' → ConditionFilter (or DynamicFilter for aboveAverage/belowAverage)
 * - 'top10' → TopBottomFilter
 *
 * Returns null for:
 * - 'color' type (bridge evaluates color filters separately)
 * - Condition filters with no convertible conditions
 *
 * @param criteria - Contracts ColumnFilterCriteria
 * @returns Table-engine FilterCriteria or null if unsupported
 */
export function convertContractsFilter(criteria: ColumnFilterCriteria): FilterCriteria | null {
  switch (criteria.type) {
    case 'value': {
      const rawValues = criteria.values ?? [];
      const includeBlanks = criteria.includeBlanks ?? rawValues.some((v) => isLegacyBlankValue(v));
      const included = rawValues.filter((v) => !isLegacyBlankValue(v));
      return {
        type: 'values',
        included,
        includeBlanks,
      };
    }

    case 'condition': {
      // Check for aboveAverage/belowAverage — convert to DynamicFilter
      if (criteria.conditions && criteria.conditions.length === 1) {
        const singleOp = criteria.conditions[0].operator;
        if (singleOp === 'aboveAverage') {
          return { type: 'dynamic', rule: 'aboveAverage' };
        }
        if (singleOp === 'belowAverage') {
          return { type: 'dynamic', rule: 'belowAverage' };
        }
      }

      const conditions = (criteria.conditions ?? [])
        .map((c) => {
          const mappedOp = mapOperatorString(c.operator);
          if (mappedOp === null) return null;
          return {
            operator: mappedOp,
            value: c.value ?? null,
            ...(c.value2 !== undefined ? { value2: c.value2 } : {}),
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (conditions.length === 0) return null;

      return {
        type: 'condition',
        conditions,
        logic: criteria.conditionLogic ?? 'and',
      } as FilterCriteria;
    }

    case 'top10': {
      return {
        type: 'topBottom',
        direction: criteria.topBottom?.type ?? 'top',
        count: criteria.topBottom?.count ?? 10,
        by: criteria.topBottom?.by ?? 'items',
      };
    }

    case 'color':
      return null;

    default:
      return null;
  }
}
