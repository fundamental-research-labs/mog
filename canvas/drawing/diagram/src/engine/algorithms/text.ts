/**
 * Text Algorithm
 *
 * Produces a single shape representing a text container. The text algorithm
 * auto-sizes text to fit within shape bounds and applies alignment, anchoring,
 * bullet levels, and auto-rotation properties.
 *
 * Parameters:
 * - parTxLTRAlign: paragraph text LTR alignment (l, r, ctr). Default: l
 * - parTxRTLAlign: paragraph text RTL alignment (l, r, ctr). Default: r
 * - txAnchorVert: vertical text anchor (t, mid, b). Default: t
 * - txAnchorHorz: horizontal text anchor (none, ctr). Default: none
 * - stBulletLvl: starting bullet level (0 = no bullets). Default: 0
 * - txBlDir: text block direction (horz, vert). Default: horz
 * - autoTxRot: auto-rotation mode (none, upr, grav). Default: none
 * - lnSpPar: line spacing for paragraphs (percentage). Default: 100
 * - lnSpCh: line spacing for children (percentage). Default: 100
 * - alignTx: text alignment flag. Default: undefined
 *
 * @see ECMA-376 Part 1, Section 21.4.4.9 (Text Algorithm)
 * @module text
 */

import type { AlgorithmTypeValue } from '@mog-sdk/contracts/diagram';
import { AlgorithmType } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  AlgorithmResult,
  ILayoutAlgorithm,
  PositionedShape,
} from './algorithm-types';
import { getOptionalTypedParam, getTypedParam } from './param-utils';

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed text algorithm parameters.
 */
interface TextParams {
  parTxLTRAlign: 'l' | 'r' | 'ctr';
  parTxRTLAlign: 'l' | 'r' | 'ctr';
  txAnchorVert: 't' | 'mid' | 'b';
  txAnchorHorz: 'none' | 'ctr';
  stBulletLvl: number;
  txBlDir: 'horz' | 'vert';
  autoTxRot: 'none' | 'upr' | 'grav';
  lnSpPar: number;
  lnSpCh: number;
  alignTx: string | undefined;
  shpTxLTRAlignCh: 'l' | 'r' | 'ctr' | undefined;
  shpTxRTLAlignCh: 'l' | 'r' | 'ctr' | undefined;
  txAnchorVertCh: 't' | 'mid' | 'b' | undefined;
  txAnchorHorzCh: 'none' | 'ctr' | undefined;
  lnSpAfParP: number;
  lnSpAfChP: number;
}

/**
 * Text properties attached to a PositionedShape.
 * Encoded via the adjustments map for downstream rendering.
 */
