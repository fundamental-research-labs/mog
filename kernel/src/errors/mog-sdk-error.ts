/**
 * MogSdkError — the public SDK error class.
 *
 * Wraps internal kernel/bridge/capability errors into a stable, documented
 * error taxonomy that never leaks internal codes across the SDK boundary.
 *
 * @see contracts/src/sdk/mog-sdk-error.ts  (type definitions)
 */

import type {
  IMogSdkError,
  KernelToSdkErrorMapping,
  MogSdkDiagnostics,
  MogSdkErrorCode,
  MogSdkErrorJSON,
  MogSdkSavePathErrorDetails,
} from '@mog-sdk/contracts/sdk';

import type { KernelErrorCode } from './codes';
import { KernelError } from './kernel-error';

// ---------------------------------------------------------------------------
// Exhaustive kernel-to-SDK mapping
// ---------------------------------------------------------------------------

/**
 * Runtime lookup table that satisfies `KernelToSdkErrorMapping`.
 * TypeScript enforces that every KernelErrorCode key is present and maps
 * to the correct MogSdkErrorCode value.
 */
type KernelToSdkRuntimeMapping = {
  readonly [Code in KernelErrorCode]: Code extends keyof KernelToSdkErrorMapping
    ? KernelToSdkErrorMapping[Code] & MogSdkErrorCode
    : never;
} & {
  readonly [Code in keyof KernelToSdkErrorMapping]: Code extends KernelErrorCode
    ? KernelToSdkErrorMapping[Code] & MogSdkErrorCode
    : never;
};

