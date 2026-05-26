/**
 * OOXML Diagram Layout Definition Types
 *
 * Type definitions for Diagram layout definitions (layout#.xml) as defined in
 * ECMA-376 Part 1, Section 21.4 (DrawingML - Diagrams).
 *
 * A layout definition describes HOW a diagram should be arranged. It contains:
 * - A tree of layout nodes, each with an algorithm, shape, constraints, and rules
 * - ForEach loops that iterate over data model points
 * - Choose/If/Else conditionals for data-driven branching
 * - Constraint lists that define spatial relationships between nodes
 * - Rule lists for adaptive fallback behavior
 * - Variable lists for parameterizing the layout
 *
 * The layout engine interprets these definitions to produce positioned shapes.
 * Each of Excel's 185+ Diagram layouts is represented as a LayoutDefinition.
 *
 * NOTE: Iteration types (ForEach, Choose, IfClause, ElseClause, LayoutNodeChild,
 * VariableList) are defined in ooxml-engine-types.ts and re-exported here for
 * convenience. Layout-specific types (LayoutNode, LayoutDefinition, Algorithm,
 * Shape, PresOf) are defined in this file.
 *
 * XML namespace: `dgm` (http://schemas.openxmlformats.org/drawingml/2006/diagram)
 * File: `diagrams/layout#.xml` within the XLSX package
 *
 * @see ECMA-376 Part 1, Section 21.4.3 (Diagram Layout Definition)
 * @see ECMA-376 Part 1, Section 21.4.3.9 (dgm:layoutDef)
 */

import type { DataModel } from './ooxml-data-model-types';
import type {
  LayoutNodeChild as EngineLayoutNodeChild,
  OoxmlConstraint,
  OoxmlRule,
  VariableList,
} from './ooxml-engine-types';

// =============================================================================
// Algorithm Type Enum
// =============================================================================

/**
 * Diagram layout algorithm types.
 *
 * Each algorithm defines a different positioning strategy for child nodes.
 * Maps to OOXML `ST_AlgorithmType`.
 *
 * @see ECMA-376 Part 1, Section 21.4.7.1 (ST_AlgorithmType)
 */
export const AlgorithmType = {
  /**
   * Composite algorithm.
   * Positions children using absolute constraints (l, t, w, h pairs).
   * The most common top-level algorithm; used as a container.
   */
  composite: 'composite',

  /**
   * Linear algorithm.
   * Arranges children in a straight line (horizontal or vertical).
   * Supports direction, alignment, and node/transition alternation.
   */
  lin: 'lin',

  /**
   * Snake algorithm.
   * Multi-row/column wrapping flow layout. Children wrap to the next
   * row or column when they reach the edge. Supports boustrophedon
   * (alternating direction per row).
   */
  snake: 'snake',

  /**
   * Cycle algorithm.
   * Circular/radial arrangement of children around a center point.
   * Uses start angle, span angle, and optional center shape mapping.
   */
  cycle: 'cycle',

  /**
   * Hierarchy root algorithm.
   * Positions the root node of a hierarchy relative to its children.
   * Used with hierChild for complete hierarchy layouts.
   */
  hierRoot: 'hierRoot',

  /**
   * Hierarchy child algorithm.
   * Positions child nodes in a hierarchy underneath their parent.
   * Used in combination with hierRoot.
   */
  hierChild: 'hierChild',

  /**
   * Pyramid algorithm.
   * Vertical arrangement with trapezoid shape modification.
   * Each level gets proportional width (wider at base or top).
   */
  pyra: 'pyra',

  /**
   * Connector algorithm.
   * Routes connection lines between named source and destination nodes.
   * Supports straight, bend, curve, and long curve routing styles.
   */
  conn: 'conn',

  /**
   * Text algorithm.
   * Auto-sizes and positions text within a shape's bounds.
   * Handles alignment, anchoring, bullet levels, and auto-rotation.
   */
  tx: 'tx',

  /**
   * Space algorithm.
   * Invisible spacing placeholder. Allocates space but renders nothing.
   * Used for uniform gap distribution between visible nodes.
   */
  sp: 'sp',
} as const;

/** Union type of all valid algorithm type values. */
export type AlgorithmTypeValue = (typeof AlgorithmType)[keyof typeof AlgorithmType];

// =============================================================================
// Algorithm
// =============================================================================

/**
 * A layout algorithm with its type and parameter map.
 *
 * Corresponds to the `dgm:alg` element in a layout definition.
 * The params map contains algorithm-specific parameters keyed by
 * `ST_ParameterId` names with string values.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.1 (dgm:alg)
 */
export interface Algorithm {
  /** The algorithm type. */
  type: AlgorithmTypeValue;

