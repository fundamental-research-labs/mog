/**
 * Constraint Evaluator
 *
 * Evaluates a single OOXML constraint and returns the resolved value.
 * This is the atomic unit of constraint resolution — the solver calls
 * this function repeatedly to resolve an entire constraint system.
 *
 * The evaluation formula is:
 *   target.type = (reference.refType * fact) + val
 *
 * Where:
 * - If refType is 'none': the result is simply `val`
 * - If refType is set: look up the referenced value, multiply by `fact`, add `val`
 * - Operator semantics determine how the result is applied:
 *   - 'none': soft/preferred value (can be overwritten)
 *   - 'equ': equality constraint (exact value)
 *   - 'gte': minimum constraint (value is a floor)
 *   - 'lte': maximum constraint (value is a ceiling)
 *
 * @module constraint-evaluator
 */

import type { OoxmlConstraint, ST_BoolOperator } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved constraint values for a single layout node.
 *
 * The values map stores constraint type keys (or "forName:constraintType"
 * composite keys for named node targets) to their resolved numeric values.
 */
export interface ResolvedConstraints {
  /** Map of constraint key to resolved numeric value */
  values: Map<string, number>;
}

/**
 * The result of evaluating a single constraint.
 */
export interface EvaluationResult {
  /** The key under which to store the resolved value */
  key: string;
  /** The computed numeric value */
  value: number;
  /** The operator that governs how this value should be applied */
  op: ST_BoolOperator;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Compute the storage key for a constraint's target.
 *
 * For constraints with a specific forName target, the key is "forName:type".
 * For constraints scoped to self/ch/des without a name, the key is just "type".
 *
 * @param constraint - The constraint to compute the key for
 * @returns The storage key string
 */
export function computeConstraintKey(constraint: OoxmlConstraint): string {
  if (constraint.forName) {
    return `${constraint.forName}:${constraint.type}`;
  }
  return constraint.type;
}

/**
 * Compute the lookup key for a constraint's reference source.
 *
 * @param constraint - The constraint whose reference to look up
 * @returns The reference lookup key, or null if no reference (refType = 'none')
 */
export function computeReferenceKey(constraint: OoxmlConstraint): string | null {
  if (constraint.refType === 'none') {
    return null;
  }
  if (constraint.refForName) {
    return `${constraint.refForName}:${constraint.refType}`;
  }
  return constraint.refType;
}

// =============================================================================
// Evaluator
// =============================================================================

/**
 * Evaluate a single OOXML constraint and return the resolved value.
 *
 * The evaluation formula is:
 *   result = (referenceValue * fact) + val
 *
 * When refType is 'none', the result is simply val (no reference lookup).
 *
 * @param constraint - The constraint to evaluate
 * @param resolvedValues - Currently resolved values for the target node scope
 * @param nodeNames - Map of named nodes to their resolved constraint values
 * @returns The evaluation result, or null if the referenced value is not yet available
 */
export function evaluateConstraint(
  constraint: OoxmlConstraint,
  resolvedValues: ResolvedConstraints,
  nodeNames: Map<string, ResolvedConstraints>,
): EvaluationResult | null {
  const key = computeConstraintKey(constraint);

  // Case 1: No reference — absolute value
  if (constraint.refType === 'none') {
    return {
      key,
      value: constraint.val,
      op: constraint.op,
    };
  }

  // Case 2: Reference-based value — look up the referenced value
  const refValue = lookupReferenceValue(constraint, resolvedValues, nodeNames);

  if (refValue === null) {
    // Referenced value not yet resolved — dependency not met
    return null;
  }

  // Apply the formula: result = (refValue * fact) + val
  const computedValue = refValue * constraint.fact + constraint.val;

  return {
    key,
    value: computedValue,
    op: constraint.op,
  };
}

/**
 * Look up the value referenced by a constraint.
 *
 * The lookup follows this priority:
 * 1. If refForName is set, look in the named node's resolved values
 * 2. If refFor is 'self', look in the current node's resolved values
 * 3. If refFor is 'ch' or 'des', look in the current node's resolved values
 *    (child/descendant scoped values share the same resolved map in our model)
 *
 * @param constraint - The constraint whose reference to look up
 * @param resolvedValues - Current node's resolved values
 * @param nodeNames - Map of named nodes to their resolved values
 * @returns The referenced numeric value, or null if not yet resolved
 */
function lookupReferenceValue(
  constraint: OoxmlConstraint,
  resolvedValues: ResolvedConstraints,
  nodeNames: Map<string, ResolvedConstraints>,
): number | null {
  const refKey = computeReferenceKey(constraint);
  if (refKey === null) {
    return null;
  }

  // If refForName is specified, look in that named node's values
  if (constraint.refForName) {
    const namedNode = nodeNames.get(constraint.refForName);
    if (!namedNode) {
      return null;
    }
    // Look up in the named node using just the refType (not prefixed)
    const val = namedNode.values.get(constraint.refType);
    if (val === undefined) {
      // Also try the full key in case it was stored with a prefix
      const fullVal = namedNode.values.get(refKey);
      return fullVal !== undefined ? fullVal : null;
    }
    return val;
  }

  // Self-reference or scope-based reference — look in current resolved values
  // First try the plain refType key
  const val = resolvedValues.values.get(constraint.refType);
  if (val !== undefined) {
    return val;
  }

  // Try the full reference key (might be stored with a scope prefix)
  const fullVal = resolvedValues.values.get(refKey);
  if (fullVal !== undefined) {
    return fullVal;
  }

  return null;
}

/**
 * Apply operator semantics to combine a new value with an existing value.
 *
 * Operator semantics:
 * - 'none': Soft/preferred value — set if no existing value, otherwise keep existing
 * - 'equ': Equality — always overwrite with the new value
 * - 'gte': Minimum — use the maximum of existing and new value
 * - 'lte': Maximum — use the minimum of existing and new value
 *
 * @param existingValue - The current value (undefined if not yet set)
 * @param newValue - The newly computed value
 * @param op - The operator to apply
 * @returns The resulting value after applying operator semantics
 */
export function applyOperator(
  existingValue: number | undefined,
  newValue: number,
  op: ST_BoolOperator,
): number {
  if (existingValue === undefined) {
    // No existing value — always set
    return newValue;
  }

  switch (op) {
    case 'none':
      // Soft/preferred — only set if no existing value (already checked above)
      // If there IS an existing value, keep it
      return existingValue;

    case 'equ':
      // Equality — always overwrite
      return newValue;

    case 'gte':
      // Minimum constraint — use the larger of the two
      return Math.max(existingValue, newValue);

    case 'lte':
      // Maximum constraint — use the smaller of the two
      return Math.min(existingValue, newValue);

    default:
      return newValue;
  }
}

/**
 * Create an empty ResolvedConstraints object.
 *
 * @returns A new ResolvedConstraints with an empty values map
 */
export function createResolvedConstraints(): ResolvedConstraints {
  return { values: new Map() };
}

/**
 * Clone a ResolvedConstraints object (deep copy of the values map).
 *
 * @param source - The source to clone
 * @returns A new ResolvedConstraints with copied values
 */
export function cloneResolvedConstraints(source: ResolvedConstraints): ResolvedConstraints {
  return { values: new Map(source.values) };
}
