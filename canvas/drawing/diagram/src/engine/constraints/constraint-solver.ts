/**
 * Constraint Solver
 *
 * Resolves all constraints for a layout node tree using iterative evaluation.
 * This is the mathematical heart of the OOXML Diagram layout engine.
 *
 * Algorithm:
 * 1. Group constraints by target (for + forName)
 * 2. Initialize self values with parent bounds (w = bounds.width, h = bounds.height)
 * 3. Iterative resolution loop (max iterations):
 *    a. For each unresolved constraint, try to evaluate it
 *    b. If evaluation succeeds (all references available), store the value
 *    c. Apply operator semantics (equ = set, gte = max, lte = min)
 *    d. Track if any new values were resolved this iteration
 *    e. If no progress and still unresolved constraints -> break (circular or missing)
 * 4. Derive composite values from positional pairs:
 *    - If l + w known -> r = l + w
 *    - If l + r known -> w = r - l
 *    - If w + r known -> l = r - w
 *    - Same for vertical (t, h, b) and center (ctrX, ctrY)
 *
 * @module constraint-solver
 */

import type { OoxmlConstraint, ST_BoolOperator, ST_ElementType } from '@mog-sdk/contracts/diagram';
import type { PointType } from '../data-model';
import { matchesElementType } from '../element-type-utils';
import {
  applyOperator,
  createResolvedConstraints,
  evaluateConstraint,
  type ResolvedConstraints,
} from './constraint-evaluator';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of resolution iterations before giving up */
const MAX_ITERATIONS = 10;

// =============================================================================
// Types
// =============================================================================

/**
 * Input to the constraint solver.
 */
export interface ConstraintSolverInput {
  /** All constraints for a layout subtree */
  constraints: readonly OoxmlConstraint[];
  /** Named layout nodes that constraints can reference */
  nodeNames: string[];
  /** Available bounds (width, height of parent container) */
  bounds: { width: number; height: number };
  /**
   * Optional mapping from node name to data point type.
   * When provided, constraints with ptType/refPtType filters are matched
   * against the associated data point type of each target/reference node.
   * If not provided, ptType/refPtType filters are ignored (backward compatible).
   */
  nodePointTypes?: Map<string, PointType>;
  /**
   * Optional data point type for the "self" node.
   * Used when a constraint with ptType filters targets self.
   */
  selfPointType?: PointType;
  /**
   * Optional list of node names that are direct children (vs deeper descendants).
   * When provided, for='ch' broadcasts only to these names, while for='des'
   * broadcasts to all nodeNames. If not provided, both for='ch' and for='des'
   * broadcast to all nodeNames (backward compatible).
   */
  childNames?: string[];
  /**
   * Optional pre-set values to seed the solver with before constraint resolution.
   * When provided, these values are used as initial values for self and named nodes
   * instead of the defaults (bounds-only for self, empty for nodes).
   * This is used by the rule engine to re-solve constraints after rule modifications.
   */
  initialValues?: {
    selfValues?: ResolvedConstraints;
    nodeValues?: Map<string, ResolvedConstraints>;
  };
}

/**
 * Output from the constraint solver.
 */
export interface ConstraintSolverOutput {
  /** Resolved values per named node */
  nodeValues: Map<string, ResolvedConstraints>;
  /** Self values (for the current node) */
  selfValues: ResolvedConstraints;
  /** Whether all constraints were satisfiable */
  fullyResolved: boolean;
  /** Any constraints that couldn't be resolved */
  unresolvedConstraints: OoxmlConstraint[];
}

// =============================================================================
// Solver
// =============================================================================

/**
 * Solve all constraints for a layout node subtree.
 *
 * Uses iterative resolution to handle forward references and dependency chains.
 * Constraints are evaluated repeatedly until all are resolved or no more progress
 * can be made (indicating circular dependencies or missing references).
 *
 * @param input - The constraints, node names, and bounds to solve with
 * @returns The solved constraint values, resolution status, and any unresolved constraints
 */
