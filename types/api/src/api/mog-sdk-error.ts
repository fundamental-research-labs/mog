/**
 * MogSdkError — Typed SDK error contract
 *
 * Provides structured, discriminated error details for each error code so SDK
 * consumers can programmatically inspect error context without casting.
 *
 * Backward-compatible: `MogSdkError.details` accepts the typed union *and*
 * `Record<string, unknown>` for extensibility. Use `isMogSdkError` + switch
 * on `code` for exhaustive narrowing.
 */

import type { ApiErrorCode } from './api-errors';

// =============================================================================
// SDK Error Code (superset of ApiErrorCode with SDK-specific additions)
// =============================================================================

/**
 * All error codes the SDK can surface. Includes the existing ApiErrorCode set
 * plus SDK-layer codes for transport, import, capability, and lifecycle errors.
 */
export type MogSdkErrorCode =
  | ApiErrorCode
  // Stable SDK argument / provider / internal codes
  | 'INVALID_ARGUMENT'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR'
  // SDK transport / bridge
  | 'TRANSPORT_ERROR'
  | 'BRIDGE_NOT_AVAILABLE'
  // SDK import / export
  | 'IMPORT_ERROR'
  | 'EXPORT_ERROR'
  // Capability / authorization
  | 'AUTHORIZATION_DENIED'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_SCOPE_MISMATCH'
  // Document lifecycle
  | 'DOCUMENT_NOT_READY'
  | 'DOCUMENT_DISPOSED'
  | 'HYDRATION_FAILED'
  // Compute
  | 'COMPUTE_ERROR';

// =============================================================================
// Per-code detail interfaces
// =============================================================================

/** Details for invalid cell address / range / argument errors */
export interface MogSdkInvalidArgumentDetails {
  /** Name of the parameter that was invalid */
  paramName?: string;
  /** Expected value or type description */
  expected?: string;
  /** Received value (serialized) */
  received?: string;
  /** Cell address string (e.g. "A1") if applicable */
  address?: string;
  /** Row index if applicable */
  row?: number;
  /** Column index if applicable */
  col?: number;
  /** Start row for range errors */
  startRow?: number;
  /** Start column for range errors */
  startCol?: number;
  /** End row for range errors */
  endRow?: number;
  /** End column for range errors */
  endCol?: number;
  /** Maximum allowed row */
  maxRow?: number;
  /** Maximum allowed column */
  maxCol?: number;
}

/** Details for resource-not-found errors (sheets, charts, shapes, etc.) */
export interface MogSdkNotFoundDetails {
  /** Type of resource that was not found */
  resourceType: string;
  /** ID of the resource that was not found */
  resourceId?: string;
  /** Human-readable name of the resource */
  resourceName?: string;
}

/** Details for formula-related errors */
export interface MogSdkFormulaErrorDetails {
  /** The formula text that caused the error */
  formula?: string;
  /** The specific parse error message */
  parseError?: string;
  /** The unknown function name */
  functionName?: string;
  /** Cell address where a circular reference was detected */
  cellAddress?: string;
  /** Chain of cell addresses forming the circular dependency */
  dependencyChain?: string[];
}

/** Details for protection-related errors */
export interface MogSdkProtectionDetails {
  /** The operation that was blocked */
  operation?: string;
  /** The range that is protected */
  range?: string;
}

/** Details for invalid configuration errors (charts, shapes, etc.) */
export interface MogSdkInvalidConfigDetails {
  /** Reason the configuration is invalid */
  reason?: string;
  /** The config field path that is invalid */
  configPath?: string;
}

/** Details for authorization / capability denied errors */
export interface MogSdkAuthorizationDeniedDetails {
  /** The operation that was denied */
  operation?: string;
  /** App ID that was denied */
  appId?: string;
  /** Capability that was missing */
  capability?: string;
  /** Whether the user explicitly denied permission */
  wasDenied?: boolean;
}

/** Details for capability expiration errors */
export interface MogSdkCapabilityExpiredDetails {
  /** App ID whose capability expired */
  appId?: string;
  /** The expired capability */
  capability?: string;
  /** When the capability expired (epoch ms) */
  expiredAt?: number;
}

/** Details for capability scope mismatch errors */
export interface MogSdkCapabilityScopeMismatchDetails {
  /** App ID */
  appId?: string;
  /** The capability */
  capability?: string;
  /** Resource type being accessed */
  resourceType?: string;
  /** Resource ID being accessed */
  resourceId?: string;
}

