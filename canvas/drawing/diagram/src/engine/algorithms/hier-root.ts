/**
 * Hierarchy Root Algorithm
 *
 * Positions the root node of a hierarchy relative to its subtree children.
 * Used in combination with hier-child to build tree layouts. The root node
 * is placed on one side of the subtree (top, bottom, left, or right) and
 * aligned according to the hierAlign parameter.
 *
 * Parameters:
 * - hierAlign: 16 values controlling tree orientation and alignment
 * - nodeHorzAlign: Horizontal alignment of the root node (l, ctr, r)
 * - nodeVertAlign: Vertical alignment of the root node (t, mid, b)
 * - rtShortDist: Minimum short-axis distance between root and children
 *
 * @see ECMA-376 Part 1, Section 21.4.4.5 (Hierarchy Root Algorithm)
 * @module hier-root
 */

import type {
  AlgorithmTypeValue,
  HierRootAlgorithmParams,
  HierarchyAlignmentValue,
  HorizontalAlignmentValue,
  VerticalAlignmentValue,
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
 * The positioned root node result.
 */
export interface RootPosition {
  /** Computed x coordinate (left edge) */
  readonly x: number;
  /** Computed y coordinate (top edge) */
  readonly y: number;
  /** Width of the root node */
  readonly w: number;
  /** Height of the root node */
  readonly h: number;
}

/**
 * The computed region reserved for child subtrees.
 */
export interface ChildRegion {
  /** Left edge x coordinate */
  readonly x: number;
  /** Top edge y coordinate */
  readonly y: number;
  /** Width of the child region */
  readonly w: number;
  /** Height of the child region */
  readonly h: number;
}

/**
 * Result of running the hierRoot algorithm.
 */
export interface HierRootAlgorithmResult {
  /** Position of the root node */
  readonly rootPosition: RootPosition;
  /** Region reserved for child subtrees */
  readonly childRegion: ChildRegion;
  /** The side of the tree where the root is placed */
  readonly rootSide: 'top' | 'bottom' | 'left' | 'right';
  /** The alignment of the root on its side */
  readonly rootAlignment: 'start' | 'end' | 'centerChildren' | 'centerDescendants';
}

/**
 * Input describing the root node.
 */
export interface RootInput {
  /** Desired width of the root node */
  readonly w: number;
  /** Desired height of the root node */
  readonly h: number;
}

/**
 * Input describing the subtree bounding box (all children combined).
 */
export interface SubtreeInput {
  /** Total width of the subtree */
  readonly w: number;
  /** Total height of the subtree */
  readonly h: number;
}

// =============================================================================
// Default Parameter Values
// =============================================================================

const DEFAULT_HIER_ALIGN: HierarchyAlignmentValue = 'tCtrCh';
const DEFAULT_NODE_HORZ_ALIGN: HorizontalAlignmentValue = 'ctr';
const DEFAULT_NODE_VERT_ALIGN: VerticalAlignmentValue = 'mid';
const DEFAULT_RT_SHORT_DIST = 0;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Parse the hierAlign value into its component parts.
 *
 * hierAlign values encode two pieces of information:
 * 1. Which side the root goes on (t=top, b=bottom, l=left, r=right)
 * 2. How the root aligns on that side (L/T=start, R/B=end, CtrCh=center-children, CtrDes=center-descendants)
 */
interface HierAlignParts {
  readonly side: 'top' | 'bottom' | 'left' | 'right';
  readonly alignment: 'start' | 'end' | 'centerChildren' | 'centerDescendants';
}

function parseHierAlign(hierAlign: HierarchyAlignmentValue): HierAlignParts {
  switch (hierAlign) {
    // Top side
    case 'tL':
      return { side: 'top', alignment: 'start' };
    case 'tR':
      return { side: 'top', alignment: 'end' };
    case 'tCtrCh':
      return { side: 'top', alignment: 'centerChildren' };
    case 'tCtrDes':
      return { side: 'top', alignment: 'centerDescendants' };

    // Bottom side
    case 'bL':
      return { side: 'bottom', alignment: 'start' };
    case 'bR':
      return { side: 'bottom', alignment: 'end' };
    case 'bCtrCh':
      return { side: 'bottom', alignment: 'centerChildren' };
    case 'bCtrDes':
      return { side: 'bottom', alignment: 'centerDescendants' };

    // Left side
    case 'lT':
      return { side: 'left', alignment: 'start' };
    case 'lB':
      return { side: 'left', alignment: 'end' };
    case 'lCtrCh':
      return { side: 'left', alignment: 'centerChildren' };
    case 'lCtrDes':
      return { side: 'left', alignment: 'centerDescendants' };

    // Right side
    case 'rT':
      return { side: 'right', alignment: 'start' };
    case 'rB':
      return { side: 'right', alignment: 'end' };
    case 'rCtrCh':
      return { side: 'right', alignment: 'centerChildren' };
    case 'rCtrDes':
      return { side: 'right', alignment: 'centerDescendants' };

    default:
      return { side: 'top', alignment: 'centerChildren' };
  }
}

/**
 * Compute the root node's cross-axis position based on alignment.
 *
 * For top/bottom root placement, this computes the X position.
 * For left/right root placement, this computes the Y position.
 *
 * @param rootSize - Size of the root on the cross-axis
 * @param subtreeSize - Size of the subtree on the cross-axis
 * @param subtreeStart - Start position of the subtree on the cross-axis
 * @param alignment - How to align the root
 * @returns The cross-axis position for the root
 */
function computeCrossAxisPosition(
  rootSize: number,
  subtreeSize: number,
  subtreeStart: number,
  alignment: 'start' | 'end' | 'centerChildren' | 'centerDescendants',
): number {
  switch (alignment) {
    case 'start':
      return subtreeStart;

    case 'end':
      return subtreeStart + subtreeSize - rootSize;

    case 'centerChildren':
    case 'centerDescendants':
      // Both center over the subtree (CtrDes vs CtrCh differ when
      // subtree has multiple levels, but with a simple subtree
      // bounding box they produce the same result).
      return subtreeStart + (subtreeSize - rootSize) / 2;

    default:
      return subtreeStart + (subtreeSize - rootSize) / 2;
  }
}

// =============================================================================
// Hierarchy Root Algorithm
// =============================================================================

/**
 * Execute the hierarchy root layout algorithm.
 *
 * Positions the root node relative to its subtree bounding box.
 * The root is placed on one side (top, bottom, left, right) and
 * aligned according to the hierAlign parameter. The remaining
 * space is allocated to the child subtree region.
 *
 * @param root - The root node input with desired size
 * @param subtree - The subtree bounding box (all children combined)
 * @param bounds - The available layout bounds
 * @param params - HierRoot algorithm parameters
 * @returns The positioned root and the child subtree region
 */
export function executeHierRootAlgorithm(
  root: RootInput,
  subtree: SubtreeInput,
  bounds: LayoutBounds,
  params: HierRootAlgorithmParams = {},
): HierRootAlgorithmResult {
  // Resolve parameters
  const hierAlign = params.hierAlign ?? DEFAULT_HIER_ALIGN;
  const nodeHorzAlign = params.nodeHorzAlign ?? DEFAULT_NODE_HORZ_ALIGN;
  const nodeVertAlign = params.nodeVertAlign ?? DEFAULT_NODE_VERT_ALIGN;
  const rtShortDist = params.rtShortDist ? parseFloat(params.rtShortDist) : DEFAULT_RT_SHORT_DIST;

  const { side, alignment } = parseHierAlign(hierAlign);

  let rootX: number;
  let rootY: number;
  let childRegion: ChildRegion;

  switch (side) {
    case 'top': {
      // Root on top, children below
      rootY = bounds.y;

      // Align root node vertically within its own height using nodeVertAlign
      if (nodeVertAlign === 'b') {
        rootY = bounds.y; // Already at top, no extra offset
      } else if (nodeVertAlign === 'mid') {
        rootY = bounds.y;
      }

      // Compute cross-axis (X) position based on alignment
      const subtreeX = computeSubtreeXForTopBottom(
        root.w,
        subtree.w,
        bounds,
        alignment,
        nodeHorzAlign,
      );
      rootX = computeCrossAxisPosition(root.w, subtree.w, subtreeX, alignment);

      // Apply nodeHorzAlign
      rootX = applyNodeHorzAlign(rootX, root.w, subtree.w, subtreeX, nodeHorzAlign);

      const childY = bounds.y + root.h + rtShortDist;
      childRegion = {
        x: subtreeX,
        y: childY,
        w: subtree.w,
        h: Math.max(0, bounds.h - root.h - rtShortDist),
      };
      break;
    }

    case 'bottom': {
      // Root on bottom, children above
      rootY = bounds.y + bounds.h - root.h;

      const subtreeX = computeSubtreeXForTopBottom(
        root.w,
        subtree.w,
        bounds,
        alignment,
        nodeHorzAlign,
      );
      rootX = computeCrossAxisPosition(root.w, subtree.w, subtreeX, alignment);
      rootX = applyNodeHorzAlign(rootX, root.w, subtree.w, subtreeX, nodeHorzAlign);

      childRegion = {
        x: subtreeX,
        y: bounds.y,
        w: subtree.w,
        h: Math.max(0, bounds.h - root.h - rtShortDist),
      };
      break;
    }

    case 'left': {
      // Root on left, children to the right
      rootX = bounds.x;

      const subtreeY = computeSubtreeYForLeftRight(
        root.h,
        subtree.h,
        bounds,
        alignment,
        nodeVertAlign,
      );
      rootY = computeCrossAxisPosition(root.h, subtree.h, subtreeY, alignment);
      rootY = applyNodeVertAlign(rootY, root.h, subtree.h, subtreeY, nodeVertAlign);

      const childX = bounds.x + root.w + rtShortDist;
      childRegion = {
        x: childX,
        y: subtreeY,
        w: Math.max(0, bounds.w - root.w - rtShortDist),
        h: subtree.h,
      };
      break;
    }

    case 'right': {
      // Root on right, children to the left
      rootX = bounds.x + bounds.w - root.w;

      const subtreeY = computeSubtreeYForLeftRight(
        root.h,
        subtree.h,
        bounds,
        alignment,
        nodeVertAlign,
      );
      rootY = computeCrossAxisPosition(root.h, subtree.h, subtreeY, alignment);
      rootY = applyNodeVertAlign(rootY, root.h, subtree.h, subtreeY, nodeVertAlign);

      childRegion = {
        x: bounds.x,
        y: subtreeY,
        w: Math.max(0, bounds.w - root.w - rtShortDist),
        h: subtree.h,
      };
      break;
    }
  }

  return {
    rootPosition: {
      x: rootX,
      y: rootY,
      w: root.w,
      h: root.h,
    },
    childRegion,
    rootSide: side,
    rootAlignment: alignment,
  };
}

// =============================================================================
// Internal Positioning Helpers
// =============================================================================

/**
 * Compute the X starting position of the subtree for top/bottom root placement.
 */
function computeSubtreeXForTopBottom(
  _rootW: number,
  subtreeW: number,
  bounds: LayoutBounds,
  alignment: 'start' | 'end' | 'centerChildren' | 'centerDescendants',
  _nodeHorzAlign: HorizontalAlignmentValue,
): number {
  switch (alignment) {
    case 'start':
      // Align subtree to the left of bounds
      return bounds.x;
    case 'end':
      // Align subtree to the right of bounds
      return bounds.x + bounds.w - subtreeW;
    case 'centerChildren':
    case 'centerDescendants':
    default: {
      // Center the subtree within bounds
      return bounds.x + (bounds.w - subtreeW) / 2;
    }
  }
}

/**
 * Compute the Y starting position of the subtree for left/right root placement.
 */
function computeSubtreeYForLeftRight(
  _rootH: number,
  subtreeH: number,
  bounds: LayoutBounds,
  alignment: 'start' | 'end' | 'centerChildren' | 'centerDescendants',
  _nodeVertAlign: VerticalAlignmentValue,
): number {
  switch (alignment) {
    case 'start':
      // Align subtree to the top of bounds
      return bounds.y;
    case 'end':
      // Align subtree to the bottom of bounds
      return bounds.y + bounds.h - subtreeH;
    case 'centerChildren':
    case 'centerDescendants':
    default: {
      // Center the subtree within bounds
      return bounds.y + (bounds.h - subtreeH) / 2;
    }
  }
}

/**
 * Apply nodeHorzAlign adjustment to the root X position.
 *
 * nodeHorzAlign fine-tunes the root position WITHIN its allocated space.
 * When 'ctr' (default), it is a no-op since computeCrossAxisPosition
 * already handled alignment. Only 'l' and 'r' shift the root within
 * the allocated cell relative to the hierAlign-computed position.
 */
function applyNodeHorzAlign(
  rootX: number,
  rootW: number,
  subtreeW: number,
  subtreeX: number,
  nodeHorzAlign: HorizontalAlignmentValue,
): number {
  switch (nodeHorzAlign) {
    case 'l':
      // Shift root to left edge of subtree extent
      return subtreeX;
    case 'r':
      // Shift root to right edge of subtree extent
      return subtreeX + subtreeW - rootW;
    case 'ctr':
    default:
      // No-op: keep the hierAlign-computed position
      return rootX;
  }
}

/**
 * Apply nodeVertAlign adjustment to the root Y position.
 *
 * nodeVertAlign fine-tunes the root position WITHIN its allocated space.
 * When 'mid' (default), it is a no-op since computeCrossAxisPosition
 * already handled alignment. Only 't' and 'b' shift the root within
 * the allocated cell relative to the hierAlign-computed position.
 */
function applyNodeVertAlign(
  rootY: number,
  rootH: number,
  subtreeH: number,
  subtreeY: number,
  nodeVertAlign: VerticalAlignmentValue,
): number {
  switch (nodeVertAlign) {
    case 't':
      // Shift root to top edge of subtree extent
      return subtreeY;
    case 'b':
      // Shift root to bottom edge of subtree extent
      return subtreeY + subtreeH - rootH;
    case 'mid':
    default:
      // No-op: keep the hierAlign-computed position
      return rootY;
  }
}

// =============================================================================
// ILayoutAlgorithm Implementation
// =============================================================================

/**
 * OOXML Hierarchy Root layout algorithm implementing the ILayoutAlgorithm interface.
 *
 * Wraps the standalone `executeHierRootAlgorithm` function to conform to
 * the unified algorithm interface. Maps AlgorithmContext fields to the
 * existing function parameters and converts the result to AlgorithmResult.
 *
 * The hierRoot algorithm positions a root node relative to its subtree.
 * The first child is treated as the root node, and remaining children
 * form the subtree bounding box.
 */
export class HierRootAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.hierRoot;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { node, children, bounds, constraints, params } = context;

    // Build HierRootAlgorithmParams from the generic params map
    const VALID_HIER_ALIGN = new Set<HierarchyAlignmentValue>([
      'tL',
      'tR',
      'tCtrCh',
      'tCtrDes',
      'bL',
      'bR',
      'bCtrCh',
      'bCtrDes',
      'lT',
      'lB',
      'lCtrCh',
      'lCtrDes',
      'rT',
      'rB',
      'rCtrCh',
      'rCtrDes',
    ]);
    const VALID_HORZ_ALIGN = new Set<HorizontalAlignmentValue>(['l', 'ctr', 'r', 'none']);
    const VALID_VERT_ALIGN = new Set<VerticalAlignmentValue>(['t', 'mid', 'b', 'none']);
    const hierRootParams: HierRootAlgorithmParams = {
      hierAlign: getOptionalTypedParam(params, 'hierAlign', VALID_HIER_ALIGN),
      nodeHorzAlign: getOptionalTypedParam(params, 'nodeHorzAlign', VALID_HORZ_ALIGN),
      nodeVertAlign: getOptionalTypedParam(params, 'nodeVertAlign', VALID_VERT_ALIGN),
      rtShortDist: params.get('rtShortDist') ?? undefined,
    };

    // The root node is the current node itself; subtree is formed by children.
    // Extract root size from constraints or use a default proportion of bounds.
    const rootW = constraints.values.get('w') ?? bounds.width * 0.5;
    const rootH = constraints.values.get('h') ?? bounds.height * 0.15;
    const rootInput: RootInput = { w: rootW, h: rootH };

    // Compute subtree bounding box from children
    let subtreeW = 0;
    let subtreeH = 0;
    for (const child of children) {
      const cw =
        constraints.values.get(`${child.name}:w`) ?? bounds.width / Math.max(children.length, 1);
      const ch = constraints.values.get(`${child.name}:h`) ?? bounds.height * 0.5;
      subtreeW += cw;
      subtreeH = Math.max(subtreeH, ch);
    }
    const subtreeInput: SubtreeInput = { w: subtreeW, h: subtreeH };

    // Map bounds to LayoutBounds format
    const layoutBounds: LayoutBounds = {
      x: 0,
      y: 0,
      w: bounds.width,
      h: bounds.height,
    };

    // Execute the standalone algorithm
    const result = executeHierRootAlgorithm(rootInput, subtreeInput, layoutBounds, hierRootParams);

    // Build shapes: root shape + pass-through child region info
    const shapes: PositionedShape[] = [];

    // Root shape
    shapes.push({
      modelId: node.dataPointId ?? node.presOfId,
      shapeType: node.shape?.type ?? 'rect',
      x: result.rootPosition.x,
      y: result.rootPosition.y,
      width: result.rootPosition.w,
      height: result.rootPosition.h,
      styleLbl: node.styleLbl,
      text: node.text,
    });

    return {
      shapes,
      connectors: [],
      usedBounds: {
        width: bounds.width,
        height: bounds.height,
      },
    };
  }
}

/**
 * Create a new HierRootAlgorithm instance.
 */
export function createHierRootAlgorithm(): HierRootAlgorithm {
  return new HierRootAlgorithm();
}
