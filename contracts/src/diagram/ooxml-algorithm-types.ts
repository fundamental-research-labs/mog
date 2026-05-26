/**
 * OOXML Diagram Algorithm Parameter Types
 *
 * Type definitions for all Diagram algorithm parameters as defined in
 * ECMA-376 Part 1, Section 21.4 (DrawingML - Diagrams).
 *
 * Diagram algorithms accept parameters via `dgm:param` elements that
 * control their positioning behavior. Each parameter has:
 * - A type (from ST_ParameterId, 55 values)
 * - A value (type-specific, from various ST_* enumerations or numeric)
 *
 * This file defines:
 * 1. All 55 ST_ParameterId values
 * 2. Type-safe value enumerations for each parameter type
 * 3. Per-algorithm parameter maps (which params are valid for which algorithm)
 *
 * @see ECMA-376 Part 1, Section 21.4.7.43 (ST_ParameterId)
 * @see https://www.datypic.com/sc/ooxml/t-draw-diag_ST_ParameterId.html
 */

import type { AlgorithmTypeValue } from './ooxml-layout-types';

// =============================================================================
// ST_ParameterId — All 55 Algorithm Parameter Identifiers
// =============================================================================

/**
 * All 55 algorithm parameter identifiers from ST_ParameterId.
 *
 * These are the valid `type` attribute values for `dgm:param` elements
 * within a `dgm:alg` algorithm definition. Each parameter controls a
 * specific aspect of the algorithm's positioning behavior.
 *
 * @see ECMA-376 Part 1, Section 21.4.7.43 (ST_ParameterId)
 */
export const ParameterId = {
  // ── Alignment Parameters ──────────────────────────────────────────────────

  /** Horizontal alignment of children within the layout area. */
  horzAlign: 'horzAlign',

  /** Vertical alignment of children within the layout area. */
  vertAlign: 'vertAlign',

  /** Horizontal alignment for individual nodes (hierarchy algorithms). */
  nodeHorzAlign: 'nodeHorzAlign',

  /** Vertical alignment for individual nodes (hierarchy algorithms). */
  nodeVertAlign: 'nodeVertAlign',

  /** Hierarchy alignment (16 possible values for tree orientation). */
  hierAlign: 'hierAlign',

  /** Text alignment (whether text should be aligned with shape). */
  alignTx: 'alignTx',

  // ── Direction Parameters ──────────────────────────────────────────────────

  /** Child direction (horizontal or vertical arrangement of children). */
  chDir: 'chDir',

  /** Child alignment (how children align on the cross-axis). */
  chAlign: 'chAlign',

  /** Secondary child alignment (for complex hierarchy layouts). */
  secChAlign: 'secChAlign',

  /** Linear direction (which edge children flow from). */
  linDir: 'linDir',

  /** Secondary linear direction (for complex hierarchy layouts). */
  secLinDir: 'secLinDir',

  /** Text direction (horizontal or vertical text blocks). */
  txDir: 'txDir',

  /** Text block direction (horizontal or vertical text flow). */
  txBlDir: 'txBlDir',

  /** Growth direction (which corner the snake starts from). */
  grDir: 'grDir',

  /** Flow direction (whether snake flows by row or column). */
  flowDir: 'flowDir',

  /** Continue direction (same direction or reversed for each row). */
  contDir: 'contDir',

  // ── Connector Parameters ──────────────────────────────────────────────────

  /** Connector routing style (straight, bend, curve, long curve). */
  connRout: 'connRout',

  /** Beginning/start arrowhead style for connectors. */
  begSty: 'begSty',

  /** Ending arrowhead style for connectors. */
  endSty: 'endSty',

  /** Connector dimension (1D, 2D, or custom). */
  dim: 'dim',

  /** Source node name for connector routing. */
  srcNode: 'srcNode',

  /** Destination node name for connector routing. */
  dstNode: 'dstNode',

  /** Beginning connection points (which points on the source shape). */
  begPts: 'begPts',

  /** Ending connection points (which points on the destination shape). */
  endPts: 'endPts',

  /** Bend point position for right-angle connectors. */
  bendPt: 'bendPt',

  // ── Cycle/Circular Parameters ─────────────────────────────────────────────

  /** Start angle in degrees for cycle algorithm. */
  stAng: 'stAng',

  /** Span angle in degrees for cycle algorithm. */
  spanAng: 'spanAng',

  /** Rotation path (none or along the circular path). */
  rotPath: 'rotPath',

  /** Center shape mapping (whether first node goes to center). */
  ctrShpMap: 'ctrShpMap',

  // ── Snake Parameters ──────────────────────────────────────────────────────

  /** Breakpoint logic for snake wrapping (end of canvas, balanced, fixed). */
  bkpt: 'bkpt',

  /** Breakpoint fixed value (number of items per row when bkpt=fixed). */
  bkPtFixedVal: 'bkPtFixedVal',

  /** Offset mode for staggered rows in snake layout. */
  off: 'off',

  // ── Linear/Sequence Parameters ────────────────────────────────────────────

  /** Starting element index (which node type starts the alternating sequence). */
  stElem: 'stElem',

  /** Starting bullet level for text algorithm. */
  stBulletLvl: 'stBulletLvl',

  // ── Pyramid Parameters ────────────────────────────────────────────────────

  /** Pyramid accent position (before or after the level). */
  pyraAcctPos: 'pyraAcctPos',

  /** Pyramid accent text margin (step or stack behavior). */
  pyraAcctTxMar: 'pyraAcctTxMar',

  /** Pyramid level node name. */
  pyraLvlNode: 'pyraLvlNode',

  /** Pyramid accent background node name. */
  pyraAcctBkgdNode: 'pyraAcctBkgdNode',

  /** Pyramid accent text node name. */
  pyraAcctTxNode: 'pyraAcctTxNode',

  // ── Text Parameters ───────────────────────────────────────────────────────

  /** Parent text LTR alignment. */
  parTxLTRAlign: 'parTxLTRAlign',

  /** Parent text RTL alignment. */
  parTxRTLAlign: 'parTxRTLAlign',

  /** Shape text LTR alignment for children. */
  shpTxLTRAlignCh: 'shpTxLTRAlignCh',

  /** Shape text RTL alignment for children. */
  shpTxRTLAlignCh: 'shpTxRTLAlignCh',

  /** Text anchor horizontal position. */
  txAnchorHorz: 'txAnchorHorz',

  /** Text anchor vertical position. */
  txAnchorVert: 'txAnchorVert',

  /** Text anchor horizontal position for children. */
  txAnchorHorzCh: 'txAnchorHorzCh',

  /** Text anchor vertical position for children. */
  txAnchorVertCh: 'txAnchorVertCh',

  /** Auto text rotation mode (none, upright, gravity-based). */
  autoTxRot: 'autoTxRot',

  // ── Spacing & Sizing Parameters ───────────────────────────────────────────

  /** Aspect ratio value. */
  ar: 'ar',

  /** Line spacing for parent text (percentage). */
  lnSpPar: 'lnSpPar',

  /** Line spacing after parent paragraph (percentage). */
  lnSpAfParP: 'lnSpAfParP',

  /** Line spacing for child text (percentage). */
  lnSpCh: 'lnSpCh',

  /** Line spacing after child paragraph (percentage). */
  lnSpAfChP: 'lnSpAfChP',

  // ── Hierarchy-Specific Parameters ─────────────────────────────────────────

  /** Root short distance flag (hierarchy algorithms). */
  rtShortDist: 'rtShortDist',

  // ── Fallback Parameter ────────────────────────────────────────────────────

  /** Fallback dimension for the algorithm. */
  fallback: 'fallback',
} as const;

