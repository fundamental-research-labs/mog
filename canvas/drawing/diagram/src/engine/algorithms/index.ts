/**
 * Layout Algorithms
 *
 * OOXML Diagram layout algorithms that position children within layout
 * nodes. Each algorithm implements the ILayoutAlgorithm interface and
 * produces positioned shapes from a layout context.
 *
 * This module exports all 10 OOXML layout algorithms:
 * - Composite: constraint-based absolute positioning
 * - Linear: straight-line arrangement
 * - Snake: multi-row/column wrapping layout
 * - Cycle: circular/radial arrangement
 * - HierRoot: hierarchy root positioning
 * - HierChild: hierarchy child positioning
 * - Pyramid: vertical proportional-width arrangement
 * - Connector: connection line routing
 * - Text: text container with auto-sizing
 * - Space: invisible placeholder
 *
 * @module algorithms
 */

// Algorithm types and interfaces
export type {
  AlgorithmContext,
  AlgorithmDataPoint,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedConnector,
  PositionedShape,
} from './algorithm-types';

// Composite algorithm
export { CompositeAlgorithm, createCompositeAlgorithm } from './composite';

// Linear algorithm
export { LinearAlgorithm, createLinearAlgorithm } from './linear';

// Snake algorithm
export { SnakeAlgorithm, createSnakeAlgorithm, executeSnakeAlgorithm } from './snake';

// Cycle algorithm
export { CycleAlgorithm, createCycleAlgorithm, executeCycleAlgorithm } from './cycle';

// Hierarchy Root algorithm
export { HierRootAlgorithm, createHierRootAlgorithm, executeHierRootAlgorithm } from './hier-root';

// Hierarchy Child algorithm
export {
  HierChildAlgorithm,
  createHierChildAlgorithm,
  executeHierChildAlgorithm,
  executeHierChildSecondaryAlgorithm,
} from './hier-child';

// Pyramid algorithm
export { PyramidAlgorithm, createPyramidAlgorithm } from './pyramid';

// Connector algorithm
export { ConnectorAlgorithm, createConnectorAlgorithm } from './connector';

// Text algorithm
export { TextAlgorithm, createTextAlgorithm } from './text';

// Space algorithm
export { SpaceAlgorithm, createSpaceAlgorithm } from './space';
