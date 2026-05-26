/**
 * Composite Layout Algorithm
 *
 * The most common OOXML layout algorithm. Positions children using
 * constraint-resolved values (l, t, w, h pairs). Each child's position
 * is determined by its resolved constraint values, not by any flow logic.
 *
 * The composite algorithm is the "container" algorithm: it delegates
 * all positioning decisions to the constraint solver. Children must have
 * their positions fully specified by constraints (2 of 4 per axis).
 *
 * When constraints don't fully specify a child's position, defaults are:
 * - Position: (0, 0) if left/top not specified
 * - Size: parent bounds if width/height not specified
 *
 * Supports the `ar` (aspect ratio) parameter to enforce proportional sizing.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.1 (Composite Algorithm)
 * @module composite
 */

import type { AlgorithmTypeValue } from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type { ResolvedConstraints } from '../constraints/constraint-evaluator';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedShape,
} from './algorithm-types';

// =============================================================================
// Constants
// =============================================================================

/** Default position when constraints don't specify l or t. */
const DEFAULT_POSITION = 0;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Get a numeric value from resolved constraints.
 *
 * @param resolved - The resolved constraints for a node
 * @param key - The constraint type key (e.g., 'l', 't', 'w', 'h')
 * @returns The resolved value, or undefined if not set
 */
function getConstraintValue(
  resolved: ResolvedConstraints | undefined,
  key: string,
): number | undefined {
  if (!resolved) return undefined;
  return resolved.values.get(key);
}

/**
 * Apply aspect ratio enforcement to a shape's dimensions.
 *
 * If the ar parameter is set, the shape's dimensions are adjusted
 * to maintain the specified aspect ratio (width / height).
 *
 * The algorithm preserves the constraint-specified dimension and
 * adjusts the other. If both are specified, the larger is shrunk.
 *
 * @param width - The current width
 * @param height - The current height
 * @param ar - The target aspect ratio (width / height)
 * @returns Adjusted [width, height] tuple
 */
function applyAspectRatio(width: number, height: number, ar: number): [number, number] {
  if (ar <= 0 || !isFinite(ar)) return [width, height];
  if (width <= 0 || height <= 0) return [width, height];

  const currentAr = width / height;
  if (Math.abs(currentAr - ar) < 0.001) return [width, height];

  // If current AR is wider than target, shrink width
  if (currentAr > ar) {
    return [height * ar, height];
  }
  // If current AR is taller than target, shrink height
  return [width, width / ar];
}

/**
 * Create a positioned shape from a child node instance and its resolved constraints.
 *
 * @param child - The child layout node instance
 * @param childResolved - Resolved constraints for this child
 * @param selfResolved - Resolved constraints for the parent (self) scope
 * @param bounds - Parent bounds
 * @param ar - Aspect ratio parameter value (if any)
 * @returns A positioned shape, or null if the child has no renderable shape
 */
function createShapeFromChild(
  child: LayoutNodeInstance,
  childResolved: ResolvedConstraints | undefined,
  selfResolved: ResolvedConstraints,
  bounds: { width: number; height: number },
  ar: number | undefined,
): PositionedShape | null {
  // Get position and size from constraints
  let x = getConstraintValue(childResolved, 'l') ?? DEFAULT_POSITION;
  let y = getConstraintValue(childResolved, 't') ?? DEFAULT_POSITION;
  let w = getConstraintValue(childResolved, 'w') ?? bounds.width;
  let h = getConstraintValue(childResolved, 'h') ?? bounds.height;

  // Also check self-resolved values with child name prefix
  if (childResolved === undefined && child.name) {
    const prefixedL = selfResolved.values.get(`${child.name}:l`);
    const prefixedT = selfResolved.values.get(`${child.name}:t`);
    const prefixedW = selfResolved.values.get(`${child.name}:w`);
    const prefixedH = selfResolved.values.get(`${child.name}:h`);
    if (prefixedL !== undefined) x = prefixedL;
    if (prefixedT !== undefined) y = prefixedT;
    if (prefixedW !== undefined) w = prefixedW;
    if (prefixedH !== undefined) h = prefixedH;
  }

  // Check ctrX/ctrY for center-based positioning
  const ctrX = getConstraintValue(childResolved, 'ctrX');
  const ctrY = getConstraintValue(childResolved, 'ctrY');
  if (ctrX !== undefined) {
    x = ctrX - w / 2;
  }
  if (ctrY !== undefined) {
    y = ctrY - h / 2;
  }

  // Apply aspect ratio if specified
  if (ar !== undefined) {
    [w, h] = applyAspectRatio(w, h, ar);
  }

  // Determine shape type
  const shapeType = child.shape?.type ?? 'rect';

  // Skip hidden geometry shapes that have no text
  if (child.shape?.hideGeom && !child.text) {
    return null;
  }

  return {
    modelId: child.dataPointId,
    shapeType,
    x,
    y,
    width: w,
    height: h,
    styleLbl: child.styleLbl,
    text: child.text,
    adjustments: child.shape?.adjustments,
  };
}

// =============================================================================
// Composite Algorithm
// =============================================================================

/**
 * Composite layout algorithm.
 *
 * Positions children using constraint-resolved absolute positions.
 * Each child's position comes from its resolved constraint values
 * (l, t, w, h). The constraint solver handles the mathematical
 * resolution of constraint chains and dependencies.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.1 (Composite Algorithm)
 */
export class CompositeAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.composite;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, params, constraints } = context;
    const shapes: PositionedShape[] = [];

    // Parse aspect ratio parameter
    const arParam = params.get('ar');
    const ar = arParam !== undefined ? parseFloat(arParam) : undefined;

    // Resolve child positions from constraints
    // The composite algorithm relies entirely on constraints for positioning.
    // Each child should have its l, t, w, h set by constraints.
    const childConstraintMap = new Map<string, ResolvedConstraints>();

    // Build per-child resolved constraints from the parent's constraint values
    for (const child of children) {
      if (!child.name) continue;

      const childResolved: ResolvedConstraints = { values: new Map() };

      // Look for constraints targeting this child by name (forName pattern)
      // These are stored as "childName:constraintType" keys in the parent's constraints
      for (const [key, value] of constraints.values) {
        const prefix = `${child.name}:`;
        if (key.startsWith(prefix)) {
          const constraintType = key.substring(prefix.length);
          childResolved.values.set(constraintType, value);
        }
      }

      // Also look for direct constraint types if child name matches
      // This handles cases where constraints target children by scope (for='ch')
      childConstraintMap.set(child.name, childResolved);
    }

    // Track the bounding box of all placed shapes
    let maxRight = 0;
    let maxBottom = 0;

    // Create shapes for each child
    for (const child of children) {
      const childResolved = child.name ? childConstraintMap.get(child.name) : undefined;

      const shape = createShapeFromChild(child, childResolved, constraints, bounds, ar);

      if (shape) {
        shapes.push(shape);
        maxRight = Math.max(maxRight, shape.x + shape.width);
        maxBottom = Math.max(maxBottom, shape.y + shape.height);
      }
    }

    return {
      shapes,
      connectors: [],
      usedBounds: {
        width: maxRight > 0 ? maxRight : bounds.width,
        height: maxBottom > 0 ? maxBottom : bounds.height,
      },
    };
  }
}

/**
 * Create a new CompositeAlgorithm instance.
 */
export function createCompositeAlgorithm(): CompositeAlgorithm {
  return new CompositeAlgorithm();
}