export function solveConstraints(input: ConstraintSolverInput): ConstraintSolverOutput {
  const {
    constraints,
    nodeNames,
    bounds,
    nodePointTypes,
    selfPointType,
    childNames,
    initialValues,
  } = input;

  // Initialize node values maps
  const nodeValuesMap = new Map<string, ResolvedConstraints>();
  for (const name of nodeNames) {
    if (initialValues?.nodeValues?.has(name)) {
      // Use pre-set values from initialValues (deep copy to avoid mutation)
      const src = initialValues.nodeValues.get(name)!;
      nodeValuesMap.set(name, { values: new Map(src.values) });
    } else {
      nodeValuesMap.set(name, createResolvedConstraints());
    }
  }

  // Initialize self values with bounds (as soft defaults)
  const selfValues = createResolvedConstraints();
  if (initialValues?.selfValues) {
    // Seed from initialValues, then ensure bounds are present
    for (const [k, v] of initialValues.selfValues.values) {
      selfValues.values.set(k, v);
    }
    // Ensure bounds are present (don't overwrite if already set from initialValues)
    if (!selfValues.values.has('w')) {
      selfValues.values.set('w', bounds.width);
    }
    if (!selfValues.values.has('h')) {
      selfValues.values.set('h', bounds.height);
    }
  } else {
    selfValues.values.set('w', bounds.width);
    selfValues.values.set('h', bounds.height);
  }

  // Track which keys have been explicitly set by constraints (not just bounds)
  // This is used to determine whether composite pair derivation can overwrite a value.
  const explicitlyConstrained = new Set<string>();

  // Track which constraints remain unresolved
  let unresolvedConstraints = [...constraints];

  // Iterative resolution loop
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let progressMade = false;
    const stillUnresolved: OoxmlConstraint[] = [];

    for (const constraint of unresolvedConstraints) {
      // Check refPtType: if refPtType is set, verify the reference node's point type matches
      if (!matchesRefPtType(constraint, nodePointTypes, selfPointType)) {
        // Reference node doesn't match refPtType filter — skip this constraint
        stillUnresolved.push(constraint);
        continue;
      }

      // Get all targets based on the `for` scope attribute
      const targets = getTargetsByScope(constraint, selfValues, nodeValuesMap, childNames);
      let constraintResolved = false;

      for (const target of targets) {
        // Check ptType: if ptType is set, verify the target node's point type matches
        if (!matchesPtType(constraint, target.name, nodePointTypes, selfPointType)) {
          // Target doesn't match ptType filter — skip this target
          continue;
        }

        // For broadcast constraints (for='ch'/'des'), when refFor='self' we need to
        // look up reference values in selfValues (the parent), not in the child's map.
        // Use selfValues as the reference context when the target is a named node.
        const referenceContext = target.name ? selfValues : target.resolved;

        // Try to evaluate this constraint against the appropriate reference context
        const result = evaluateConstraint(constraint, referenceContext, nodeValuesMap);

        if (result === null) {
          // If the constraint has a named reference (refForName) and it's not resolved
          // yet, do NOT fall back to selfValues — leave it unresolved for the next iteration.
          if (constraint.refForName) {
            continue;
          }
          // Only try selfValues fallback when there is no named reference
          // (when the constraint references self but the target is a named node)
          if (referenceContext !== selfValues) {
            const resultWithSelf = evaluateConstraint(constraint, selfValues, nodeValuesMap);
            if (resultWithSelf === null) {
              continue;
            }
            // Apply to the specific target
            applyValueToScopedTarget(
              resultWithSelf.key,
              resultWithSelf.value,
              resultWithSelf.op,
              constraint,
              target.name,
              selfValues,
              nodeValuesMap,
            );
            // Only mark as explicitly constrained if the constraint actually changes a value.
            // op='none' preserves existing values, so it shouldn't block composite derivation.
            if (!isSoftConstraint(resultWithSelf.op)) {
              markExplicitScoped(constraint, target.name, explicitlyConstrained);
            }
            constraintResolved = true;
            continue;
          }
          continue;
        }

        // Apply operator semantics and store the value
        applyValueToScopedTarget(
          result.key,
          result.value,
          result.op,
          constraint,
          target.name,
          selfValues,
          nodeValuesMap,
        );
        // Only mark as explicitly constrained if the constraint actually changes a value.
        // op='none' preserves existing values, so it shouldn't block composite derivation.
        if (!isSoftConstraint(result.op)) {
          markExplicitScoped(constraint, target.name, explicitlyConstrained);
        }
        constraintResolved = true;
      }

      if (constraintResolved) {
        progressMade = true;
      } else {
        stillUnresolved.push(constraint);
      }
    }

    unresolvedConstraints = stillUnresolved;

    // If no progress was made and there are still unresolved constraints, stop
    if (!progressMade || unresolvedConstraints.length === 0) {
      break;
    }
  }

  // Derive composite values from positional pairs
  deriveCompositeValues(selfValues, explicitlyConstrained);
  for (const [_nodeName, resolved] of nodeValuesMap) {
    // For named nodes, all values are explicitly constrained (no bounds defaults)
    deriveCompositeValues(resolved, new Set());
  }

  return {
    nodeValues: nodeValuesMap,
    selfValues,
    fullyResolved: unresolvedConstraints.length === 0,
    unresolvedConstraints,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Check if a constraint's ptType filter matches the target node's data point type.
 *
 * When ptType is 'all' or nodePointTypes is not provided, the check passes.
 * When the target is self, uses selfPointType.
 * When the target is a named node, uses nodePointTypes.
 */
function matchesPtType(
  constraint: OoxmlConstraint,
  targetName: string | null,
  nodePointTypes: Map<string, PointType> | undefined,
  selfPointType: PointType | undefined,
): boolean {
  // 'all' means no filter
  if (constraint.ptType === 'all') return true;

  // No point type info available — skip filtering (backward compatible)
  if (!nodePointTypes && selfPointType === undefined) return true;

  // Determine the target's point type
  let targetPtType: PointType | undefined;

  if (targetName) {
    targetPtType = nodePointTypes?.get(targetName);
  } else {
    targetPtType = selfPointType;
  }

  // If we can't determine the point type, allow it (don't filter out)
  if (targetPtType === undefined) return true;

  return matchesElementType({ type: targetPtType }, constraint.ptType as ST_ElementType);
}

/**
 * Check if a constraint's refPtType filter matches the reference node's data point type.
 *
 * When refPtType is 'all' or nodePointTypes is not provided, the check passes.
 */
function matchesRefPtType(
  constraint: OoxmlConstraint,
  nodePointTypes: Map<string, PointType> | undefined,
  selfPointType: PointType | undefined,
): boolean {
  // 'all' means no filter
  if (constraint.refPtType === 'all') return true;

  // No reference — no refPtType check needed
  if (constraint.refType === 'none') return true;

  // No point type info available — skip filtering (backward compatible)
  if (!nodePointTypes && selfPointType === undefined) return true;

  // Determine the reference node's point type
  let refPtType: PointType | undefined;

  if (constraint.refForName) {
    refPtType = nodePointTypes?.get(constraint.refForName);
  } else {
    refPtType = selfPointType;
  }

  // If we can't determine the point type, allow it (don't filter out)
  if (refPtType === undefined) return true;

  return matchesElementType({ type: refPtType }, constraint.refPtType as ST_ElementType);
}

/**
 * Get all target ResolvedConstraints maps for a constraint based on its `for` scope.
 *
 * Per ECMA-376, the `for` attribute controls which nodes the constraint applies to:
 * - 'self': applies to the current layout node (selfValues)
 * - 'ch': applies to each direct child layout node only
 * - 'des': applies to each descendant layout node (all named nodes)
 *
 * When forName is set, `for` is ignored because the target is explicit.
 * When for='ch' and childNames is provided, only broadcasts to direct children.
 * When for='des', broadcasts to all named nodes. If childNames is not provided,
 * both 'ch' and 'des' broadcast to all named nodes (backward compatible).
 *
 * @param childNames - Optional list of direct child node names (vs deeper descendants)
 * @returns Array of [targetKey, ResolvedConstraints] pairs to apply the constraint to
 */
function getTargetsByScope(
  constraint: OoxmlConstraint,
  selfValues: ResolvedConstraints,
  nodeValuesMap: Map<string, ResolvedConstraints>,
  childNames?: string[],
): Array<{ name: string | null; resolved: ResolvedConstraints }> {
  // If forName is set, target that specific named node
  if (constraint.forName) {
    const named = nodeValuesMap.get(constraint.forName);
    if (named) {
      return [{ name: constraint.forName, resolved: named }];
    }
    // Named node not found — fall through to self
    return [{ name: null, resolved: selfValues }];
  }

  // If for='ch', broadcast to direct children only
  if (constraint.for === 'ch') {
    // When childNames is provided, use it to filter to direct children only
    const targetNames = childNames ?? [...nodeValuesMap.keys()];
    const targets: Array<{ name: string; resolved: ResolvedConstraints }> = [];
    for (const name of targetNames) {
      const resolved = nodeValuesMap.get(name);
      if (resolved) {
        targets.push({ name, resolved });
      }
    }
    // Return whatever we found — an empty array if no children match.
    // A constraint intended for children should NOT fall back to self.
    return targets;
  }

  // If for='des', broadcast to ALL named nodes (descendants)
  if (constraint.for === 'des') {
    const targets: Array<{ name: string; resolved: ResolvedConstraints }> = [];
    for (const [name, resolved] of nodeValuesMap) {
      targets.push({ name, resolved });
    }
    // Return whatever we found — an empty array if no descendants exist.
    // A constraint intended for descendants should NOT fall back to self.
    return targets;
  }

  // for='self' (default)
  return [{ name: null, resolved: selfValues }];
}

/**
 * Apply a resolved value to a scoped target (used with `for` scope broadcasting).
 *
 * When targetName is null, the value goes to self values.
 * When targetName is set, the value goes to the named node AND self values
 * (with a composite key for cross-referencing).
 */
function applyValueToScopedTarget(
  key: string,
  value: number,
  op: ST_BoolOperator,
  constraint: OoxmlConstraint,
  targetName: string | null,
  selfValues: ResolvedConstraints,
  nodeValuesMap: Map<string, ResolvedConstraints>,
): void {
  if (targetName) {
    // Store in the named node's map
    const namedResolved = nodeValuesMap.get(targetName);
    if (namedResolved) {
      const existing = namedResolved.values.get(constraint.type);
      const applied = applyOperator(existing, value, op);
      namedResolved.values.set(constraint.type, applied);
    }
    // Also store with composite key in self values for cross-referencing
    const compositeKey = `${targetName}:${constraint.type}`;
    const existingSelf = selfValues.values.get(compositeKey);
    const appliedSelf = applyOperator(existingSelf, value, op);
    selfValues.values.set(compositeKey, appliedSelf);
  } else {
    // Store in self values
    const existing = selfValues.values.get(key);
    const applied = applyOperator(existing, value, op);
    selfValues.values.set(key, applied);
  }
}

/**
 * Check if a constraint's op means it should not mark the value as explicitly constrained.
 *
 * op='none' is a soft/preferred constraint — it only sets a value when there is
 * no existing value, and even then it should not be treated as "explicitly constrained"
 * because it shouldn't block composite pair derivation (e.g., l + r -> w).
 *
 * We check before applying the constraint whether the target already had a value.
 * If op='none' and the target already had a value, the constraint is a true no-op.
 * If op='none' and the target had no value, it sets the value but as a soft default.
 * In both cases, the value should not be marked as explicitly constrained.
 */
function isSoftConstraint(op: ST_BoolOperator): boolean {
  return op === 'none';
}

/**
 * Mark a constraint's target key as explicitly constrained (scoped version).
 */
function markExplicitScoped(
  constraint: OoxmlConstraint,
  targetName: string | null,
  explicitlyConstrained: Set<string>,
): void {
  if (targetName) {
    explicitlyConstrained.add(`${targetName}:${constraint.type}`);
  } else if (constraint.forName) {
    explicitlyConstrained.add(`${constraint.forName}:${constraint.type}`);
  } else {
    explicitlyConstrained.add(constraint.type);
  }
}

/**
 * Derive missing composite values from known positional pairs.
 *
 * The composite algorithm requires specifying 2 of 3 values per axis.
 * This function derives the third value when possible.
 *
 * A value is considered "missing" (derivable) if either:
 * - It doesn't exist at all in the resolved values, OR
 * - It was only set from bounds defaults (not explicitly constrained)
 *
 * This ensures that when l and r are both explicitly constrained,
 * w can be derived from them even though w was initialized from bounds.
 *
 * Horizontal: l + w -> r = l + w, l + r -> w = r - l, w + r -> l = r - w
 * Vertical: t + h -> b = t + h, t + b -> h = b - t, h + b -> t = b - h
 * Center X: ctrX = l + w/2, l = ctrX - w/2, w = 2*(ctrX - l)
 * Center Y: ctrY = t + h/2, t = ctrY - h/2, h = 2*(ctrY - t)
 */
function deriveCompositeValues(
  resolved: ResolvedConstraints,
  explicitlyConstrained: Set<string>,
): void {
  const vals = resolved.values;

  // Horizontal: l, w, r
  deriveTriple(vals, 'l', 'w', 'r', explicitlyConstrained);

  // Vertical: t, h, b
  deriveTriple(vals, 't', 'h', 'b', explicitlyConstrained);

  // Center X derivations
  deriveCenterValues(vals, 'l', 'w', 'ctrX', explicitlyConstrained);

  // Center Y derivations
  deriveCenterValues(vals, 't', 'h', 'ctrY', explicitlyConstrained);
}

/**
 * Check if a value is considered "derivable" — either absent or only set from bounds.
 */
function isDerivable(
  key: string,
  vals: Map<string, number>,
  explicitlyConstrained: Set<string>,
): boolean {
  // If the value doesn't exist, it's derivable
  if (!vals.has(key)) {
    return true;
  }
  // If the value exists but was NOT explicitly constrained, it's derivable
  // (it was set from bounds or a previous derivation)
  return !explicitlyConstrained.has(key);
}

/**
 * Derive the third value from a triple (start, size, end).
 *
 * Rules (only when exactly one of the three is derivable):
 * - start + size known (explicit) -> end = start + size
 * - start + end known (explicit) -> size = end - start
 * - size + end known (explicit) -> start = end - size
 */
function deriveTriple(
  vals: Map<string, number>,
  startKey: string,
  sizeKey: string,
  endKey: string,
  explicitlyConstrained: Set<string>,
): void {
  const startExplicit = explicitlyConstrained.has(startKey);
  const sizeExplicit = explicitlyConstrained.has(sizeKey);
  const endExplicit = explicitlyConstrained.has(endKey);

  const start = vals.get(startKey);
  const size = vals.get(sizeKey);
  const end = vals.get(endKey);

  // Two explicit, one derivable => derive the third
  if (startExplicit && sizeExplicit && isDerivable(endKey, vals, explicitlyConstrained)) {
    if (start !== undefined && size !== undefined) {
      vals.set(endKey, start + size);
    }
  } else if (startExplicit && endExplicit && isDerivable(sizeKey, vals, explicitlyConstrained)) {
    if (start !== undefined && end !== undefined) {
      vals.set(sizeKey, end - start);
    }
  } else if (sizeExplicit && endExplicit && isDerivable(startKey, vals, explicitlyConstrained)) {
    if (size !== undefined && end !== undefined) {
      vals.set(startKey, end - size);
    }
  }
  // Fallback: if values exist but none are "explicit" constraints (e.g., all from bounds),
  // still try standard derivation for the case of no bounds overlap
  else if (start !== undefined && size !== undefined && end === undefined) {
    vals.set(endKey, start + size);
  } else if (start !== undefined && end !== undefined && size === undefined) {
    vals.set(sizeKey, end - start);
  } else if (size !== undefined && end !== undefined && start === undefined) {
    vals.set(startKey, end - size);
  }
}

/**
 * Derive center-related values.
 *
 * Rules:
 * - start + size -> center = start + size/2
 * - center + size -> start = center - size/2
 * - center + start -> size = 2 * (center - start)
 */
function deriveCenterValues(
  vals: Map<string, number>,
  startKey: string,
  sizeKey: string,
  centerKey: string,
  explicitlyConstrained: Set<string>,
): void {
  const startExplicit = explicitlyConstrained.has(startKey);
  const sizeExplicit = explicitlyConstrained.has(sizeKey);
  const centerExplicit = explicitlyConstrained.has(centerKey);

  const start = vals.get(startKey);
  const size = vals.get(sizeKey);
  const center = vals.get(centerKey);

  // Derive center from start + size
  if (startExplicit && sizeExplicit && isDerivable(centerKey, vals, explicitlyConstrained)) {
    if (start !== undefined && size !== undefined) {
      vals.set(centerKey, start + size / 2);
    }
  } else if (centerExplicit && sizeExplicit && isDerivable(startKey, vals, explicitlyConstrained)) {
    if (center !== undefined && size !== undefined) {
      vals.set(startKey, center - size / 2);
    }
  } else if (centerExplicit && startExplicit && isDerivable(sizeKey, vals, explicitlyConstrained)) {
    if (center !== undefined && start !== undefined) {
      vals.set(sizeKey, 2 * (center - start));
    }
  }
  // Fallback for non-explicit values
  else if (start !== undefined && size !== undefined && center === undefined) {
    vals.set(centerKey, start + size / 2);
  } else if (center !== undefined && size !== undefined && start === undefined) {
    vals.set(startKey, center - size / 2);
  } else if (center !== undefined && start !== undefined && size === undefined) {
    vals.set(sizeKey, 2 * (center - start));
  }
}
