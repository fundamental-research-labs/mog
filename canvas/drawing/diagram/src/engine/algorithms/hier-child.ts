/**
 * Hierarchy Child Algorithm
 *
 * Positions child nodes in a linear arrangement under a root node.
 * Used in combination with hier-root to create tree layouts. Children
 * are arranged along a primary linear direction with cross-axis alignment.
 *
 * Parameters:
 * - chAlign: Cross-axis alignment (l, r, t, b)
 * - linDir: Primary linear direction (fromL, fromR, fromT, fromB)
 * - secChAlign: Secondary child alignment for sub-branches
 * - secLinDir: Secondary linear direction for sub-branches
 *
 * @see ECMA-376 Part 1, Section 21.4.4.6 (Hierarchy Child Algorithm)
 * @module hier-child
 */

import type {
  AlgorithmTypeValue,
  ChildAlignmentValue,
  HierChildAlgorithmParams,
  LinearDirectionValue,
} from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  PositionedShape,
} from './algorithm-types';
import { getOptionalTypedParam } from './param-utils';

// =============================================================================
// Types — local definitions compatible with algorithm-types.ts (will be
// replaced with import from algorithm-types.ts when that file is created)
// =============================================================================

/**
 * Axis-aligned bounding box for layout computation.
 */
export interface LayoutBounds {
  /** Left edge x coordinate */
  readonly x: number;
  /** Top edge y coordinate */
  readonly y: number;
  /** Width of the bounds */
  readonly w: number;
  /** Height of the bounds */
  readonly h: number;
}

/**
 * Result of positioning a single child node.
 */
export interface HierChildPosition {
  /** Index of the child in the original children array */
  readonly index: number;
  /** Computed x coordinate (left edge) */
  readonly x: number;
  /** Computed y coordinate (top edge) */
  readonly y: number;
  /** Width of the child */
  readonly w: number;
  /** Height of the child */
  readonly h: number;
}

/**
 * Result of running the hierChild algorithm.
 */
export interface HierChildAlgorithmResult {
  /** Positioned children */
  readonly positions: readonly HierChildPosition[];
  /** Total bounds occupied by all positioned children */
  readonly totalBounds: LayoutBounds;
  /** Whether the primary flow is horizontal */
  readonly isHorizontal: boolean;
}

/**
 * Input describing a child to be positioned by the algorithm.
 * Each child represents either a leaf node or a sub-branch with its own size.
 */
export interface ChildInput {
  /** Desired width of this child (or sub-branch bounding box width) */
  readonly w: number;
  /** Desired height of this child (or sub-branch bounding box height) */
  readonly h: number;
}

// =============================================================================
// Default Parameter Values
// =============================================================================

const DEFAULT_LIN_DIR: LinearDirectionValue = 'fromL';
const DEFAULT_CH_ALIGN: ChildAlignmentValue = 't';
const DEFAULT_SEC_LIN_DIR: LinearDirectionValue = 'fromL';
const DEFAULT_SEC_CH_ALIGN: ChildAlignmentValue = 't';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Determine if a linear direction flows horizontally.
 */
function isHorizontalDirection(linDir: LinearDirectionValue): boolean {
  return linDir === 'fromL' || linDir === 'fromR';
}

/**
 * Determine if a linear direction flows in the positive direction.
 * fromL and fromT are "positive" (increasing x or y).
 * fromR and fromB are "negative" (decreasing x or y).
 */
function isPositiveDirection(linDir: LinearDirectionValue): boolean {
  return linDir === 'fromL' || linDir === 'fromT';
}

/**
 * Compute the cross-axis position of a child based on alignment.
 *
 * @param childSize - Size of the child on the cross-axis
 * @param availableSize - Available size on the cross-axis
 * @param boundsStart - Start position of the available bounds on the cross-axis
 * @param chAlign - Alignment value
 * @param isHorizontal - Whether the primary flow is horizontal
 * @returns The cross-axis position
 */
