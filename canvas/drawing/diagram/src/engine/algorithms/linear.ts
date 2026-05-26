/**
 * Linear Layout Algorithm
 *
 * Arranges children in a straight line, either horizontally or vertically.
 * The most common flow-based algorithm for list-style Diagram layouts.
 *
 * The algorithm divides available space among children based on count and
 * spacing, then positions each child sequentially along the primary axis.
 *
 * Parameters:
 * - linDir: Flow direction (fromL, fromR, fromT, fromB)
 * - chDir: Child rendering direction (horz, vert) - deprecated, linDir takes precedence
 * - chAlign: Cross-axis alignment (l, r, t, b)
 * - horzAlign: Horizontal alignment override (l, ctr, r, none)
 * - vertAlign: Vertical alignment override (t, mid, b, none)
 * - stElem: Starting element index for node/transition alternation
 * - nodeHorzAlign: Per-node horizontal alignment within allocated space
 * - nodeVertAlign: Per-node vertical alignment within allocated space
 *
 * Spacing is determined from resolved constraints:
 * - 'sp' (general spacing) or 'sibSp' (sibling spacing)
 *
 * @see ECMA-376 Part 1, Section 21.4.4.2 (Linear Algorithm)
 * @module linear
 */

import type { AlgorithmTypeValue } from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedShape,
} from './algorithm-types';

// =============================================================================
// Types
// =============================================================================

/** Direction of flow for the linear arrangement. */
type FlowDirection = 'fromL' | 'fromR' | 'fromT' | 'fromB';

/** Cross-axis alignment for children. */
type CrossAlignment = 'l' | 'r' | 't' | 'b' | 'ctr';

/** Horizontal alignment within allocated space. */
type HorzAlign = 'l' | 'ctr' | 'r' | 'none';

/** Vertical alignment within allocated space. */
type VertAlign = 't' | 'mid' | 'b' | 'none';

// =============================================================================
// Parameter Parsing
// =============================================================================

/**
 * Parse the linear direction parameter.
 *
 * @param params - Algorithm parameter map
 * @returns The flow direction (defaults to 'fromL')
 */
function parseLinDir(params: Map<string, string>): FlowDirection {
  const val = params.get('linDir');
  if (val === 'fromL' || val === 'fromR' || val === 'fromT' || val === 'fromB') {
    return val;
  }
  return 'fromL';
}

/**
 * Determine if the flow is horizontal.
 *
 * @param linDir - The flow direction
 * @returns True if flow is horizontal (fromL or fromR)
 */
function isHorizontalFlow(linDir: FlowDirection): boolean {
  return linDir === 'fromL' || linDir === 'fromR';
}

/**
 * Parse the cross-axis alignment parameter.
 *
 * @param params - Algorithm parameter map
 * @param isHorizontal - Whether the primary axis is horizontal
 * @returns The cross-axis alignment
 */
function parseCrossAlign(params: Map<string, string>, isHorizontal: boolean): CrossAlignment {
  const val = params.get('chAlign');
  if (val === 'l' || val === 'r' || val === 't' || val === 'b' || val === 'ctr') {
    return val;
  }
  // Default cross-axis alignment: top for horizontal, left for vertical
  return isHorizontal ? 't' : 'l';
}

/**
 * Parse the horizontal alignment parameter.
 *
 * @param params - Algorithm parameter map
 * @returns The horizontal alignment, or 'none'
 */
function parseHorzAlign(params: Map<string, string>): HorzAlign {
  const val = params.get('horzAlign');
  if (val === 'l' || val === 'ctr' || val === 'r' || val === 'none') {
    return val;
  }
  return 'none';
}

/**
 * Parse the vertical alignment parameter.
 *
 * @param params - Algorithm parameter map
 * @returns The vertical alignment, or 'none'
 */
function parseVertAlign(params: Map<string, string>): VertAlign {
  const val = params.get('vertAlign');
  if (val === 't' || val === 'mid' || val === 'b' || val === 'none') {
    return val;
  }
  return 'none';
}

/**
 * Parse the nodeHorzAlign parameter.
 */
function parseNodeHorzAlign(params: Map<string, string>): HorzAlign {
  const val = params.get('nodeHorzAlign');
  if (val === 'l' || val === 'ctr' || val === 'r' || val === 'none') {
    return val;
  }
  return 'none';
}

/**
 * Parse the nodeVertAlign parameter.
 */
