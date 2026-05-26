/**
 * @mog/types-viewport — Viewport + views + rendering-primitive types.
 *
 * Tier 1 leaf of the domain graph. Depends only on @mog/types-core.
 *
 * Contains:
 * - geometry.ts, grid-canvas.ts, viewport.ts, viewport-config.ts (from contracts/src/viewport/)
 * - views/ (from contracts/src/views/)
 * - rendering/ pure primitives: constants, primitives, grid-region, grid-renderer-primitives
 *   (from contracts/src/rendering/<pure-leaves>)
 */

export * from './geometry';
export * from './grid-canvas';
export * from './viewport';
export * from './viewport-config';

export * from './views/types';
