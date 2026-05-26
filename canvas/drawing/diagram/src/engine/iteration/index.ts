/**
 * Data Iteration System
 *
 * The forEach/choose/if system that drives data-dependent layout.
 * This is the backbone of how layouts iterate over data model points.
 *
 * @module iteration
 */

// Axis navigation
export { applySubsequence, navigateAxis, parseAxisSpec, parsePtTypeSpec } from './axis-navigator';
export type { NavigationOptions } from './axis-navigator';

// ForEach execution
export { executeForEach } from './for-each';
export type { ForEachIteration, ForEachRegistry, ForEachResult } from './for-each';

// Choose/if/else evaluation
export { evaluateChoose, evaluateCondition } from './choose-if';

// Function evaluation
export { applyOperator, evaluateFunction, lookupVariable } from './functions';
export type { FunctionEvalContext } from './functions';

// PresOf mapping
export { createDefaultPresOfSpec, resolvePresOf } from './pres-of-mapper';
export type { PresOfSpec } from './pres-of-mapper';
