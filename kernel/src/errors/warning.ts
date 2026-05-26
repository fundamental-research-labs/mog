/**
 * OperationWarning — lightweight warning for non-fatal conditions.
 *
 * Unlike KernelError, warnings don't interrupt execution. They are
 * attached to operation results so callers can inspect what happened
 * (e.g., deduplication, coercion, clamping) without the operation failing.
 *
 * Follows the same code-first design as KernelError but as a plain
 * serializable object — no stack traces or cause chains needed.
 */

import type { KernelWarningCode } from './warning-codes';

export interface OperationWarning {
  /** Machine-readable warning code */
  code: KernelWarningCode;
  /** Human-readable description */
  message: string;
  /** Optional structured context for programmatic handling */
  context?: Record<string, unknown>;
}

/** Create an OperationWarning */
export function createWarning(
  code: KernelWarningCode,
  message: string,
  context?: Record<string, unknown>,
): OperationWarning {
  return context != null ? { code, message, context } : { code, message };
}
