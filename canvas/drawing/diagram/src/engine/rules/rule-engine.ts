/**
 * Rule Engine
 *
 * The adaptive rule engine for OOXML Diagram layouts. Rules define
 * fallback behavior when content doesn't fit within the constraints.
 * They are evaluated sequentially: the engine tries each rule in
 * document order, adjusting constraint values until content fits or
 * all rules are exhausted.
 *
 * Common rule patterns:
 * - Font shrinking: primFontSz rule with val=5 (minimum 5pt)
 * - Width expansion: w rule with val=INF
 * - Spacing reduction: sp rule with smaller spacing
 *
 * @module rule-engine
 */

import type { OoxmlConstraint, OoxmlRule } from '@mog-sdk/contracts/diagram';
import {
  cloneResolvedConstraints,
  type ResolvedConstraints,
} from '../constraints/constraint-evaluator';
import {
  solveConstraints,
  type ConstraintSolverInput,
  type ConstraintSolverOutput,
} from '../constraints/constraint-solver';

// =============================================================================
// Types
// =============================================================================

/**
 * Input to the rule engine.
 */
export interface RuleEngineInput {
  /** Current resolved constraints from the solver */
  resolved: ConstraintSolverOutput;
  /** Rules to apply (in document order) */
  rules: OoxmlRule[];
  /**
   * Content measurement function — returns true if content fits.
   *
   * @param selfValues - The self (current node) resolved constraints
   * @param nodeValues - Optional map of named node values (provided when
   *   a named-node rule is being evaluated, so the callback can inspect
   *   the adjusted node values)
   */
  contentFits: (
    selfValues: ResolvedConstraints,
    nodeValues?: Map<string, ResolvedConstraints>,
  ) => boolean;
  /**
   * Optional solver input for re-evaluating constraints after rule modifications.
   * When provided, after each rule is applied the solver is called again with
   * the modified values as initial values, so dependent constraints are propagated.
   */
  solverInput?: ConstraintSolverInput;
}

/**
 * Output from the rule engine.
 */
