/**
 * Axis Navigator — Wraps DataModel navigation with OOXML forEach/presOf semantics.
 *
 * Provides higher-level navigation that supports:
 * - Space-separated chained axes ("ch ch" = grandchildren)
 * - Space-separated ptType multi-filtering ("node asst" = nodes and assistants)
 * - Subsequence control: cnt, st, step for selecting subsets
 * - hideLastTrans parameter to suppress the last sibling transition
 *
 * All functions are pure and delegate to DataModel's navigation API.
 *
 * @module axis-navigator
 */

import { DataModel, DataModelPoint, ST_AxisType, ST_ElementType } from '../data-model';
import { matchesElementType } from '../element-type-utils';

// ============================================================================
// Navigation Options
// ============================================================================

/**
 * Options for axis navigation that mirror OOXML forEach/presOf attributes.
 */
export interface NavigationOptions {
  /**
   * Maximum count of points to return.
   * 0 means no limit. Defaults to 0.
   */
  readonly cnt?: number;

  /**
   * Starting index (1-based) for the subsequence.
   * Defaults to 1.
   */
  readonly st?: number;

  /**
   * Step value for iteration.
   * 1 = every item, 2 = every other item, etc.
   * Defaults to 1.
   */
  readonly step?: number;

  /**
   * Whether to hide the last sibling transition node from results.
   * When true and the last result is a sibTrans, it is removed.
   * Defaults to true.
   */
  readonly hideLastTrans?: boolean;
}

// ============================================================================
// Axis Spec Parsing
// ============================================================================

/** Valid single axis types for validation */
const VALID_AXES = new Set<string>([
  'self',
  'ch',
  'des',
  'desOrSelf',
  'par',
  'ancst',
  'ancstOrSelf',
  'followSib',
  'precedSib',
  'follow',
  'preced',
  'root',
  'none',
]);

/** Valid single element types for validation */
const VALID_ELEMENT_TYPES = new Set<string>([
  'all',
  'doc',
  'node',
  'norm',
  'nonNorm',
  'asst',
  'nonAsst',
  'parTrans',
  'pres',
  'sibTrans',
]);

/**
 * Parse a space-separated axis spec into individual axis types.
 *
 * @param axisSpec - Space-separated axis types (e.g., "ch ch", "des", "ch des")
 * @returns Array of parsed ST_AxisType values. Invalid entries are skipped.
 */
export function parseAxisSpec(axisSpec: string): ST_AxisType[] {
  if (!axisSpec || axisSpec.trim() === '') return [];

  const parts = axisSpec.trim().split(/\s+/);
  const result: ST_AxisType[] = [];

  for (const part of parts) {
    if (VALID_AXES.has(part)) {
      result.push(part as ST_AxisType);
    }
  }

  return result;
}

/**
 * Parse a space-separated ptType spec into individual element types.
 *
 * @param ptTypeSpec - Space-separated element types (e.g., "node asst", "parTrans sibTrans")
 * @returns Array of parsed ST_ElementType values. Invalid entries are skipped.
 */
export function parsePtTypeSpec(ptTypeSpec: string): ST_ElementType[] {
  if (!ptTypeSpec || ptTypeSpec.trim() === '') return [];

  const parts = ptTypeSpec.trim().split(/\s+/);
  const result: ST_ElementType[] = [];

  for (const part of parts) {
    if (VALID_ELEMENT_TYPES.has(part)) {
      result.push(part as ST_ElementType);
    }
  }

  return result;
}

// ============================================================================
// Multi-Type Filtering
// ============================================================================

/**
 * Filter points matching ANY of multiple element types (OR logic).
 *
 * When ptTypes contains 'all', no filtering is applied.
 * When ptTypes is empty because no spec was given, no filtering is applied.
 * When ptTypes is empty because all values in the spec were invalid,
 * returns an empty array (restrictive behavior for invalid filters).
 *
 * @param points - Points to filter
 * @param ptTypes - Array of element types to match (OR logic)
 * @param hadSpec - Whether a non-empty ptType spec was originally provided
 * @returns Filtered points
 */
function filterByMultiPtType(
  points: DataModelPoint[],
  ptTypes: ST_ElementType[],
  hadSpec: boolean = false,
): DataModelPoint[] {
  // 'all' present means no filtering
  if (ptTypes.includes('all')) return points;

  // Empty ptTypes: if a spec was given but parsed to empty (all invalid),
  // return empty (restrictive). If no spec was given, return all (no filter).
  if (ptTypes.length === 0) {
    return hadSpec ? [] : points;
  }

  // Single type: use single-type filtering logic
  if (ptTypes.length === 1) {
    return filterBySingleElementType(points, ptTypes[0]);
  }

  // Multiple types: match any
  return points.filter((p) => {
    for (const ptType of ptTypes) {
      if (matchesElementType(p, ptType)) return true;
    }
    return false;
  });
}

