import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';

function isMissingValidationTarget(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'VALIDATION_NOT_FOUND'
  );
}

/**
 * Clear validation rules overlapping a user-selected range.
 *
 * The public validation API intentionally treats an explicit missing target as
 * an error. Spreadsheet Clear commands have different semantics: clearing an
 * optional property that is not present is an idempotent no-op. Keep that UI
 * policy at the action boundary while preserving the strict public API.
 */
export async function clearValidationsInRangeIfPresent(
  worksheet: Worksheet,
  range: CellRange,
): Promise<void> {
  try {
    await worksheet.validations.clearInRange(range);
  } catch (error) {
    if (!isMissingValidationTarget(error)) throw error;
  }
}
