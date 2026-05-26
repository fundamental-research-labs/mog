/**
 * TextEffect Diagnostics
 *
 * Validators and comparators for standalone diagnostic use.
 */
export { compareTextEffect } from './comparators';
export type { ComparisonResult, PropertyDifference } from './comparators';
export { validateWarpPreset, validateWarpResult } from './validators';
export type { DiagnosticIssue, ValidationResult } from './validators';
