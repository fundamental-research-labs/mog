/**
 * Choose/If/Else Evaluator — Conditional layout branching.
 *
 * Evaluates OOXML choose/if/else constructs against the current iteration
 * context to determine which branch of layout children to include.
 *
 * Evaluation rules:
 * 1. Each if-clause is evaluated in document order
 * 2. The first if-clause whose condition is true has its children returned
 * 3. If no if-clause matches, the else-clause children are returned (if present)
 * 4. If no else-clause exists and no if matches, null is returned
 *
 * @module choose-if
 */

import { DataModel } from '../data-model';
import { applyOperator, evaluateFunction } from './functions';

import type {
  Choose,
  IfClause,
  IterationContext,
  LayoutNodeChild,
  VariableList,
} from '@mog-sdk/contracts/diagram';

import type { FunctionEvalContext } from './functions';

// ============================================================================
// Choose Evaluator
// ============================================================================

/**
 * Evaluate a choose element against the current context.
 *
 * Iterates through if-clauses in order. Returns the children of the first
 * matching if-clause, or the else-clause children if no if matches.
 * Returns null if no branch matches.
 *
 * @param choose - The choose element to evaluate
 * @param dataModel - The data model for navigation-dependent conditions
 * @param context - Current iteration context
 * @param variables - Current variable list
 * @returns The winning branch's children, or null if no match
 */
export function evaluateChoose(
  choose: Choose,
  dataModel: DataModel,
  context: IterationContext,
  variables: VariableList,
): readonly LayoutNodeChild[] | null {
  // Evaluate each if-clause in order
  for (const ifClause of choose.ifClauses) {
    if (evaluateCondition(ifClause, dataModel, context, variables)) {
      return ifClause.children;
    }
  }

  // No if-clause matched: use else clause if present
  if (choose.elseClauses !== null) {
    return choose.elseClauses.children;
  }

  // No match at all
  return null;
}

// ============================================================================
// Condition Evaluator
// ============================================================================

/**
 * Evaluate a single if-clause condition.
 *
 * The condition is: func(arg, context) op val
 *
 * Where:
 * - func determines what value to compute
 * - arg provides additional context for the function
 * - op is the comparison operator
 * - val is the comparison value
 *
 * The if-clause also has axis/ptType/cnt/st/step parameters that provide
 * navigation context for functions that need it (primarily 'cnt').
 *
 * @param ifClause - The if-clause to evaluate
 * @param dataModel - The data model
 * @param context - Current iteration context
 * @param variables - Current variable list
 * @returns True if the condition is satisfied
 */
export function evaluateCondition(
  ifClause: IfClause,
  dataModel: DataModel,
  context: IterationContext,
  variables: VariableList,
): boolean {
  // Build the evaluation context for the function
  const evalContext: FunctionEvalContext = {
    dataModel,
    context: {
      ...context,
      variables,
    },
    axis: ifClause.axis,
    ptType: ifClause.ptType,
    arg: ifClause.arg,
    cnt: ifClause.cnt,
    st: ifClause.st,
    step: ifClause.step,
    hideLastTrans: ifClause.hideLastTrans,
  };

  // Evaluate the function
  const funcResult = evaluateFunction(ifClause.func, evalContext);

  // Apply the operator
  return applyOperator(ifClause.op, funcResult, ifClause.val);
}
