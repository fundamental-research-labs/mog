/**
 * Scroll Handling - Re-export shim
 *
 * This file re-exports scroll functions from @mog/grid-renderer
 * where the canonical definitions now live. It exists to support
 * compute-layout.ts which remains in this package.
 *
 * @module canvas/viewports/scroll
 */

export {
  applyScrollBehavior,
  applyScrollToViewports,
  clampScroll,
  computeMaxScroll,
  scrollToCell,
} from '@mog/grid-renderer';