// matchesElementType is imported from ../element-type-utils (shared implementation)

/**
 * Filter points by a single element type.
 */
function filterBySingleElementType(
  points: DataModelPoint[],
  elementType: ST_ElementType,
): DataModelPoint[] {
  if (elementType === 'all') return points;
  return points.filter((p) => matchesElementType(p, elementType));
}

// ============================================================================
// Subsequence Selection
// ============================================================================

/**
 * Apply cnt, st, step subsequence selection to an array of points.
 *
 * @param points - Full array of matched points
 * @param st - 1-based start index (default 1)
 * @param step - Step value (default 1)
 * @param cnt - Max count, 0 = no limit (default 0)
 * @returns Subsequence of points
 */
export function applySubsequence(
  points: DataModelPoint[],
  st: number = 1,
  step: number = 1,
  cnt: number = 0,
): DataModelPoint[] {
  if (points.length === 0) return [];

  const effectiveSt = Math.max(1, st);
  const effectiveStep = Math.max(1, step);

  const result: DataModelPoint[] = [];

  // Start at (st - 1) because st is 1-based
  const startIndex = effectiveSt - 1;

  for (let i = startIndex; i < points.length; i += effectiveStep) {
    result.push(points[i]);
    if (cnt > 0 && result.length >= cnt) break;
  }

  return result;
}

// ============================================================================
// hideLastTrans Logic
// ============================================================================

/**
 * If hideLastTrans is true and the last point in the array is a sibTrans,
 * remove it.
 *
 * @param points - Array of points
 * @param hideLastTrans - Whether to hide the last transition
 * @returns Points with last sibTrans removed if applicable
 */
function applyHideLastTrans(points: DataModelPoint[], hideLastTrans: boolean): DataModelPoint[] {
  if (!hideLastTrans || points.length === 0) return points;

  const lastPoint = points[points.length - 1];
  if (lastPoint.type === 'sibTrans') {
    return points.slice(0, -1);
  }

  return points;
}

// ============================================================================
// Main Navigation Function
// ============================================================================

/**
 * Navigate the data model from a starting point using OOXML axis/ptType specs.
 *
 * This is the primary navigation function used by forEach, presOf, and choose/if.
 * It supports all OOXML navigation features:
 * - Chained axes (space-separated)
 * - Multi-type ptType filtering (space-separated)
 * - Subsequence selection (cnt, st, step)
 * - Last transition hiding (hideLastTrans)
 *
 * @param dataModel - The data model to navigate
 * @param fromPointId - Starting point's model ID
 * @param axisSpec - Space-separated axis types (e.g., "ch", "ch ch", "des")
 * @param ptTypeSpec - Space-separated element type filters (e.g., "node", "node asst")
 * @param options - Optional subsequence and hideLastTrans parameters
 * @returns Array of matching data model points
 */
export function navigateAxis(
  dataModel: DataModel,
  fromPointId: string,
  axisSpec: string,
  ptTypeSpec: string = 'all',
  options?: NavigationOptions,
): DataModelPoint[] {
  // Parse axis and ptType specs
  const axes = parseAxisSpec(axisSpec);
  const ptTypes = parsePtTypeSpec(ptTypeSpec);

  if (axes.length === 0) return [];

  // Step 1: Navigate along chained axes (no ptType filtering during chaining)
  let results: DataModelPoint[];

  if (axes.length === 1) {
    // Single axis: simple navigate
    results = dataModel.navigate(fromPointId, axes[0]);
  } else {
    // Chained axes: navigate sequentially
    // For chained navigation, we DON'T apply ptType filter at each step.
    // We navigate all axes, then apply ptType filter at the end.
    results = dataModel.navigateChained(fromPointId, axes);
  }

  // Step 2: Apply hideLastTrans BEFORE ptType filtering
  // In OOXML, hideLastTrans removes the last sibling transition from the
  // full navigation result set, before any ptType filtering is applied.
  const hideLastTrans = options?.hideLastTrans ?? true;
  results = applyHideLastTrans(results, hideLastTrans);

  // Step 3: Apply ptType filtering
  // Pass hadSpec=true when the caller provided a non-empty ptTypeSpec,
  // so that invalid specs (parsed to empty) are restrictive (return []).
  const hadSpec =
    ptTypeSpec !== undefined && ptTypeSpec.trim() !== '' && ptTypeSpec.trim() !== 'all';
  results = filterByMultiPtType(results, ptTypes, hadSpec);

  // Step 4: Apply subsequence selection (cnt, st, step)
  const st = options?.st ?? 1;
  const step = options?.step ?? 1;
  const cnt = options?.cnt ?? 0;

  if (st !== 1 || step !== 1 || cnt !== 0) {
    results = applySubsequence(results, st, step, cnt);
  }

  return results;
}
