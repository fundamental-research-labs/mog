// Re-export types from contracts
export type { ShapeType } from '@mog-sdk/contracts/floating-objects';
export type {
  ColorTheme,
  ColorThemeId,
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  ConnectorType,
  ILayoutRegistry,
  LayoutAlgorithm,
  LayoutResult,
  NodeId,
  QuickStyle,
  QuickStyleId,
  ShapeEffects,
  DiagramCategory,
  Diagram,
  DiagramLayoutDefinition,
  DiagramNode,
  TextStyle,
} from '@mog-sdk/contracts/diagram';

// Models (diagram CRUD operations)
export {
  addNodeToDiagram,
  changeLayout,
  createDiagram,
  createNode,
  createNodeId,
  demoteNode,
  moveNodeDown,
  moveNodeUp,
  promoteNode,
  removeNodeFromDiagram,
  updateNodeText,
} from './models';

// =============================================================================
// Layout Computation (Legacy System - Primary Path)
// =============================================================================

// Legacy layout system - hardcoded per-layout algorithms
export { computeLayout, layoutRegistry } from './layouts';

// =============================================================================
// Styles (quick styles, color themes, node color generation)
// =============================================================================

// Quick Styles - 16 Excel-compatible quick styles
export {
  applyQuickStyleToShape,
  getAllQuickStyleIds,
  getQuickStyle,
  getQuickStylesByCategory,
  quickStyles,
} from './styles';

// Color Themes - 36+ Excel-compatible color themes
export {
  colorThemes,
  darkenColor,
  DEFAULT_ACCENT_COLORS,
  generateNodeColors,
  getAllColorThemeIds,
  getColorTheme,
  getColorThemesByCategory,
  hexToRgb,
  interpolateColors,
  lightenColor,
  rgbToHex,
} from './styles';

// Effects and Validation
export {
  applyBevelToCanvas,
  applyEffectsToCanvas,
  BEVEL_TYPES,
  clearFilterCache,
  createBevel,
  createGlow,
  createShadow,
  generateSVGBevelFilter,
  generateSVGFilterDefs,
  isValidHexColor,
  validateColorTheme,
  validateColorThemeForGeneration,
  validateColorThemeSafe,
  validateQuickStyle,
  validateQuickStyleSafe,
  type BevelType,
  type ValidationResult,
} from './styles';

// Re-export BevelEffect from contracts (was previously DiagramBevelEffect)
export type { BevelEffect } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Output (ComputedLayout -> DrawingObject[])
// =============================================================================

export { layoutToDrawingObjects } from './output';

// =============================================================================
// Gallery (layout catalog, preview generation, search)
// =============================================================================

export {
  // Preview generation
  clearPreviewCache,
  generateLayoutPreviewSVG,
  getCachedPreviewSVG,
  // Layout catalog
  getCatalog,
  searchLayouts,
} from './gallery';
export type { CatalogCategory, PreviewOptions } from './gallery';

// =============================================================================
// OOXML Layout Engine (new generic engine - partial implementation)
// =============================================================================

// Engine: Data Model -- OOXML point/connection graph with navigation API
export { DataModel } from './engine';
export type {
  ConnectionType,
  DataModelConnection,
  DataModelPoint,
  PointType,
  ST_AxisType,
  ST_ElementType,
} from './engine';

// Engine: Shared element type matching utility
export { matchesElementType } from './engine';
export type { PointLike } from './engine';

// Engine: Iteration System -- forEach/choose/if, axis navigation, presOf mapping
export {
  applyFunctionOperator,
  applySubsequence,
  createDefaultPresOfSpec,
  evaluateChoose,
  evaluateCondition,
  evaluateFunction,
  executeForEach,
  lookupVariable,
  navigateAxis,
  parseAxisSpec,
  parsePtTypeSpec,
  resolvePresOf,
} from './engine';
export type {
  ForEachIteration,
  ForEachRegistry,
  ForEachResult,
  FunctionEvalContext,
  NavigationOptions,
  PresOfSpec,
} from './engine';

// Engine: Constraint System -- solver, evaluator, type helpers
export {
  applyConstraintOperator,
  cloneResolvedConstraints,
  computeConstraintKey,
  computeReferenceKey,
  createResolvedConstraints,
  evaluateConstraint,
  getConstraintCategory,
  isAlignmentConstraint,
  isDimensionalConstraint,
  isFontConstraint,
  isGeometryConstraint,
  isHorizontalConstraint,
  isMarginConstraint,
  isPositionalConstraint,
  isPyramidConstraint,
  isSpacingConstraint,
  isUserDefinedConstraint,
  isVerticalConstraint,
  solveConstraints,
} from './engine';
export type {
  ConstraintSolverInput,
  ConstraintSolverOutput,
  EvaluationResult,
  ResolvedConstraints,
} from './engine';

// Engine: Rule Engine -- adaptive rule evaluation
export { applyRules } from './engine';
export type { RuleEngineInput, RuleEngineOutput } from './engine';

// Engine: Layout Algorithms -- all 10 OOXML layout algorithms
export {
  CompositeAlgorithm,
  ConnectorAlgorithm,
  createCompositeAlgorithm,
  createConnectorAlgorithm,
  createCycleAlgorithm,
  createHierChildAlgorithm,
  createHierRootAlgorithm,
  createLinearAlgorithm,
  createPyramidAlgorithm,
  createSnakeAlgorithm,
  createSpaceAlgorithm,
  createTextAlgorithm,
  CycleAlgorithm,
  executeCycleAlgorithm,
  executeHierChildAlgorithm,
  executeHierChildSecondaryAlgorithm,
  executeHierRootAlgorithm,
  executeSnakeAlgorithm,
  HierChildAlgorithm,
  HierRootAlgorithm,
  LinearAlgorithm,
  PyramidAlgorithm,
  SnakeAlgorithm,
  SpaceAlgorithm,
  TextAlgorithm,
} from './engine';
export type {
  AlgorithmContext,
  AlgorithmDataPoint,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedConnector,
  PositionedShape,
} from './engine';

// Engine: Computed Layout Adapter -- bridge new engine to existing interface
export { adaptAlgorithmResult, adaptPositionedConnector, adaptPositionedShape } from './engine';

// =============================================================================
// OOXML Parsers (parse Diagram XML parts into typed objects)
// =============================================================================

// Parsers: all 5 Diagram XML part parsers
export {
  parseColorsDef,
  parseDataModel,
  parseDiagramDrawing,
  parseLayoutDefinition,
  parseStyleDef,
} from './parser';

// Parsers: XML helper utilities
export { attr, boolAttr, child, children, numAttr, textContent } from './parser';
export type { XmlNode } from './parser';

// =============================================================================
// Resource Lifecycle
// =============================================================================

import { clearPreviewCache as _clearPreviewCache } from './gallery';
import { clearFilterCache as _clearFilterCache } from './styles';

/**
 * Dispose all module-level caches to free memory.
 *
 * Call this when Diagram functionality is no longer needed,
 * e.g., when unmounting a Diagram editor or closing a document.
 */
export function dispose(): void {
  _clearFilterCache();
  _clearPreviewCache();
}