/** Union type of all valid parameter ID values. */
export type ParameterIdValue = (typeof ParameterId)[keyof typeof ParameterId];

// =============================================================================
// ST_HorizontalAlignment
// =============================================================================

/**
 * Horizontal alignment values for layout algorithms.
 *
 * Used by: horzAlign, nodeHorzAlign, txAnchorHorz, txAnchorHorzCh
 *
 * @see ECMA-376 Part 1, Section 21.4.7.29 (ST_HorizontalAlignment)
 */
export const HorizontalAlignment = {
  /** Left-aligned. */
  l: 'l',
  /** Center-aligned. */
  ctr: 'ctr',
  /** Right-aligned. */
  r: 'r',
  /** No alignment specified (use default). */
  none: 'none',
} as const;

/** Union type of all valid horizontal alignment values. */
export type HorizontalAlignmentValue =
  (typeof HorizontalAlignment)[keyof typeof HorizontalAlignment];

// =============================================================================
// ST_VerticalAlignment
// =============================================================================

/**
 * Vertical alignment values for layout algorithms.
 *
 * Used by: vertAlign, nodeVertAlign, txAnchorVert, txAnchorVertCh
 *
 * @see ECMA-376 Part 1, Section 21.4.7.58 (ST_VerticalAlignment)
 */
export const VerticalAlignment = {
  /** Top-aligned. */
  t: 't',
  /** Middle-aligned (centered vertically). */
  mid: 'mid',
  /** Bottom-aligned. */
  b: 'b',
  /** No alignment specified (use default). */
  none: 'none',
} as const;

/** Union type of all valid vertical alignment values. */
export type VerticalAlignmentValue = (typeof VerticalAlignment)[keyof typeof VerticalAlignment];

// =============================================================================
// ST_ChildDirection
// =============================================================================

/**
 * Child direction values.
 *
 * Controls whether children are arranged horizontally or vertically.
 *
 * Used by: chDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.12 (ST_ChildDirection)
 */
export const ChildDirection = {
  /** Children arranged horizontally. */
  horz: 'horz',
  /** Children arranged vertically. */
  vert: 'vert',
} as const;

/** Union type of all valid child direction values. */
export type ChildDirectionValue = (typeof ChildDirection)[keyof typeof ChildDirection];

// =============================================================================
// ST_ChildAlignment
// =============================================================================

/**
 * Child alignment values.
 *
 * Controls how children align on the cross-axis (perpendicular to flow direction).
 *
 * Used by: chAlign, secChAlign
 *
 * @see ECMA-376 Part 1, Section 21.4.7.11 (ST_ChildAlignment)
 */