/** Details for bridge / transport errors */
export interface MogSdkTransportErrorDetails {
  /** Bridge type (e.g. "napi", "wasm", "worker") */
  bridgeType?: string;
  /** The operation that failed */
  operation?: string;
  /** The bridge command that failed */
  command?: string;
}

/** Details for import / export errors */
export interface MogSdkImportErrorDetails {
  /** File format (e.g. "xlsx", "csv") */
  format?: string;
  /** Phase where the error occurred (e.g. "parse", "hydrate", "validate") */
  phase?: string;
  /** Non-fatal warnings collected during import */
  warnings?: unknown[];
}

/** Details for document lifecycle errors */
export interface MogSdkDocumentLifecycleDetails {
  /** Current lifecycle phase */
  phase?: string;
  /** Expected lifecycle phase */
  expectedPhase?: string;
}

/** Details for compute errors */
export interface MogSdkComputeErrorDetails {
  /** The operation that failed */
  operation?: string;
  /** Reason for the compute failure */
  reason?: string;
}

/** Details for generic operation-failed / not-implemented errors */
export interface MogSdkOperationDetails {
  /** The operation that failed */
  operation?: string;
  /** Reason for the failure */
  reason?: string;
  /** Feature name (for NOT_IMPLEMENTED) */
  feature?: string;
}

export type MogSdkSavePathIssue =
  | 'save-path-invalid'
  | 'save-path-writer-unavailable'
  | 'save-path-write-failed'
  | 'save-callback-failed';

/** Details for workbook save path and host save callback failures */
export interface MogSdkSavePathErrorDetails {
  /** Machine-readable save-path issue */
  issue: MogSdkSavePathIssue;
  /** SDK operation that failed */
  operation: 'workbook.save';
  /** Path exactly passed to wb.save(path), when present */
  requestedPath?: string;
  /** Host-resolved absolute path, when the runtime can provide it */
  absolutePath?: string;
  /** Runtime current working directory, when available */
  cwd?: string;
  /** Parent directory selected by the host writer, when available */
  parentDirectory?: string;
  /** Filesystem error code such as ENOENT, EACCES, EPERM, or EISDIR */
  filesystemCode?: string;
  /** Original error class/name */
  causeName?: string;
  /** Original error message */
  causeMessage?: string;
  /** Valid call examples useful for agents */
  examples?: readonly string[];
}

// =============================================================================
// Discriminated union: code -> details mapping
// =============================================================================

/**
 * Maps each MogSdkErrorCode to its typed detail interface.
 * Use with `MogSdkError['code']` for exhaustive switch narrowing.
 */
export interface MogSdkErrorDetailsMap {
  // Stable SDK codes
  INVALID_ARGUMENT: MogSdkInvalidArgumentDetails | MogSdkSavePathErrorDetails;
  PROVIDER_ERROR: MogSdkSavePathErrorDetails | MogSdkOperationDetails;
  INTERNAL_ERROR: MogSdkOperationDetails;

  // Invalid argument / address / range
  INVALID_CELL_ADDRESS: MogSdkInvalidArgumentDetails;
  INVALID_RANGE: MogSdkInvalidArgumentDetails;
  INVALID_SHEET_ID: MogSdkInvalidArgumentDetails;
  VALUE_TOO_LONG: MogSdkInvalidArgumentDetails;
  INVALID_VALUE_TYPE: MogSdkInvalidArgumentDetails;
  ROW_OUT_OF_BOUNDS: MogSdkInvalidArgumentDetails;
  COLUMN_OUT_OF_BOUNDS: MogSdkInvalidArgumentDetails;
  INVALID_ROW_COUNT: MogSdkInvalidArgumentDetails;
  INVALID_COLUMN_COUNT: MogSdkInvalidArgumentDetails;

  // Not found
  SHEET_NOT_FOUND: MogSdkNotFoundDetails;
  CHART_NOT_FOUND: MogSdkNotFoundDetails;
  SHAPE_NOT_FOUND: MogSdkNotFoundDetails;
  OBJECT_NOT_FOUND: MogSdkNotFoundDetails;
  DRAWING_NOT_FOUND: MogSdkNotFoundDetails;
  EQUATION_NOT_FOUND: MogSdkNotFoundDetails;
  TEXT_EFFECT_NOT_FOUND: MogSdkNotFoundDetails;
  DIAGRAM_NOT_FOUND: MogSdkNotFoundDetails;

