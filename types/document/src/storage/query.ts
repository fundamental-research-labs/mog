/**
 * Portable Query Contract
 *
 * A query format that ALL table drivers must support.
 * Translates cleanly to SQL, REST params, GraphQL, and MongoDB.
 *
 * Complex operations (joins, aggregations, subqueries) are intentionally
 * excluded - use the formula engine, pivot engine, or executeNative().
 *
 */

// =============================================================================
// Query Interface
// =============================================================================

/**
 * Portable query that ALL drivers must support.
 * Translates cleanly to SQL, REST params, GraphQL, and MongoDB.
 *
 * Complex operations (joins, aggregations, subqueries) are intentionally
 * excluded - use the formula engine, pivot engine, or executeNative().
 */
export interface Query {
  /** Filter conditions (optional) */
  where?: FilterGroup;
  /** Sort specifications (optional) */
  orderBy?: SortSpec[];
  /** Maximum number of records to return (optional) */
  limit?: number;
  /** Number of records to skip (optional) */
  offset?: number;
  /** Column subset to return (optional - returns all if not specified) */
  select?: string[];
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * A group of filter conditions combined with AND or OR.
 * Can be nested to create complex filter trees.
 */
export interface FilterGroup {
  /** How to combine the conditions */
  operator: 'and' | 'or';
  /** The conditions or nested groups to combine */
  conditions: Array<FilterCondition | FilterGroup>;
}

/** Scalar value type for filter comparisons */
export type FilterScalar = string | number | boolean | null;

interface FilterConditionBase {
  /** The column name to filter on */
  column: string;
}

/** eq, neq, gt, gte, lt, lte */
export interface ScalarFilterCondition extends FilterConditionBase {
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: FilterScalar;
}

/** contains, startsWith, endsWith */
export interface StringFilterCondition extends FilterConditionBase {
  operator: 'contains' | 'startsWith' | 'endsWith';
  value: string;
}

/** in, notIn */
export interface ArrayFilterCondition extends FilterConditionBase {
  operator: 'in' | 'notIn';
  value: FilterScalar[];
}

/** isNull, isNotNull */
export interface NullFilterCondition extends FilterConditionBase {
  operator: 'isNull' | 'isNotNull';
}

/**
 * A single filter condition comparing a column to a value.
 * Discriminated union on `operator` for type-safe value access.
 */
export type FilterCondition =
  | ScalarFilterCondition
  | StringFilterCondition
  | ArrayFilterCondition
  | NullFilterCondition;

/**
 * Supported filter operators.
 *
 * These operators are chosen to be portable across all drivers:
 * - SQL: Direct translation
 * - REST: Query parameter conventions
 * - GraphQL: Common filter patterns
 * - MongoDB: Direct operator mapping
 */
export type FilterOperator =
  | 'eq'
  | 'neq' // Equality: =, !=
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte' // Comparison: >, >=, <, <=
  | 'contains'
  | 'startsWith'
  | 'endsWith' // String matching
  | 'in'
  | 'notIn' // Array membership
  | 'isNull'
  | 'isNotNull'; // Null checks

// =============================================================================
// Sort Types
// =============================================================================

/**
 * A sort specification for ordering results.
 */
export interface SortSpec {
  /** The column name to sort by */
  column: string;
  /** Sort direction */
  direction: 'asc' | 'desc';
}
