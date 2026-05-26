/**
 * Viewport Types
 *
 * A Viewport is the fundamental rendering primitive for the spreadsheet.
 * Everything that shows sheet data—the main grid, freeze panes, AI previews,
 * minimaps, split views—is a viewport.
 *
 * @module viewport
 */

import type { CellRange } from '@mog/types-core/core';

// =============================================================================
// Geometric Primitives
// =============================================================================

/**
 * A 2D point in any coordinate space.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A 2D size (width and height).
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle in any coordinate space.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// Scroll Behavior
// =============================================================================

/**
 * How a viewport responds to scroll input.
 *
 * There is ONE scroll position (owned by coordinator). Each viewport
 * derives its scroll offset based on its ScrollBehavior:
 * - `free`: uses scroll position directly (main viewport)
 * - `horizontal-only`: uses scroll.x, ignores scroll.y (frozen rows)
 * - `vertical-only`: uses scroll.y, ignores scroll.x (frozen cols)
 * - `none`: always (0, 0) (frozen corner, previews)
 * - `linked`: follows another viewport's computed offset
 */
export type ScrollBehavior =
  | { readonly type: 'free' }
  | { readonly type: 'horizontal-only' }
  | { readonly type: 'vertical-only' }
  | { readonly type: 'none' }
  | { readonly type: 'linked'; readonly viewportId: string; readonly axis: 'x' | 'y' };

// =============================================================================
// Viewport Render Config
// =============================================================================

/**
 * Rendering configuration for a viewport.
 */
export interface ViewportRenderConfig {
  /** Show grid lines (default: true) */
  readonly showGridLines: boolean;
  /** Show row/column headers (default: false for overlay viewports) */
  readonly showHeaders: boolean;
  /** Background color (default: white) */
  readonly backgroundColor: string;
  /** Border style for viewport edge */
  readonly border?: { readonly color: string; readonly width: number };
  /** Reduce detail for performance (minimap) */
  readonly lowFidelity: boolean;
  /** Opacity (for overlay viewports) */
  readonly opacity: number;
}

/**
 * Default render config for main viewports.
 */
export const DEFAULT_VIEWPORT_RENDER_CONFIG: ViewportRenderConfig = {
  showGridLines: true,
  showHeaders: false,
  backgroundColor: '#ffffff',
  lowFidelity: false,
  opacity: 1,
};

// =============================================================================
// Viewport
// =============================================================================

/**
 * A Viewport is an independent view into sheet data.
 * This is the fundamental rendering primitive.
 *
 * Viewports are immutable - they are computed fresh whenever inputs change.
 */
export interface Viewport {
  /** Unique identifier */
  readonly id: string;

  /** Position and size on canvas (CSS pixels, after header area) */
  readonly bounds: Rect;

  /** What cells this viewport shows */
  readonly cellRange: CellRange;

  /**
   * Where this viewport starts in document coordinate space.
   *
   * This is critical for freeze panes: when the main viewport starts at row 2 (after
   * 1 frozen row), viewportOrigin.y = frozenRowsHeight (e.g., 21px). This allows
   * correct calculation of viewport-relative coordinates:
   *
   *   localCoord = docCoord - viewportOrigin - scrollOffset
   *
   * For the 4 freeze viewport types:
   * - Corner:      { x: 0, y: 0 }
   * - FrozenRows:  { x: frozenColsWidth, y: 0 }
   * - FrozenCols:  { x: 0, y: frozenRowsHeight }
   * - Main:        { x: frozenColsWidth, y: frozenRowsHeight }
   * - Single (no freeze): { x: 0, y: 0 }
   */
  readonly viewportOrigin: Point;

  /** Current scroll offset within this viewport's cell space */
  readonly scrollOffset: Point;

  /** How this viewport responds to scroll input */
  readonly scrollBehavior: ScrollBehavior;

  /** Which sheet this viewport shows (default: active sheet) */
  readonly sheetId?: string;

  /** Zoom level (default: 1.0) */
  readonly zoom: number;

  /** Rendering configuration */
  readonly renderConfig: ViewportRenderConfig;
}

// =============================================================================
// Viewport Divider
// =============================================================================

/**
 * A divider line between viewports (freeze lines, split bars).
 */
export interface ViewportDivider {
  readonly type: 'freeze' | 'split';
  readonly orientation: 'horizontal' | 'vertical';
  /** Position in canvas coordinates (CSS pixels) */
  readonly position: number;
  readonly draggable: boolean;
}

// =============================================================================
// Header Render Info
// =============================================================================

/**
 * Information needed to render row/column headers with freeze awareness.
 *
 * Headers are NOT viewports, but they follow the same 4-region structure
 * when freeze panes are enabled:
 * - Frozen column headers don't scroll horizontally
 * - Scrolling column headers scroll with scrollPosition.x
 * - Frozen row headers don't scroll vertically
 * - Scrolling row headers scroll with scrollPosition.y
 */
export interface HeaderRenderInfo {
  /** Number of frozen rows (0 if none) */
  readonly frozenRows: number;
  /** Number of frozen columns (0 if none) */
  readonly frozenCols: number;
  /** Pixel height of frozen rows region (unzoomed) */
  readonly frozenRowsHeight: number;
  /** Pixel width of frozen columns region (unzoomed) */
  readonly frozenColsWidth: number;
  /** Current scroll position */
  readonly scrollPosition: Point;
  /** Current zoom level */
  readonly zoom: number;
}

// =============================================================================
// Viewport Layout
// =============================================================================

/**
 * Complete layout of all viewports for a frame.
 * This is the output of computeViewportLayout() - computed fresh from inputs.
 *
 * ViewportLayout is immutable derived state. It is never mutated, only replaced.
 */
export interface ViewportLayout {
  /** All viewports to render, in z-order (first = bottom) */
  readonly viewports: readonly Viewport[];
  /** Which viewport receives keyboard/scroll input */
  readonly primaryViewportId: string;
  /** Divider lines between viewports (freeze lines, split bars) */
  readonly dividers: readonly ViewportDivider[];
  /** Total content size for scroll bounds calculation */
  readonly contentSize: Size;
  /** Maximum scroll position allowed */
  readonly maxScroll: Point;
  /** Header rendering information (freeze-aware) */
  readonly headerInfo: HeaderRenderInfo;
}

// =============================================================================
// Hit Testing
// =============================================================================

/**
 * Result of hit testing a point against the viewport layout.
 */
export interface ViewportHitResult {
  /** The viewport that was hit */
  readonly viewport: Viewport;
  /** Cell coordinate within the viewport */
  readonly cell: {
    readonly row: number;
    readonly col: number;
  };
  /** Point relative to the viewport's bounds */
  readonly localPoint: Point;
}
