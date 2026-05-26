/**
 * Pyramid Algorithm
 *
 * Arranges children vertically with proportional widths to form a pyramid shape.
 * Each level gets a width proportional to its position: wider at the base and
 * narrower at the top (or reversed if the pyramid is inverted).
 *
 * Parameters:
 * - linDir: fromB (build bottom-up) or fromT (build top-down). Default: fromT
 * - txDir: fromB or fromT (text direction). Default: fromT
 * - pyraAcctPos: bef or aft (accent position). Default: undefined (no accent)
 * - pyraAcctTxMar: step or stack (accent text margin mode). Default: step
 * - pyraLvlNode: shape name for level nodes
 * - pyraAcctBkgdNode: shape name for accent background
 * - pyraAcctTxNode: shape name for accent text
 *
 * The pyramid accent ratio (pyraAcctRatio) is read from constraints.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.7 (Pyramid Algorithm)
 * @module pyramid
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
import { getOptionalTypedParam, getTypedParam } from './param-utils';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SHAPE_TYPE = 'trapezoid';
const DEFAULT_ACCENT_RATIO = 0.25;

// =============================================================================
// Helper Functions
// =============================================================================

// Valid value sets for pyramid parameter validation
const VALID_PYRAMID_DIR = new Set<'fromT' | 'fromB'>(['fromT', 'fromB']);
const VALID_ACCT_POS = new Set<'bef' | 'aft'>(['bef', 'aft']);
const VALID_ACCT_TX_MAR = new Set<'step' | 'stack'>(['step', 'stack']);

/**
 * Parse pyramid parameters from the algorithm param map.
 */
function parsePyramidParams(params: Map<string, string>) {
  return {
    linDir: getTypedParam(params, 'linDir', VALID_PYRAMID_DIR, 'fromT'),
    txDir: getTypedParam(params, 'txDir', VALID_PYRAMID_DIR, 'fromT'),
    pyraAcctPos: getOptionalTypedParam(params, 'pyraAcctPos', VALID_ACCT_POS),
    pyraAcctTxMar: getTypedParam(params, 'pyraAcctTxMar', VALID_ACCT_TX_MAR, 'step'),
    pyraLvlNode: params.get('pyraLvlNode'),
    pyraAcctBkgdNode: params.get('pyraAcctBkgdNode'),
    pyraAcctTxNode: params.get('pyraAcctTxNode'),
  };
}

/**
 * Compute the width for a given pyramid level.
 *
 * For a standard pyramid (fromT direction, base at bottom):
 *   Level 0 (top) is narrowest, level count-1 (bottom) is widest.
 *   Width at level i = baseWidth * (i + 1) / count
 *
 * For an inverted pyramid (fromB direction, base at top):
 *   Level 0 (top) is widest, level count-1 (bottom) is narrowest.
 *   Width at level i = baseWidth * (count - i) / count
 *
 * @param index - The 0-based level index (0 = top of visual layout)
 * @param count - Total number of levels
 * @param baseWidth - The maximum available width
 * @param inverted - Whether the pyramid is inverted (fromB)
 * @returns The width for this level
 */
function computeLevelWidth(
  index: number,
  count: number,
  baseWidth: number,
  inverted: boolean,
): number {
  if (count <= 0) return baseWidth;
  if (count === 1) return baseWidth;

  if (inverted) {
    // fromB: wider at top (index 0), narrower at bottom
    return (baseWidth * (count - index)) / count;
  } else {
    // fromT: narrower at top (index 0), wider at bottom
    return (baseWidth * (index + 1)) / count;
  }
}

/**
 * Resolve the shape type for a given child node.
 */
function resolveShapeType(child: LayoutNodeInstance, pyraLvlNode: string | undefined): string {
  // Use the child's own shape type if defined
  if (child.shape?.type) {
    return child.shape.type;
  }
  // Otherwise use the algorithm parameter or default
  return pyraLvlNode ?? DEFAULT_SHAPE_TYPE;
}

// =============================================================================
// Pyramid Algorithm
// =============================================================================