export interface RuleEngineOutput {
  /** Adjusted constraint values */
  adjusted: ConstraintSolverOutput;
  /** Which rules were applied */
  appliedRules: OoxmlRule[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Number of interpolation steps when searching for the right value
 * between the current constraint value and the rule's target value.
 */
const INTERPOLATION_STEPS = 10;

// =============================================================================
// Rule Engine
// =============================================================================

/**
 * Apply adaptive rules to a resolved constraint set.
 *
 * Algorithm:
 * 1. Check if content fits with current constraints -> if yes, return unchanged
 * 2. For each rule in document order:
 *    a. Determine the constraint key and current value
 *    b. Interpolate from current value toward rule's target (val)
 *    c. At each step, check if content fits
 *    d. If fits -> stop, return adjusted values
 *    e. If not -> continue to next step, then next rule
 * 3. If all rules exhausted and content still doesn't fit -> return best effort
 *
 * @param input - The current resolved constraints, rules, and content fit function
 * @returns The adjusted constraints and list of applied rules
 */
export function applyRules(input: RuleEngineInput): RuleEngineOutput {
  const { resolved, rules, contentFits, solverInput } = input;

  // Check if content fits with current constraints
  if (contentFits(resolved.selfValues, resolved.nodeValues)) {
    return {
      adjusted: resolved,
      appliedRules: [],
    };
  }

  // Clone resolved state so we can mutate it
  let currentSelfValues = cloneResolvedConstraints(resolved.selfValues);
  const currentNodeValues = new Map<string, ResolvedConstraints>();
  for (const [key, val] of resolved.nodeValues) {
    currentNodeValues.set(key, cloneResolvedConstraints(val));
  }

  const appliedRules: OoxmlRule[] = [];

  // Track the latest resolution status — updated after each re-solve
  let latestFullyResolved = resolved.fullyResolved;
  let latestUnresolvedConstraints = resolved.unresolvedConstraints;

  for (const rule of rules) {
    // HIGH 3 fix: When for='ch' or for='des' without forName, broadcast to all matching nodes
    if ((rule.for === 'ch' || rule.for === 'des') && !rule.forName && currentNodeValues.size > 0) {
      let anyApplied = false;
      // Snapshot selfValues before the broadcast loop so all children see the
      // same state. Without this, the second child would see modifications from
      // the first child's rule application.
      const snapshotSelfValues = cloneResolvedConstraints(currentSelfValues);
      for (const [nodeName, _nodeResolved] of currentNodeValues) {
        const scopedRule = { ...rule, forName: nodeName } as OoxmlRule;
        const adjustResult = applyRule(
          scopedRule,
          snapshotSelfValues,
          currentNodeValues,
          contentFits,
        );

        if (adjustResult.applied) {
          anyApplied = true;
          if (adjustResult.targetNodeName && adjustResult.nodeValues) {
            currentNodeValues.set(adjustResult.targetNodeName, adjustResult.nodeValues);
          }
        }
      }

      if (anyApplied) {
        appliedRules.push(rule);

        // HIGH 4 fix: Re-solve constraints after rule modifications to propagate dependent values
        const reSolveStatus = reSolveIfNeeded(solverInput, currentSelfValues, currentNodeValues);
        if (reSolveStatus) {
          latestFullyResolved = reSolveStatus.fullyResolved;
          latestUnresolvedConstraints = reSolveStatus.unresolvedConstraints;
        }

        // Check if content now fits
        if (contentFits(currentSelfValues, currentNodeValues)) {
          break;
        }
      }
      continue;
    }

    const adjustResult = applyRule(rule, currentSelfValues, currentNodeValues, contentFits);

    if (adjustResult.applied) {
      appliedRules.push(rule);
      currentSelfValues = adjustResult.selfValues;

      // Update node values if rule targeted a named node
      if (adjustResult.targetNodeName && adjustResult.nodeValues) {
        currentNodeValues.set(adjustResult.targetNodeName, adjustResult.nodeValues);
      }

      // HIGH 4 fix: Re-solve constraints after rule modifications to propagate dependent values
      const reSolveStatus = reSolveIfNeeded(solverInput, currentSelfValues, currentNodeValues);
      if (reSolveStatus) {
        latestFullyResolved = reSolveStatus.fullyResolved;
        latestUnresolvedConstraints = reSolveStatus.unresolvedConstraints;
      }

      // Check if content now fits
      if (contentFits(currentSelfValues, currentNodeValues)) {
        break;
      }
    }
  }

  return {
    adjusted: {
      nodeValues: currentNodeValues,
      selfValues: currentSelfValues,
      fullyResolved: latestFullyResolved,
      unresolvedConstraints: latestUnresolvedConstraints,
    },
    appliedRules,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Result of a re-solve operation, containing the updated resolution status.
 */
interface ReSolveStatus {
  fullyResolved: boolean;
  unresolvedConstraints: OoxmlConstraint[];
}

/**
 * Re-solve constraints after a rule modification to propagate dependent values.
 *
 * When solverInput is provided, re-runs the constraint solver with the current
 * modified values as initial values. This ensures that constraints that depend
 * on values modified by rules get updated (e.g., if constraint B depends on A,
 * and a rule changes A, B is re-computed).
 *
 * Mutates currentSelfValues and currentNodeValues in place with the re-solved results.
 *
 * @returns The updated resolution status from the re-solve, or null if no re-solve was needed.
 */
function reSolveIfNeeded(
  solverInput: ConstraintSolverInput | undefined,
  currentSelfValues: ResolvedConstraints,
  currentNodeValues: Map<string, ResolvedConstraints>,
): ReSolveStatus | null {
  if (!solverInput) return null;

  const reSolved = solveConstraints({
    ...solverInput,
    initialValues: {
      selfValues: currentSelfValues,
      nodeValues: currentNodeValues,
    },
  });

  // Update self values in place
  currentSelfValues.values.clear();
  for (const [k, v] of reSolved.selfValues.values) {
    currentSelfValues.values.set(k, v);
  }

  // Update node values in place
  for (const [name, resolved] of reSolved.nodeValues) {
    const existing = currentNodeValues.get(name);
    if (existing) {
      existing.values.clear();
      for (const [k, v] of resolved.values) {
        existing.values.set(k, v);
      }
    } else {
      currentNodeValues.set(name, resolved);
    }
  }

  return {
    fullyResolved: reSolved.fullyResolved,
    unresolvedConstraints: reSolved.unresolvedConstraints,
  };
}

interface ApplyRuleResult {
  applied: boolean;
  selfValues: ResolvedConstraints;
  nodeValues?: ResolvedConstraints;
  targetNodeName?: string;
}

/**
 * Apply a single rule by interpolating from the current value toward
 * the rule's target value.
 *
 * The rule adjusts a constraint value in discrete steps. At each step,
 * we check if content fits. If it does, we stop and return the adjusted
 * value. If not, we continue toward the target.
 *
 * @param rule - The rule to apply
 * @param selfValues - Current self resolved constraints
 * @param nodeValues - Map of named nodes to their resolved values
 * @param contentFits - Function that checks if content fits
 * @returns Whether the rule was applied and the updated values
 */
function applyRule(
  rule: OoxmlRule,
  selfValues: ResolvedConstraints,
  nodeValues: Map<string, ResolvedConstraints>,
  contentFits: (
    selfValues: ResolvedConstraints,
    nodeValues?: Map<string, ResolvedConstraints>,
  ) => boolean,
): ApplyRuleResult {
  // Determine which resolved values to modify
  const targetKey = rule.type;
  let targetResolved: ResolvedConstraints;
  let targetNodeName: string | undefined;

  if (rule.forName) {
    const named = nodeValues.get(rule.forName);
    if (!named) {
      return { applied: false, selfValues };
    }
    targetResolved = cloneResolvedConstraints(named);
    targetNodeName = rule.forName;
  } else {
    targetResolved = cloneResolvedConstraints(selfValues);
  }

  /**
   * Build a temporary node values map with updated values for the named node
   * being modified by this rule. This allows contentFits to see the change.
   */
  const buildTestNodeValues = (
    testNamedValues: ResolvedConstraints,
  ): Map<string, ResolvedConstraints> => {
    const testMap = new Map(nodeValues);
    if (targetNodeName) {
      testMap.set(targetNodeName, testNamedValues);
    }
    return testMap;
  };

  // Get the current value of the constraint
  const currentValue = targetResolved.values.get(targetKey);
  if (currentValue === undefined) {
    // No current value — set directly to rule's target
    const newValues = cloneResolvedConstraints(targetResolved);
    const targetValue = computeRuleTargetValue(rule);
    newValues.values.set(targetKey, targetValue);

    // Build the self values and node values to test
    const testSelfValues = rule.forName ? selfValues : newValues;
    const testNodeValues = rule.forName ? buildTestNodeValues(newValues) : nodeValues;

    if (contentFits(testSelfValues, testNodeValues)) {
      return {
        applied: true,
        selfValues: testSelfValues,
        nodeValues: rule.forName ? newValues : undefined,
        targetNodeName,
      };
    }

    // Even if it doesn't fit, apply the target value (best effort)
    return {
      applied: true,
      selfValues: rule.forName ? selfValues : newValues,
      nodeValues: rule.forName ? newValues : undefined,
      targetNodeName,
    };
  }

  // Interpolate from current value toward rule's target value
  const targetValue = computeRuleTargetValue(rule);

  // Clamp by max
  const clampedTarget = rule.max !== Infinity ? Math.min(targetValue, rule.max) : targetValue;

  // Step through values from current toward target
  for (let step = 1; step <= INTERPOLATION_STEPS; step++) {
    const t = step / INTERPOLATION_STEPS;
    const interpolated = currentValue + (clampedTarget - currentValue) * t;

    const testValues = cloneResolvedConstraints(targetResolved);
    testValues.values.set(targetKey, interpolated);

    const testSelfValues = rule.forName ? selfValues : testValues;
    const testNodeValues = rule.forName ? buildTestNodeValues(testValues) : nodeValues;

    if (contentFits(testSelfValues, testNodeValues)) {
      return {
        applied: true,
        selfValues: testSelfValues,
        nodeValues: rule.forName ? testValues : undefined,
        targetNodeName,
      };
    }
  }

  // Target not reached via interpolation — apply the full target
  const finalValues = cloneResolvedConstraints(targetResolved);
  finalValues.values.set(targetKey, clampedTarget);

  return {
    applied: true,
    selfValues: rule.forName ? selfValues : finalValues,
    nodeValues: rule.forName ? finalValues : undefined,
    targetNodeName,
  };
}

/**
 * Compute the target value for a rule.
 *
 * The formula is: targetValue = val * fact
 *
 * The rule's `val` attribute is the target value for the adjustment.
 * The `fact` attribute is a multiplier applied to val.
 *
 * Examples:
 * - primFontSz val=5 fact=1 -> target = 5 (shrink font to 5pt)
 * - sp val=2 fact=1 -> target = 2 (reduce spacing to 2)
 * - sibSp val=0 fact=1 -> target = 0 (reduce sibling spacing to 0)
 * - w val=200 fact=1.5 -> target = 300 (expand width to 300)
 *
 * @param rule - The rule
 * @returns The target value for the rule adjustment
 */
function computeRuleTargetValue(rule: OoxmlRule): number {
  return rule.val * rule.fact;
}