function parseNodeVertAlign(params: Map<string, string>): VertAlign {
  const val = params.get('nodeVertAlign');
  if (val === 't' || val === 'mid' || val === 'b' || val === 'none') {
    return val;
  }
  return 'none';
}

/**
 * Parse the stElem (starting element) parameter.
 *
 * In OOXML, stElem controls the starting element index for node/transition
 * alternation patterns. A value of 1 means start with the first element.
 *
 * @param params - Algorithm parameter map
 * @returns The 1-based starting element index (defaults to 1)
 */
function parseStElem(params: Map<string, string>): number {
  const val = params.get('stElem');
  if (val !== undefined) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 1;
}

// =============================================================================
// Spacing Resolution
// =============================================================================

/**
 * Get the spacing value from resolved constraints.
 *
 * Checks for 'sp' (general spacing) first, then falls back to 'sibSp'
 * (sibling spacing).
 *
 * @param constraintValues - The resolved constraint values map
 * @returns The spacing value, or 0 if not specified
 */
function getSpacing(constraintValues: Map<string, number>): number {
  const sp = constraintValues.get('sp');
  if (sp !== undefined) return sp;
  const sibSp = constraintValues.get('sibSp');
  if (sibSp !== undefined) return sibSp;
  return 0;
}

// =============================================================================
// Child Sizing
// =============================================================================

/**
 * Get the resolved size for a child from constraint values.
 *
 * Checks for child-specific constraint values (childName:w, childName:h)
 * first, then falls back to general child size (ch:w, ch:h) or
 * proportional distribution.
 *
 * @param child - The child node instance
 * @param constraintValues - The parent's resolved constraint values
 * @param isHorizontal - Whether the primary axis is horizontal
 * @param defaultMainSize - Default size along the primary axis
 * @param defaultCrossSize - Default size along the cross axis
 * @returns [mainAxisSize, crossAxisSize] tuple
 */
function getChildSize(
  child: LayoutNodeInstance,
  constraintValues: Map<string, number>,
  isHorizontal: boolean,
  defaultMainSize: number,
  defaultCrossSize: number,
): [number, number] {
  let w: number;
  let h: number;

  // Check for child-specific constraint values
  const childW = child.name ? constraintValues.get(`${child.name}:w`) : undefined;
  const childH = child.name ? constraintValues.get(`${child.name}:h`) : undefined;

  if (isHorizontal) {
    w = childW ?? defaultMainSize;
    h = childH ?? defaultCrossSize;
  } else {
    w = childW ?? defaultCrossSize;
    h = childH ?? defaultMainSize;
  }

  return [w, h];
}

// =============================================================================
// Cross-Axis Positioning
// =============================================================================

/**
 * Compute cross-axis position based on alignment.
 *
 * @param crossAlign - The cross-axis alignment
 * @param childCrossSize - The child's size along the cross axis
 * @param availableCrossSize - The available space along the cross axis
 * @param isHorizontal - Whether the primary axis is horizontal
 * @returns The cross-axis offset
 */
function computeCrossAxisOffset(
  crossAlign: CrossAlignment,
  childCrossSize: number,
  availableCrossSize: number,
  isHorizontal: boolean,
): number {
  if (isHorizontal) {
    // Cross axis is vertical (t, b, ctr)
    switch (crossAlign) {
      case 't':
        return 0;
      case 'b':
        return availableCrossSize - childCrossSize;
      case 'ctr':
        return (availableCrossSize - childCrossSize) / 2;
      case 'l':
        return 0; // l maps to t for horizontal flow
      case 'r':
        return availableCrossSize - childCrossSize; // r maps to b for horizontal flow
      default:
        return 0;
    }
  } else {
    // Cross axis is horizontal (l, r, ctr)
    switch (crossAlign) {
      case 'l':
        return 0;
      case 'r':
        return availableCrossSize - childCrossSize;
      case 'ctr':
        return (availableCrossSize - childCrossSize) / 2;
      case 't':
        return 0; // t maps to l for vertical flow
      case 'b':
        return availableCrossSize - childCrossSize; // b maps to r for vertical flow
      default:
        return 0;
    }
  }
}

// =============================================================================
// Block Alignment
// =============================================================================

/**
 * Compute the starting offset for the entire block of children
 * based on the horzAlign/vertAlign parameters.
 *
 * This shifts the entire group of children within the available bounds.
 *
 * @param totalSize - Total size of all children + spacing
 * @param availableSize - Available size in the primary axis
 * @param alignment - The alignment value (l/ctr/r for horizontal, t/mid/b for vertical)
 * @returns The offset to apply to all children
 */
