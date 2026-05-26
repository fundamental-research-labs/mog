/**
 * OOXML Diagram Layout Algorithm Interface
 *
 * Defines the contract that all 10 OOXML layout algorithms implement.
 * Each algorithm takes a context (node, constraints, children, bounds)
 * and produces positioned shapes and connectors.
 *
 * The AlgorithmContext provides everything an algorithm needs:
 * - The layout node instance being processed
 * - Resolved constraint values from the constraint solver
 * - Child node instances to position
 * - Algorithm parameters from the layout definition
 * - Variable list for conditional evaluation
 * - Available bounds from the parent container
 *
 * The AlgorithmResult contains the output:
 * - Positioned shapes with x, y, width, height
 * - Positioned connectors with routing points
 * - Used bounds (actual space consumed)
 *
 * @see ECMA-376 Part 1, Section 21.4.4 (Algorithm Definitions)
 * @module algorithm-types
 */

import type {
  AlgorithmTypeValue,
  OoxmlConstraint,
  OoxmlRule,
  VariableList,
} from '@mog-sdk/contracts/diagram';
import type { ResolvedConstraints } from '../constraints/constraint-evaluator';

// =============================================================================
// Layout Node Instance
// =============================================================================

/**
 * A runtime instance of a layout node after iteration expansion.
 *
 * During layout computation, forEach loops and choose/if conditionals
 * expand the layout definition tree into a flat(ter) instance tree.
 * Each instance corresponds to one stamped-out copy of a layout node
 * bound to a specific data model point.
 *
 * This is the runtime representation that algorithms work with,
 * as opposed to the static LayoutNode type from the layout definition.
 */
export interface LayoutNodeInstance {
  /** The layout node name (from the layout definition). */
  name: string;

  /** Style label for color/style resolution. */
  styleLbl?: string;

  /**
   * The algorithm assigned to this node.
   *
   * Note: params uses Map<string, string> at runtime for ergonomic .get() usage
   * in algorithm implementations. The OOXML contracts (ooxml-layout-types.ts)
   * define params as Record<string, string> for serialization. The layout engine
   * must convert Record -> Map when constructing LayoutNodeInstance from parsed data.
   */
  algorithm?: {
    type: string;
    params: Map<string, string>;
  };

  /**
   * The shape to render for this node.
   *
   * Note: adjustments uses Map<string, number> at runtime for consistency with
   * algorithm code. The OOXML contracts (ooxml-layout-types.ts) define adjustments
   * as Record<string, number> for serialization. The layout engine must convert
   * Record -> Map when constructing LayoutNodeInstance from parsed data.
   */
  shape?: {
    type: string;
    hideGeom?: boolean;
    adjustments?: Map<string, number>;
  };

  /** Constraints defined on this node. */
  constraints: readonly OoxmlConstraint[];

  /** Rules defined on this node. */
  rules: readonly OoxmlRule[];

  /** Child layout node instances (after iteration expansion). */
  children: LayoutNodeInstance[];

  /** The data model point ID this instance is bound to. */
  dataPointId?: string;

  /** The presOf source point ID (for presentation-of mapping). */
  presOfId?: string;

  /** Text content from the bound data model point. */
  text?: string;
}

// =============================================================================
// Data Model Point (minimal interface for algorithm use)
// =============================================================================

/**
 * Minimal data model point interface for algorithm consumption.
 *
 * Algorithms only need the model ID and text from data points.
 * The full DataModelPoint type (with type, properties, shapeProperties)
 * is defined in the data model module (data-model.ts). This interface
 * is intentionally minimal to keep algorithm code decoupled from the
 * full data model schema.
 *
 * Renamed from DataModelPoint to avoid naming collision with the
 * navigation-focused DataModelPoint in data-model.ts.
 */
export interface AlgorithmDataPoint {
  /** Unique model identifier. */
  readonly modelId: string;

  /** Text content. */
  readonly text: string;
}

// =============================================================================
// Algorithm Context
// =============================================================================

/**
 * The context provided to a layout algorithm for computation.
 *
 * Contains everything the algorithm needs to position its children:
 * - The node being processed
 * - The data model point bound to this node
 * - Resolved constraint values from the constraint solver
 * - Child node instances to position
 * - Algorithm parameters from the layout definition
 * - Variable list for conditional evaluation
 * - Available bounds from the parent container
 */