export const ChildAlignment = {
  /** Top-aligned (for horizontal flow). */
  t: 't',
  /** Bottom-aligned (for horizontal flow). */
  b: 'b',
  /** Left-aligned (for vertical flow). */
  l: 'l',
  /** Right-aligned (for vertical flow). */
  r: 'r',
} as const;

/** Union type of all valid child alignment values. */
export type ChildAlignmentValue = (typeof ChildAlignment)[keyof typeof ChildAlignment];

// =============================================================================
// ST_LinearDirection
// =============================================================================

/**
 * Linear direction values.
 *
 * Controls the direction of flow in linear and hierarchy algorithms.
 *
 * Used by: linDir, secLinDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.36 (ST_LinearDirection)
 */
export const LinearDirection = {
  /** Flow from left to right. */
  fromL: 'fromL',
  /** Flow from right to left. */
  fromR: 'fromR',
  /** Flow from top to bottom. */
  fromT: 'fromT',
  /** Flow from bottom to top. */
  fromB: 'fromB',
} as const;

/** Union type of all valid linear direction values. */
export type LinearDirectionValue = (typeof LinearDirection)[keyof typeof LinearDirection];

// =============================================================================
// ST_ConnectorRouting
// =============================================================================

/**
 * Connector routing style values.
 *
 * Controls how connector lines are routed between shapes.
 *
 * Used by: connRout
 *
 * @see ECMA-376 Part 1, Section 21.4.7.14 (ST_ConnectorRouting)
 */
export const ConnectorRouting = {
  /** Straight line connection. */
  stra: 'stra',
  /** Right-angle bend connection. */
  bend: 'bend',
  /** Smooth curve connection. */
  curve: 'curve',
  /** Long smooth curve connection. */
  longCurve: 'longCurve',
} as const;

/** Union type of all valid connector routing values. */
export type ConnectorRoutingValue = (typeof ConnectorRouting)[keyof typeof ConnectorRouting];

// =============================================================================
// ST_ArrowheadStyle
// =============================================================================

/**
 * Arrowhead style values for connectors.
 *
 * Controls whether arrowheads appear on connector endpoints.
 *
 * Used by: begSty, endSty
 *
 * @see ECMA-376 Part 1, Section 21.4.7.4 (ST_ArrowheadStyle)
 */
export const ArrowheadStyle = {
  /** Automatic arrowhead (determined by algorithm). */
  auto: 'auto',
  /** Show arrowhead. */
  arr: 'arr',
  /** No arrowhead. */
  noArr: 'noArr',
} as const;

/** Union type of all valid arrowhead style values. */
export type ArrowheadStyleValue = (typeof ArrowheadStyle)[keyof typeof ArrowheadStyle];

// =============================================================================
// ST_ConnectorDimension
// =============================================================================

/**
 * Connector dimension values.
 *
 * Controls whether connectors are 1D (lines) or 2D (shapes with area).
 *
 * Used by: dim
 *
 * @see ECMA-376 Part 1, Section 21.4.7.13 (ST_ConnectorDimension)
 */
export const ConnectorDimension = {
  /** One-dimensional line connector. */
  '1D': '1D',
  /** Two-dimensional shape connector. */
  '2D': '2D',
  /** Custom dimension connector. */
  cust: 'cust',
} as const;

/** Union type of all valid connector dimension values. */
export type ConnectorDimensionValue = (typeof ConnectorDimension)[keyof typeof ConnectorDimension];

// =============================================================================
// ST_RotationPath
// =============================================================================

/**
 * Rotation path values for cycle algorithm.
 *
 * Controls whether shapes rotate to follow the circular path tangent.
 *
 * Used by: rotPath
 *
 * @see ECMA-376 Part 1, Section 21.4.7.52 (ST_RotationPath)
 */
export const RotationPath = {
  /** No rotation along path (shapes keep their original orientation). */
  none: 'none',
  /** Shapes rotate to follow the path tangent. */
  alongPath: 'alongPath',
} as const;

/** Union type of all valid rotation path values. */
export type RotationPathValue = (typeof RotationPath)[keyof typeof RotationPath];

// =============================================================================
// ST_CenterShapeMapping
// =============================================================================

/**
 * Center shape mapping values for cycle algorithm.
 *
 * Controls whether the first node is placed at the center of the cycle.
 *
 * Used by: ctrShpMap
 *
 * @see ECMA-376 Part 1, Section 21.4.7.10 (ST_CenterShapeMapping)
 */
export const CenterShapeMapping = {
  /** No center shape mapping; all nodes on the circle. */
  none: 'none',
  /** First node placed at the center of the circle. */
  fNode: 'fNode',
} as const;

/** Union type of all valid center shape mapping values. */
export type CenterShapeMappingValue = (typeof CenterShapeMapping)[keyof typeof CenterShapeMapping];

// =============================================================================
// ST_GrowDirection
// =============================================================================

/**
 * Growth direction values for snake algorithm.
 *
 * Controls which corner the snake layout starts from and grows toward.
 *
 * Used by: grDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.28 (ST_GrowDirection)
 */