function computeCrossAxisPosition(
  childSize: number,
  availableSize: number,
  boundsStart: number,
  chAlign: ChildAlignmentValue,
  isHorizontal: boolean,
): number {
  // For horizontal flow, cross-axis is vertical (t/b alignment)
  // For vertical flow, cross-axis is horizontal (l/r alignment)
  if (isHorizontal) {
    switch (chAlign) {
      case 't':
        return boundsStart;
      case 'b':
        return boundsStart + availableSize - childSize;
      case 'l':
        return boundsStart;
      case 'r':
        return boundsStart + availableSize - childSize;
      default:
        return boundsStart;
    }
  } else {
    switch (chAlign) {
      case 'l':
        return boundsStart;
      case 'r':
        return boundsStart + availableSize - childSize;
      case 't':
        return boundsStart;
      case 'b':
        return boundsStart + availableSize - childSize;
      default:
        return boundsStart;
    }
  }
}

// =============================================================================
// Hierarchy Child Algorithm
// =============================================================================

/**
 * Execute the hierarchy child layout algorithm.
 *
 * Arranges children along a primary linear direction with cross-axis
 * alignment. Used to position child branches under a hierarchy root node.
 *
 * @param children - Array of child inputs with desired sizes
 * @param bounds - The available layout bounds (the child region from hierRoot)
 * @param params - HierChild algorithm parameters
 * @param spacing - Spacing between children (default 0)
 * @returns Positioned children and total bounds
 */
export function executeHierChildAlgorithm(
  children: readonly ChildInput[],
  bounds: LayoutBounds,
  params: HierChildAlgorithmParams = {},
  spacing: number = 0,
): HierChildAlgorithmResult {
  if (children.length === 0) {
    return {
      positions: [],
      totalBounds: { x: bounds.x, y: bounds.y, w: 0, h: 0 },
      isHorizontal: isHorizontalDirection(params.linDir ?? DEFAULT_LIN_DIR),
    };
  }

  // Resolve parameters
  const linDir = params.linDir ?? DEFAULT_LIN_DIR;
  const chAlign = params.chAlign ?? DEFAULT_CH_ALIGN;

  const horizontal = isHorizontalDirection(linDir);
  const positive = isPositiveDirection(linDir);

  const positions: HierChildPosition[] = [];

  // Compute total primary axis length
  let totalPrimary = 0;
  for (let i = 0; i < children.length; i++) {
    const primarySize = horizontal ? children[i].w : children[i].h;
    totalPrimary += primarySize + (i > 0 ? spacing : 0);
  }

  // Determine starting primary offset
  let primaryOffset: number;
  if (positive) {
    primaryOffset = horizontal ? bounds.x : bounds.y;
  } else {
    // Start from the far end and go backward
    primaryOffset = horizontal ? bounds.x + bounds.w : bounds.y + bounds.h;
  }

  // Lay out children along the primary direction
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const primarySize = horizontal ? child.w : child.h;
    const crossSize = horizontal ? child.h : child.w;

    // Compute primary axis position
    let primaryPos: number;
    if (positive) {
      primaryPos = primaryOffset;
      primaryOffset += primarySize + spacing;
    } else {
      primaryOffset -= primarySize;
      primaryPos = primaryOffset;
      primaryOffset -= spacing;
    }

    // Compute cross-axis position
    let crossPos: number;
    if (horizontal) {
      crossPos = computeCrossAxisPosition(crossSize, bounds.h, bounds.y, chAlign, horizontal);
    } else {
      crossPos = computeCrossAxisPosition(crossSize, bounds.w, bounds.x, chAlign, horizontal);
    }

    // Construct the position
    const x = horizontal ? primaryPos : crossPos;
    const y = horizontal ? crossPos : primaryPos;

    positions.push({
      index: i,
      x,
      y,
      w: child.w,
      h: child.h,
    });
  }

  // Compute total bounds from all positioned children
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.w);
    maxY = Math.max(maxY, pos.y + pos.h);
  }

  return {
    positions,
    totalBounds: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
    isHorizontal: horizontal,
  };
}

/**
 * Execute the hierarchy child algorithm with secondary parameters.
 *
 * This is used when a tree has sub-branches that need different layout
 * parameters than the primary children. The secondary parameters override
 * the primary ones for the sub-branch layout.
 *
 * @param children - Array of child inputs (sub-branches)
 * @param bounds - The available layout bounds
 * @param params - HierChild algorithm parameters (both primary and secondary)
 * @param spacing - Spacing between children (default 0)
 * @returns Positioned children using secondary parameters
 */
