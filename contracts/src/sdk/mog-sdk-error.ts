/**
 * Stable SDK error taxonomy.
 *
 * Public APIs throw MogSdkError (or a subclass). Raw KernelErrorCode values
 * never cross the SDK boundary — they are mapped exhaustively to one of
 * these stable codes.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type MogSdkErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'AUTHORIZATION_DENIED'
  | 'READ_ONLY'
  | 'DISPOSED'
  | 'IMPORT_ERROR'
  | 'EXPORT_ERROR'
  | 'COMPUTE_ERROR'
  | 'TRANSPORT_ERROR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

// ---------------------------------------------------------------------------
// Diagnostics (safe for external consumers; redacted when policy applies)
// ---------------------------------------------------------------------------

export interface MogSdkDiagnostics {
  readonly domain?: string;
  readonly property?: string;
  readonly issueCode?: string;
  readonly severity?: 'error' | 'warning' | 'info';
}

// ---------------------------------------------------------------------------
// Structured details for agent-facing save-path failures
// ---------------------------------------------------------------------------

export type MogSdkSavePathIssue =
  | 'save-path-invalid'
  | 'save-path-writer-unavailable'
  | 'save-path-write-failed'
  | 'save-callback-failed';

export interface MogSdkSavePathErrorDetails {
  readonly issue: MogSdkSavePathIssue;
  readonly operation: 'workbook.save';
  readonly requestedPath?: string;
  readonly absolutePath?: string;
  readonly cwd?: string;
  readonly parentDirectory?: string;
  readonly filesystemCode?: string;
  readonly causeName?: string;
  readonly causeMessage?: string;
  readonly examples?: readonly string[];
}

// ---------------------------------------------------------------------------
// Serialized error shape (HTTP/server SDKs, AI agent tools)
// ---------------------------------------------------------------------------

export interface MogSdkErrorJSON {
  readonly code: MogSdkErrorCode;
  readonly message: string;
  readonly operation?: string;
  readonly details?: Record<string, unknown> | MogSdkSavePathErrorDetails;
  readonly diagnostics?: MogSdkDiagnostics;
  readonly cause?: MogSdkErrorJSON;
}

// ---------------------------------------------------------------------------
// Error interface
// ---------------------------------------------------------------------------

export interface IMogSdkError extends Error {
  readonly code: MogSdkErrorCode;
  readonly details?: Record<string, unknown> | MogSdkSavePathErrorDetails;
  readonly operation?: string;
  readonly diagnostics?: MogSdkDiagnostics;
  toJSON(): MogSdkErrorJSON;
}

// ---------------------------------------------------------------------------
// Kernel-to-SDK mapping table (exhaustive)
// ---------------------------------------------------------------------------

/**
 * Every KernelErrorCode maps to exactly one MogSdkErrorCode.
 * This type enforces exhaustive coverage at the mapping site.
 */
export interface KernelToSdkErrorMapping {
  // API / validation
  API_INVALID_CELL_ADDRESS: 'INVALID_ARGUMENT';
  API_INVALID_RANGE: 'INVALID_ARGUMENT';
  API_INVALID_ADDRESS: 'INVALID_ARGUMENT';
  API_INVALID_SHEET_ID: 'INVALID_ARGUMENT';
  API_INVALID_VALUE_TYPE: 'INVALID_ARGUMENT';
  API_VALUE_TOO_LONG: 'INVALID_ARGUMENT';
  API_ROW_OUT_OF_BOUNDS: 'INVALID_ARGUMENT';
  API_COLUMN_OUT_OF_BOUNDS: 'INVALID_ARGUMENT';
  API_SHEET_NOT_FOUND: 'NOT_FOUND';
  API_SHEET_NAME_EXISTS: 'CONFLICT';
  API_PROTECTED_RANGE: 'AUTHORIZATION_DENIED';
  API_PROTECTED_SHEET: 'AUTHORIZATION_DENIED';
  API_PROTECTED_WORKBOOK: 'AUTHORIZATION_DENIED';
  API_INVALID_ARGUMENT: 'INVALID_ARGUMENT';
  API_UNSUPPORTED_OPERATION: 'INVALID_ARGUMENT';

  // Formula
  FORMULA_PARSE_ERROR: 'COMPUTE_ERROR';
  FORMULA_CIRCULAR_REFERENCE: 'COMPUTE_ERROR';
  FORMULA_UNKNOWN_FUNCTION: 'COMPUTE_ERROR';

  // Table
  TABLE_NOT_FOUND: 'NOT_FOUND';
  TABLE_RANGE_NOT_FOUND: 'NOT_FOUND';
  TABLE_INVALID_NAME: 'INVALID_ARGUMENT';
  TABLE_INVALID_RESIZE: 'INVALID_ARGUMENT';
  TABLE_STYLE_EXISTS: 'CONFLICT';
  TABLE_STYLE_NOT_FOUND: 'NOT_FOUND';
  TABLE_RECORD_NOT_FOUND: 'NOT_FOUND';

