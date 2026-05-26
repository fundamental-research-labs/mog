/**
 * Function Evaluators — Evaluates the 8 OOXML function types.
 *
 * Used by choose/if conditions to compute values against the current
 * iteration context. Each function returns a numeric or string value
 * that is then compared to the condition's val using the specified operator.
 *
 * Functions:
 * - cnt: count of matching items along an axis
 * - pos: 1-based position in current iteration
 * - revPos: reverse position (counting from end)
 * - posEven: 1 if position is even, 0 otherwise
 * - posOdd: 1 if position is odd, 0 otherwise
 * - var: variable lookup from VariableList
 * - depth: depth of current node
 * - maxDepth: maximum depth in data model
 *
 * @module functions
 */

import { DataModel } from '../data-model';
import { navigateAxis } from './axis-navigator';

import type {
  IterationContext,
  ST_FunctionArgument,
  ST_FunctionOperator,
  ST_FunctionType,
  VariableList,
} from '@mog-sdk/contracts/diagram';

// ============================================================================
// Function Evaluation
// ============================================================================

/**
 * Evaluation context for a function — everything needed to compute
 * the function's result.
 */
export interface FunctionEvalContext {
  /** The data model for cnt/depth/maxDepth computations */
  readonly dataModel: DataModel;

  /** Current iteration context (position, count, depth, variables) */
  readonly context: IterationContext;

  /** Axis spec for navigation-dependent functions (cnt) */
  readonly axis: string;

  /** PtType spec for navigation-dependent functions (cnt) */
  readonly ptType: string;

  /** Function argument (used by 'var' function for variable name) */
  readonly arg: ST_FunctionArgument;

  /** Optional: cnt, st, step for navigation subsequence */
  readonly cnt?: number;
  readonly st?: number;
  readonly step?: number;
  readonly hideLastTrans?: boolean;
}

/**
 * Evaluate a function and return its result as a string.
 *
 * All function results are returned as strings to allow uniform
 * comparison with the condition's val (which is always a string).
 *
 * For numeric functions (cnt, pos, revPos, posEven, posOdd, depth, maxDepth),
 * the result is the numeric value as a string.
 *
 * For the var function, the result is the variable's string representation.
 *
 * @param func - The function type to evaluate
 * @param evalContext - The evaluation context
 * @returns The function result as a string
 */
export function evaluateFunction(func: ST_FunctionType, evalContext: FunctionEvalContext): string {
  switch (func) {
    case 'cnt':
      return evaluateCnt(evalContext);
    case 'pos':
      return evaluatePos(evalContext);
    case 'revPos':
      return evaluateRevPos(evalContext);
    case 'posEven':
      return evaluatePosEven(evalContext);
    case 'posOdd':
      return evaluatePosOdd(evalContext);
    case 'var':
      return evaluateVar(evalContext);
    case 'depth':
      return evaluateDepth(evalContext);
    case 'maxDepth':
      return evaluateMaxDepth(evalContext);
    default: {
      // Exhaustive check
      const _exhaustive: never = func;
      throw new Error(`Unknown function type: ${_exhaustive}`);
    }
  }
}

// ============================================================================
// Individual Function Evaluators
// ============================================================================

/**
 * cnt — Count of matching items along the specified axis.
 * Uses the axis navigator to navigate from the current point and count results.
 */
function evaluateCnt(evalContext: FunctionEvalContext): string {
  const { dataModel, context, axis, ptType, hideLastTrans } = evalContext;

  // Per OOXML, cnt() counts ALL matching items along the axis.
  // Do NOT pass cnt/st/step to navigateAxis — those would limit the
  // navigation result before counting, double-applying subsequence params.
  const results = navigateAxis(dataModel, context.currentPoint, axis || 'ch', ptType || 'all', {
    hideLastTrans,
  });

  return String(results.length);
}

/**
 * pos — 1-based position of the current item in the iteration.
 */
function evaluatePos(evalContext: FunctionEvalContext): string {
  return String(evalContext.context.position);
}

/**
 * revPos — Reverse position: count - position + 1.
 */