export const GrowDirection = {
  /** Start from top-left, grow right and down. */
  tL: 'tL',
  /** Start from top-right, grow left and down. */
  tR: 'tR',
  /** Start from bottom-left, grow right and up. */
  bL: 'bL',
  /** Start from bottom-right, grow left and up. */
  bR: 'bR',
} as const;

/** Union type of all valid growth direction values. */
export type GrowDirectionValue = (typeof GrowDirection)[keyof typeof GrowDirection];

// =============================================================================
// ST_FlowDirection
// =============================================================================

/**
 * Flow direction values for snake algorithm.
 *
 * Controls whether the primary flow axis is horizontal (row) or vertical (column).
 *
 * Used by: flowDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.26 (ST_FlowDirection)
 */
export const FlowDirection = {
  /** Flow in rows (horizontal primary axis). */
  row: 'row',
  /** Flow in columns (vertical primary axis). */
  col: 'col',
} as const;

/** Union type of all valid flow direction values. */
export type FlowDirectionValue = (typeof FlowDirection)[keyof typeof FlowDirection];

// =============================================================================
// ST_ContinueDirection
// =============================================================================

/**
 * Continue direction values for snake algorithm.
 *
 * Controls whether each row/column flows in the same direction or alternates
 * (boustrophedon layout, like reading alternating lines left-to-right then
 * right-to-left).
 *
 * Used by: contDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.15 (ST_ContinueDirection)
 */
export const ContinueDirection = {
  /** Reverse direction for each new row/column. */
  revDir: 'revDir',
  /** Same direction for each new row/column. */
  sameDir: 'sameDir',
} as const;

/** Union type of all valid continue direction values. */
export type ContinueDirectionValue = (typeof ContinueDirection)[keyof typeof ContinueDirection];

// =============================================================================
// ST_Breakpoint
// =============================================================================

/**
 * Breakpoint values for snake algorithm.
 *
 * Controls when the snake wraps to the next row/column.
 *
 * Used by: bkpt
 *
 * @see ECMA-376 Part 1, Section 21.4.7.8 (ST_Breakpoint)
 */
export const Breakpoint = {
  /** Break when reaching the end of the canvas/bounds. */
  endCnv: 'endCnv',
  /** Balanced breakpoints (evenly distribute items across rows). */
  bal: 'bal',
  /** Fixed number of items per row (see bkPtFixedVal). */
  fixed: 'fixed',
} as const;

/** Union type of all valid breakpoint values. */
export type BreakpointValue = (typeof Breakpoint)[keyof typeof Breakpoint];

// =============================================================================
// ST_Offset
// =============================================================================

/**
 * Offset values for snake algorithm.
 *
 * Controls whether rows are centered or staggered (offset).
 *
 * Used by: off
 *
 * @see ECMA-376 Part 1, Section 21.4.7.42 (ST_Offset)
 */
export const Offset = {
  /** Rows are centered (no offset). */
  ctr: 'ctr',
  /** Rows are offset/staggered. */
  off: 'off',
} as const;

/** Union type of all valid offset values. */
export type OffsetValue = (typeof Offset)[keyof typeof Offset];

// =============================================================================
// ST_HierarchyAlignment
// =============================================================================

/**
 * Hierarchy alignment values for hierRoot algorithm.
 *
 * Controls tree orientation and how the root node aligns relative to
 * its hierarchy children. The 16 values represent all combinations of:
 * - Edge position: top (t), bottom (b), left (l), right (r)
 * - Alignment: left/top (L/T), right/bottom (R/B), center-children (CtrCh), center-descendants (CtrDes)
 *
 * Used by: hierAlign
 *
 * @see ECMA-376 Part 1, Section 21.4.7.30 (ST_HierarchyAlignment)
 */
export const HierarchyAlignment = {
  /** Top edge, left-aligned. */
  tL: 'tL',
  /** Top edge, right-aligned. */
  tR: 'tR',
  /** Top edge, centered over children. */
  tCtrCh: 'tCtrCh',
  /** Top edge, centered over all descendants. */
  tCtrDes: 'tCtrDes',

  /** Bottom edge, left-aligned. */
  bL: 'bL',
  /** Bottom edge, right-aligned. */
  bR: 'bR',
  /** Bottom edge, centered over children. */
  bCtrCh: 'bCtrCh',
  /** Bottom edge, centered over all descendants. */
  bCtrDes: 'bCtrDes',

  /** Left edge, top-aligned. */
  lT: 'lT',
  /** Left edge, bottom-aligned. */
  lB: 'lB',
  /** Left edge, centered over children. */
  lCtrCh: 'lCtrCh',
  /** Left edge, centered over all descendants. */
  lCtrDes: 'lCtrDes',

  /** Right edge, top-aligned. */
  rT: 'rT',
  /** Right edge, bottom-aligned. */
  rB: 'rB',
  /** Right edge, centered over children. */
  rCtrCh: 'rCtrCh',
  /** Right edge, centered over all descendants. */
  rCtrDes: 'rCtrDes',
} as const;

/** Union type of all 16 valid hierarchy alignment values. */
export type HierarchyAlignmentValue = (typeof HierarchyAlignment)[keyof typeof HierarchyAlignment];

