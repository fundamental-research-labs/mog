/**
 * Floating Object Errors
 *
 * Error types for charts, shapes, drawings, equations, and other floating objects.
 */

import { KernelError, type KernelErrorOptions } from './kernel-error';
import type { KernelErrorCode } from './codes';

export class FloatingObjectError extends KernelError {
  public readonly objectType: string;

  constructor(
    code: KernelErrorCode,
    objectType: string,
    message: string,
    options?: KernelErrorOptions,
  ) {
    super(code, message, { ...options, context: { ...options?.context, objectType } });
    this.name = 'FloatingObjectError';
    this.objectType = objectType;
  }
}
