/**
 * Layout Module
 *
 * Grid layout computation, visible range calculation, cell iteration,
 * and coordinate conversions.
 *
 * @module grid-renderer/layout
 */

// Types
export type { GridRenderRegion, VisibleCellCallback, VisibleCellInfo } from './types';

// Visible range
export { computeFrozenRange, computeVisibleRange } from './compute-visible-range';

// Cell iteration
export { forEachVisibleCell } from './for-each-visible-cell';

// Grid coordinate system
export { GridCoordinateSystem } from './grid-coords';
export type { CellAddress, CellDocumentRect } from './grid-coords';