const KERNEL_TO_SDK_MAP = {
  // API / validation
  API_INVALID_CELL_ADDRESS: 'INVALID_ARGUMENT',
  API_INVALID_RANGE: 'INVALID_ARGUMENT',
  API_INVALID_ADDRESS: 'INVALID_ARGUMENT',
  API_INVALID_SHEET_ID: 'INVALID_ARGUMENT',
  API_INVALID_VALUE_TYPE: 'INVALID_ARGUMENT',
  API_VALUE_TOO_LONG: 'INVALID_ARGUMENT',
  API_ROW_OUT_OF_BOUNDS: 'INVALID_ARGUMENT',
  API_COLUMN_OUT_OF_BOUNDS: 'INVALID_ARGUMENT',
  API_SHEET_NOT_FOUND: 'NOT_FOUND',
  API_SHEET_NAME_EXISTS: 'CONFLICT',
  API_PROTECTED_RANGE: 'AUTHORIZATION_DENIED',
  API_PROTECTED_SHEET: 'AUTHORIZATION_DENIED',
  API_PROTECTED_WORKBOOK: 'AUTHORIZATION_DENIED',
  API_INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  API_UNSUPPORTED_OPERATION: 'INVALID_ARGUMENT',

  // Formula
  FORMULA_PARSE_ERROR: 'COMPUTE_ERROR',
  FORMULA_CIRCULAR_REFERENCE: 'COMPUTE_ERROR',
  FORMULA_UNKNOWN_FUNCTION: 'COMPUTE_ERROR',

  // Table
  TABLE_NOT_FOUND: 'NOT_FOUND',
  TABLE_RANGE_NOT_FOUND: 'NOT_FOUND',
  TABLE_INVALID_NAME: 'INVALID_ARGUMENT',
  TABLE_INVALID_RESIZE: 'INVALID_ARGUMENT',
  TABLE_STYLE_EXISTS: 'CONFLICT',
  TABLE_STYLE_NOT_FOUND: 'NOT_FOUND',
  TABLE_RECORD_NOT_FOUND: 'NOT_FOUND',

  // Execution
  EXEC_CANCELLED: 'INTERNAL_ERROR',
  EXEC_UNKNOWN_METHOD: 'INVALID_ARGUMENT',
  EXEC_REQUIRES_SHEET: 'INVALID_ARGUMENT',

  // Comment
  COMMENT_NOT_FOUND: 'NOT_FOUND',

  // Conditional formatting
  CONDITIONAL_FORMAT_NOT_FOUND: 'NOT_FOUND',
  CONDITIONAL_FORMAT_RULE_NOT_FOUND: 'NOT_FOUND',

  // Validation
  VALIDATION_NOT_FOUND: 'NOT_FOUND',

  // Filter
  FILTER_NOT_FOUND: 'NOT_FOUND',

  // Pivot
  PIVOT_NOT_FOUND: 'NOT_FOUND',
  PIVOT_INVALID_DATA_SOURCE: 'INVALID_ARGUMENT',
  PIVOT_UNRESOLVED_FIELD_REFERENCES: 'INVALID_ARGUMENT',

  // Slicer
  SLICER_NOT_FOUND: 'NOT_FOUND',
  SLICER_ID_EXISTS: 'CONFLICT',
  SLICER_SHEET_MISMATCH: 'INVALID_ARGUMENT',

  // Form controls
  FORM_CONTROL_NOT_FOUND: 'NOT_FOUND',

  // Sparklines
  SPARKLINE_NOT_FOUND: 'NOT_FOUND',
  SPARKLINE_GROUP_NOT_FOUND: 'NOT_FOUND',

  // Hyperlinks
  HYPERLINK_NOT_FOUND: 'NOT_FOUND',

  // Scenario
  SCENARIO_ACTIVE_STATE_READ_ONLY: 'READ_ONLY',

  // Domain
  DOMAIN_FILTER_CREATE_FAILED: 'INTERNAL_ERROR',
  DOMAIN_GROUPING_MAX_LEVEL: 'INVALID_ARGUMENT',
  DOMAIN_DEFINED_NAME_NOT_FOUND: 'NOT_FOUND',
  DOMAIN_SPARKLINE_NOT_INITIALIZED: 'INTERNAL_ERROR',
  DOMAIN_CELL_STYLE_INVALID: 'INVALID_ARGUMENT',

  // Filesystem
  FS_INVALID_PATH: 'INVALID_ARGUMENT',

  // Registry
  REGISTRY_DRIVER_EXISTS: 'CONFLICT',
  REGISTRY_DRIVER_NOT_FOUND: 'NOT_FOUND',

  // Object
  OBJ_NOT_FOUND: 'NOT_FOUND',
  OBJ_INVALID_CONFIG: 'INVALID_ARGUMENT',
  OBJ_CHART_NOT_FOUND: 'NOT_FOUND',
  OBJ_CHART_TARGET_AMBIGUOUS: 'CONFLICT',
  OBJ_CHART_INVALID_CONFIG: 'INVALID_ARGUMENT',
  OBJ_SHAPE_NOT_FOUND: 'NOT_FOUND',
  OBJ_SHAPE_INVALID_CONFIG: 'INVALID_ARGUMENT',
  OBJ_DRAWING_NOT_FOUND: 'NOT_FOUND',
  OBJ_EQUATION_NOT_FOUND: 'NOT_FOUND',
  OBJ_TEXT_EFFECT_NOT_FOUND: 'NOT_FOUND',
  OBJ_DIAGRAM_NOT_FOUND: 'NOT_FOUND',
  OBJ_GROUP_TOO_FEW: 'INVALID_ARGUMENT',

  // Bridge / transport
  BRIDGE_NOT_AVAILABLE: 'TRANSPORT_ERROR',
  BRIDGE_COMMAND_FAILED: 'TRANSPORT_ERROR',
  BRIDGE_TRANSPORT_ERROR: 'TRANSPORT_ERROR',
  BRIDGE_WASM_LOAD_FAILED: 'TRANSPORT_ERROR',
  BRIDGE_NOT_STARTED: 'TRANSPORT_ERROR',
  BRIDGE_DISPOSED: 'DISPOSED',
  BRIDGE_ALREADY_STARTED: 'TRANSPORT_ERROR',
  BRIDGE_MUTATION_REJECTED: 'TRANSPORT_ERROR',
  BRIDGE_PHASE_INSUFFICIENT: 'TRANSPORT_ERROR',

  // Capability
  CAP_DENIED: 'AUTHORIZATION_DENIED',
  CAP_SCOPE_MISMATCH: 'AUTHORIZATION_DENIED',
  CAP_EXPIRED: 'AUTHORIZATION_DENIED',
  CAP_NOT_GRANTED: 'AUTHORIZATION_DENIED',
  CAP_REQUIRES_AUTH: 'AUTHORIZATION_DENIED',
  CAP_INVALID_SCOPE: 'INVALID_ARGUMENT',
  CAP_UNBOUNDED_WILDCARD: 'INVALID_ARGUMENT',

  // Document lifecycle
  DOC_NOT_READY: 'INTERNAL_ERROR',
  DOC_DISPOSED: 'DISPOSED',
  DOC_ENGINE_CREATE_FAILED: 'TRANSPORT_ERROR',
  DOC_HYDRATION_FAILED: 'IMPORT_ERROR',
  DOC_LIFECYCLE_ERROR: 'INTERNAL_ERROR',
  DOC_HOST_CONTEXT_VALIDATION: 'INVALID_ARGUMENT',
  DOC_LEGACY_OPTION_REJECTED: 'INVALID_ARGUMENT',

  // Compute
  COMPUTE_ERROR: 'COMPUTE_ERROR',

  // Configuration
  CONFIG_MISSING_USER_TIMEZONE: 'INVALID_ARGUMENT',
  CONFIG_INVALID_USER_TIMEZONE: 'INVALID_ARGUMENT',

  // Storage / Write Gate
  WRITE_GATE_BLOCKED: 'READ_ONLY',

  // Generic
  OPERATION_FAILED: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'INTERNAL_ERROR',
} as const satisfies KernelToSdkRuntimeMapping;