interface TextProperties {
  textAlign: string;
  verticalAnchor: string;
  horizontalAnchor: string;
  bulletLevel: number;
  textBlockDirection: string;
  rotation: number;
  lineSpacing: number;
  lineSpacingChild: number;
  lineSpacingAfterParagraph: number;
  lineSpacingAfterChildParagraph: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SHAPE_TYPE = 'rect';
const BULLET_INDENT_EMU = 228600; // ~0.25 inch per bullet level in EMUs

// =============================================================================
// Helper Functions
// =============================================================================

// Valid value sets for text parameter validation
const VALID_TEXT_ALIGN = new Set<'l' | 'r' | 'ctr'>(['l', 'r', 'ctr']);
const VALID_VERT_ANCHOR = new Set<'t' | 'mid' | 'b'>(['t', 'mid', 'b']);
const VALID_HORZ_ANCHOR = new Set<'none' | 'ctr'>(['none', 'ctr']);
const VALID_TX_BL_DIR = new Set<'horz' | 'vert'>(['horz', 'vert']);
const VALID_AUTO_TX_ROT = new Set<'none' | 'upr' | 'grav'>(['none', 'upr', 'grav']);

/**
 * Parse text parameters from the algorithm param map.
 */
function parseTextParams(params: Map<string, string>): TextParams {
  return {
    parTxLTRAlign: getTypedParam(params, 'parTxLTRAlign', VALID_TEXT_ALIGN, 'l'),
    parTxRTLAlign: getTypedParam(params, 'parTxRTLAlign', VALID_TEXT_ALIGN, 'r'),
    txAnchorVert: getTypedParam(params, 'txAnchorVert', VALID_VERT_ANCHOR, 't'),
    txAnchorHorz: getTypedParam(params, 'txAnchorHorz', VALID_HORZ_ANCHOR, 'none'),
    stBulletLvl: parseInt(params.get('stBulletLvl') ?? '0', 10),
    txBlDir: getTypedParam(params, 'txBlDir', VALID_TX_BL_DIR, 'horz'),
    autoTxRot: getTypedParam(params, 'autoTxRot', VALID_AUTO_TX_ROT, 'none'),
    lnSpPar: parseFloat(params.get('lnSpPar') ?? '100'),
    lnSpCh: parseFloat(params.get('lnSpCh') ?? '100'),
    alignTx: params.get('alignTx'),
    shpTxLTRAlignCh: getOptionalTypedParam(params, 'shpTxLTRAlignCh', VALID_TEXT_ALIGN),
    shpTxRTLAlignCh: getOptionalTypedParam(params, 'shpTxRTLAlignCh', VALID_TEXT_ALIGN),
    txAnchorVertCh: getOptionalTypedParam(params, 'txAnchorVertCh', VALID_VERT_ANCHOR),
    txAnchorHorzCh: getOptionalTypedParam(params, 'txAnchorHorzCh', VALID_HORZ_ANCHOR),
    lnSpAfParP: parseFloat(params.get('lnSpAfParP') ?? '0'),
    lnSpAfChP: parseFloat(params.get('lnSpAfChP') ?? '0'),
  };
}

/**
 * Compute the text rotation angle based on the auto-rotation mode.
 *
 * @param mode - The auto-rotation mode
 * @param shapeCenterY - Y position of the shape center
 * @param containerHeight - Total container height (for gravity calculation)
 * @returns Rotation angle in degrees
 */
function computeAutoRotation(
  mode: 'none' | 'upr' | 'grav',
  shapeCenterY: number,
  containerHeight: number,
): number {
  switch (mode) {
    case 'none':
      return 0;
    case 'upr':
      // Always upright - no rotation
      return 0;
    case 'grav':
      // Gravity-based: shapes in the bottom half get 180-degree rotation
      // so text remains readable
      if (containerHeight > 0 && shapeCenterY > containerHeight / 2) {
        return 180;
      }
      return 0;
    default:
      return 0;
  }
}

/**
 * Compute the bullet indentation based on the starting bullet level.
 *
 * @param stBulletLvl - Starting bullet level (0 = no bullets)
 * @returns Left margin offset for bullet indentation
 */
function computeBulletIndent(stBulletLvl: number): number {
  if (stBulletLvl <= 0) return 0;
  return stBulletLvl * BULLET_INDENT_EMU;
}

/**
 * Build the text properties for a positioned shape.
 */
function buildTextProperties(textParams: TextParams, rotation: number): TextProperties {
  return {
    textAlign: textParams.parTxLTRAlign,
    verticalAnchor: textParams.txAnchorVert,
    horizontalAnchor: textParams.txAnchorHorz,
    bulletLevel: textParams.stBulletLvl,
    textBlockDirection: textParams.txBlDir,
    rotation,
    lineSpacing: textParams.lnSpPar,
    lineSpacingChild: textParams.lnSpCh,
    lineSpacingAfterParagraph: textParams.lnSpAfParP,
    lineSpacingAfterChildParagraph: textParams.lnSpAfChP,
  };
}

/**
 * Encode text properties as a Map<string, number> for storage in
 * the PositionedShape.adjustments field.
 *
 * This encoding convention allows downstream renderers to extract
 * text layout properties from the shape's adjustments map.
 */
function encodeTextProperties(props: TextProperties): Map<string, number> {
  const map = new Map<string, number>();

  // Encode text alignment as a numeric code
  const alignMap: Record<string, number> = { l: 0, ctr: 1, r: 2 };
  map.set('txAlign', alignMap[props.textAlign] ?? 0);

  // Encode vertical anchor
  const vAnchorMap: Record<string, number> = { t: 0, mid: 1, b: 2 };
  map.set('txAnchorVert', vAnchorMap[props.verticalAnchor] ?? 0);

  // Encode horizontal anchor
  const hAnchorMap: Record<string, number> = { none: 0, ctr: 1 };
  map.set('txAnchorHorz', hAnchorMap[props.horizontalAnchor] ?? 0);

  // Bullet level
  map.set('txBulletLvl', props.bulletLevel);

  // Text block direction
  const dirMap: Record<string, number> = { horz: 0, vert: 1 };
  map.set('txBlDir', dirMap[props.textBlockDirection] ?? 0);

  // Rotation
  map.set('txRotation', props.rotation);

  // Line spacings
  map.set('txLnSpPar', props.lineSpacing);
  map.set('txLnSpCh', props.lineSpacingChild);
  map.set('txLnSpAfParP', props.lineSpacingAfterParagraph);
  map.set('txLnSpAfChP', props.lineSpacingAfterChildParagraph);

  return map;
}

// =============================================================================
// Text Algorithm
// =============================================================================

/**
 * OOXML Text layout algorithm.
 *
 * Produces a single shape that represents a text container with computed
 * text properties (alignment, anchoring, bullet levels, rotation).
 *
 * The shape bounds come from resolved constraints. Text properties are
 * encoded in the shape's adjustments map for downstream rendering.
 */
export class TextAlgorithm implements ILayoutAlgorithm {
  readonly type: AlgorithmTypeValue = AlgorithmType.tx;

