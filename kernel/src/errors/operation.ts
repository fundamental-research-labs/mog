/**
 * Operation Result type and helpers
 *
 * Provides a type-safe result pattern for kernel operations.
 * Failure results carry KernelError instances with full context.
 */

import type { CellAddress } from '@mog-sdk/contracts/core';
import type { KernelError } from './kernel-error';

/** Result of a kernel operation — either success with data, or failure with a KernelError */
export type OperationResult<T = void> =
  | { success: true; data: T; affectedCells?: CellAddress[] }
  | { success: false; error: KernelError };

/** Extract data or throw — preserving the full KernelError */
export function unwrap<T>(result: OperationResult<T>): T {
  if (!result.success) throw result.error;
  return result.data;
}

/** Transform the data inside a successful result */
export function mapResult<T, U>(
  result: OperationResult<T>,
  fn: (data: T) => U,
): OperationResult<U> {
  if (!result.success) return result;
  return { success: true, data: fn(result.data), affectedCells: result.affectedCells };
}

/** Create a failure result from a KernelError */
export function failResult(error: KernelError): OperationResult<never> {
  return { success: false, error };
}

/** Create a success result */
export function okResult<T>(data: T, affectedCells?: CellAddress[]): OperationResult<T> {
  return { success: true, data, affectedCells };
}