  /**
   * Algorithm parameters.
   * Keys are ST_ParameterId names (e.g., "linDir", "horzAlign").
   * Values are string representations parsed by the algorithm at runtime.
   * Different algorithms accept different parameter sets.
   */
  params: Record<string, string>;
}

// =============================================================================
// Shape
// =============================================================================

/**
 * Shape definition for a layout node.
 *
 * Corresponds to the `dgm:shape` element. Defines the visual shape
 * used to render this layout node.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.14 (dgm:shape)
 */
export interface LayoutShape {
  /**
   * Shape type from ST_LayoutShapeType.
   *
   * Can be any DrawingML preset geometry name (e.g., "rect", "roundRect",
   * "ellipse", "diamond", "chevron", etc.) or special values:
   * - "none": No shape is rendered
   * - "conn": Connector shape (for connection algorithm)
   *
   * @see ECMA-376 Part 1, Section 21.4.7.34 (ST_LayoutShapeType)
   */
  type?: string;

  /**
   * Rotation angle in degrees.
   * Applied after positioning.
   */
  rot?: number;

  /**
   * Z-order offset.
   * Adjusts the z-order of this shape relative to its siblings.
   * Positive values bring the shape forward; negative push it back.
   */
  zOrderOff?: number;

  /**
   * Whether to hide the shape's geometry.
   * When true, the shape outline is not drawn (but text may still render).
   */
  hideGeom?: boolean;

  /**
   * Lock text entry flag.
   * When true, text is locked to this shape (cannot be moved to another).
   */
  lkTxEntry?: boolean;

  /**
   * Blip (image) placeholder flag.
   * When true, this shape acts as an image placeholder in picture layouts.
   */
  blipPhldr?: boolean;

  /**
   * Shape adjustment values.
   * Override the default adjustment handles for the preset geometry.
   * Maps adjustment name (e.g., "adj", "adj1", "adj2") to a value.
   */
  adjustments?: Record<string, number>;
}

// =============================================================================
// PresOf (Presentation-Of Mapping)
// =============================================================================

/**
 * Presentation-of mapping for a layout node.
 *
 * Defines which data model points are presented by this layout node.
 * Uses axis navigation to find the relevant data points from the
 * current iteration context.
 *
 * Corresponds to the `dgm:presOf` element.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.12 (dgm:presOf)
 */
export interface PresOf {
  /**
   * Axis to navigate for finding the presented point.
   * Space-separated for chained navigation (e.g., "ch ch" = grandchildren).
   *
   * @see ST_AxisTypes (Section 21.4.7.7)
   */
  axis?: string;

  /**
   * Point type filter.
   * Space-separated list of point types to include.
   * Navigation results are filtered to only include these types.
   */
  ptType?: string;

  /**
   * Count of items to include.
   * Limits the number of navigation results.
   */
  cnt?: number;

  /**
   * Start index (1-based).
   * Skips this many results before including.
   */
  st?: number;

  /**
   * Step increment.
   * Include every Nth result (e.g., step=2 includes every other item).
   */
  step?: number;

  /**
   * Whether to hide the last transition in the sequence.
   * Used to suppress trailing connector shapes.
   */
  hideLastTrans?: boolean;
}

// =============================================================================
// Layout Category
// =============================================================================

/**
 * A category tag for a layout definition.
 *
 * Layout definitions can belong to multiple categories, each with a
 * type identifier and a priority for sorting within the category.
 *
 * Corresponds to `dgm:cat` elements within `dgm:catLst`.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.2 (dgm:cat)
 */
export interface LayoutCategory {
  /** Category type URI (e.g., "urn:microsoft.com/office/officeart/2005/8/layout/list"). */
  type: string;

  /** Priority within this category (lower = higher priority, shown first). */
  priority: number;
}

// =============================================================================
// Layout Constraint & Rule (wrappers for parsing context)
// =============================================================================

/**
 * A layout constraint definition as it appears in layout#.xml.
 *
 * This is an alias for OoxmlConstraint from ooxml-engine-types.ts.
 * All constraint types (65 ST_ConstraintType values, operators, scoping)
 * are defined there.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.4 (dgm:constr)
 */
export type LayoutConstraint = OoxmlConstraint;

/**
 * A layout rule definition as it appears in layout#.xml.
 *
 * This is an alias for OoxmlRule from ooxml-engine-types.ts.
 * Rules define adaptive fallback ranges for constraints.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.13 (dgm:rule)
 */
export type LayoutRule = OoxmlRule;

// =============================================================================
// Layout Node
// =============================================================================

