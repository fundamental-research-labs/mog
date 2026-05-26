/**
 * Coordinate System Module
 *
 * Single source of truth for all coordinate conversions in the renderer.
 *
 * @module canvas/coordinates
 */

// Types (re-exports from contracts)
export type {
  CellCoord,
  CellRange,
  CoordinateSystem,
  FrozenPanes,
  HitTestResult,
  Point,
  Rect,
  ScrollViewport,
  VisibleRegions,
} from './types';

// Implementation
export {
  CoordinateSystemImpl,
  createCoordinateSystem,
  isOnFillHandle,
  isOnSelectionBorder,
  isOnTableResizeHandle,
} from './coordinate-system';

// Viewport Position Index
export { ViewportPositionIndex } from './viewport-position-index';

// Viewport Merge Index
export {
  ViewportMergeIndex,
  type MergeRegion,
  type BinaryMergeInput,
} from './viewport-merge-index';
