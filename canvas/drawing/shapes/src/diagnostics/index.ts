/**
 * Shape engine diagnostics.
 */
export { compareShapes } from './comparators';
export type { ShapeComparisonResult, ShapeDifference } from './comparators';
export { generatePresetSummaryReport, generateShapeReport } from './reporters';
export { validateShape } from './validators';
export type { DiagnosticIssue, ShapeValidationResult } from './validators';
