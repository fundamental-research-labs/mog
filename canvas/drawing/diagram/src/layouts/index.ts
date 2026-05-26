/**
 * Diagram Layout Algorithms (DEPRECATED)
 *
 * @deprecated This module contains hardcoded layout implementations that are
 * being replaced by the new OOXML layout engine in `src/engine/`.
 *
 * For new code, use:
 * - `computeLayoutFromDefinition()` from `src/engine/layout-engine.ts`
 * - Layout definitions from `src/definitions/`
 *
 * This module is retained for backward compatibility and will be removed
 * in a future major version.
 *
 * This module exports all layout-related functionality:
 * - Layout registry for looking up layout definitions
 * - Base layout class for implementing new layouts
 * - Connector routers for path calculation
 * - Individual layout implementations by category
 */

// =============================================================================
// Registry & Base Classes
// =============================================================================

export { BaseLayoutAlgorithm } from './base-layout';
export type { NodeHierarchyInfo, NodePosition } from './base-layout';
export {
  computeLayout,
  getLayoutImplementation,
  implementationRegistry,
  layoutRegistry,
} from './registry';

// =============================================================================
// Connector Routing
// =============================================================================

export {
  BezierConnectorRouter,
  DirectConnectorRouter,
  OrthogonalConnectorRouter,
  bezierRouter,
  directRouter,
  getRouterByStyle,
  orthogonalRouter,
} from './connector-router';

export type {
  ConnectionPoint,
  ConnectorPath,
  ConnectorRouterOptions,
  IConnectorRouter,
} from './connector-router';

// =============================================================================
// List Layouts
// =============================================================================

export {
  BasicBlockListLayout,
  HorizontalBulletListLayout,
  SquareAccentListLayout,
  StackedListLayout,
  VerticalBlockListLayout,
  listImplementations,
  registerListLayouts,
} from './list';

// =============================================================================
// Process Layouts
// =============================================================================

export {
  BasicBendingProcessLayout,
  BasicProcessLayout,
  BasicTimelineLayout,
  CircleAccentTimelineLayout,
  StepDownProcessLayout,
  processImplementations,
  registerProcessLayouts,
} from './process';

// =============================================================================
// Cycle Layouts
// =============================================================================

export {
  BasicCycleLayout,
  BlockCycleLayout,
  ContinuousCycleLayout,
  NondirectionalCycleLayout,
  TextCycleLayout,
  cycleImplementations,
  registerCycleLayouts,
} from './cycle';

// =============================================================================
// Hierarchy Layouts
// =============================================================================

export {
  HierarchyListLayout,
  HorizontalOrgChartLayout,
  NameAndTitleOrgChartLayout,
  OrganizationChartLayout,
  TableHierarchyLayout,
  hierarchyImplementations,
  registerHierarchyLayouts,
} from './hierarchy';

// =============================================================================
// Relationship Layouts
// =============================================================================

export {
  BalanceLayout,
  BasicRadialLayout,
  BasicVennLayout,
  FunnelLayout,
  TargetLayout,
  registerRelationshipLayouts,
  relationshipImplementations,
} from './relationship';

// =============================================================================
// Matrix Layouts
// =============================================================================

export {
  BasicMatrixLayout,
  ConvergingMatrixLayout,
  CycleMatrixLayout,
  GridMatrixLayout,
  TitledMatrixLayout,
  matrixImplementations,
  registerMatrixLayouts,
} from './matrix';

// =============================================================================
// Pyramid Layouts
// =============================================================================

export {
  BalancePyramidLayout,
  BasicPyramidLayout,
  InvertedPyramidLayout,
  PyramidListLayout,
  SegmentedPyramidLayout,
  pyramidImplementations,
  registerPyramidLayouts,
} from './pyramid';

// =============================================================================
// Picture Layouts
// =============================================================================

export {
  AlternatingPictureBlocksLayout,
  BentUpPictureLayout,
  CirclePictureListLayout,
  PictureCaptionListLayout,
  PictureGridLayout,
  pictureImplementations,
  registerPictureLayouts,
} from './picture';
