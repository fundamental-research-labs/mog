/**
 * Code Execution Types
 *
 * Type definitions for AI code execution in the spreadsheet engine.
 * These types define the contract between the engine and the Platform.
 */

// ============================================================================
// Execution Status
// ============================================================================

/**
 * Status of code execution.
 */
export type ExecutionStatus = 'success' | 'error' | 'timeout' | 'cancelled';

/**
 * Type of cell change - direct (by code) or indirect (formula recalc).
 */
export type ChangeType = 'direct' | 'indirect';

// ============================================================================
// Dirty Cell Tracking
// ============================================================================

/**
 * A cell that was modified during code execution.
 */
export interface DirtyCell {
  /** Sheet name */
  sheet: string;
  /** Cell address in A1 notation (e.g., "A1") */
  address: string;
  /** Value before modification */
  oldValue: unknown;
  /** Value after modification */
  value: unknown;
  /** Formatted display value */
  displayValue?: string;
  /** Formula if this is a formula cell */
  formula?: string;
  /** Number format string (e.g., "0.00%", "#,##0") */
  numberFormat?: string;
  /** How this cell was changed */
  changeType: ChangeType;
}

// ============================================================================
// Execution Result
// ============================================================================

/**
 * Result of code execution.
 */
export interface CodeExecutionResult {
  /** Execution status */
  status: ExecutionStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Error stack trace if available */
  stack?: string;
  /** Console logs captured during execution */
  logs: string[];
  /** Total number of cells changed */
  changeCount: number;
  /** Number of cells directly modified by code */
  directCount: number;
  /** Number of cells indirectly changed (formula recalc) */
  indirectCount: number;
  /** Ranges that were edited (e.g., ["Sheet1!A1:B2"]) */
  editRanges: string[];
  /** Detailed list of all modified cells */
  dirtyCells: DirtyCell[];
  /** Pre-formatted LLM-readable summary of cell changes */
  formattedSummary?: string;
  /** Execution timing in milliseconds */
  timing: {
    /** Total execution time */
    total: number;
    /** Time spent in user code */
    userCode: number;
    /** Time spent in API calls */
    apiCalls: number;
  };
}

// ============================================================================
// Execution Options
// ============================================================================

/**
 * Options for code execution.
 */
export interface CodeExecutionOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Global store object persisted between executions */
  store?: Record<string, unknown>;
  /** Whether to track indirect changes from formula recalc (default: true) */
  trackIndirectChanges?: boolean;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_EXECUTION_TIMEOUT = 30000; // 30 seconds
export const API_CALL_TIMEOUT = 10000; // 10 seconds per API call