// =============================================================================
// ST_ConnectorPoint
// =============================================================================

/**
 * Connector point values for connector algorithm.
 *
 * Defines where on a shape the connector line begins or ends.
 * The 11 values cover edges, corners, center, and radial positions.
 *
 * Used by: begPts, endPts
 *
 * @see ECMA-376 Part 1, Section 21.4.7.14 (ST_ConnectorPoint)
 */
export const ConnectorPoint = {
  /** Automatic selection of the best connection point. */
  auto: 'auto',
  /** Bottom center. */
  bCtr: 'bCtr',
  /** Center. */
  ctr: 'ctr',
  /** Middle left. */
  midL: 'midL',
  /** Middle right. */
  midR: 'midR',
  /** Top center. */
  tCtr: 'tCtr',
  /** Bottom left corner. */
  bL: 'bL',
  /** Bottom right corner. */
  bR: 'bR',
  /** Top left corner. */
  tL: 'tL',
  /** Top right corner. */
  tR: 'tR',
  /** Radial connection point (along the line from center to edge). */
  radial: 'radial',
} as const;

/** Union type of all 11 valid connector point values. */
export type ConnectorPointValue = (typeof ConnectorPoint)[keyof typeof ConnectorPoint];

// =============================================================================
// ST_BendPoint
// =============================================================================

/**
 * Bend point values for connector algorithm.
 *
 * Controls where the bend occurs in a right-angle connector.
 *
 * Used by: bendPt
 *
 * @see ECMA-376 Part 1, Section 21.4.7.6 (ST_BendPoint)
 */
export const BendPoint = {
  /** Bend at the beginning of the connector. */
  beg: 'beg',
  /** Default bend position (midpoint). */
  def: 'def',
  /** Bend at the end of the connector. */
  end: 'end',
} as const;

/** Union type of all valid bend point values. */
export type BendPointValue = (typeof BendPoint)[keyof typeof BendPoint];

// =============================================================================
// ST_PyraAcctPosition
// =============================================================================

/**
 * Pyramid accent position values.
 *
 * Controls whether the accent region appears before or after the pyramid level.
 *
 * Used by: pyraAcctPos
 *
 * @see ECMA-376 Part 1, Section 21.4.7.48 (ST_PyramidAccentPosition)
 */
export const PyramidAccentPosition = {
  /** Accent before (to the left of) the pyramid level. */
  bef: 'bef',
  /** Accent after (to the right of) the pyramid level. */
  aft: 'aft',
} as const;

/** Union type of all valid pyramid accent position values. */
export type PyramidAccentPositionValue =
  (typeof PyramidAccentPosition)[keyof typeof PyramidAccentPosition];

// =============================================================================
// ST_PyraAcctTextMargin
// =============================================================================

/**
 * Pyramid accent text margin values.
 *
 * Controls the text margin behavior for pyramid accent regions.
 *
 * Used by: pyraAcctTxMar
 *
 * @see ECMA-376 Part 1, Section 21.4.7.49 (ST_PyramidAccentTextMargin)
 */
export const PyramidAccentTextMargin = {
  /** Step margin (each level has its own margin). */
  step: 'step',
  /** Stack margin (margins accumulate). */
  stack: 'stack',
} as const;

/** Union type of all valid pyramid accent text margin values. */
export type PyramidAccentTextMarginValue =
  (typeof PyramidAccentTextMargin)[keyof typeof PyramidAccentTextMargin];

// =============================================================================
// ST_TextDirection
// =============================================================================

/**
 * Text direction values for pyramid algorithm.
 *
 * Controls the direction of text flow within pyramid levels.
 *
 * Used by: txDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.55 (ST_TextDirection)
 */
export const TextDirection = {
  /** Left-to-right text direction. */
  fromT: 'fromT',
  /** Right-to-left text direction. */
  fromB: 'fromB',
} as const;

/** Union type of all valid text direction values. */
export type TextDirectionValue = (typeof TextDirection)[keyof typeof TextDirection];

// =============================================================================
// ST_TextBlockDirection
// =============================================================================

/**
 * Text block direction values.
 *
 * Controls whether text blocks flow horizontally or vertically.
 *
 * Used by: txBlDir
 *
 * @see ECMA-376 Part 1, Section 21.4.7.54 (ST_TextBlockDirection)
 */
export const TextBlockDirection = {
  /** Horizontal text block. */
  horz: 'horz',
  /** Vertical text block. */
  vert: 'vert',
} as const;

/** Union type of all valid text block direction values. */
export type TextBlockDirectionValue = (typeof TextBlockDirection)[keyof typeof TextBlockDirection];

// =============================================================================
// ST_AutoTextRotation
// =============================================================================

/**
 * Auto text rotation values.
 *
 * Controls automatic text rotation behavior for cycle/radial layouts.
 *
 * Used by: autoTxRot
 *
 * @see ECMA-376 Part 1, Section 21.4.7.5 (ST_AutoTextRotation)
 */
export const AutoTextRotation = {
  /** No automatic rotation; text keeps its original orientation. */
  none: 'none',
  /** Text is rotated to remain upright (readable). */
  upr: 'upr',
  /** Text is rotated based on gravity (bottom edge down). */
  grav: 'grav',
} as const;