  // Sheet name conflict
  SHEET_NAME_EXISTS: MogSdkNotFoundDetails;

  // Formula
  FORMULA_PARSE_ERROR: MogSdkFormulaErrorDetails;
  CIRCULAR_REFERENCE: MogSdkFormulaErrorDetails;
  UNKNOWN_FUNCTION: MogSdkFormulaErrorDetails;

  // Protection
  PROTECTED_RANGE: MogSdkProtectionDetails;
  PROTECTED_SHEET: MogSdkProtectionDetails;

  // Config
  INVALID_CHART_CONFIG: MogSdkInvalidConfigDetails;
  INVALID_SHAPE_CONFIG: MogSdkInvalidConfigDetails;

  // Bridge / Transport
  BRIDGE_NOT_AVAILABLE: MogSdkTransportErrorDetails;
  TRANSPORT_ERROR: MogSdkTransportErrorDetails;

  // Import / Export
  IMPORT_ERROR: MogSdkImportErrorDetails;
  EXPORT_ERROR: MogSdkImportErrorDetails;

  // Authorization / Capability
  AUTHORIZATION_DENIED: MogSdkAuthorizationDeniedDetails;
  CAPABILITY_EXPIRED: MogSdkCapabilityExpiredDetails;
  CAPABILITY_SCOPE_MISMATCH: MogSdkCapabilityScopeMismatchDetails;

  // Document lifecycle
  DOCUMENT_NOT_READY: MogSdkDocumentLifecycleDetails;
  DOCUMENT_DISPOSED: MogSdkDocumentLifecycleDetails;
  HYDRATION_FAILED: MogSdkDocumentLifecycleDetails;

  // Compute
  COMPUTE_ERROR: MogSdkComputeErrorDetails;

  // Generic
  OPERATION_FAILED: MogSdkOperationDetails;
  NOT_IMPLEMENTED: MogSdkOperationDetails;
}

// =============================================================================
// Typed detail union
// =============================================================================

/**
 * Union of all typed detail interfaces. When used with a known `code`,
 * TypeScript can narrow to the specific detail type via `MogSdkErrorDetailsMap`.
 */
export type MogSdkErrorDetails = MogSdkErrorDetailsMap[keyof MogSdkErrorDetailsMap];

// =============================================================================
// MogSdkError interface
// =============================================================================

/**
 * The public SDK error contract. Extends the wire-format `ApiError` shape with
 * a typed `details` field that preserves backward compatibility.
 *
 * For known error codes, `details` carries the corresponding typed detail
 * interface. The `& Record<string, unknown>` intersection ensures unknown
 * additional fields are accepted (forward compatibility).
 */
export interface MogSdkError<C extends MogSdkErrorCode = MogSdkErrorCode> {
  /** Machine-readable error code for programmatic handling */
  code: C;
  /** Human-readable error message */
  message: string;
  /** Path to the problematic field(s) */
  path?: string[];
  /** Suggestion for how to fix the error */
  suggestion?: string;
  /**
   * Structured error details. When `code` is a key in `MogSdkErrorDetailsMap`,
   * this carries the corresponding typed interface intersected with
   * `Record<string, unknown>` for extensibility.
   */
  details?: (C extends keyof MogSdkErrorDetailsMap
    ? MogSdkErrorDetailsMap[C]
    : Record<string, unknown>) &
    Record<string, unknown>;
}

// =============================================================================
// Type guard
// =============================================================================

/**
 * Type guard to check if a value is a MogSdkError-shaped object.
 * Works on plain objects (deserialized from IPC) — does not require instanceof.
 */
export function isMogSdkError(value: unknown): value is MogSdkError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as MogSdkError).code === 'string' &&
    typeof (value as MogSdkError).message === 'string'
  );
}

/**
 * Narrow a MogSdkError to a specific code. Useful for exhaustive switch patterns:
 *
 * ```ts
 * if (isMogSdkErrorWithCode(err, 'SHEET_NOT_FOUND')) {
 *   console.log(err.details?.resourceId); // typed as string | undefined
 * }
 * ```
 */
export function isMogSdkErrorWithCode<C extends MogSdkErrorCode>(
  value: unknown,
  code: C,
): value is MogSdkError<C> {
  return isMogSdkError(value) && value.code === code;
}