function computeBlockOffset(
  totalSize: number,
  availableSize: number,
  alignment: HorzAlign | VertAlign,
): number {
  const remaining = availableSize - totalSize;
  if (remaining <= 0) return 0;

  switch (alignment) {
    case 'l':
    case 't':
      return 0;
    case 'ctr':
    case 'mid':
      return remaining / 2;
    case 'r':
    case 'b':
      return remaining;
    case 'none':
    default:
      return 0;
  }
}

// =============================================================================
// Node Alignment
// =============================================================================

/**
 * Compute alignment offset for a node within its allocated cell.
 *
 * nodeHorzAlign/nodeVertAlign control how each node is positioned
 * within the space allocated to it by the linear algorithm.
 *
 * @param nodeSize - The actual size of the node
 * @param cellSize - The allocated cell size
 * @param alignment - The alignment parameter
 * @returns The offset within the cell
 */
function computeNodeAlignmentOffset(
  nodeSize: number,
  cellSize: number,
  alignment: HorzAlign | VertAlign,
): number {
  const remaining = cellSize - nodeSize;
  if (remaining <= 0) return 0;

  switch (alignment) {
    case 'l':
    case 't':
      return 0;
    case 'ctr':
    case 'mid':
      return remaining / 2;
    case 'r':
    case 'b':
      return remaining;
    case 'none':
    default:
      return 0;
  }
}

// =============================================================================
// Linear Algorithm
// =============================================================================

/**
 * Linear layout algorithm.
 *
 * Arranges children in a straight line along the primary axis (horizontal
 * or vertical), with configurable direction, alignment, and spacing.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.2 (Linear Algorithm)
 */
