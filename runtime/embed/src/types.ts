/**
 * @mog-sdk/embed — Public type definitions.
 *
 * Embed-specific types for the public SDK surface. Workbook, worksheet,
 * viewport, and renderer internals intentionally stay behind the embed handle.
 */

// ---------------------------------------------------------------------------
// Embed-specific types
// ---------------------------------------------------------------------------

/** Lifecycle status for an embedded sheet. */
export type EmbedStatus = 'loading' | 'ready' | 'error' | 'disposed';

/** Renderer options for the embed canvas. */
export interface EmbedRendererOptions {
  /** Show row/col headers (default: true) */
  headers?: boolean;
  /** Show gridlines (default: true) */
  gridlines?: boolean;
  /** Show formula bar chrome (default: true) */
  formulaBar?: boolean;
  /** Show sheet tabs (default: true) */
  sheetTabs?: boolean;
  /** Enable scrolling (default: true) */
  scrollable?: boolean;
  /** Show SheetView-owned viewport scrollbars (default: true) */
  scrollbars?: boolean;
  /** Show SheetView-owned zoom controls (default: true) */
  zoomControls?: boolean;
  /** Enable hover highlight (default: true) */
  hoverHighlight?: boolean;
  /** Device pixel ratio (default: window.devicePixelRatio) */
  dpr?: number;
  /** Theme overrides */
  theme?: {
    gridlineColor?: string;
    headerBg?: string;
    background?: string;
  };
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type EmbedEventMap = {
  ready: void;
  status: EmbedStatus;
  error: Error;
  sheetChange: number;
  select: { row: number; col: number };
};
