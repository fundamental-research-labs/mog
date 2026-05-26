/**
 * Constraint System
 *
 * The constraint solver and evaluator that form the mathematical heart
 * of the OOXML Diagram layout engine. Constraints define spatial
 * relationships between layout nodes; the solver resolves them into
 * concrete numeric values.
 *
 * @module constraints
 */

// Constraint type helpers
export {
  getConstraintCategory,
  isAlignmentConstraint,
  isDimensionalConstraint,
  isFontConstraint,
  isGeometryConstraint,
  isHorizontalConstraint,
  isMarginConstraint,
  isPositionalConstraint,
  isPyramidConstraint,
  isSpacingConstraint,
  isUserDefinedConstraint,
  isVerticalConstraint,
} from './constraint-types';

// Constraint evaluator
export {
  applyOperator,
  cloneResolvedConstraints,
  computeConstraintKey,
  computeReferenceKey,
  createResolvedConstraints,
  evaluateConstraint,
} from './constraint-evaluator';
export type { EvaluationResult, ResolvedConstraints } from './constraint-evaluator';

// Constraint solver
export { solveConstraints } from './constraint-solver';
export type { ConstraintSolverInput, ConstraintSolverOutput } from './constraint-solver';