function evaluateRevPos(evalContext: FunctionEvalContext): string {
  const { position, count } = evalContext.context;
  return String(count - position + 1);
}

/**
 * posEven — 1 if position is even, 0 otherwise.
 */
function evaluatePosEven(evalContext: FunctionEvalContext): string {
  return evalContext.context.position % 2 === 0 ? '1' : '0';
}

/**
 * posOdd — 1 if position is odd, 0 otherwise.
 */
function evaluatePosOdd(evalContext: FunctionEvalContext): string {
  return evalContext.context.position % 2 !== 0 ? '1' : '0';
}

/**
 * var — Look up a variable from the VariableList by arg name.
 */
function evaluateVar(evalContext: FunctionEvalContext): string {
  const { arg } = evalContext;
  const variables = evalContext.context.variables;

  return lookupVariable(variables, arg);
}

/**
 * depth — Depth of the current node in the data model tree.
 */
function evaluateDepth(evalContext: FunctionEvalContext): string {
  return String(evalContext.context.depth);
}

/**
 * maxDepth — Maximum depth anywhere in the data model tree.
 */
function evaluateMaxDepth(evalContext: FunctionEvalContext): string {
  return String(evalContext.dataModel.getMaxDepth());
}

// ============================================================================
// Variable Lookup
// ============================================================================

/**
 * Look up a variable from the VariableList by argument name.
 *
 * Converts the variable value to a string representation for comparison.
 *
 * @param variables - The variable list
 * @param arg - The function argument specifying which variable to look up
 * @returns String representation of the variable value
 */
export function lookupVariable(variables: VariableList, arg: ST_FunctionArgument): string {
  switch (arg) {
    case 'orgChart':
      return variables.orgChart ? '1' : '0';
    case 'chMax':
      return String(variables.chMax);
    case 'chPref':
      return String(variables.chPref);
    case 'bulEnabled':
      return variables.bulletEnabled ? '1' : '0';
    case 'dir':
      return variables.dir;
    case 'hierBranch':
      return variables.hierBranch;
    case 'animOne':
      return variables.animOne;
    case 'animLvl':
      return variables.animLvl;
    case 'resizeHandles':
      return variables.resizeHandles;
    case 'none':
      return '0';
    default: {
      const _exhaustive: never = arg;
      throw new Error(`Unknown function argument: ${_exhaustive}`);
    }
  }
}

// ============================================================================
// Operator Evaluation
// ============================================================================

/**
 * Apply a comparison operator to compare a function result against a value.
 *
 * Both operands are strings. For numeric operators (gt, lt, gte, lte),
 * both are parsed as numbers. For equality operators (equ, neq),
 * string comparison is used first, falling back to numeric if both parse.
 *
 * @param op - The comparison operator
 * @param funcResult - The function evaluation result (left operand)
 * @param val - The comparison value (right operand)
 * @returns True if the comparison holds
 */
export function applyOperator(op: ST_FunctionOperator, funcResult: string, val: string): boolean {
  switch (op) {
    case 'equ':
      return compareEqual(funcResult, val);
    case 'neq':
      return !compareEqual(funcResult, val);
    case 'gt':
      return compareNumeric(funcResult, val) > 0;
    case 'lt':
      return compareNumeric(funcResult, val) < 0;
    case 'gte':
      return compareNumeric(funcResult, val) >= 0;
    case 'lte':
      return compareNumeric(funcResult, val) <= 0;
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown operator: ${_exhaustive}`);
    }
  }
}

/**
 * Compare two values for equality.
 * First tries string comparison, then numeric comparison.
 */
function compareEqual(a: string, b: string): boolean {
  // Direct string comparison
  if (a === b) return true;

  // Try numeric comparison (handles "1" === "1.0" etc.)
  const numA = Number(a);
  const numB = Number(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA === numB;
  }

  return false;
}

/**
 * Numeric comparison of two string values.
 * Returns negative if a < b, zero if equal, positive if a > b.
 * Non-numeric values are treated as 0.
 */
function compareNumeric(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  const effectiveA = isNaN(numA) ? 0 : numA;
  const effectiveB = isNaN(numB) ? 0 : numB;
  return effectiveA - effectiveB;
}
