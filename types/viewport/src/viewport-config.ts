/**
 * Viewport Configuration Types
 *
 * Configuration types are split into:
 * - PERSISTED: Stored in Yjs, shared across all collaborators
 * - SESSION-LOCAL: Coordinator-owned, per-client
 *
 * @module viewport-config
 */

import type { CellRange } from '@mog/types-core/core';
import type { Rect } from './viewport';

// =============================================================================
// Persisted Viewport Configurations
// =============================================================================

/**
 * Persisted viewport configuration.
 * Stored in Yjs, shared across all collaborators.
 * This is the first-class viewport concept - no legacy "freeze config" indirection.
 */
export type PersistedViewportConfig =
  | SingleViewportConfig
  | FreezeViewportConfig
  | SplitViewportConfig;

/**
 * Default: single viewport showing the active sheet.
 */
export interface SingleViewportConfig {
  readonly type: 'single';
}

/**
 * Freeze panes: 1-4 linked viewports.
 * - rows=0, cols=0: same as SingleViewportConfig
 * - rows>0, cols=0: 2 viewports (frozen rows, main)
 * - rows=0, cols>0: 2 viewports (frozen cols, main)
 * - rows>0, cols>0: 4 viewports (corner, frozen rows, frozen cols, main)
 */
export interface FreezeViewportConfig {
  readonly type: 'freeze';
  /** Number of frozen rows (0 = no frozen rows) */
  readonly rows: number;
  /** Number of frozen columns (0 = no frozen columns) */
  readonly cols: number;
}

/**
 * Split view: 2-4 independently scrolling viewports.
 *
 * Split view creates independent panes that can each scroll separately,
 * allowing users to compare distant regions of the spreadsheet.
 *
 * Viewport IDs by direction:
 * - 'horizontal': 'top', 'bottom' (split along a row)
 * - 'vertical': 'left', 'right' (split along a column)
 * - 'both': 'topLeft', 'topRight', 'bottomLeft', 'bottomRight' (4 quadrants)
 *
 */
export interface SplitViewportConfig {
  readonly type: 'split';
  /** Direction of the split */
  readonly direction: 'horizontal' | 'vertical' | 'both';
  /**
   * Row index for horizontal split line.
   * Used when direction is 'horizontal' or 'both'.
   * Defaults to 0 (ignored) when direction is 'vertical'.
   */
  readonly horizontalPosition: number;
  /**
   * Column index for vertical split line.
   * Used when direction is 'vertical' or 'both'.
   * Defaults to 0 (ignored) when direction is 'horizontal'.
   */
  readonly verticalPosition: number;
}

// =============================================================================
// Session-Local Configurations (Overlays)
// =============================================================================

/**
 * Content type for overlay viewports.
 */
export type OverlayContent =
  | { readonly type: 'range'; readonly sheetId?: string; readonly range: CellRange }
  | { readonly type: 'cell'; readonly sheetId?: string; readonly row: number; readonly col: number }
  | { readonly type: 'custom'; readonly renderer: string };

/**
 * Session-local overlay viewport configuration.
 * Not persisted, not shared. Used for AI previews, focus mode, temporary visualizations.
 */
export interface OverlayViewportConfig {
  readonly id: string;
  readonly bounds: Rect;
  readonly content: OverlayContent;
  /** Whether this overlay receives input events (default: false) */
  readonly interactive?: boolean;
}
