/**
 * Query Runtime Utilities
 *
 * Runtime functions for building portable queries.
 * Types are defined in @mog-sdk/contracts/storage.
 */

import type {
  ArrayFilterCondition,
  FilterCondition,
  FilterGroup,
  FilterOperator,
  FilterScalar,
  NullFilterCondition,
  Query,
  ScalarFilterCondition,
  SortSpec,
  StringFilterCondition,
} from '@mog-sdk/contracts/storage';

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a value is a FilterGroup.
 */
export function isFilterGroup(value: FilterCondition | FilterGroup): value is FilterGroup {
  return 'operator' in value && 'conditions' in value && Array.isArray(value.conditions);
}

/**
 * Type guard to check if a value is a FilterCondition.
 */
export function isFilterCondition(value: FilterCondition | FilterGroup): value is FilterCondition {
  return 'column' in value && 'operator' in value;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a filter condition.
 *
 * @example
 * ```typescript
 * const condition = where('status', 'eq', 'active');
 * // { column: 'status', operator: 'eq', value: 'active' }
 * ```
 */
export function where(
  column: string,
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  value: FilterScalar,
): ScalarFilterCondition;
export function where(
  column: string,
  operator: 'contains' | 'startsWith' | 'endsWith',
  value: string,
): StringFilterCondition;
export function where(
  column: string,
  operator: 'in' | 'notIn',
  value: FilterScalar[],
): ArrayFilterCondition;
export function where(column: string, operator: 'isNull' | 'isNotNull'): NullFilterCondition;
export function where(column: string, operator: FilterOperator, value?: unknown): FilterCondition {
  if (operator === 'isNull' || operator === 'isNotNull') {
    return { column, operator } as NullFilterCondition;
  }
  return { column, operator, value } as FilterCondition;
}

/**
 * Combine conditions with AND.
 *
 * @example
 * ```typescript
 * const filter = and(
 *   where('status', 'eq', 'active'),
 *   where('age', 'gte', 18)
 * );
 * ```
 */
export function and(...conditions: Array<FilterCondition | FilterGroup>): FilterGroup {
  return { operator: 'and', conditions };
}

/**
 * Combine conditions with OR.
 *
 * @example
 * ```typescript
 * const filter = or(
 *   where('status', 'eq', 'active'),
 *   where('status', 'eq', 'pending')
 * );
 * ```
 */
export function or(...conditions: Array<FilterCondition | FilterGroup>): FilterGroup {
  return { operator: 'or', conditions };
}

/**
 * Create a sort specification.
 *
 * @example
 * ```typescript
 * const sort = orderBy('created', 'desc');
 * // { column: 'created', direction: 'desc' }
 * ```
 */
export function orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): SortSpec {
  return { column, direction };
}

// =============================================================================
// Query Builder (Fluent API)
// =============================================================================

/**
 * Fluent query builder for constructing queries.
 *
 * @example
 * ```typescript
 * const query = QueryBuilder.create()
 *   .where(and(
 *     where('status', 'eq', 'active'),
 *     where('age', 'gte', 18)
 *   ))
 *   .orderBy('created', 'desc')
 *   .limit(100)
 *   .select(['id', 'name', 'email'])
 *   .build();
 * ```
 */
export class QueryBuilder {
  private _where?: FilterGroup;
  private _orderBy: SortSpec[] = [];
  private _limit?: number;
  private _offset?: number;
  private _select?: string[];

  /**
   * Create a new query builder.
   */
  static create(): QueryBuilder {
    return new QueryBuilder();
  }

  /**
   * Set the filter conditions.
   */
  where(filter: FilterGroup): this {
    this._where = filter;
    return this;
  }

  /**
   * Add a sort specification.
   */
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this._orderBy.push({ column, direction });
    return this;
  }

  /**
   * Set the maximum number of records to return.
   */
  limit(count: number): this {
    this._limit = count;
    return this;
  }

  /**
   * Set the number of records to skip.
   */
  offset(count: number): this {
    this._offset = count;
    return this;
  }

  /**
   * Set the columns to return.
   */
  select(columns: string[]): this {
    this._select = columns;
    return this;
  }

  /**
   * Build the query object.
   */
  build(): Query {
    const query: Query = {};

    if (this._where) {
      query.where = this._where;
    }
    if (this._orderBy.length > 0) {
      query.orderBy = this._orderBy;
    }
    if (this._limit !== undefined) {
      query.limit = this._limit;
    }
    if (this._offset !== undefined) {
      query.offset = this._offset;
    }
    if (this._select) {
      query.select = this._select;
    }

    return query;
  }
}