/** Union type of all valid auto text rotation values. */
export type AutoTextRotationValue = (typeof AutoTextRotation)[keyof typeof AutoTextRotation];

// =============================================================================
// ST_TextAlignment
// =============================================================================

/**
 * Text alignment values for text algorithm parameters.
 *
 * Used by: parTxLTRAlign, parTxRTLAlign, shpTxLTRAlignCh, shpTxRTLAlignCh
 *
 * @see ECMA-376 Part 1, Section 21.4.7.53 (ST_TextAlignment)
 */
export const TextAlignment = {
  /** Left-aligned. */
  l: 'l',
  /** Center-aligned. */
  ctr: 'ctr',
  /** Right-aligned. */
  r: 'r',
} as const;

/** Union type of all valid text alignment values. */
export type TextAlignmentValue = (typeof TextAlignment)[keyof typeof TextAlignment];

// =============================================================================
// ST_TextAnchorHorizontal
// =============================================================================

/**
 * Text anchor horizontal values.
 *
 * Controls horizontal text anchoring within a shape.
 *
 * Used by: txAnchorHorz, txAnchorHorzCh
 *
 * @see ECMA-376 Part 1, Section 21.4.7.56 (ST_TextAnchorHorizontal)
 */
export const TextAnchorHorizontal = {
  /** No horizontal anchor specified. */
  none: 'none',
  /** Anchor text to the center horizontally. */
  ctr: 'ctr',
} as const;

/** Union type of all valid text anchor horizontal values. */
export type TextAnchorHorizontalValue =
  (typeof TextAnchorHorizontal)[keyof typeof TextAnchorHorizontal];

// =============================================================================
// ST_TextAnchorVertical
// =============================================================================

/**
 * Text anchor vertical values.
 *
 * Controls vertical text anchoring within a shape.
 *
 * Used by: txAnchorVert, txAnchorVertCh
 *
 * @see ECMA-376 Part 1, Section 21.4.7.57 (ST_TextAnchorVertical)
 */
export const TextAnchorVertical = {
  /** Top anchor. */
  t: 't',
  /** Middle anchor. */
  mid: 'mid',
  /** Bottom anchor. */
  b: 'b',
} as const;

/** Union type of all valid text anchor vertical values. */
export type TextAnchorVerticalValue = (typeof TextAnchorVertical)[keyof typeof TextAnchorVertical];

// =============================================================================
// ST_FallbackDimension
// =============================================================================

/**
 * Fallback dimension values.
 *
 * Controls the fallback dimension mode for algorithms.
 *
 * Used by: fallback
 *
 * @see ECMA-376 Part 1, Section 21.4.7.25 (ST_FallbackDimension)
 */
export const FallbackDimension = {
  /** One-dimensional fallback. */
  '1D': '1D',
  /** Two-dimensional fallback. */
  '2D': '2D',
} as const;

/** Union type of all valid fallback dimension values. */
export type FallbackDimensionValue = (typeof FallbackDimension)[keyof typeof FallbackDimension];

// =============================================================================
// Per-Algorithm Parameter Maps
// =============================================================================

/**
 * Parameters valid for the composite algorithm.
 *
 * The composite algorithm positions children using constraints only.
 * It has very few direct parameters.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.1 (Composite Algorithm)
 */
export interface CompositeAlgorithmParams {
  /** Aspect ratio. */
  ar?: string;
}

/**
 * Parameters valid for the linear algorithm.
 *
 * Controls direction, alignment, and element alternation in a straight line.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.2 (Linear Algorithm)
 */
export interface LinearAlgorithmParams {
  /** Flow direction (fromL, fromR, fromT, fromB). */
  linDir?: LinearDirectionValue;
  /** Child direction (horz, vert). */
  chDir?: ChildDirectionValue;
  /** Child alignment (t, b, l, r). */
  chAlign?: ChildAlignmentValue;
  /** Horizontal alignment (l, ctr, r, none). */
  horzAlign?: HorizontalAlignmentValue;
  /** Vertical alignment (t, mid, b, none). */
  vertAlign?: VerticalAlignmentValue;
  /** Starting element index for node/transition alternation. */
  stElem?: string;
  /** Fallback dimension (1D, 2D). */
  fallback?: FallbackDimensionValue;
  /** Node horizontal alignment. */
  nodeHorzAlign?: HorizontalAlignmentValue;
  /** Node vertical alignment. */
  nodeVertAlign?: VerticalAlignmentValue;
}

/**
 * Parameters valid for the snake algorithm.
 *
 * Controls multi-row/column wrapping layout with growth direction,
 * flow direction, breakpoints, and row staggering.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.3 (Snake Algorithm)
 */
export interface SnakeAlgorithmParams {
  /** Growth direction (tL, tR, bL, bR). */
  grDir?: GrowDirectionValue;
  /** Flow direction (row, col). */
  flowDir?: FlowDirectionValue;
  /** Continue direction (sameDir, revDir). */
  contDir?: ContinueDirectionValue;
  /** Breakpoint logic (endCnv, bal, fixed). */
  bkpt?: BreakpointValue;
  /** Breakpoint fixed value (number of items per row). */
  bkPtFixedVal?: string;
  /** Offset mode (ctr, off). */
  off?: OffsetValue;
}

