/**
 * Snake Algorithm
 *
 * Multi-row/column wrapping layout algorithm -- similar to CSS flexbox
 * with wrapping. Children are laid out along a primary axis (row or column),
 * wrapping to the next row/column when a breakpoint is reached.
 *
 * Parameters:
 * - grDir: Starting corner (tL, tR, bL, bR)
 * - flowDir: Primary axis (row = horizontal, col = vertical)
 * - contDir: Continue direction (sameDir = same each row, revDir = alternating/boustrophedon)
 * - off: Offset mode (ctr = centered rows, off = staggered rows)
 * - bkpt: Breakpoint logic (endCnv = canvas edge, bal = balanced, fixed = fixed count)
 * - bkPtFixedVal: Fixed breakpoint count when bkpt=fixed
 *
 * @see ECMA-376 Part 1, Section 21.4.4.3 (Snake Algorithm)
 * @module snake
 */

import type {
  AlgorithmTypeValue,
  BreakpointValue,
  ContinueDirectionValue,
  FlowDirectionValue,
  GrowDirectionValue,
  OffsetValue,
  SnakeAlgorithmParams,
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
export interface ChildPosition {
  /** Index of the child in the original children array */
  readonly index: number;
  /** Computed x coordinate (left edge) */
  readonly x: number;
  /** Computed y coordinate (top edge) */
  readonly y: number;
  /** Computed width */
  readonly w: number;
  /** Computed height */
  readonly h: number;
}

/**
 * Result of running the snake algorithm.
 */
export interface SnakeAlgorithmResult {
  /** Positioned children */
  readonly positions: readonly ChildPosition[];
  /** Total bounds occupied by all children */
  readonly totalBounds: LayoutBounds;
}

/**
 * Input describing a child to be positioned by the algorithm.
 */
export interface ChildInput {
  /** Desired width of this child */
  readonly w: number;
  /** Desired height of this child */
  readonly h: number;
}

// =============================================================================
// Default Parameter Values
// =============================================================================

const DEFAULT_GR_DIR: GrowDirectionValue = 'tL';
const DEFAULT_FLOW_DIR: FlowDirectionValue = 'row';
const DEFAULT_CONT_DIR: ContinueDirectionValue = 'sameDir';
const DEFAULT_BKPT: BreakpointValue = 'endCnv';
const DEFAULT_OFF: OffsetValue = 'ctr';
const DEFAULT_BK_PT_FIXED_VAL = 2;

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Determine the primary axis direction sign and starting position
 * based on growth direction and flow direction.
 */
interface DirectionConfig {
  /** +1 or -1 for the primary axis */
  readonly primarySign: number;
  /** +1 or -1 for the secondary axis (wrap direction) */
  readonly secondarySign: number;
  /** Starting x coordinate */
  readonly startX: number;
  /** Starting y coordinate */
  readonly startY: number;
  /** Whether primary axis is horizontal */
  readonly isRowFlow: boolean;
}

function resolveDirectionConfig(
  bounds: LayoutBounds,
  grDir: GrowDirectionValue,
  flowDir: FlowDirectionValue,
): DirectionConfig {
  const isRowFlow = flowDir === 'row';

  // Determine primary and secondary axis signs from growth direction
  // grDir encodes the starting corner:
  //   tL = top-left:     primary +, secondary +
  //   tR = top-right:    primary -, secondary +
  //   bL = bottom-left:  primary +, secondary -
  //   bR = bottom-right: primary -, secondary -

  let hSign: number;
  let vSign: number;

  switch (grDir) {
    case 'tL':
      hSign = 1;
      vSign = 1;
      break;
    case 'tR':
      hSign = -1;
      vSign = 1;
      break;
    case 'bL':
      hSign = 1;
      vSign = -1;
      break;
    case 'bR':
      hSign = -1;
      vSign = -1;
      break;
    default:
      hSign = 1;
      vSign = 1;
  }

  // For row flow: primary = horizontal, secondary = vertical
  // For col flow: primary = vertical, secondary = horizontal
  const primarySign = isRowFlow ? hSign : vSign;
  const secondarySign = isRowFlow ? vSign : hSign;

  // Compute starting coordinates
  let startX: number;
  let startY: number;

  if (isRowFlow) {
    startX = hSign > 0 ? bounds.x : bounds.x + bounds.w;
    startY = vSign > 0 ? bounds.y : bounds.y + bounds.h;
  } else {
    startX = hSign > 0 ? bounds.x : bounds.x + bounds.w;
    startY = vSign > 0 ? bounds.y : bounds.y + bounds.h;
  }

  return { primarySign, secondarySign, startX, startY, isRowFlow };
}

/**
 * Compute breakpoints (how many items per row/column).
 */
function computeRowAssignments(
  childCount: number,
  children: readonly ChildInput[],
  bounds: LayoutBounds,
  bkpt: BreakpointValue,
  bkPtFixedVal: number,
  isRowFlow: boolean,
  spacing: number,
): number[] {
  if (childCount === 0) return [];

  switch (bkpt) {
    case 'fixed': {
      const perRow = Math.max(1, bkPtFixedVal);
      const rows: number[] = [];
      let remaining = childCount;
      while (remaining > 0) {
        const count = Math.min(perRow, remaining);
        rows.push(count);
        remaining -= count;
      }
      return rows;
    }

    case 'bal': {
      // Balanced: distribute children as evenly as possible.
      // Estimate the number of rows needed, then distribute.
      if (childCount <= 1) return [childCount];

      // Estimate average child size on primary axis
      let totalPrimarySize = 0;
      for (const child of children) {
        totalPrimarySize += isRowFlow ? child.w : child.h;
      }
      const avgSize = totalPrimarySize / childCount;
      const availableLength = isRowFlow ? bounds.w : bounds.h;

      // Estimate how many fit per row (with spacing)
      let perRow: number;
      if (avgSize <= 0) {
        perRow = childCount;
      } else {
        perRow = Math.max(1, Math.floor((availableLength + spacing) / (avgSize + spacing)));
      }

      const numRows = Math.max(1, Math.ceil(childCount / perRow));
      const itemsPerRow = Math.ceil(childCount / numRows);

      const rows: number[] = [];
      let remaining = childCount;
      for (let i = 0; i < numRows; i++) {
        const count = Math.min(itemsPerRow, remaining);
        rows.push(count);
        remaining -= count;
      }
      return rows;
    }

    case 'endCnv':
    default: {
      // Break at canvas edge: fill primary axis until children exceed bounds
      const availableLength = isRowFlow ? bounds.w : bounds.h;
      const rows: number[] = [];
      let remaining = childCount;
      let childIdx = 0;

      while (remaining > 0) {
        if (childIdx >= children.length) break;

        let usedLength = 0;
        let count = 0;

        while (childIdx < children.length) {
          const childSize = isRowFlow ? children[childIdx].w : children[childIdx].h;
          const nextLength = usedLength + childSize + (count > 0 ? spacing : 0);

          if (count > 0 && nextLength > availableLength) {
            break;
          }

          usedLength = nextLength;
          count++;
          childIdx++;
        }

        // Ensure at least one child per row to avoid infinite loop
        if (count === 0) {
          count = 1;
          childIdx++;
        }

        rows.push(count);
        remaining -= count;
      }
      return rows;
    }
  }
}

// =============================================================================
// Snake Algorithm
// =============================================================================

/**
 * Execute the snake layout algorithm.
 *
 * Positions children in a wrapping grid layout similar to CSS flexbox.
 * Children flow along the primary axis, wrapping to the next row/column
 * when a breakpoint is reached.
 *
 * @param children - Array of child inputs with desired sizes
 * @param bounds - The available layout bounds
 * @param params - Snake algorithm parameters
 * @param spacing - Spacing between children within a row (sibSp) (default 0)
 * @param secondarySpacing - Spacing between rows (sp). Defaults to `spacing` if not provided.
 * @returns Positioned children and total bounds
 */
export function executeSnakeAlgorithm(
  children: readonly ChildInput[],
  bounds: LayoutBounds,
  params: SnakeAlgorithmParams = {},
  spacing: number = 0,
  secondarySpacing?: number,
): SnakeAlgorithmResult {
  if (children.length === 0) {
    return {
      positions: [],
      totalBounds: { x: bounds.x, y: bounds.y, w: 0, h: 0 },
    };
  }

  // Resolve parameters with defaults
  const grDir = params.grDir ?? DEFAULT_GR_DIR;
  const flowDir = params.flowDir ?? DEFAULT_FLOW_DIR;
  const contDir = params.contDir ?? DEFAULT_CONT_DIR;
  const bkpt = params.bkpt ?? DEFAULT_BKPT;
  const bkPtFixedVal = params.bkPtFixedVal
    ? parseInt(params.bkPtFixedVal, 10)
    : DEFAULT_BK_PT_FIXED_VAL;
  const off = params.off ?? DEFAULT_OFF;

  // Resolve secondary (between-row) spacing, falling back to primary spacing
  const rowSpacing = secondarySpacing ?? spacing;

  const dirConfig = resolveDirectionConfig(bounds, grDir, flowDir);
  const { isRowFlow, primarySign, secondarySign, startX, startY } = dirConfig;

  // Compute row assignments (how many children per row)
  const rowAssignments = computeRowAssignments(
    children.length,
    children,
    bounds,
    bkpt,
    bkPtFixedVal,
    isRowFlow,
    spacing,
  );

  // Position children row by row
  const positions: ChildPosition[] = [];
  let childIdx = 0;
  let secondaryOffset = 0;
  let maxTotalPrimary = 0;
  let maxTotalSecondary = 0;

  for (let rowIdx = 0; rowIdx < rowAssignments.length; rowIdx++) {
    const rowCount = rowAssignments[rowIdx];

    // Determine direction for this row based on contDir
    let rowPrimarySign = primarySign;
    if (contDir === 'revDir' && rowIdx % 2 === 1) {
      rowPrimarySign = -primarySign;
    }

    // Compute row dimensions
    let rowPrimarySize = 0;
    let rowSecondarySize = 0;
    for (let i = 0; i < rowCount; i++) {
      const child = children[childIdx + i];
      const primarySize = isRowFlow ? child.w : child.h;
      const secondSize = isRowFlow ? child.h : child.w;
      rowPrimarySize += primarySize + (i > 0 ? spacing : 0);
      rowSecondarySize = Math.max(rowSecondarySize, secondSize);
    }

    // Compute stagger offset for odd rows when off='off'
    let staggerOffset = 0;
    if (off === 'off' && rowIdx % 2 === 1) {
      // Stagger by half of the first child's primary dimension
      const firstChild = children[childIdx];
      const firstPrimary = isRowFlow ? firstChild.w : firstChild.h;
      staggerOffset = firstPrimary / 2;
    }

    // Position each child in this row
    let primaryOffset = staggerOffset;

    for (let i = 0; i < rowCount; i++) {
      const child = children[childIdx + i];
      const primarySize = isRowFlow ? child.w : child.h;
      const secondSize = isRowFlow ? child.h : child.w;

      // Compute the actual position based on signs and starting point
      let x: number;
      let y: number;

      if (isRowFlow) {
        if (rowPrimarySign > 0) {
          x = startX + primaryOffset;
        } else {
          x = startX - primaryOffset - child.w;
        }
        if (secondarySign > 0) {
          y = startY + secondaryOffset;
        } else {
          y = startY - secondaryOffset - child.h;
        }
      } else {
        if (secondarySign > 0) {
          x = startX + secondaryOffset;
        } else {
          x = startX - secondaryOffset - child.w;
        }
        if (rowPrimarySign > 0) {
          y = startY + primaryOffset;
        } else {
          y = startY - primaryOffset - child.h;
        }
      }

      positions.push({
        index: childIdx + i,
        x,
        y,
        w: child.w,
        h: child.h,
      });

      primaryOffset += primarySize + spacing;

      // Track max extents for total bounds
      const endPrimary = primaryOffset - spacing;
      const endSecondary = secondaryOffset + secondSize;
      maxTotalPrimary = Math.max(maxTotalPrimary, endPrimary);
      maxTotalSecondary = Math.max(maxTotalSecondary, endSecondary);
    }

    childIdx += rowCount;
    secondaryOffset += rowSecondarySize + rowSpacing;
  }

  // Remove trailing spacing from secondary offset
  if (rowAssignments.length > 0) {
    secondaryOffset -= rowSpacing;
  }

  // Compute total bounds
  const totalW = isRowFlow ? maxTotalPrimary : maxTotalSecondary;
  const totalH = isRowFlow ? maxTotalSecondary : maxTotalPrimary;

  return {
    positions,
    totalBounds: {
      x: isRowFlow
        ? primarySign > 0
          ? bounds.x
          : bounds.x + bounds.w - totalW
        : secondarySign > 0
          ? bounds.x
          : bounds.x + bounds.w - totalW,
      y: isRowFlow
        ? secondarySign > 0
          ? bounds.y
          : bounds.y + bounds.h - totalH
        : primarySign > 0
          ? bounds.y
          : bounds.y + bounds.h - totalH,
      w: totalW,
      h: totalH,
    },
  };
}

// =============================================================================
// ILayoutAlgorithm Implementation
// =============================================================================

/**
 * OOXML Snake layout algorithm implementing the ILayoutAlgorithm interface.
 *
 * Wraps the standalone `executeSnakeAlgorithm` function to conform to
 * the unified algorithm interface. Maps AlgorithmContext fields to the
 * existing function parameters and converts the result to AlgorithmResult.
 */
export class SnakeAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.snake;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, constraints, params } = context;

    // Extract spacing from resolved constraints
    const spacing = constraints.values.get('sp') ?? 0;
    const sibSpacing = constraints.values.get('sibSp') ?? spacing;

    // Build SnakeAlgorithmParams from the generic params map
    const VALID_GR_DIR = new Set<GrowDirectionValue>(['tL', 'tR', 'bL', 'bR']);
    const VALID_FLOW_DIR = new Set<FlowDirectionValue>(['row', 'col']);
    const VALID_CONT_DIR = new Set<ContinueDirectionValue>(['sameDir', 'revDir']);
    const VALID_BKPT = new Set<BreakpointValue>(['endCnv', 'bal', 'fixed']);
    const VALID_OFF = new Set<OffsetValue>(['ctr', 'off']);
    const snakeParams: SnakeAlgorithmParams = {
      grDir: getOptionalTypedParam(params, 'grDir', VALID_GR_DIR),
      flowDir: getOptionalTypedParam(params, 'flowDir', VALID_FLOW_DIR),
      contDir: getOptionalTypedParam(params, 'contDir', VALID_CONT_DIR),
      bkpt: getOptionalTypedParam(params, 'bkpt', VALID_BKPT),
      bkPtFixedVal: params.get('bkPtFixedVal') ?? undefined,
      off: getOptionalTypedParam(params, 'off', VALID_OFF),
    };

    // Map children to ChildInput format
    // For snake (row flow), width is divided among children per row, but height
    // should be a reasonable fraction for one row (not divided by total count).
    const childInputs: ChildInput[] = children.map((child) => {
      const w =
        constraints.values.get(`${child.name}:w`) ?? bounds.width / Math.max(children.length, 1);
      const h = constraints.values.get(`${child.name}:h`) ?? bounds.height * 0.3;
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
    // sibSpacing is the primary (within-row) spacing, spacing is the secondary (between-row) spacing
    const result = executeSnakeAlgorithm(
      childInputs,
      layoutBounds,
      snakeParams,
      sibSpacing,
      spacing,
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
 * Create a new SnakeAlgorithm instance.
 */
export function createSnakeAlgorithm(): SnakeAlgorithm {
  return new SnakeAlgorithm();
}
