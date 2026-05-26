/**
 * Form Validation Utilities
 *
 * Common validation functions for form fields.
 */

import type { CellValue } from '@mog-sdk/contracts/core';

/**
 * Validation result.
 */
export interface ValidationResult {
  isValid: boolean;
  message?: string;
}

/**
 * Check if a value is empty (null, undefined, or empty string).
 */
export function isEmpty(value: CellValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * Validate required field.
 */
export function validateRequired(value: CellValue): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: false, message: 'This field is required' };
  }
  return { isValid: true };
}

/**
 * Validate email format.
 */
export function validateEmail(value: CellValue): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: true }; // Empty is valid (use validateRequired for required)
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const str = String(value);

  if (!emailRegex.test(str)) {
    return { isValid: false, message: 'Please enter a valid email address' };
  }
  return { isValid: true };
}

/**
 * Validate URL format.
 */
export function validateUrl(value: CellValue): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: true };
  }

  try {
    new URL(String(value));
    return { isValid: true };
  } catch {
    return { isValid: false, message: 'Please enter a valid URL' };
  }
}

/**
 * Validate number range.
 */
export function validateNumberRange(
  value: CellValue,
  min?: number,
  max?: number,
): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: true };
  }

  const num = typeof value === 'number' ? value : parseFloat(String(value));

  if (isNaN(num)) {
    return { isValid: false, message: 'Please enter a valid number' };
  }

  if (min !== undefined && num < min) {
    return { isValid: false, message: `Value must be at least ${min}` };
  }

  if (max !== undefined && num > max) {
    return { isValid: false, message: `Value must be at most ${max}` };
  }

  return { isValid: true };
}

/**
 * Validate string length.
 */
export function validateLength(
  value: CellValue,
  minLength?: number,
  maxLength?: number,
): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: true };
  }

  const str = String(value);

  if (minLength !== undefined && str.length < minLength) {
    return { isValid: false, message: `Must be at least ${minLength} characters` };
  }

  if (maxLength !== undefined && str.length > maxLength) {
    return { isValid: false, message: `Must be at most ${maxLength} characters` };
  }

  return { isValid: true };
}

/**
 * Validate against a regex pattern.
 */
export function validatePattern(
  value: CellValue,
  pattern: RegExp,
  message = 'Invalid format',
): ValidationResult {
  if (isEmpty(value)) {
    return { isValid: true };
  }

  const str = String(value);

  if (!pattern.test(str)) {
    return { isValid: false, message };
  }

  return { isValid: true };
}

/**
 * Combine multiple validators.
 */
export function combineValidators(
  ...validators: ((value: CellValue) => ValidationResult)[]
): (value: CellValue) => ValidationResult {
  return (value: CellValue) => {
    for (const validator of validators) {
      const result = validator(value);
      if (!result.isValid) {
        return result;
      }
    }
    return { isValid: true };
  };
}
