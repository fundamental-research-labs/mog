/**
 * Canvas Overlay Types
 *
 * Shared types and configuration for the canvas overlay package.
 * This package renders screen-space UX chrome on canvas 1 (the top canvas):
 * handles, guides, rubber band selection, drag preview, ink preview.
 *
 * @module @mog/canvas-overlay
 */

import type { Point, Rect } from '@mog/canvas-engine';

// =============================================================================
// Screen-Space Bounds
// =============================================================================

/**
 * Screen-space bounds with rotation.
 *
 * Combines position/size from OverlayDataSource with rotation,
 * all in CSS pixels (post-zoom). Handles render at consistent
 * sizes regardless of document zoom level.
 */
export interface ScreenBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

// =============================================================================
// Overlay Configuration
// =============================================================================

/**
 * Configuration for the overlay layer.
 * All sizes are in CSS pixels (DPR-independent).
 */
export interface OverlayConfig {
  /** Visual size of resize handles (default: 12 CSS pixels) */
  readonly handleSize: number;
  /** Hit area expansion beyond visual handle (default: 4 CSS pixels) */
  readonly handleHitExpansion: number;
  /** Distance of rotation handle above object (default: 25 CSS pixels) */
  readonly rotationHandleOffset: number;
  /** Selection outline and handle stroke color (default: '#217346') */
  readonly selectionColor: string;
  /** Selection outline width (default: 2) */
  readonly selectionWidth: number;
  /** Handle fill color (default: '#ffffff') */
  readonly handleFillColor: string;
  /** Handle stroke color (default: '#217346') */
  readonly handleStrokeColor: string;
  /** Drag preview opacity (default: 0.5) */
  readonly dragPreviewOpacity: number;
  /** Smart guide line color (default: '#FF00FF' magenta) */
  readonly guideColor: string;
  /** Guide line width (default: 1) */
  readonly guideLineWidth: number;
  /** Rubber band border color (default: '#217346') */
  readonly rubberBandBorderColor: string;
  /** Rubber band fill color (default: 'rgba(33,115,70,0.1)') */
  readonly rubberBandFillColor: string;
  /** Below this screen-space size, show only corner handles (default: 40) */
  readonly smallObjectThreshold: number;
  /** Below this screen-space size, show no handles at all (default: 20) */
  readonly tinyObjectThreshold: number;
  /** Multi-selection group bounding box dash pattern (default: [4, 4]) */
  readonly groupDashPattern: readonly number[];
}

/**
 * Default overlay configuration.
 */
export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  handleSize: 12,
  handleHitExpansion: 4,
  rotationHandleOffset: 25,
  selectionColor: '#217346',
  selectionWidth: 2,
  handleFillColor: '#ffffff',
  handleStrokeColor: '#217346',
  dragPreviewOpacity: 0.5,
  guideColor: '#FF00FF',
  guideLineWidth: 1,
  rubberBandBorderColor: '#217346',
  rubberBandFillColor: 'rgba(33,115,70,0.1)',
  smallObjectThreshold: 40,
  tinyObjectThreshold: 20,
  groupDashPattern: [4, 4],
};

// =============================================================================
// Handle Types
// =============================================================================

/**
 * Handle region identifiers for hit testing.
 * These correspond to the 8 resize handles, rotation handle, and custom handles.
 */
export type HandleRegion =
  | 'resize-nw'
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | 'rotation'
  | 'warp-adjust';

/**
 * A handle position in screen-space with its region type.
 */
export interface HandlePosition {
  readonly x: number;
  readonly y: number;
  readonly region: HandleRegion;
}

// =============================================================================
// Handle Visibility
// =============================================================================

/**
 * Determines which handles to show based on object screen-space size and lock state.
 */
export type HandleVisibility =
  | 'all' // Normal: 8 resize + rotation + custom
  | 'corners-only' // Small object (<40px): 4 corner handles only
  | 'none'; // Tiny object (<20px) or locked: no handles

/**
 * Determine handle visibility based on screen-space bounds and lock state.
 */
export function getHandleVisibility(
  bounds: { width: number; height: number },
  isLocked: boolean,
  config: Pick<OverlayConfig, 'smallObjectThreshold' | 'tinyObjectThreshold'>,
): HandleVisibility {
  if (isLocked) return 'none';

  const minDimension = Math.min(bounds.width, bounds.height);
  if (minDimension < config.tinyObjectThreshold) return 'none';
  if (minDimension < config.smallObjectThreshold) return 'corners-only';
  return 'all';
}

// =============================================================================
// Hit Test Result
// =============================================================================

/**
 * Result from overlay hit testing.
 */
export interface OverlayHitResult {
  /** The handle region that was hit */
  readonly region: HandleRegion;
  /** The object ID this handle belongs to (or group ID for multi-selection) */
  readonly objectId: string | null;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { Point, Rect };
