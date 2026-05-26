/**
 * Diagnostics index
 */
export { validateGroups, validateZOrder } from './validators';
export type { DiagnosticIssue } from './validators';

export { traceAnchorResolution } from './anchor-diagnostics';
export type { AnchorTrace, ResolutionStep } from './anchor-diagnostics';

export { generateDrawingSummary } from './reporters';