const SDK_ERROR_CODES = new Set<MogSdkErrorCode>([
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'CONFLICT',
  'AUTHORIZATION_DENIED',
  'READ_ONLY',
  'DISPOSED',
  'IMPORT_ERROR',
  'EXPORT_ERROR',
  'COMPUTE_ERROR',
  'TRANSPORT_ERROR',
  'PROVIDER_ERROR',
  'INTERNAL_ERROR',
]);

/**
 * Map a KernelErrorCode to its corresponding MogSdkErrorCode.
 * Exhaustive — every kernel code has exactly one SDK mapping.
 */
export function mapKernelCodeToSdkCode(code: KernelErrorCode): MogSdkErrorCode {
  return KERNEL_TO_SDK_MAP[code];
}

// ---------------------------------------------------------------------------
// MogSdkError class
// ---------------------------------------------------------------------------

export interface MogSdkErrorOptions {
  path?: readonly string[];
  suggestion?: string;
  details?: Record<string, unknown> | MogSdkSavePathErrorDetails;
  operation?: string;
  diagnostics?: MogSdkDiagnostics;
  cause?: unknown;
}

export class MogSdkError extends Error implements IMogSdkError {
  readonly code: MogSdkErrorCode;
  readonly path?: readonly string[];
  readonly suggestion?: string;
  readonly details?: Record<string, unknown> | MogSdkSavePathErrorDetails;
  readonly operation?: string;
  readonly diagnostics?: MogSdkDiagnostics;

  constructor(code: MogSdkErrorCode, message: string, options?: MogSdkErrorOptions) {
    super(message, options?.cause != null ? { cause: options.cause } : undefined);
    this.name = 'MogSdkError';
    this.code = code;
    this.path = options?.path;
    this.suggestion = options?.suggestion;
    this.details = options?.details;
    this.operation = options?.operation;
    this.diagnostics = options?.diagnostics;
  }

