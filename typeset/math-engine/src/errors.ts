/**
 * Equation Parse Error Factory
 *
 * Creates structured parse-error objects for the equation system.
 * Moved from kernel/src/equation/contracts-runtime/errors.ts so that
 * any package depending on @mog/math-engine can use it without
 * pulling in the kernel.
 */

import type { EquationParseError, EquationParseErrorCode } from '@mog-sdk/contracts/equation';

export function createEquationParseError(
  code: EquationParseErrorCode,
  message: string,
  location?: string,
  fragment?: string,
): EquationParseError {
  return { code, message, location, fragment };
}
