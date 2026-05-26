/**
 * @mog/canvas-overlay
 *
 * Screen-space UX chrome for canvas 1 (top canvas).
 * Renders selection handles, guides, rubber band, drag preview, and ink preview.
 *
 * @module @mog/canvas-overlay
 */

// =============================================================================
// Factory & Layer
// =============================================================================

export { OverlayLayer, createOverlayLayer } from './overlay-layer';
export type { OverlayLayerConfig } from './overlay-layer';

// =============================================================================
// Types
// =============================================================================

export type { HandlePosition, OverlayConfig } from './types';

// =============================================================================
// Custom Handles
// =============================================================================

export type { CustomHandle } from './custom-handles';
