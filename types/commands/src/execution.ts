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
// Execution Diagnostics
// ============================================================================

/**
 * Source span for diagnostics reported against executed source code.
 */
export interface CodeExecutionDiagnosticSpan {
  /** UTF-16 source offset where the diagnostic starts */
  start: number;
  /** UTF-16 source offset where the diagnostic ends */
  end: number;
  /** 1-based line number, when available */
  line?: number;
  /** 1-based column number, when available */
  column?: number;
}

/**
 * Mog API replacement suggested by an execution diagnostic.
 */
export interface CodeExecutionDiagnosticReplacement {
  /** Canonical Mog API path, such as `wb.activeSheet` or `ws.setRange` */
  path: string;
  /** Ready-to-use snippet for the replacement, when one is available */
  snippet?: string;
  /** Extra guidance for ambiguous replacements */
  note?: string;
}

/**
 * Structured diagnostic returned by code executors.
 *
 * The shape is intentionally structural rather than importing from the public
 * SDK guidance layer. Command/core contracts sit below the SDK package, while
 * execution paths can still populate richer guidance-specific fields.
 */
export interface CodeExecutionDiagnostic {
  /** Stable diagnostic code, for example `MOG001_FOREIGN_API_DIALECT` */
  code: string;
  /** Human-readable severity */
  severity: 'error' | 'warning' | 'info';
  /** Wrong dialect when a diagnostic identifies foreign API residue */
  dialect?: string;
  /** Stable diagnostic category, such as `worksheet` or `range` */
  category?: string;
  /** Stable catalog entry identifier */
  entryId?: string;
  /** Stable matcher identifier */
  matcherId?: string;
  /** Source symbol or token that triggered the diagnostic */
  offendingSymbol?: string;
  /** Concise human-readable message */
  message: string;
  /** Actionable correction text */
  suggestion?: string;
  /** Suggested Mog replacements */
  mogReplacements?: readonly CodeExecutionDiagnosticReplacement[];
  /** Follow-up references, such as `api.guidance.explain("wb.activeSheet")` */
  references?: readonly string[];
  /** Confidence score in the inclusive range [0, 1] */
  confidence?: number;
  /** Whether this diagnostic should block execution */
  blocking?: boolean;
  /** Optional source span */
  span?: CodeExecutionDiagnosticSpan;
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
  /** Structured diagnostics produced before or during execution */
  diagnostics?: readonly CodeExecutionDiagnostic[];
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
