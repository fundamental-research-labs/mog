/**
 * Kernel Error System
 *
 * Unified error handling for the kernel. Every error thrown by the kernel
 * is a KernelError with a machine-readable code from the unified registry.
 *
 * KernelError is defined in kernel-error.ts to avoid circular imports:
 * error subclass files need KernelError, and this barrel re-exports them.
 *
 */

import type { ApiError } from '@mog-sdk/contracts/api-errors';

export { type KernelErrorCode } from './codes';
export { KernelError, isKernelError, type KernelErrorOptions } from './kernel-error';

// Import for use in toApiError below.
import type { KernelError as KernelErrorType } from './kernel-error';

/** Convert KernelError to the contracts ApiError plain object shape (for IPC boundaries) */
export function toApiError(error: KernelErrorType): ApiError {
  return {
    code: error.code as ApiError['code'],
    message: error.message,
    path: error.path,
    suggestion: error.suggestion,
    details: error.context,
  };
}

// Re-export domain error modules
export { BridgeError } from './bridge';
export { CapabilityError } from './capability';
export {
  DocumentDisposedError,
  DocumentLifecycleError,
  DocumentNotReadyError,
  EngineCreateError,
  HostContextValidationError,
  HydrationError,
} from './document';
export { FloatingObjectError } from './floating-object';
export {
  createPivotInvalidDataSourceError,
  createPivotAmbiguousPlacementError,
  createPivotNotFoundError,
  createPivotStaleHandleError,
  createPivotUnresolvedFieldReferencesError,
  type PivotInvalidDataSourceContext,
  type PivotInvalidReference,
  type PivotInvalidReferenceKind,
  type PivotNotFoundContext,
  type PivotStaleHandleContext,
  type PivotUnresolvedFieldReferencesContext,
} from './pivot';
export { failResult, mapResult, okResult, unwrap, type OperationResult } from './operation';
export { type KernelWarningCode } from './warning-codes';
export { createWarning, type OperationWarning } from './warning';
export { MogSdkError, mapKernelCodeToSdkCode, toMogSdkError } from './mog-sdk-error';