export function executeHierChildSecondaryAlgorithm(
  children: readonly ChildInput[],
  bounds: LayoutBounds,
  params: HierChildAlgorithmParams = {},
  spacing: number = 0,
): HierChildAlgorithmResult {
  // Use secondary parameters, falling back to primary, then defaults
  const secLinDir = params.secLinDir ?? params.linDir ?? DEFAULT_SEC_LIN_DIR;
  const secChAlign = params.secChAlign ?? params.chAlign ?? DEFAULT_SEC_CH_ALIGN;

  return executeHierChildAlgorithm(
    children,
    bounds,
    { linDir: secLinDir, chAlign: secChAlign },
    spacing,
  );
}

// =============================================================================
// ILayoutAlgorithm Implementation
// =============================================================================

/**
 * OOXML Hierarchy Child layout algorithm implementing the ILayoutAlgorithm interface.
 *
 * Wraps the standalone `executeHierChildAlgorithm` function to conform to
 * the unified algorithm interface. Maps AlgorithmContext fields to the
 * existing function parameters and converts the result to AlgorithmResult.
 *
 * The hierChild algorithm arranges child nodes in a linear direction under
 * a hierarchy root node.
 */
export class HierChildAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.hierChild;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, constraints, params } = context;

    // Extract spacing from resolved constraints
    const spacing = constraints.values.get('sp') ?? 0;
    const sibSpacing = constraints.values.get('sibSp') ?? spacing;

    // Build HierChildAlgorithmParams from the generic params map
    const VALID_CH_ALIGN = new Set<ChildAlignmentValue>(['t', 'b', 'l', 'r']);
    const VALID_LIN_DIR = new Set<LinearDirectionValue>(['fromL', 'fromR', 'fromT', 'fromB']);
    const hierChildParams: HierChildAlgorithmParams = {
      chAlign: getOptionalTypedParam(params, 'chAlign', VALID_CH_ALIGN),
      linDir: getOptionalTypedParam(params, 'linDir', VALID_LIN_DIR),
      secChAlign: getOptionalTypedParam(params, 'secChAlign', VALID_CH_ALIGN),
      secLinDir: getOptionalTypedParam(params, 'secLinDir', VALID_LIN_DIR),
    };

    // Map children to ChildInput format
    // For hier-child, the primary axis is divided among children, but the
    // cross-axis should use the full available size.
    const linDir = hierChildParams.linDir ?? 'fromL';
    const isHorizontalFlow = linDir === 'fromL' || linDir === 'fromR';
    const childInputs: ChildInput[] = children.map((child) => {
      const w =
        constraints.values.get(`${child.name}:w`) ??
        (isHorizontalFlow ? bounds.width / Math.max(children.length, 1) : bounds.width);
      const h =
        constraints.values.get(`${child.name}:h`) ??
        (isHorizontalFlow ? bounds.height : bounds.height / Math.max(children.length, 1));
      return { w, h };
    });

    // Map bounds to LayoutBounds format
    const layoutBounds: LayoutBounds = {
      x: 0,
      y: 0,
      w: bounds.width,
      h: bounds.height,
    };

    // Execute the standalone algorithm
    const result = executeHierChildAlgorithm(
      childInputs,
      layoutBounds,
      hierChildParams,
      sibSpacing,
    );

    // Convert to PositionedShape array
    const shapes: PositionedShape[] = result.positions.map((pos) => {
      const child = children[pos.index];
      return {
        modelId: child.dataPointId ?? child.presOfId,
        shapeType: child.shape?.type ?? 'rect',
        x: pos.x,
        y: pos.y,
        width: pos.w,
        height: pos.h,
        styleLbl: child.styleLbl,
        text: child.text,
      };
    });

    return {
      shapes,
      connectors: [],
      usedBounds: {
        width: result.totalBounds.w,
        height: result.totalBounds.h,
      },
    };
  }
}

/**
 * Create a new HierChildAlgorithm instance.
 */
export function createHierChildAlgorithm(): HierChildAlgorithm {
  return new HierChildAlgorithm();
}
