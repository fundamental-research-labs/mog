/**
 * Mark Renderer - Dispatches rendering for each mark type
 *
 * This module re-exports the unified rendering functions from the marks module.
 * The actual rendering implementations are in the individual mark files.
 *
 * No framework dependencies - pure Canvas2D operations.
 */

// Re-export from marks module for convenience
export {
  applyStyle,
  renderArc,
  renderMark,
  renderMarks,
  renderPath,
  renderRect,
  renderSymbol,
  renderText,
} from '../marks';

// Re-export types
export type {
  AnyMark,
  ArcMark,
  Mark,
  MarkStyle,
  PathMark,
  RectMark,
  SymbolMark,
  TextMark,
} from '../types';
