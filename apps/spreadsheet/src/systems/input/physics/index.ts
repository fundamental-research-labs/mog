/**
 * Physics module exports
 *
 * Physics engines for scroll momentum and zoom animations.
 * These are interaction/state concerns, not rendering concerns,
 * hence they live in the coordinator layer.
 *
 * @module state/coordinator/physics
 */

export { ScrollPhysics } from './scroll-physics';
export { DEFAULT_ZOOM_CONFIG, ZoomPhysics } from './zoom-physics';
