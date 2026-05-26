/**
 * Cycle Algorithm
 *
 * Circular/radial arrangement algorithm. Positions children on a circle
 * (or arc) defined by start angle and span angle. Optionally places
 * the first node at the center.
 *
 * Parameters:
 * - stAng: Start angle in degrees (0 = top/12 o'clock, clockwise)
 * - spanAng: Span angle in degrees (360 = full circle)
 * - rotPath: none or alongPath (rotate shapes to follow tangent)
 * - ctrShpMap: none or fNode (place first node at center)
 *
 * @see ECMA-376 Part 1, Section 21.4.4.4 (Cycle Algorithm)
 * @module cycle
 */

import type {
  AlgorithmTypeValue,
  CenterShapeMappingValue,
  CycleAlgorithmParams,
  RotationPathValue,
} from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  PositionedConnector,
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
 * Result of positioning a single child node in the cycle.
 */
export interface CycleChildPosition {
  /** Index of the child in the original children array */
  readonly index: number;
  /** Computed x coordinate (center of the child) */
  readonly cx: number;
  /** Computed y coordinate (center of the child) */
  readonly cy: number;
  /** Computed x coordinate (left edge) */
  readonly x: number;
  /** Computed y coordinate (top edge) */
  readonly y: number;
  /** Width of the child */
  readonly w: number;
  /** Height of the child */
  readonly h: number;
  /** Rotation angle in degrees (0 if rotPath=none) */
  readonly rotation: number;
  /** Whether this child is the center node (ctrShpMap=fNode) */
  readonly isCenter: boolean;
  /** The angle on the circle in degrees */
  readonly angle: number;
}

/**
 * Result of running the cycle algorithm.
 */
export interface CycleAlgorithmResult {
  /** Positioned children */
  readonly positions: readonly CycleChildPosition[];
  /** Center of the cycle */
  readonly centerX: number;
  /** Center of the cycle */
  readonly centerY: number;
  /** Radius used for the cycle */
  readonly radius: number;
  /** Total bounds occupied */
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

const DEFAULT_ST_ANG = 0; // 0 degrees = top (12 o'clock)
const DEFAULT_SPAN_ANG = 360; // Full circle
const DEFAULT_ROT_PATH: RotationPathValue = 'none';
const DEFAULT_CTR_SHP_MAP: CenterShapeMappingValue = 'none';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert degrees to radians.
 */
function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Normalize angle to [0, 360) range.
 */
function normalizeAngle(degrees: number): number {
  const mod = degrees % 360;
  return mod < 0 ? mod + 360 : mod;
}

/**
 * Compute the tangent angle at a given position on a circle.
 * The tangent is perpendicular to the radius at that point.
 * For clockwise movement, tangent = angle + 90.
 */
function computeTangentAngle(angleDegrees: number): number {
  return normalizeAngle(angleDegrees + 90);
}

// =============================================================================
// Cycle Algorithm
// =============================================================================

/**
 * Execute the cycle layout algorithm.
 *
 * Positions children on a circular arc within the given bounds.
 * The circle is centered in the bounds, and children are distributed
 * evenly across the specified span angle starting from the start angle.
 *
 * Angle convention:
 * - 0 degrees = top of the circle (12 o'clock position)
 * - Angles increase clockwise
 * - This matches the OOXML convention where stAng=0 is the top
 *
 * @param children - Array of child inputs with desired sizes
 * @param bounds - The available layout bounds
 * @param params - Cycle algorithm parameters
 * @returns Positioned children, center, radius, and total bounds
 */
export function executeCycleAlgorithm(
  children: readonly ChildInput[],
  bounds: LayoutBounds,
  params: CycleAlgorithmParams = {},
): CycleAlgorithmResult {
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;

  if (children.length === 0) {
    return {
      positions: [],
      centerX,
      centerY,
      radius: 0,
      totalBounds: { x: bounds.x, y: bounds.y, w: 0, h: 0 },
    };
  }

  // Resolve parameters
  const stAng = params.stAng !== undefined ? parseFloat(params.stAng) : DEFAULT_ST_ANG;
  const spanAng = params.spanAng !== undefined ? parseFloat(params.spanAng) : DEFAULT_SPAN_ANG;
  const rotPath = params.rotPath ?? DEFAULT_ROT_PATH;
  const ctrShpMap = params.ctrShpMap ?? DEFAULT_CTR_SHP_MAP;

  // Determine which children go on the circle vs center
  const hasCenterNode = ctrShpMap === 'fNode' && children.length > 0;
  const circleChildren = hasCenterNode ? children.slice(1) : [...children];
  const circleStartIndex = hasCenterNode ? 1 : 0;

  // Compute maximum child size for radius padding
  let maxChildW = 0;
  let maxChildH = 0;
  for (const child of circleChildren) {
    maxChildW = Math.max(maxChildW, child.w);
    maxChildH = Math.max(maxChildH, child.h);
  }

  // Compute radius: fit within bounds with padding for child sizes
  const maxChildDim = Math.max(maxChildW, maxChildH);
  const radius = Math.max(0, Math.min(bounds.w, bounds.h) / 2 - maxChildDim / 2);

  const positions: CycleChildPosition[] = [];

  // Place center node if applicable
  if (hasCenterNode) {
    const child = children[0];
    positions.push({
      index: 0,
      cx: centerX,
      cy: centerY,
      x: centerX - child.w / 2,
      y: centerY - child.h / 2,
      w: child.w,
      h: child.h,
      rotation: 0,
      isCenter: true,
      angle: 0,
    });
  }

  // Place children on the circle
  const circleCount = circleChildren.length;
  if (circleCount > 0) {
    // Determine if this is a full circle or an arc
    const isFullCircle = Math.abs(spanAng) >= 360;

    // For a full circle, distribute evenly with count divisions
    // For an arc, distribute evenly including endpoints
    const divisions = isFullCircle ? circleCount : Math.max(1, circleCount - 1);

    for (let i = 0; i < circleCount; i++) {
      const child = circleChildren[i];

      // Compute angle for this child
      // angle = stAng + (i / divisions) * spanAng
      const angle = stAng + (circleCount === 1 ? 0 : (i / divisions) * spanAng);

      // Convert to standard math coordinates:
      // OOXML: 0 = top (12 o'clock), clockwise
      // Math:  0 = right (3 o'clock), counter-clockwise
      // Convert: mathAngle = -(ooxmlAngle - 90) = 90 - ooxmlAngle
      const mathAngleRad = degreesToRadians(90 - angle);

      // Compute position on the circle
      const cx = centerX + radius * Math.cos(mathAngleRad);
      const cy = centerY - radius * Math.sin(mathAngleRad);

      // Compute rotation if rotPath=alongPath
      let rotation = 0;
      if (rotPath === 'alongPath') {
        rotation = computeTangentAngle(angle);
      }

      positions.push({
        index: circleStartIndex + i,
        cx,
        cy,
        x: cx - child.w / 2,
        y: cy - child.h / 2,
        w: child.w,
        h: child.h,
        rotation,
        isCenter: false,
        angle,
      });
    }
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

  if (positions.length === 0) {
    minX = bounds.x;
    minY = bounds.y;
    maxX = bounds.x;
    maxY = bounds.y;
  }

  return {
    positions,
    centerX,
    centerY,
    radius,
    totalBounds: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
  };
}

// =============================================================================
// ILayoutAlgorithm Implementation
// =============================================================================

/**
 * OOXML Cycle layout algorithm implementing the ILayoutAlgorithm interface.
 *
 * Wraps the standalone `executeCycleAlgorithm` function to conform to
 * the unified algorithm interface. Maps AlgorithmContext fields to the
 * existing function parameters and converts the result to AlgorithmResult.
 */
export class CycleAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.cycle;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, constraints, params } = context;