  // Execution
  EXEC_CANCELLED: 'INTERNAL_ERROR';
  EXEC_UNKNOWN_METHOD: 'INVALID_ARGUMENT';
  EXEC_REQUIRES_SHEET: 'INVALID_ARGUMENT';

  // Comment
  COMMENT_NOT_FOUND: 'NOT_FOUND';

  // Pivot
  PIVOT_NOT_FOUND: 'NOT_FOUND';
  PIVOT_INVALID_DATA_SOURCE: 'INVALID_ARGUMENT';
  PIVOT_UNRESOLVED_FIELD_REFERENCES: 'INVALID_ARGUMENT';

  // Scenario
  SCENARIO_ACTIVE_STATE_READ_ONLY: 'READ_ONLY';

  // Domain
  DOMAIN_FILTER_CREATE_FAILED: 'INTERNAL_ERROR';
  DOMAIN_GROUPING_MAX_LEVEL: 'INVALID_ARGUMENT';
  DOMAIN_DEFINED_NAME_NOT_FOUND: 'NOT_FOUND';
  DOMAIN_SPARKLINE_NOT_INITIALIZED: 'INTERNAL_ERROR';
  DOMAIN_CELL_STYLE_INVALID: 'INVALID_ARGUMENT';

  // Filesystem
  FS_INVALID_PATH: 'INVALID_ARGUMENT';

  // Registry
  REGISTRY_DRIVER_EXISTS: 'CONFLICT';
  REGISTRY_DRIVER_NOT_FOUND: 'NOT_FOUND';

  // Object
  OBJ_NOT_FOUND: 'NOT_FOUND';
  OBJ_INVALID_CONFIG: 'INVALID_ARGUMENT';
  OBJ_CHART_NOT_FOUND: 'NOT_FOUND';
  OBJ_CHART_INVALID_CONFIG: 'INVALID_ARGUMENT';
  OBJ_SHAPE_NOT_FOUND: 'NOT_FOUND';
  OBJ_SHAPE_INVALID_CONFIG: 'INVALID_ARGUMENT';
  OBJ_DRAWING_NOT_FOUND: 'NOT_FOUND';
  OBJ_EQUATION_NOT_FOUND: 'NOT_FOUND';
  OBJ_TEXT_EFFECT_NOT_FOUND: 'NOT_FOUND';
  OBJ_DIAGRAM_NOT_FOUND: 'NOT_FOUND';
  OBJ_GROUP_TOO_FEW: 'INVALID_ARGUMENT';

  // Bridge / transport
  BRIDGE_NOT_AVAILABLE: 'TRANSPORT_ERROR';
  BRIDGE_COMMAND_FAILED: 'TRANSPORT_ERROR';
  BRIDGE_TRANSPORT_ERROR: 'TRANSPORT_ERROR';
  BRIDGE_WASM_LOAD_FAILED: 'TRANSPORT_ERROR';
  BRIDGE_NOT_STARTED: 'TRANSPORT_ERROR';
  BRIDGE_DISPOSED: 'DISPOSED';
  BRIDGE_ALREADY_STARTED: 'TRANSPORT_ERROR';
  BRIDGE_MUTATION_REJECTED: 'TRANSPORT_ERROR';
  BRIDGE_PHASE_INSUFFICIENT: 'TRANSPORT_ERROR';

  // Capability
  CAP_DENIED: 'AUTHORIZATION_DENIED';
  CAP_SCOPE_MISMATCH: 'AUTHORIZATION_DENIED';
  CAP_EXPIRED: 'AUTHORIZATION_DENIED';
  CAP_NOT_GRANTED: 'AUTHORIZATION_DENIED';
  CAP_REQUIRES_AUTH: 'AUTHORIZATION_DENIED';
  CAP_INVALID_SCOPE: 'INVALID_ARGUMENT';
  CAP_UNBOUNDED_WILDCARD: 'INVALID_ARGUMENT';

  // Document lifecycle
  DOC_NOT_READY: 'INTERNAL_ERROR';
  DOC_DISPOSED: 'DISPOSED';
  DOC_ENGINE_CREATE_FAILED: 'TRANSPORT_ERROR';
  DOC_HYDRATION_FAILED: 'IMPORT_ERROR';
  DOC_LIFECYCLE_ERROR: 'INTERNAL_ERROR';
  DOC_HOST_CONTEXT_VALIDATION: 'INVALID_ARGUMENT';
  DOC_LEGACY_OPTION_REJECTED: 'INVALID_ARGUMENT';

  // Compute
  COMPUTE_ERROR: 'COMPUTE_ERROR';

  // Configuration
  CONFIG_MISSING_USER_TIMEZONE: 'INVALID_ARGUMENT';
  CONFIG_INVALID_USER_TIMEZONE: 'INVALID_ARGUMENT';

  // Storage / Write Gate
  WRITE_GATE_BLOCKED: 'READ_ONLY';

  // Generic
  OPERATION_FAILED: 'INTERNAL_ERROR';
  NOT_IMPLEMENTED: 'INTERNAL_ERROR';
}
