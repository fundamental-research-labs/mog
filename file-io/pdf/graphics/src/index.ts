/**
 * @mog/pdf-graphics
 *
 * Canvas-like drawing API built on the RenderBackend interface.
 * The PDF implementation (PdfCanvas) translates high-level drawing commands
 * into PDF content stream operators via a command buffer + IpcBridge.
 *
 * ALL renderers code against RenderBackend, NOT PdfCanvas directly,
 * making the system backend-swappable.
 */

// ── RenderBackend interface ──────────────────────────────────────────
export type { RenderBackend } from './render-backend';

// ── PdfCanvas implementation ─────────────────────────────────────────
export { PdfCanvas } from './pdf-canvas';

// ── ContentOp types ──────────────────────────────────────────────────
export { lineCapToInt, lineJoinToInt } from './content-ops';
export type { ContentOp } from './content-ops';

// ── Types ────────────────────────────────────────────────────────────
export type {
  FontHandle,
  ImageFormat,
  TextBlockOptions,
  TextMeasurement,
  TextOptions,
  TextRun,
} from './types';

// ── IpcBridge ────────────────────────────────────────────────────────
export { MockIpcBridge, TauriFontBridge } from './ipc-bridge';
export type { FinalizedFont, IpcBridge } from './ipc-bridge';

// ── Graphics State ───────────────────────────────────────────────────
export { GraphicsStateStack, cloneState, createDefaultState } from './graphics-state';
export type { GraphicsState } from './graphics-state';

// ── Text (scaffold — AFM fallback for testing) ──────────────────────
// These remain available as fallback metrics. The production path uses
// IpcBridge.measureText() for real TrueType metrics from Rust.
export {
  FONT_METRICS,
  createScaffoldFont,
  getBase14FontName,
  measureTextWidth,
  resolveFontForRun,
} from './text/afm-metrics';

export {
  computeAlignmentX,
  computeAlignmentY,
  getAscender,
  getDescender,
  getXHeight,
  measureSingleText,
  measureTextRuns,
  wrapText,
} from './text/text-layout';

export {
  emitDrawText,
  emitDrawTextRuns,
  emitStrikethrough,
  emitUnderline,
  encodeText,
} from './text/text-renderer';

// ── Pattern Fill ────────────────────────────────────────────────────
export {
  ALL_PATTERN_TYPES,
  PatternCache,
  generatePatternFillOps,
  generatePatternTileOps,
} from './pattern-fill';
export type { ExcelPatternType, PatternDefinition, PatternFillOptions } from './pattern-fill';

// ── Gradient Fill ───────────────────────────────────────────────────
export {
  ShadingCache,
  generateLinearGradientOps,
  generateRadialGradientOps,
  interpolateStops,
  linearAngleToCoords,
} from './gradient-fill';
export type {
  GradientStop,
  LinearGradientOptions,
  RadialGradientOptions,
  ShadingDefinition,
} from './gradient-fill';

// ── Border Renderer ────────────────────────────────────────────────
export {
  ALL_BORDER_STYLES,
  generateBorderOps,
  getBorderDashPattern,
  getBorderLineWidth,
  renderBorderSide,
  renderDiagonalBorder,
  renderDoubleBorder,
} from './border-renderer';
export type { BorderBounds, BorderConfig, ExcelBorderStyle } from './border-renderer';

// ── Image Support ──────────────────────────────────────────────────
export {
  ImageCache,
  computeImageHash,
  createTestJpeg,
  createTestPng,
  generateImagePlacementOps,
  parseImageDimensions,
} from './image-support';
export type { ImageInfo } from './image-support';

// ── Drawing Renderer ───────────────────────────────────────────────
export { renderDrawingObject } from './drawing-renderer';
export type {
  DrawingFill,
  DrawingObject,
  DrawingStroke,
  ShapePathSegment,
} from './drawing-renderer';

// ── Backend Fills (RenderBackend-level gradient + pattern rendering) ──
export {
  renderLinearGradientFill,
  renderPatternFillRect,
  renderRadialGradientFill,
} from './backend-fills';
export type { FillBounds } from './backend-fills';