    // Build CycleAlgorithmParams from the generic params map
    const VALID_ROT_PATH = new Set<RotationPathValue>(['none', 'alongPath']);
    const VALID_CTR_SHP_MAP = new Set<CenterShapeMappingValue>(['none', 'fNode']);
    const cycleParams: CycleAlgorithmParams = {
      stAng: params.get('stAng') ?? undefined,
      spanAng: params.get('spanAng') ?? undefined,
      rotPath: getOptionalTypedParam(params, 'rotPath', VALID_ROT_PATH),
      ctrShpMap: getOptionalTypedParam(params, 'ctrShpMap', VALID_CTR_SHP_MAP),
    };

    // Map children to ChildInput format
    // For cycle layout, child size should be a fraction of the smaller dimension
    // to fit nodes on the circle without overlap.
    const cycleFallbackSize =
      Math.min(bounds.width, bounds.height) / (Math.max(children.length, 1) + 1);
    const childInputs: ChildInput[] = children.map((child) => {
      const w = constraints.values.get(`${child.name}:w`) ?? cycleFallbackSize;
      const h = constraints.values.get(`${child.name}:h`) ?? cycleFallbackSize;
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
    const result = executeCycleAlgorithm(childInputs, layoutBounds, cycleParams);

    // Convert to PositionedShape array
    const shapes: PositionedShape[] = result.positions.map((pos) => {
      const child = children[pos.index];
      return {
        modelId: child.dataPointId ?? child.presOfId,
        shapeType: child.shape?.type ?? 'ellipse',
        x: pos.x,
        y: pos.y,
        width: pos.w,
        height: pos.h,
        rotation: pos.rotation !== 0 ? pos.rotation : undefined,
        styleLbl: child.styleLbl,
        text: child.text,
      };
    });

    // Build connectors between adjacent circle nodes (if applicable)
    const connectors: PositionedConnector[] = [];

    return {
      shapes,
      connectors,
      usedBounds: {
        width: result.totalBounds.w,
        height: result.totalBounds.h,
      },
    };
  }
}

/**
 * Create a new CycleAlgorithm instance.
 */
export function createCycleAlgorithm(): CycleAlgorithm {
  return new CycleAlgorithm();
}