/**
 * OOXML Pyramid layout algorithm.
 *
 * Arranges children in a vertical pyramid pattern where each level has
 * a proportional width. Supports both standard (narrow top, wide bottom)
 * and inverted (wide top, narrow bottom) pyramids.
 *
 * Optionally adds accent regions alongside pyramid levels.
 */
export class PyramidAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.pyra;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { children, bounds, constraints, params } = context;
    const pyraParams = parsePyramidParams(params);
    const shapes: PositionedShape[] = [];

    if (children.length === 0) {
      return { shapes: [], connectors: [], usedBounds: { width: 0, height: 0 } };
    }

    // Get spacing from constraints
    const spacing = constraints.values.get('sp') ?? 0;
    const sibSpacing = constraints.values.get('sibSp') ?? spacing;
    const accentRatio = constraints.values.get('pyraAcctRatio') ?? DEFAULT_ACCENT_RATIO;

    const count = children.length;
    const totalSpacing = sibSpacing * Math.max(0, count - 1);
    const levelHeight = (bounds.height - totalSpacing) / count;

    // Determine if the pyramid is inverted (fromB means base at top)
    const inverted = pyraParams.linDir === 'fromB';

    // Compute available width for pyramid levels (accounting for accent)
    const hasAccent = pyraParams.pyraAcctPos !== undefined;
    const accentWidth = hasAccent ? bounds.width * accentRatio : 0;
    const pyramidWidth = bounds.width - accentWidth;

    // Children are always laid out in their original order (top visual position
    // first). The width inversion is handled by the `inverted` parameter to
    // computeLevelWidth, so no child reordering is needed.
    const orderedChildren = children;

    for (let i = 0; i < count; i++) {
      const child = orderedChildren[i];
      const levelW = computeLevelWidth(i, count, pyramidWidth, inverted);
      const y = i * (levelHeight + sibSpacing);

      // Center the level horizontally within the pyramid region
      let levelX: number;
      if (hasAccent && pyraParams.pyraAcctPos === 'bef') {
        // Accent is on the left, pyramid shifted right
        levelX = accentWidth + (pyramidWidth - levelW) / 2;
      } else {
        // No accent or accent on the right
        levelX = (pyramidWidth - levelW) / 2;
      }

      // Create the level shape
      const shapeType = resolveShapeType(child, pyraParams.pyraLvlNode);
      shapes.push({
        modelId: child.dataPointId ?? child.presOfId,
        shapeType,
        x: levelX,
        y,
        width: levelW,
        height: levelHeight,
        styleLbl: child.styleLbl,
        text: child.text,
      });

      // Create accent shapes if configured
      if (hasAccent) {
        const accentX = pyraParams.pyraAcctPos === 'bef' ? 0 : pyramidWidth;
        let accentW: number;

        if (pyraParams.pyraAcctTxMar === 'step') {
          // Step mode: accent width matches the gap between level edge and pyramid edge
          accentW = accentWidth;
        } else {
          // Stack mode: accent width accumulates
          accentW = accentWidth;
        }

        // Accent background shape
        if (pyraParams.pyraAcctBkgdNode) {
          shapes.push({
            modelId: child.dataPointId ? `${child.dataPointId}_acctBkgd` : undefined,
            shapeType: pyraParams.pyraAcctBkgdNode,
            x: accentX,
            y,
            width: accentW,
            height: levelHeight,
            styleLbl: child.styleLbl,
          });
        }

        // Accent text shape
        if (pyraParams.pyraAcctTxNode) {
          shapes.push({
            modelId: child.dataPointId ? `${child.dataPointId}_acctTx` : undefined,
            shapeType: pyraParams.pyraAcctTxNode,
            x: accentX,
            y,
            width: accentW,
            height: levelHeight,
            styleLbl: child.styleLbl,
            text: child.text,
          });
        }
      }
    }

    return {
      shapes,
      connectors: [],
      usedBounds: { width: bounds.width, height: bounds.height },
    };
  }
}

/**
 * Create a new PyramidAlgorithm instance.
 */
export function createPyramidAlgorithm(): PyramidAlgorithm {
  return new PyramidAlgorithm();
}
