/**
 * Named Ranges Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/data/named-ranges.
 */

import type { SheetId } from '@mog-sdk/contracts/core/core';
import type { NameValidationResult } from '@mog-sdk/contracts/data/named-ranges';

/**
 * Reserved names that cannot be used as defined names.
 * Includes Excel built-in system names that are managed by the workbook engine.
 */
export const RESERVED_NAMES = new Set([
  'TRUE',
  'FALSE',
  'NULL',
  // All single letters A–Z (includes R and C which are R1C1 aliases)
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  // Excel built-in defined names reserved for system use
  'PRINT_AREA',
  'PRINT_TITLES',
  '_FILTERDATABASE',
]);

/**
 * Maximum name length (Excel limit is 255 characters).
 */
export const MAX_NAME_LENGTH = 255;

/**
 * Validate a potential name.
 */
export function validateName(
  name: string,
  existingNames: Set<string>,
  scope: SheetId | undefined,
): NameValidationResult {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: 'empty', message: 'Name cannot be empty' };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: 'too_long',
      message: `Name cannot exceed ${MAX_NAME_LENGTH} characters`,
    };
  }

  if (!/^[A-Za-z_\\]/.test(name)) {
    return {
      valid: false,
      error: 'starts_with_number',
      message: 'Name must start with a letter, underscore, or backslash',
    };
  }

  if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(name)) {
    return {
      valid: false,
      error: 'invalid_characters',
      message: 'Name can only contain letters, numbers, periods, and underscores',
    };
  }

  if (RESERVED_NAMES.has(name.toUpperCase())) {
    return { valid: false, error: 'reserved_name', message: 'This name is reserved' };
  }

  if (/^[A-Za-z]{1,3}[0-9]+$/.test(name)) {
    return {
      valid: false,
      error: 'cell_reference',
      message: 'Name cannot look like a cell reference',
    };
  }

  if (/^[Rr][0-9]+[Cc][0-9]+$/.test(name)) {
    return {
      valid: false,
      error: 'r1c1_reference',
      message: 'Name cannot look like an R1C1 reference',
    };
  }

  const key = scope ? `${scope}!${name.toUpperCase()}` : name.toUpperCase();
  if (existingNames.has(key)) {
    return {
      valid: false,
      error: 'duplicate_name',
      message: 'A name with this name already exists in this scope',
    };
  }

  return { valid: true };
}

/**
 * Get the storage key for a defined name.
 */
export function getDefinedNameKey(name: string, scope?: SheetId): string {
  const upperName = name.toUpperCase();
  return scope ? `${scope}!${upperName}` : upperName;
}
