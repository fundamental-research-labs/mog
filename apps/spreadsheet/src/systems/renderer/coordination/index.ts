/**
 * Layout Coordination Feature
 *
 * Re-exports layout coordination module for centralized layout recomputation.
 *
 * @see layout-coordination.ts - Main implementation
 */

export {
  setupLayoutCoordination,
  type LayoutCoordinationConfig,
  type LayoutCoordinationResult,
  type LayoutInputSnapshot,
} from './layout-coordination';

// Sparkline coordination (moved from coordinator/features/sparkline/)
export {
  buildSparklineCoordination,
  type SparklineCoordinationConfig,
  type SparklineCoordinationResult,
} from './sparkline-coordination';
export {
  setupSparklineSelectionCoordination,
  type SparklineSelectionCoordinationConfig,
  type SparklineSelectionCoordinationResult,
} from './sparkline-selection-coordination';

// CF coordination (moved from coordinator/features/cf/)
export {
  buildCFCoordination,
  type CFCoordinationConfig,
  type CFCoordinationResult,
} from './cf-coordination';