  /** Serialize to a JSON-safe form, including recursive cause chain. */
  toJSON(): MogSdkErrorJSON {
    const json: MogSdkErrorJSON = {
      code: this.code,
      message: this.message,
      ...(this.path != null ? { path: this.path } : {}),
      ...(this.suggestion != null ? { suggestion: this.suggestion } : {}),
      ...(this.operation != null ? { operation: this.operation } : {}),
      ...(this.details != null ? { details: this.details } : {}),
      ...(this.diagnostics != null ? { diagnostics: this.diagnostics } : {}),
      ...(this.cause instanceof MogSdkError ? { cause: this.cause.toJSON() } : {}),
    };
    return json;
  }

  /**
   * Map a KernelError to a MogSdkError using the exhaustive mapping table.
   */
  static fromKernelError(error: KernelError, operation?: string): MogSdkError {
    const sdkCode = mapKernelCodeToSdkCode(error.code);
    return new MogSdkError(sdkCode, error.message, {
      path: error.path,
      suggestion: error.suggestion,
      details: Object.keys(error.context).length > 0 ? error.context : undefined,
      operation,
      diagnostics: {
        domain: error.code.split('_')[0],
        ...(error.path?.at(-1) != null ? { property: error.path.at(-1) } : {}),
        issueCode: error.code,
        severity: 'error',
      },
      cause: error,
    });
  }

  /**
   * Wrap any error as a MogSdkError. If it is already a MogSdkError, returns
   * it as-is. If it is a KernelError (or subclass), maps via the mapping table.
   * Otherwise wraps as INTERNAL_ERROR.
   */
  static from(error: unknown, operation?: string): MogSdkError {
    return toMogSdkError(error, operation);
  }
}

// ---------------------------------------------------------------------------
// Convenience converter
// ---------------------------------------------------------------------------

/**
 * Duck-type check for XlsxParseError (lives in file-io, not in kernel).
 * Avoids a cross-package dependency.
 */
function isXlsxParseError(error: unknown): boolean {
  return error instanceof Error && error.name === 'XlsxParseError';
}

/** Cross-realm/cross-bundle guard for already-normalized public SDK errors. */
function isMogSdkErrorLike(error: unknown): error is MogSdkError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<MogSdkError>;
  return (
    candidate.name === 'MogSdkError' &&
    typeof candidate.message === 'string' &&
    typeof candidate.code === 'string' &&
    SDK_ERROR_CODES.has(candidate.code as MogSdkErrorCode) &&
    typeof candidate.toJSON === 'function'
  );
}

/**
 * Kernel and host packages can be bundled into separate JavaScript realms.
 * Recognize the lossless KernelError shape as well as local instanceof so the
 * stable boundary does not erase structured feedback at a package seam.
 */
function isKernelErrorLike(error: unknown): error is KernelError {
  if (error instanceof KernelError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<KernelError>;
  return (
    typeof candidate.code === 'string' &&
    Object.prototype.hasOwnProperty.call(KERNEL_TO_SDK_MAP, candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.context === 'object' &&
    candidate.context !== null
  );
}

/**
 * Convert any error to a MogSdkError:
 *
 * - MogSdkError          -> return as-is
 * - KernelError/subclass -> map via fromKernelError
 * - XlsxParseError       -> IMPORT_ERROR (duck-typed)
 * - anything else        -> INTERNAL_ERROR
 */
export function toMogSdkError(error: unknown, operation?: string): MogSdkError {
  if (error instanceof MogSdkError || isMogSdkErrorLike(error)) {
    return error;
  }

  // KernelError and all subclasses — use the exhaustive mapping and preserve
  // the complete agent-facing recovery contract.
  if (isKernelErrorLike(error)) {
    return MogSdkError.fromKernelError(error, operation);
  }

  // XlsxParseError (duck-typed to avoid cross-package import)
  if (isXlsxParseError(error)) {
    return new MogSdkError('IMPORT_ERROR', (error as Error).message, {
      operation,
      diagnostics: { domain: 'XLSX', severity: 'error' },
      cause: error,
    });
  }

  // Fallback: wrap as INTERNAL_ERROR
  const message = error instanceof Error ? error.message : String(error);
  return new MogSdkError('INTERNAL_ERROR', message, {
    operation,
    cause: error,
  });
}