export class LinearAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.lin;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, params, constraints } = context;
    const shapes: PositionedShape[] = [];

    // No children, nothing to do
    if (children.length === 0) {
      return { shapes: [], connectors: [], usedBounds: { width: 0, height: 0 } };
    }

    // Parse parameters
    const linDir = parseLinDir(params);
    const horizontal = isHorizontalFlow(linDir);
    const crossAlign = parseCrossAlign(params, horizontal);
    const horzAlign = parseHorzAlign(params);
    const vertAlign = parseVertAlign(params);
    const nodeHorzAlign = parseNodeHorzAlign(params);
    const nodeVertAlign = parseNodeVertAlign(params);
    const stElem = parseStElem(params);

    // Get spacing from constraints
    const spacing = getSpacing(constraints.values);

    // Determine axis sizes
    const mainAxisSize = horizontal ? bounds.width : bounds.height;
    const crossAxisSize = horizontal ? bounds.height : bounds.width;

    // Filter children based on stElem (starting element index)
    // stElem is 1-based, so stElem=1 means include all
    const activeChildren = stElem > 1 ? children.slice(stElem - 1) : children;

    if (activeChildren.length === 0) {
      return { shapes: [], connectors: [], usedBounds: { width: 0, height: 0 } };
    }

    // Calculate child sizes
    // Total spacing between children
    const totalSpacing = Math.max(0, activeChildren.length - 1) * spacing;
    const availableMainAxisForChildren = mainAxisSize - totalSpacing;

    // Default size for each child (equal distribution)
    const defaultChildMainSize =
      activeChildren.length > 0 ? availableMainAxisForChildren / activeChildren.length : 0;
    const defaultChildCrossSize = crossAxisSize;

    // Build child sizes array (each child may have individual constraints)
    const childSizes: Array<{ w: number; h: number }> = [];
    for (const child of activeChildren) {
      const [w, h] = getChildSize(
        child,
        constraints.values,
        horizontal,
        defaultChildMainSize,
        defaultChildCrossSize,
      );
      childSizes.push({ w, h });
    }

    // Compute total main axis size used by children + spacing
    let totalMainAxisUsed = 0;
    for (let i = 0; i < activeChildren.length; i++) {
      const size = horizontal ? childSizes[i].w : childSizes[i].h;
      totalMainAxisUsed += size;
      if (i < activeChildren.length - 1) {
        totalMainAxisUsed += spacing;
      }
    }

    // Compute block alignment offset for the primary axis
    let primaryBlockOffset: number;
    if (horizontal) {
      primaryBlockOffset = computeBlockOffset(totalMainAxisUsed, mainAxisSize, horzAlign);
    } else {
      primaryBlockOffset = computeBlockOffset(totalMainAxisUsed, mainAxisSize, vertAlign);
    }

    // Determine whether to reverse the order
    const reversed = linDir === 'fromR' || linDir === 'fromB';

    // Position children
    let cursor = reversed ? mainAxisSize - primaryBlockOffset : primaryBlockOffset;

    for (let idx = 0; idx < activeChildren.length; idx++) {
      const child = activeChildren[idx];
      const { w, h } = childSizes[idx];

      const mainSize = horizontal ? w : h;
      const crossSize = horizontal ? h : w;

      // Compute cross-axis position
      const crossOffset = computeCrossAxisOffset(crossAlign, crossSize, crossAxisSize, horizontal);

      // Compute the position along the primary axis
      let mainPosition: number;
      if (reversed) {
        cursor -= mainSize;
        mainPosition = cursor;
        if (idx < activeChildren.length - 1) {
          cursor -= spacing;
        }
      } else {
        mainPosition = cursor;
        cursor += mainSize;
        if (idx < activeChildren.length - 1) {
          cursor += spacing;
        }
      }

      // Apply node-level alignment within the allocated cell
      let x: number;
      let y: number;

      if (horizontal) {
        x = mainPosition;
        y = crossOffset;

        // Node horizontal alignment within cell (only if cell is wider)
        if (nodeHorzAlign !== 'none') {
          const offset = computeNodeAlignmentOffset(w, mainSize, nodeHorzAlign);
          x = mainPosition + offset;
        }
        // Node vertical alignment within cell
        if (nodeVertAlign !== 'none') {
          const offset = computeNodeAlignmentOffset(h, crossAxisSize, nodeVertAlign);
          y = offset;
        }
      } else {
        x = crossOffset;
        y = mainPosition;

        // Node horizontal alignment within cell (cross axis for vertical flow)
        if (nodeHorzAlign !== 'none') {
          const offset = computeNodeAlignmentOffset(w, crossAxisSize, nodeHorzAlign);
          x = offset;
        }
        // Node vertical alignment within cell
        if (nodeVertAlign !== 'none') {
          const offset = computeNodeAlignmentOffset(h, mainSize, nodeVertAlign);
          y = mainPosition + offset;
        }
      }

      // Determine shape type
      const shapeType = child.shape?.type ?? 'rect';

      shapes.push({
        modelId: child.dataPointId,
        shapeType,
        x,
        y,
        width: w,
        height: h,
        styleLbl: child.styleLbl,
        text: child.text,
        adjustments: child.shape?.adjustments,
      });
    }

    // Apply cross-axis block alignment as an additional group offset.
    // This shifts the entire group of children, composing with the per-child
    // chAlign positioning rather than replacing it.
    if (shapes.length > 0) {
      if (!horizontal && horzAlign !== 'none') {
        // For vertical flow, horzAlign shifts all shapes on the cross-axis (X)
        let minX = Infinity;
        let maxX = -Infinity;
        for (const shape of shapes) {
          minX = Math.min(minX, shape.x);
          maxX = Math.max(maxX, shape.x + shape.width);
        }
        const groupWidth = maxX - minX;
        const targetOffset = computeBlockOffset(groupWidth, crossAxisSize, horzAlign);
        const shiftX = targetOffset - minX;
        for (const shape of shapes) {
          (shape as { x: number }).x += shiftX;
        }
      }
      if (horizontal && vertAlign !== 'none') {
        // For horizontal flow, vertAlign shifts all shapes on the cross-axis (Y)
        let minY = Infinity;
        let maxY = -Infinity;
        for (const shape of shapes) {
          minY = Math.min(minY, shape.y);
          maxY = Math.max(maxY, shape.y + shape.height);
        }
        const groupHeight = maxY - minY;
        const targetOffset = computeBlockOffset(groupHeight, crossAxisSize, vertAlign);
        const shiftY = targetOffset - minY;
        for (const shape of shapes) {
          (shape as { y: number }).y += shiftY;
        }
      }
    }

    // Compute used bounds
    let usedWidth = 0;
    let usedHeight = 0;
    for (const shape of shapes) {
      usedWidth = Math.max(usedWidth, shape.x + shape.width);
      usedHeight = Math.max(usedHeight, shape.y + shape.height);
    }

    return {
      shapes,
      connectors: [],
      usedBounds: {
        width: usedWidth,
        height: usedHeight,
      },
    };
  }
}

/**
 * Create a new LinearAlgorithm instance.
 */
export function createLinearAlgorithm(): LinearAlgorithm {
  return new LinearAlgorithm();
}
