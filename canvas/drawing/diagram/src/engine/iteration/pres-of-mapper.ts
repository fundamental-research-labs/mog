/**
 * PresOf Mapper — Maps data model points to layout nodes.
 *
 * The presOf element in a layout node specifies which data model point(s)
 * provide text content for the shape. It navigates from the current context
 * point using an axis and ptType filter to determine which data model points
 * are associated with a given layout node.
 *
 * This mapping determines:
 * - Which text content appears in which shape
 * - Whether a shape has data at all (empty shapes for missing mappings)
 *
 * @module pres-of-mapper
 */

import { DataModel, DataModelPoint } from '../data-model';
import { navigateAxis } from './axis-navigator';

// ============================================================================
// PresOf Definition (local type matching OOXML structure)
// ============================================================================

/**
 * PresOf specification from a layout node.
 * Describes how to map data model points to this layout node.
 */
export interface PresOfSpec {
  /** Axis for navigation from context point */
  readonly axis: string;

  /** Point type filter */
  readonly ptType: string;

  /** Maximum count (0 = no limit) */
  readonly cnt: number;

  /** Starting index (1-based) */
  readonly st: number;

  /** Step value */
  readonly step: number;

  /** Whether to hide the last sibling transition */
  readonly hideLastTrans: boolean;
}

// ============================================================================
// PresOf Mapper
// ============================================================================

/**
 * Resolve a presOf mapping to find matching data model points.
 *
 * Navigates from the context point using the presOf's axis and ptType
 * parameters to determine which data model points are associated with
 * a given layout node.
 *
 * @param presOf - The presOf specification
 * @param dataModel - The data model to navigate
 * @param contextPoint - The current context point (from forEach iteration)
 * @returns Array of matching data model points
 */
export function resolvePresOf(
  presOf: PresOfSpec,
  dataModel: DataModel,
  contextPoint: DataModelPoint,
): DataModelPoint[] {
  // If no axis specified, default to self
  const axis = presOf.axis || 'self';
  const ptType = presOf.ptType || 'all';

  return navigateAxis(dataModel, contextPoint.modelId, axis, ptType, {
    cnt: presOf.cnt,
    st: presOf.st,
    step: presOf.step,
    hideLastTrans: presOf.hideLastTrans,
  });
}

/**
 * Create a default presOf spec that maps to self.
 *
 * @param overrides - Optional overrides for individual fields
 * @returns A PresOfSpec
 */
export function createDefaultPresOfSpec(overrides?: Partial<PresOfSpec>): PresOfSpec {
  return {
    axis: overrides?.axis ?? 'self',
    ptType: overrides?.ptType ?? 'all',
    cnt: overrides?.cnt ?? 0,
    st: overrides?.st ?? 1,
    step: overrides?.step ?? 1,
    hideLastTrans: overrides?.hideLastTrans ?? true,
  };
}
