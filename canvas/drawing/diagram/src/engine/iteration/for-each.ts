/**
 * ForEach Executor — Iterates over data model points and instantiates
 * child layout nodes for each matching point.
 *
 * The forEach element is the primary mechanism for data-driven layout
 * in OOXML Diagram. It navigates from a context point along an axis,
 * filters by point type, and for each result creates an iteration
 * with the child templates.
 *
 * Features:
 * - Axis navigation using the axis navigator
 * - Point type filtering
 * - Subsequence selection (cnt, st, step)
 * - hideLastTrans support
 * - Nested forEach support (context narrows with each level)
 * - ref attribute (reuse another forEach's definition)
 *
 * @module for-each
 */

import { DataModel, DataModelPoint } from '../data-model';
import { navigateAxis } from './axis-navigator';

import type {
  ForEach,
  IterationContext,
  LayoutNodeChild,
  VariableList,
} from '@mog-sdk/contracts/diagram';

// ============================================================================
// ForEach Result Types
// ============================================================================

/**
 * A single iteration result — one entry per matched data point.
 */
export interface ForEachIteration {
  /** The data point this iteration is for */
  readonly dataPoint: DataModelPoint;

  /** The iteration context (position, count, depth, variables) */
  readonly context: IterationContext;

  /** The forEach's child templates, ready for further processing */
  readonly children: readonly LayoutNodeChild[];
}

/**
 * Result of executing a forEach element.
 */
export interface ForEachResult {
  /** One entry per matched data point */
  readonly iterations: readonly ForEachIteration[];
}

// ============================================================================
// ForEach Registry (for ref lookups)
// ============================================================================

/**
 * A registry mapping forEach names to their definitions.
 * Used for resolving `ref` attributes on forEach elements.
 */
export type ForEachRegistry = ReadonlyMap<string, ForEach>;

// ============================================================================
// ForEach Executor
// ============================================================================

/**
 * Execute a forEach element against the data model.
 *
 * Navigates from the context point along the forEach's axis, filters by
 * ptType, applies subsequence parameters, and creates an iteration entry
 * for each matching data point.
 *
 * @param forEach - The forEach element to execute
 * @param dataModel - The data model to navigate
 * @param contextPoint - The current context point (starting point for navigation)
 * @param parentContext - The parent iteration context (for nested forEach)
 * @param variables - Current variable list
 * @param registry - Optional registry for resolving ref attributes
 * @returns ForEachResult with one iteration per matched point
 */
export function executeForEach(
  forEach: ForEach,
  dataModel: DataModel,
  contextPoint: DataModelPoint,
  _parentContext: IterationContext,
  variables: VariableList,
  registry?: ForEachRegistry,
): ForEachResult {
  // Resolve ref if present
  const resolved = resolveForEachRef(forEach, registry);

  // Navigate to matching points
  const matchedPoints = navigateAxis(
    dataModel,
    contextPoint.modelId,
    resolved.axis,
    resolved.ptType,
    {
      cnt: resolved.cnt,
      st: resolved.st,
      step: resolved.step,
      hideLastTrans: resolved.hideLastTrans,
    },
  );

  // Create iterations
  const iterations: ForEachIteration[] = [];
  const count = matchedPoints.length;

  for (let i = 0; i < matchedPoints.length; i++) {
    const dataPoint = matchedPoints[i];
    const position = i + 1; // 1-based position

    const context: IterationContext = {
      currentPoint: dataPoint.modelId,
      position,
      count,
      depth: dataModel.getDepth(dataPoint.modelId),
      variables,
    };

    iterations.push({
      dataPoint,
      context,
      children: resolved.children,
    });
  }

  return { iterations };
}

// ============================================================================
// Ref Resolution
// ============================================================================

/**
 * Resolve a forEach's ref attribute if present.
 *
 * When a forEach has a `ref` attribute, it reuses the referenced forEach's
 * axis, ptType, cnt, st, step, hideLastTrans, and children. The current
 * forEach's own name is preserved.
 *
 * @param forEach - The forEach element
 * @param registry - Optional registry for ref lookup
 * @returns The resolved forEach (either original or referenced)
 */
function resolveForEachRef(forEach: ForEach, registry?: ForEachRegistry): ForEach {
  if (!forEach.ref || !registry) {
    return forEach;
  }

  const referenced = registry.get(forEach.ref);
  if (!referenced) {
    // If ref not found, use the forEach as-is
    return forEach;
  }

  // Use referenced forEach's properties, but keep original's name
  return {
    ...referenced,
    name: forEach.name || referenced.name,
  };
}