/**
 * Parameters valid for the cycle algorithm.
 *
 * Controls circular/radial arrangement with angles and center shape.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.4 (Cycle Algorithm)
 */
export interface CycleAlgorithmParams {
  /** Start angle in degrees (0 = right/3 o'clock). */
  stAng?: string;
  /** Span angle in degrees (360 = full circle). */
  spanAng?: string;
  /** Rotation path (none, alongPath). */
  rotPath?: RotationPathValue;
  /** Center shape mapping (none, fNode). */
  ctrShpMap?: CenterShapeMappingValue;
}

/**
 * Parameters valid for the hierRoot algorithm.
 *
 * Controls hierarchy root positioning relative to child branches.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.5 (Hierarchy Root Algorithm)
 */
export interface HierRootAlgorithmParams {
  /** Hierarchy alignment (16 values). */
  hierAlign?: HierarchyAlignmentValue;
  /** Node horizontal alignment. */
  nodeHorzAlign?: HorizontalAlignmentValue;
  /** Node vertical alignment. */
  nodeVertAlign?: VerticalAlignmentValue;
  /** Root short distance flag. */
  rtShortDist?: string;
}

/**
 * Parameters valid for the hierChild algorithm.
 *
 * Controls hierarchy child positioning under parent nodes.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.6 (Hierarchy Child Algorithm)
 */
export interface HierChildAlgorithmParams {
  /** Child alignment (t, b, l, r). */
  chAlign?: ChildAlignmentValue;
  /** Linear direction (fromL, fromR, fromT, fromB). */
  linDir?: LinearDirectionValue;
  /** Secondary child alignment. */
  secChAlign?: ChildAlignmentValue;
  /** Secondary linear direction. */
  secLinDir?: LinearDirectionValue;
}

/**
 * Parameters valid for the pyramid algorithm.
 *
 * Controls vertical trapezoid arrangement with accent regions.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.7 (Pyramid Algorithm)
 */
export interface PyramidAlgorithmParams {
  /** Linear direction (fromT, fromB). */
  linDir?: LinearDirectionValue;
  /** Text direction. */
  txDir?: TextDirectionValue;
  /** Accent position (bef, aft). */
  pyraAcctPos?: PyramidAccentPositionValue;
  /** Accent text margin (step, stack). */
  pyraAcctTxMar?: PyramidAccentTextMarginValue;
  /** Pyramid level node name. */
  pyraLvlNode?: string;
  /** Pyramid accent background node name. */
  pyraAcctBkgdNode?: string;
  /** Pyramid accent text node name. */
  pyraAcctTxNode?: string;
}

/**
 * Parameters valid for the connector algorithm.
 *
 * Controls line routing between shapes with arrowheads and bend points.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.8 (Connector Algorithm)
 */
export interface ConnectorAlgorithmParams {
  /** Source node name. */
  srcNode?: string;
  /** Destination node name. */
  dstNode?: string;
  /** Connector routing style (stra, bend, curve, longCurve). */
  connRout?: ConnectorRoutingValue;
  /** Beginning arrowhead style (auto, arr, noArr). */
  begSty?: ArrowheadStyleValue;
  /** Ending arrowhead style (auto, arr, noArr). */
  endSty?: ArrowheadStyleValue;
  /** Connector dimension (1D, 2D, cust). */
  dim?: ConnectorDimensionValue;
  /** Bend point position (beg, def, end). */
  bendPt?: BendPointValue;
  /** Beginning connection points. */
  begPts?: ConnectorPointValue;
  /** Ending connection points. */
  endPts?: ConnectorPointValue;
}

/**
 * Parameters valid for the text algorithm.
 *
 * Controls text auto-sizing, alignment, anchoring, and rotation.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.9 (Text Algorithm)
 */
export interface TextAlgorithmParams {
  /** Parent text LTR alignment (l, ctr, r). */
  parTxLTRAlign?: TextAlignmentValue;
  /** Parent text RTL alignment (l, ctr, r). */
  parTxRTLAlign?: TextAlignmentValue;
  /** Shape text LTR alignment for children. */
  shpTxLTRAlignCh?: TextAlignmentValue;
  /** Shape text RTL alignment for children. */
  shpTxRTLAlignCh?: TextAlignmentValue;
  /** Text anchor vertical (t, mid, b). */
  txAnchorVert?: TextAnchorVerticalValue;
  /** Text anchor horizontal (none, ctr). */
  txAnchorHorz?: TextAnchorHorizontalValue;
  /** Text anchor vertical for children. */
  txAnchorVertCh?: TextAnchorVerticalValue;
  /** Text anchor horizontal for children. */
  txAnchorHorzCh?: TextAnchorHorizontalValue;
  /** Text block direction (horz, vert). */
  txBlDir?: TextBlockDirectionValue;
  /** Auto text rotation (none, upr, grav). */
  autoTxRot?: AutoTextRotationValue;
  /** Starting bullet level. */
  stBulletLvl?: string;
  /** Line spacing for parent text. */
  lnSpPar?: string;
  /** Line spacing after parent paragraph. */
  lnSpAfParP?: string;
  /** Line spacing for child text. */
  lnSpCh?: string;
  /** Line spacing after child paragraph. */
  lnSpAfChP?: string;
  /** Text alignment flag. */
  alignTx?: string;
}