export interface AlgorithmContext {
  /** The layout node instance being processed. */
  node: LayoutNodeInstance;

  /** The data model point bound to this node (if any). */
  dataPoint?: AlgorithmDataPoint;

  /** Resolved constraint values for this node and its children. */
  constraints: ResolvedConstraints;

  /** Child layout node instances to position. */
  children: LayoutNodeInstance[];

  /**
   * Algorithm parameters from the layout definition.
   *
   * Uses Map<string, string> at runtime for ergonomic .get() usage in algorithms.
   * Converted from Record<string, string> (the OOXML contract type) at the
   * engine boundary when constructing AlgorithmContext.
   */
  params: Map<string, string>;

  /** Variable list for conditional evaluation. */
  variables: VariableList;

  /** Available bounds from the parent container (width x height). */
  bounds: { width: number; height: number };
}

// =============================================================================
// Positioned Shape
// =============================================================================

/**
 * A shape with computed position and dimensions.
 *
 * This is the output of algorithm computation. Each shape has:
 * - Position (x, y) relative to the algorithm's coordinate space
 * - Dimensions (width, height)
 * - Optional rotation, style label, text, and shape adjustments
 * - A model ID linking back to the data model point
 */
export interface PositionedShape {
  /** Data model point ID this shape represents (if any). */
  modelId?: string;

  /** Shape type (preset geometry name, e.g., "rect", "roundRect"). */
  shapeType: string;

  /** X position (left edge). */
  x: number;

  /** Y position (top edge). */
  y: number;

  /** Width of the shape. */
  width: number;

  /** Height of the shape. */
  height: number;

  /** Rotation angle in degrees. */
  rotation?: number;

  /** Style label for color/style resolution. */
  styleLbl?: string;

  /** Text content to display in the shape. */
  text?: string;

  /**
   * Shape adjustment handle overrides.
   *
   * Uses Map<string, number> at runtime. Convert to Record<string, number>
   * (the OOXML contract type) when serializing back to the contract layer.
   */
  adjustments?: Map<string, number>;
}

// =============================================================================
// Positioned Connector
// =============================================================================

/**
 * A connector with computed routing points.
 *
 * Connectors link two shapes and are routed between them.
 * The routing type determines the shape of the connector path
 * (straight, bend, curve, etc.).
 */
export interface PositionedConnector {
  /** Source shape's model ID. */
  fromId: string;

  /** Destination shape's model ID. */
  toId: string;

  /** Connector routing type (stra, bend, curve, longCurve). */
  routingType: string;

  /** Ordered list of points defining the connector path. */
  points: Array<{ x: number; y: number }>;

  /** Style label for color/style resolution. */
  styleLbl?: string;
}

// =============================================================================
// Algorithm Result
// =============================================================================

/**
 * The output of a layout algorithm computation.
 *
 * Contains all positioned shapes and connectors, plus the actual
 * bounds consumed by the algorithm's output.
 */
export interface AlgorithmResult {
  /** Positioned shapes produced by the algorithm. */
  shapes: PositionedShape[];

  /** Positioned connectors produced by the algorithm. */
  connectors: PositionedConnector[];

  /** Actual bounds consumed by the algorithm's output. */
  usedBounds: { width: number; height: number };
}

// =============================================================================
// Layout Algorithm Interface
// =============================================================================

/**
 * The contract that all OOXML layout algorithms implement.
 *
 * Each of the 10 algorithm types (composite, lin, snake, cycle,
 * hierRoot, hierChild, pyra, conn, tx, sp) implements this interface.
 *
 * Algorithms are stateless: they take a context and produce a result.
 * All state is carried in the AlgorithmContext.
 *
 * @see ECMA-376 Part 1, Section 21.4.4 (Algorithm Definitions)
 */
export interface ILayoutAlgorithm {
  /** The algorithm type identifier. */
  readonly type: AlgorithmTypeValue;

  /**
   * Compute the layout for the given context.
   *
   * @param context - The algorithm context with node, constraints, children, etc.
   * @returns The positioned shapes, connectors, and used bounds.
   */
  compute(context: AlgorithmContext): AlgorithmResult;
}