/**
 * A layout node in the layout definition tree.
 *
 * Layout nodes are the primary building blocks of a layout definition.
 * Each node defines:
 * - An algorithm for positioning its children
 * - A shape for visual rendering
 * - Constraints for spatial relationships
 * - Rules for adaptive fallback
 * - PresOf mapping to connect to data model points
 * - A variable list for parameterization
 *
 * Corresponds to the `dgm:layoutNode` element.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.10 (dgm:layoutNode)
 */
export interface LayoutNode {
  /** Discriminant for LayoutNodeChild union. */
  readonly kind: 'layoutNode';

  /**
   * Unique name within the layout definition.
   * Used for constraint references (forName/refForName) and moveWith.
   */
  name?: string;

  /**
   * Style label for color and style resolution.
   * Maps to entries in the colors and style definitions.
   * Examples: "node1", "sibTrans2D1", "bgShp", "revTx"
   *
   * @see ECMA-376 Part 1, Section 21.4.5 (Style Label System)
   */
  styleLbl?: string;

  /**
   * Move-with reference.
   * When set, this node moves together with the named node.
   * Used for decorative elements that should track another node's position.
   */
  moveWith?: string;

  /** The algorithm used to position this node's children. */
  algorithm?: Algorithm;

  /** The shape rendered for this node. */
  shape?: LayoutShape;

  /** Presentation-of mapping to data model points. */
  presOf?: PresOf;

  /**
   * Constraint list defining spatial relationships.
   * Constraints set positions, sizes, and spacing for this node and its children.
   */
  constraints?: LayoutConstraint[];

  /**
   * Rule list defining adaptive fallback behavior.
   * Rules modify constraints when content doesn't fit.
   */
  rules?: LayoutRule[];

  /**
   * Variable list for parameterizing this node and its descendants.
   * Variables are accessible via choose/if evaluations.
   */
  varLst?: VariableList;

  /**
   * Child elements (layout nodes, forEach loops, or choose conditionals).
   * Processed in order during layout computation.
   */
  children: EngineLayoutNodeChild[];
}

// =============================================================================
// Sample Data / Style Data / Color Data
// =============================================================================

/**
 * Sample data for layout preview in galleries.
 *
 * Layout definitions can include sample data models that are used
 * when rendering previews (before the user provides their own data).
 *
 * Corresponds to `dgm:sampData`, `dgm:styleData`, and `dgm:clrData`.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.14 (dgm:sampData)
 */
export interface SampleData {
  /**
   * Inline data model for preview rendering.
   * If undefined, a default 3-node data model is used.
   */
  dataModel?: DataModel;

  /**
   * Whether to use the default sample data instead.
   * When true, the layout engine generates a standard sample.
   */
  useDefault?: boolean;
}

// =============================================================================
// Layout Definition (Top-Level)
// =============================================================================

/**
 * Complete Diagram layout definition (dgm:layoutDef).
 *
 * The top-level container for a layout#.xml file. Describes how a
 * Diagram diagram should be arranged, including the full tree of
 * layout nodes, constraints, algorithms, and conditional logic.
 *
 * Each of Excel's 185+ Diagram layouts corresponds to one LayoutDefinition.
 * Custom layouts (.glox files) also parse into this type.
 *
 * @see ECMA-376 Part 1, Section 21.4.3.9 (dgm:layoutDef)
 */
export interface LayoutDefinition {
  /**
   * Unique identifier URI for this layout.
   * Format: "urn:microsoft.com/office/officeart/2005/8/layout/{name}"
   * Example: "urn:microsoft.com/office/officeart/2005/8/layout/orgChart1"
   */
  uniqueId: string;

  /** Display title shown in the layout gallery. */
  title?: string;

  /** Description text shown in the layout gallery tooltip. */
  desc?: string;

  /**
   * Categories this layout belongs to.
   * A layout can appear in multiple gallery categories.
   */
  categories: LayoutCategory[];

  /**
   * Sample data model for gallery preview rendering.
   * Used when the user hasn't provided their own data yet.
   */
  sampData?: SampleData;

  /**
   * Style data model for style preview rendering.
   * Typically simpler than sampData (fewer nodes).
   */
  styleData?: SampleData;

  /**
   * Color data model for color preview rendering.
   * Typically simpler than sampData (fewer nodes).
   */
  clrData?: SampleData;

  /**
   * The root layout node of the definition tree.
   * This is the top-level composite node that contains all other nodes.
   * Layout computation starts from this node.
   */
  rootLayoutNode: LayoutNode;

  /**
   * Default minimum version required to render this layout.
   * Used for backward compatibility with older applications.
   */
  minVer?: string;

  /**
   * Default style label for the definition level.
   * Applies to all nodes that don't specify their own styleLbl.
   */
  defStyle?: string;
}