  compute(context: AlgorithmContext): AlgorithmResult {
    const { node, bounds, constraints, params } = context;
    const textParams = parseTextParams(params);

    // Resolve shape bounds from constraints
    const l = constraints.values.get('l') ?? 0;
    const t = constraints.values.get('t') ?? 0;
    const w = constraints.values.get('w') ?? bounds.width;
    const h = constraints.values.get('h') ?? bounds.height;

    // Get margins from constraints
    const lMarg = constraints.values.get('lMarg') ?? 0;
    const tMarg = constraints.values.get('tMarg') ?? 0;
    const rMarg = constraints.values.get('rMarg') ?? 0;
    const bMarg = constraints.values.get('bMarg') ?? 0;

    // For vertical text (txBlDir=vert), the effective dimensions for text
    // layout are swapped (width becomes height and vice versa)
    let effectiveW = w - lMarg - rMarg;
    let effectiveH = h - tMarg - bMarg;

    if (textParams.txBlDir === 'vert') {
      const temp = effectiveW;
      effectiveW = effectiveH;
      effectiveH = temp;
    }

    // Compute bullet indentation
    const bulletIndent = computeBulletIndent(textParams.stBulletLvl);

    // Adjust effective width for bullet indentation
    effectiveW = Math.max(0, effectiveW - bulletIndent);

    // Compute auto-rotation
    const shapeCenterY = t + h / 2;
    const rotation = computeAutoRotation(textParams.autoTxRot, shapeCenterY, bounds.height);

    // Build text properties
    const textProps = buildTextProperties(textParams, rotation);

    // Encode text properties into adjustments
    const adjustments = encodeTextProperties(textProps);

    // Resolve shape type
    const shapeType = node.shape?.type ?? DEFAULT_SHAPE_TYPE;

    // Create the positioned shape
    const shape: PositionedShape = {
      modelId: node.dataPointId ?? node.presOfId,
      shapeType,
      x: l,
      y: t,
      width: w,
      height: h,
      rotation: rotation !== 0 ? rotation : undefined,
      styleLbl: node.styleLbl,
      text: node.text,
      adjustments,
    };

    return {
      shapes: [shape],
      connectors: [],
      usedBounds: { width: w, height: h },
    };
  }
}

/**
 * Create a new TextAlgorithm instance.
 */
export function createTextAlgorithm(): TextAlgorithm {
  return new TextAlgorithm();
}
