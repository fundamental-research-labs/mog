/**
 * Diagram Layout Engine
 *
 * The generic OOXML layout engine that interprets layout definition XML
 * and produces computed layouts. This replaces the hardcoded per-layout
 * algorithms with a single engine that handles all 185+ Excel Diagram layouts.
 *
 * @module engine
 */

// Shared element type matching utility
export { matchesElementType } from './element-type-utils';
export type { PointLike } from './element-type-utils';

// Data Model - OOXML point/connection graph with navigation API
export { DataModel } from './data-model';
export type {
  ConnectionType,
  DataModelConnection,
  DataModelPoint,
  PointType,
  ST_AxisType,
  ST_ElementType,
} from './data-model';

// Iteration System - forEach/choose/if, axis navigation, function evaluation
export {
  applyOperator as applyFunctionOperator,
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
} from './iteration';
export type {
  ForEachIteration,
  ForEachRegistry,
  ForEachResult,
  FunctionEvalContext,
  NavigationOptions,
  PresOfSpec,
} from './iteration';

// Constraint System - solver, evaluator, type helpers
export {
  applyOperator as applyConstraintOperator,
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
} from './constraints';
export type {
  ConstraintSolverInput,
  ConstraintSolverOutput,
  EvaluationResult,
  ResolvedConstraints,
} from './constraints';

// Rule Engine - adaptive rule evaluation
export { applyRules } from './rules';
export type { RuleEngineInput, RuleEngineOutput } from './rules';

// Layout Algorithms - all 10 OOXML layout algorithms
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
} from './algorithms';
export type {
  AlgorithmContext,
  AlgorithmDataPoint,
  AlgorithmResult,
  ILayoutAlgorithm,
  LayoutNodeInstance,
  PositionedConnector,
  PositionedShape,
} from './algorithms';

// =============================================================================
// Computed Layout Adapter
// =============================================================================

import type {
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  NodeId,
  ShapeEffects,
  DiagramShapeType,
  TextStyle,
} from '@mog-sdk/contracts/diagram';
import { createNodeId } from '../types';
import type { AlgorithmResult, PositionedConnector, PositionedShape } from './algorithms';

/**
 * Default text style for shapes produced by the engine.
 */
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Calibri',
  fontSize: 11,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#000000',
  align: 'center',
  verticalAlign: 'middle',
};

/**
 * Default shape effects (none).
 */
const DEFAULT_EFFECTS: ShapeEffects = {};

/**
 * Map OOXML shape type names to DiagramShapeType.
 */
const SHAPE_TYPE_MAP: Record<string, DiagramShapeType> = {
  rect: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  hexagon: 'hexagon',
  chevron: 'chevron',
  pentagon: 'pentagon',
  trapezoid: 'trapezoid',
  parallelogram: 'parallelogram',
  plus: 'plus',
  star5: 'star5',
  rightArrow: 'rightArrow',
  cloud: 'cloud',
  wedgeRectCallout: 'wedgeRectCallout',
  // Default mappings for common OOXML names
  rectangle: 'rect',
  roundedRectangle: 'roundRect',
  oval: 'ellipse',
};

/**
 * Convert a PositionedShape from the engine to ComputedShape format.
 *
 * This adapter ensures the new engine produces the same ComputedLayout type
 * as the old hardcoded layouts, maintaining backward compatibility with
 * renderers (SVG, Canvas) and models (diagram CRUD).
 *
 * @param shape - PositionedShape from algorithm computation
 * @param options - Optional styling overrides
 * @returns ComputedShape compatible with existing renderers
 */
export function adaptPositionedShape(
  shape: PositionedShape,
  options?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    textStyle?: Partial<TextStyle>;
    effects?: ShapeEffects;
  },
): ComputedShape {
  // Map shape type to DiagramShapeType
  const shapeType: DiagramShapeType =
    SHAPE_TYPE_MAP[shape.shapeType] ?? ('rect' as DiagramShapeType);

  return {
    nodeId: (shape.modelId as NodeId) ?? createNodeId(),
    shapeType,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rotation: shape.rotation ?? 0,
    fill: options?.fill ?? '#4472C4',
    stroke: options?.stroke ?? '#2F528F',
    strokeWidth: options?.strokeWidth ?? 1,
    text: shape.text ?? '',
    textStyle: { ...DEFAULT_TEXT_STYLE, ...options?.textStyle },
    effects: options?.effects ?? { ...DEFAULT_EFFECTS },
  };
}

/**
 * Convert a PositionedConnector from the engine to ComputedConnector format.
 *
 * @param connector - PositionedConnector from algorithm computation
 * @param options - Optional styling overrides
 * @returns ComputedConnector compatible with existing renderers
 */
export function adaptPositionedConnector(
  connector: PositionedConnector,
  options?: {
    stroke?: string;
    strokeWidth?: number;
  },
): ComputedConnector {
  return {
    fromNodeId: connector.fromId as NodeId,
    toNodeId: connector.toId as NodeId,
    connectorType: mapRoutingType(connector.routingType),
    path: {
      type: connector.points.length === 2 ? 'line' : 'polyline',
      points: connector.points,
    },
    stroke: options?.stroke ?? '#2F528F',
    strokeWidth: options?.strokeWidth ?? 1,
    arrowStart: undefined,
    arrowEnd: { type: 'triangle', size: 'medium' },
  };
}

/**
 * Map OOXML routing type to ConnectorType.
 */
function mapRoutingType(routingType: string): 'straight' | 'elbow' | 'curved' | 'none' {
  switch (routingType) {
    case 'stra':
      return 'straight';
    case 'bend':
      return 'elbow';
    case 'curve':
    case 'longCurve':
      return 'curved';
    default:
      return 'straight';
  }
}

/**
 * Convert an AlgorithmResult to ComputedLayout format.
 *
 * This is the main adapter function that bridges the new OOXML layout engine
 * to the existing ComputedLayout interface used by renderers and models.
 *
 * @param result - AlgorithmResult from the layout engine
 * @param bounds - Diagram bounds
 * @param options - Optional styling overrides
 * @returns ComputedLayout compatible with existing renderers
 *
 * @example
 * ```typescript
 * const algo = new LinearAlgorithm();
 * const result = algo.compute(context);
 * const layout = adaptAlgorithmResult(result, { width: 800, height: 600 });
 * renderToSVG(layout, options);
 * ```
 */
export function adaptAlgorithmResult(
  result: AlgorithmResult,
  bounds: { width: number; height: number },
  options?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    textStyle?: Partial<TextStyle>;
    effects?: ShapeEffects;
    version?: number;
  },
): ComputedLayout {
  const shapes = result.shapes.map((shape) =>
    adaptPositionedShape(shape, {
      fill: options?.fill,
      stroke: options?.stroke,
      strokeWidth: options?.strokeWidth,
      textStyle: options?.textStyle,
      effects: options?.effects,
    }),
  );

  const connectors = result.connectors.map((connector) =>
    adaptPositionedConnector(connector, {
      stroke: options?.stroke,
      strokeWidth: options?.strokeWidth,
    }),
  );

  return {
    shapes,
    connectors,
    bounds,
    version: options?.version ?? 1,
  };
}
