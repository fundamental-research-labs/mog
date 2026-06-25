/**
 * Canvas Rendering Constants
 *
 * Dimension and rendering constants shared between canvas and state subsystems.
 * These are foundational values used for layout calculations.
 *
 * Note: Spreadsheet limits (MAX_ROWS, MAX_COLS) remain in @mog-sdk/contracts/core.
 *
 * @module @mog-sdk/contracts/rendering/constants
 */

// =============================================================================
// Grid Defaults
// =============================================================================

/** Default row height in pixels */
export const DEFAULT_ROW_HEIGHT = 20;

/**
 * Default column width — Windows/Linux baseline (96 DPI, Calibri 11pt,
 * max-digit-width ≈ 7 px → 8.43 chars × 7 + 5 padding ≈ 64 px).
 */
export const DEFAULT_COL_WIDTH_WINDOWS = 64;

/**
 * Default column width — macOS (Core Text renders Calibri 11pt with
 * max-digit-width ≈ 8 px → 8.43 chars × 8 + 5 padding ≈ 72 px).
 */
export const DEFAULT_COL_WIDTH_MACOS = 72;

// Detect Mac at module load for the default export.
// Uses navigator.platform (available in all browsers + Tauri webview).
// Falls back to Windows default in non-browser contexts (Node.js, tests).
const _isMac =
  typeof navigator !== 'undefined' &&
  /Mac/.test((navigator as { platform?: string }).platform ?? '');

/** Platform-appropriate default column width in pixels. */
export const DEFAULT_COL_WIDTH: number = _isMac
  ? DEFAULT_COL_WIDTH_MACOS
  : DEFAULT_COL_WIDTH_WINDOWS;

// =============================================================================
// Minimum Dimensions
// =============================================================================

/** Minimum column width in pixels */
export const MIN_COL_WIDTH = 20;

/** Minimum row height in pixels */
export const MIN_ROW_HEIGHT = 16;

// =============================================================================
// Header Dimensions
// =============================================================================

/** Width of row header column (shows row numbers) */
export const ROW_HEADER_WIDTH = 28;

/** Height of column header row (shows column letters) */
export const COL_HEADER_HEIGHT = 24;

// =============================================================================
// Scroll
// =============================================================================

/** Width of scroll bars in pixels */
export const SCROLL_BAR_WIDTH = 14;

// =============================================================================
// Zoom
// =============================================================================

/** Default zoom level (100%) */
export const DEFAULT_ZOOM = 1.0;

/** Minimum zoom level (10%) */
export const MIN_ZOOM = 0.1;

/** Maximum zoom level (400%) */
export const MAX_ZOOM = 4.0;

/** Zoom step increment (10%) */
export const ZOOM_STEP = 0.1;

/** Standard zoom preset values */
export const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 4.0] as const;

// =============================================================================
// Outline/Grouping Dimensions (Stream O)
// =============================================================================

/** Width per outline level for row grouping gutter */
export const OUTLINE_LEVEL_WIDTH = 14;

/** Height per outline level for column grouping gutter */
export const OUTLINE_LEVEL_HEIGHT = 14;

/** Size of the +/- collapse/expand button */
export const OUTLINE_BUTTON_SIZE = 10;

/** Maximum outline levels supported (Excel compatibility) */
export const MAX_OUTLINE_LEVELS = 8;

// =============================================================================
// Virtual Scrolling
// =============================================================================

/** Extra rows to render outside viewport for smooth scrolling */
export const BUFFER_ROWS = 5;

/** Extra columns to render outside viewport for smooth scrolling */
export const BUFFER_COLS = 3;

// =============================================================================
// Hit testing / touch targets
// =============================================================================

/**
 * Minimum hit area size for mouse interactions (in CSS pixels).
 * Allows precise targeting for mouse users.
 */
export const MOUSE_HIT_AREA_SIZE = 5;

/**
 * Minimum hit area size for touch interactions (in CSS pixels).
 * Apple HIG recommends 44x44 points minimum for touch targets.
 * We use a slightly smaller value for resize handles since the
 * header row/column provides additional visual feedback.
 */
export const TOUCH_HIT_AREA_SIZE = 22;

// =============================================================================
// Header Visibility (Dynamic Header Dimensions)
// =============================================================================

/** Header visibility configuration */
export interface HeaderVisibility {
  /** Whether row headers (row numbers) are visible */
  showRowHeaders?: boolean;
  /** Whether column headers (column letters) are visible */
  showColumnHeaders?: boolean;
}
