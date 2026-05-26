/**
 * Table Component Types
 *
 * Kernel-agnostic types for table components (FilterBar, SortMenu, etc.).
 */

import type {
  ColumnInfo,
  Filter,
  FilterCondition,
  FilterOperator,
  SortConfig,
  SortDirection,
} from '../types';

/**
 * FilterBar props.
 */
export interface FilterBarProps {
  /** Column definitions */
  columns: ColumnInfo[];
  /** Current filter configuration */
  filter: Filter;
  /** Callback when filter changes */
  onChange: (filter: Filter) => void;
  /** Optional CSS class name */
  className?: string;
}

/**
 * SortMenu props.
 */
export interface SortMenuProps {
  /** Column definitions */
  columns: ColumnInfo[];
  /** Current sort configuration */
  sorts: SortConfig[];
  /** Callback when sort configuration changes */
  onChange: (sorts: SortConfig[]) => void;
  /** Optional CSS class name */
  className?: string;
}

// Re-export types from base types for convenience
export type { Filter, FilterCondition, FilterOperator, SortConfig, SortDirection };