/**
 * Parameters valid for the space algorithm.
 *
 * The space algorithm has no parameters. It simply allocates space
 * as an invisible placeholder.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.10 (Space Algorithm)
 */
export interface SpaceAlgorithmParams {
  // No parameters. Space algorithm is parameterless.
}

// =============================================================================
// Algorithm Parameter Union
// =============================================================================

/**
 * Union of all per-algorithm parameter interfaces.
 *
 * Used for type-safe access when the algorithm type is known at compile time.
 */
export type AlgorithmParams =
  | CompositeAlgorithmParams
  | LinearAlgorithmParams
  | SnakeAlgorithmParams
  | CycleAlgorithmParams
  | HierRootAlgorithmParams
  | HierChildAlgorithmParams
  | PyramidAlgorithmParams
  | ConnectorAlgorithmParams
  | TextAlgorithmParams
  | SpaceAlgorithmParams;

/**
 * Mapping from algorithm type to its valid parameter interface.
 *
 * This type enables type-safe parameter access when the algorithm type
 * is known. Usage:
 * ```typescript
 * function getParams<T extends AlgorithmTypeValue>(
 *   type: T,
 *   params: Record<string, string>
 * ): AlgorithmParamMap[T] { ... }
 * ```
 */
export interface AlgorithmParamMap {
  composite: CompositeAlgorithmParams;
  lin: LinearAlgorithmParams;
  snake: SnakeAlgorithmParams;
  cycle: CycleAlgorithmParams;
  hierRoot: HierRootAlgorithmParams;
  hierChild: HierChildAlgorithmParams;
  pyra: PyramidAlgorithmParams;
  conn: ConnectorAlgorithmParams;
  tx: TextAlgorithmParams;
  sp: SpaceAlgorithmParams;
}

// =============================================================================
// Valid Parameter Sets
// =============================================================================

/**
 * Set of valid parameter IDs for each algorithm type.
 *
 * This is the definitive reference for which parameters each algorithm accepts.
 * Parameters not in the valid set for an algorithm should be ignored during parsing.
 *
 * @see ECMA-376 Part 1, Section 21.4.4 (Algorithm Definitions)
 */
export const VALID_PARAMS_BY_ALGORITHM: Readonly<
  Record<AlgorithmTypeValue, ReadonlyArray<ParameterIdValue>>
> = {
  composite: [ParameterId.ar],
  lin: [
    ParameterId.linDir,
    ParameterId.chDir,
    ParameterId.chAlign,
    ParameterId.horzAlign,
    ParameterId.vertAlign,
    ParameterId.stElem,
    ParameterId.fallback,
    ParameterId.nodeHorzAlign,
    ParameterId.nodeVertAlign,
  ],
  snake: [
    ParameterId.grDir,
    ParameterId.flowDir,
    ParameterId.contDir,
    ParameterId.bkpt,
    ParameterId.bkPtFixedVal,
    ParameterId.off,
  ],
  cycle: [ParameterId.stAng, ParameterId.spanAng, ParameterId.rotPath, ParameterId.ctrShpMap],
  hierRoot: [
    ParameterId.hierAlign,
    ParameterId.nodeHorzAlign,
    ParameterId.nodeVertAlign,
    ParameterId.rtShortDist,
  ],
  hierChild: [
    ParameterId.chAlign,
    ParameterId.linDir,
    ParameterId.secChAlign,
    ParameterId.secLinDir,
  ],
  pyra: [
    ParameterId.linDir,
    ParameterId.txDir,
    ParameterId.pyraAcctPos,
    ParameterId.pyraAcctTxMar,
    ParameterId.pyraLvlNode,
    ParameterId.pyraAcctBkgdNode,
    ParameterId.pyraAcctTxNode,
  ],
  conn: [
    ParameterId.srcNode,
    ParameterId.dstNode,
    ParameterId.connRout,
    ParameterId.begSty,
    ParameterId.endSty,
    ParameterId.dim,
    ParameterId.bendPt,
    ParameterId.begPts,
    ParameterId.endPts,
  ],
  tx: [
    ParameterId.parTxLTRAlign,
    ParameterId.parTxRTLAlign,
    ParameterId.shpTxLTRAlignCh,
    ParameterId.shpTxRTLAlignCh,
    ParameterId.txAnchorVert,
    ParameterId.txAnchorHorz,
    ParameterId.txAnchorVertCh,
    ParameterId.txAnchorHorzCh,
    ParameterId.txBlDir,
    ParameterId.autoTxRot,
    ParameterId.stBulletLvl,
    ParameterId.lnSpPar,
    ParameterId.lnSpAfParP,
    ParameterId.lnSpCh,
    ParameterId.lnSpAfChP,
    ParameterId.alignTx,
  ],
  sp: [],
} as const;
