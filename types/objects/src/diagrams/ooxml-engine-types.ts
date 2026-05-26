/**
 * OOXML Diagram Engine Control Types
 *
 * Type definitions for the constraint/rule system, iteration/conditional logic,
 * and variable list system used by the OOXML Diagram layout engine.
 *
 * These types directly correspond to ECMA-376 Part 1, Section 21.4 (DrawingML - Diagrams).
 * String literal union types are used (not enums) for maximum type safety with OOXML
 * string attribute values and zero runtime overhead.
 *
 * @see ECMA-376 5th Edition, Part 1, Section 21.4
 * @module ooxml-engine-types
 */

// =============================================================================
// 1c: Constraint & Rule Types
// =============================================================================

// -----------------------------------------------------------------------------
// ST_ConstraintType — All 64 OOXML constraint type values
// -----------------------------------------------------------------------------

/**
 * OOXML constraint type enumeration.
 *
 * Defines all 64 possible constraint types used in Diagram layout definitions
 * to control positioning, sizing, margins, fonts, spacing, geometry, and
 * user-defined variables.
 *
 * Organized by category:
 * - **Positional** (12): l, t, r, b, lOff, tOff, rOff, bOff, ctrX, ctrY, ctrXOff, ctrYOff
 * - **Dimensional** (4): w, h, wOff, hOff
 * - **Margins** (6): lMarg, tMarg, rMarg, bMarg, begMarg, endMarg
 * - **Font** (2): primFontSz, secFontSz
 * - **Spacing** (3): sp, sibSp, secSibSp
 * - **Geometry** (8): connDist, diam, stemThick, begPad, endPad, wArH, hArH, bendDist
 * - **Pyramid** (1): pyraAcctRatio
 * - **Alignment** (1): alignOff
 * - **User-defined** (26): userA through userZ
 * - **None** (1): none
 * - **Total**: 38 standard + 26 user-defined = 64 values
 *
 * @see ECMA-376 Section 21.4.7.17 ST_ConstraintType
 */
export type ST_ConstraintType =
  // Positional constraints
  | 'l'
  | 't'
  | 'r'
  | 'b'
  | 'lOff'
  | 'tOff'
  | 'rOff'
  | 'bOff'
  | 'ctrX'
  | 'ctrY'
  | 'ctrXOff'
  | 'ctrYOff'
  // Dimensional constraints
  | 'w'
  | 'h'
  | 'wOff'
  | 'hOff'
  // Margin constraints
  | 'lMarg'
  | 'tMarg'
  | 'rMarg'
  | 'bMarg'
  | 'begMarg'
  | 'endMarg'
  // Font constraints
  | 'primFontSz'
  | 'secFontSz'
  // Spacing constraints
  | 'sp'
  | 'sibSp'
  | 'secSibSp'
  // Geometry constraints
  | 'connDist'
  | 'diam'
  | 'stemThick'
  | 'begPad'
  | 'endPad'
  | 'wArH'
  | 'hArH'
  | 'bendDist'
  // Pyramid constraints
  | 'pyraAcctRatio'
  // Alignment constraints
  | 'alignOff'
  // User-defined constraint variables (A through Z)
  | 'userA'
  | 'userB'
  | 'userC'
  | 'userD'
  | 'userE'
  | 'userF'
  | 'userG'
  | 'userH'
  | 'userI'
  | 'userJ'
  | 'userK'
  | 'userL'
  | 'userM'
  | 'userN'
  | 'userO'
  | 'userP'
  | 'userQ'
  | 'userR'
  | 'userS'
  | 'userT'
  | 'userU'
  | 'userV'
  | 'userW'
  | 'userX'
  | 'userY'
  | 'userZ'
  // None
  | 'none';

/**
 * Constraint relationship type.
 *
 * Specifies the scope of a constraint — which nodes it applies to
 * or references:
 * - `'self'` — The constraint applies to/references the layout node itself
 * - `'ch'` — The constraint applies to/references the direct children
 * - `'des'` — The constraint applies to/references all descendants
 *
 * @see ECMA-376 Section 21.4.7.15 ST_ConstraintRelationship
 */
export type ST_ConstraintRelationship = 'self' | 'ch' | 'des';

/**
 * Boolean constraint operator.
 *
 * Defines how a constraint value relates to its target:
 * - `'none'` — Soft/preferred value (no enforcement)
 * - `'equ'` — Equality constraint (target must equal value)
 * - `'gte'` — Minimum constraint (target must be >= value)
 * - `'lte'` — Maximum constraint (target must be <= value)
 *
 * @see ECMA-376 Section 21.4.7.9 ST_BoolOperator
 */
export type ST_BoolOperator = 'none' | 'equ' | 'gte' | 'lte';

// -----------------------------------------------------------------------------
// OoxmlConstraint — Single constraint definition
// -----------------------------------------------------------------------------

/**
 * A single OOXML layout constraint.
 *
 * Constraints define relationships between layout properties. The general
 * evaluation formula is:
 *
 *   target[for/forName].type = (source[refFor/refForName].refType * fact) + val
 *
 * Where:
 * - `type` identifies the target property (one of 64 ST_ConstraintType values)
 * - `for`/`forName` identifies the target node(s)
 * - `refType`/`refFor`/`refForName` identifies the reference source
 * - `op` controls enforcement semantics (none=preferred, equ=exact, gte=min, lte=max)
 * - `fact` is a multiplicative factor applied to the reference value
 * - `val` is an additive constant
 * - `ptType` filters which data point types this constraint applies to
 *
 * @see ECMA-376 Section 21.4.2.7 constr (Constraint)
 */
export interface OoxmlConstraint {
  /**
   * The constraint property type being set.
   * @see ST_ConstraintType
   */
  readonly type: ST_ConstraintType;

  /**
   * Scope of the target node(s) this constraint applies to.
   * Defaults to 'self' if not specified.
   */
  readonly for: ST_ConstraintRelationship;

  /**
   * Name of a specific layout node this constraint targets.
   * When specified, the constraint only applies to the named node.
   * Empty string means no specific target (uses `for` scope instead).
   */
  readonly forName: string;

  /**
   * The reference constraint property type to read from.
   * Defaults to 'none' if this constraint uses an absolute value.
   */
  readonly refType: ST_ConstraintType;

  /**
   * Scope of the reference node(s) to read from.
   * Defaults to 'self' if not specified.
   */
  readonly refFor: ST_ConstraintRelationship;

  /**
   * Name of a specific layout node to read the reference value from.
   * Empty string means no specific reference (uses `refFor` scope instead).
   */
  readonly refForName: string;

  /**
   * Constraint operator defining enforcement semantics.
   * - 'none': soft/preferred value
   * - 'equ': target must equal computed value
   * - 'gte': target must be >= computed value
   * - 'lte': target must be <= computed value
   */
  readonly op: ST_BoolOperator;

  /**
   * Absolute value for the constraint.
   * Used either as the sole value (when refType is 'none') or as an
   * additive offset to the referenced value.
   * Defaults to 0.
   */
  readonly val: number;

  /**
   * Multiplicative factor applied to the reference value.
   * The formula is: result = (refValue * fact) + val
   * Defaults to 1.
   */
  readonly fact: number;

  /**
   * Data point type filter for the target.
   * When specified, this constraint only applies to layout nodes
   * associated with data points of this type.
   * Defaults to 'all'.
   * @see ST_ElementType
   */
  readonly ptType: ST_ElementType;

  /**
   * Data point type filter for the reference source.
   * When specified, the reference value is read only from nodes
   * associated with data points of this type.
   * Defaults to 'all'.
   * @see ST_ElementType
   */
  readonly refPtType: ST_ElementType;
}

// -----------------------------------------------------------------------------
// OoxmlRule — Adaptive rule definition
// -----------------------------------------------------------------------------

/**
 * A single OOXML adaptive layout rule.
 *
 * Rules define fallback behavior when content doesn't fit within constraints.
 * They are evaluated sequentially: the engine tries each rule in document order,
 * adjusting constraint values until content fits or all rules are exhausted.
 *
 * Common patterns:
 * - Font shrinking: `primFontSz` rule with val=5 (minimum 5pt)
 * - Width expansion: `w` rule with val=INF
 * - Spacing reduction: `sp` rule with smaller spacing
 *
 * @see ECMA-376 Section 21.4.2.19 rule (Rule)
 */
export interface OoxmlRule {
  /**
   * The constraint property type this rule adjusts.
   * @see ST_ConstraintType
   */
  readonly type: ST_ConstraintType;

  /**
   * Scope of the target node(s) this rule applies to.
   * Defaults to 'self' if not specified.
   */
  readonly for: ST_ConstraintRelationship;

  /**
   * Name of a specific layout node this rule targets.
   * Empty string means no specific target.
   */
  readonly forName: string;

  /**
   * The reference constraint property type to read from.
   * Defaults to 'none' if this rule uses an absolute value.
   * @see ST_ConstraintType
   * @see ECMA-376 Section 21.4.3.13 (dgm:rule)
   */
  readonly refType?: ST_ConstraintType;

  /**
   * Scope of the reference node(s) to read from.
   * Defaults to 'self' if not specified.
   * @see ECMA-376 Section 21.4.3.13 (dgm:rule)
   */
  readonly refFor?: ST_ConstraintRelationship;

  /**
   * Name of a specific layout node to read the reference value from.
   * Empty string means no specific reference (uses `refFor` scope instead).
   * @see ECMA-376 Section 21.4.3.13 (dgm:rule)
   */
  readonly refForName?: string;

  /**
   * Constraint operator defining enforcement semantics.
   * - 'none': soft/preferred value
   * - 'equ': target must equal computed value
   * - 'gte': target must be >= computed value
   * - 'lte': target must be <= computed value
   * @see ECMA-376 Section 21.4.3.13 (dgm:rule)
   */
  readonly op?: ST_BoolOperator;

  /**
   * Data point type filter.
   * When specified, this rule only applies to layout nodes
   * associated with data points of this type.
   * Defaults to 'all'.
   * @see ST_ElementType
   */
  readonly ptType: ST_ElementType;

  /**
   * Target value for the adjustment.
   * The rule engine adjusts the constraint toward this value.
   * Defaults to 0.
   */
  readonly val: number;

  /**
   * Multiplicative factor applied when computing the adjusted value.
   * Defaults to 1.
   */
  readonly fact: number;

  /**
   * Maximum value for the adjustment.
   * The adjusted value will not exceed this maximum.
   * Defaults to Infinity (no maximum).
   */
  readonly max: number;
}

// -----------------------------------------------------------------------------
// ConstraintList & RuleList — Typed arrays
// -----------------------------------------------------------------------------

/**
 * An ordered list of OOXML constraints.
 *
 * Constraints are evaluated in document order. Later constraints can
 * reference values set by earlier constraints within the same list.
 *
 * @see ECMA-376 Section 21.4.2.8 constrLst (Constraint List)
 */
export type ConstraintList = readonly OoxmlConstraint[];

/**
 * An ordered list of OOXML adaptive rules.
 *
 * Rules are evaluated sequentially: the engine tries each rule in
 * document order, adjusting constraint values until content fits.
 *
 * @see ECMA-376 Section 21.4.2.20 ruleLst (Rule List)
 */
export type RuleList = readonly OoxmlRule[];

// =============================================================================
// 1d: Iteration & Conditional Types
// =============================================================================

// -----------------------------------------------------------------------------
// ST_AxisType — All 13 OOXML axis navigation types
// -----------------------------------------------------------------------------

/**
 * OOXML axis type enumeration.
 *
 * Defines all 13 possible axis types for navigating the data model tree.
 * Axes are used by `forEach`, `presOf`, and `choose/if` elements to
 * select sets of data model points relative to a context point.
 *
 * Axes can be chained (space-separated) to compose navigation paths.
 * For example, `"ch ch"` means "grandchildren" (children of children).
 *
 * - **Self** (1): self
 * - **Descendants** (3): ch, des, desOrSelf
 * - **Ancestors** (3): par, ancst, ancstOrSelf
 * - **Siblings** (4): followSib, precedSib, follow, preced
 * - **Root** (1): root
 * - **None** (1): none
 *
 * @see ECMA-376 Section 21.4.7.6 ST_AxisType
 */
export type ST_AxisType =
  | 'self'
  | 'ch'
  | 'des'
  | 'desOrSelf'
  | 'par'
  | 'ancst'
  | 'ancstOrSelf'
  | 'followSib'
  | 'precedSib'
  | 'follow'
  | 'preced'
  | 'root'
  | 'none';

// -----------------------------------------------------------------------------
// ST_ElementType — All 10 OOXML data point element types
// -----------------------------------------------------------------------------

/**
 * OOXML element type enumeration.
 *
 * Defines all 10 possible data point types for filtering during axis
 * navigation. Used in `forEach.ptType`, constraint `ptType`/`refPtType`,
 * and `choose/if` conditions.
 *
 * Can be space-separated for multi-type filtering (e.g., `"node asst"`).
 *
 * - `'all'` — Match all element types
 * - `'doc'` — Document root node
 * - `'node'` — Standard data node
 * - `'norm'` — Normal node (non-assistant)
 * - `'nonNorm'` — Non-normal node
 * - `'asst'` — Assistant node (special hierarchy position)
 * - `'nonAsst'` — Non-assistant node
 * - `'parTrans'` — Parent transition (connector between parent and child)
 * - `'pres'` — Presentation node (layout-generated, not in data model)
 * - `'sibTrans'` — Sibling transition (connector between siblings)
 *
 * @see ECMA-376 Section 21.4.7.19 ST_ElementType
 */
export type ST_ElementType =
  | 'all'
  | 'doc'
  | 'node'
  | 'norm'
  | 'nonNorm'
  | 'asst'
  | 'nonAsst'
  | 'parTrans'
  | 'pres'
  | 'sibTrans';

// -----------------------------------------------------------------------------
// ST_FunctionType — All 8 OOXML function types
// -----------------------------------------------------------------------------

/**
 * OOXML function type enumeration.
 *
 * Defines all 8 function types used in `choose/if` conditions to
 * evaluate properties of the current iteration context.
 *
 * - `'cnt'` — Count of matching items along the specified axis
 * - `'pos'` — 1-based position of current item in iteration
 * - `'revPos'` — Reverse position (counting from end, 1-based)
 * - `'posEven'` — 1 if position is even, 0 otherwise
 * - `'posOdd'` — 1 if position is odd, 0 otherwise
 * - `'var'` — Variable lookup (uses the `arg` attribute for variable name)
 * - `'depth'` — Depth of current node in the data model tree
 * - `'maxDepth'` — Maximum depth anywhere in the data model tree
 *
 * @see ECMA-376 Section 21.4.7.22 ST_FunctionType
 */
export type ST_FunctionType =
  | 'cnt'
  | 'pos'
  | 'revPos'
  | 'posEven'
  | 'posOdd'
  | 'var'
  | 'depth'
  | 'maxDepth';

// -----------------------------------------------------------------------------
// ST_FunctionOperator — All 6 OOXML function operators
// -----------------------------------------------------------------------------

/**
 * OOXML function operator enumeration.
 *
 * Defines all 6 comparison operators used in `choose/if` conditions
 * to compare a function result against a value.
 *
 * - `'equ'` — Equal to
 * - `'neq'` — Not equal to
 * - `'gt'` — Greater than
 * - `'lt'` — Less than
 * - `'gte'` — Greater than or equal to
 * - `'lte'` — Less than or equal to
 *
 * @see ECMA-376 Section 21.4.7.21 ST_FunctionOperator
 */
export type ST_FunctionOperator = 'equ' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';

// -----------------------------------------------------------------------------
// ST_FunctionArgument — All 10 OOXML function argument types
// -----------------------------------------------------------------------------

/**
 * OOXML function argument enumeration.
 *
 * Defines all 10 possible argument values used with the `var` function type
 * in `choose/if` conditions. Each corresponds to a variable in the
 * `VariableList` that can be queried at evaluation time.
 *
 * - `'none'` — No argument / unknown
 * - `'orgChart'` — Whether this is an organization chart layout
 * - `'chMax'` — Maximum number of children
 * - `'chPref'` — Preferred number of children
 * - `'bulEnabled'` — Whether bullets are enabled
 * - `'dir'` — Layout direction (normal or reversed)
 * - `'hierBranch'` — Hierarchy branching style
 * - `'animOne'` — One-by-one animation style
 * - `'animLvl'` — Animation level style
 * - `'resizeHandles'` — Resize handle behavior
 *
 * @see ECMA-376 Section 21.4.7.20 ST_FunctionArgument
 */
export type ST_FunctionArgument =
  | 'none'
  | 'orgChart'
  | 'chMax'
  | 'chPref'
  | 'bulEnabled'
  | 'dir'
  | 'hierBranch'
  | 'animOne'
  | 'animLvl'
  | 'resizeHandles';

// -----------------------------------------------------------------------------
// ForEach — Data iteration element
// -----------------------------------------------------------------------------

/**
 * OOXML forEach iteration element.
 *
 * Iterates over data model points selected by axis navigation and
 * point type filtering. For each matching point, the child layout
 * nodes are instantiated (stamped out).
 *
 * Supports:
 * - Axis chaining: `axis` can be space-separated (e.g., `"ch ch"` for grandchildren)
 * - Type filtering: `ptType` can be space-separated (e.g., `"node asst"`)
 * - Subsequence control: `cnt`, `st`, `step` for selecting subsets
 * - Transition hiding: `hideLastTrans` to suppress the last sibling transition
 * - Nesting: forEach can contain other forEach, choose, or layoutNode children
 *
 * @see ECMA-376 Section 21.4.2.13 forEach (For Each)
 */
export interface ForEach {
  /** Discriminator for LayoutNodeChild union type */
  readonly kind: 'forEach';

  /**
   * Optional name for this forEach element.
   * Can be referenced by other forEach elements via the `ref` attribute.
   */
  readonly name: string;

  /**
   * Reference to another forEach element's name.
   * When specified, this forEach reuses the referenced forEach's definition
   * instead of defining its own axis/ptType/children.
   */
  readonly ref: string;

  /**
   * Axis type(s) for navigation from the current context point.
   * Can be a single axis type or space-separated list for chained navigation.
   * Example: `'ch'` (children), `'ch ch'` (grandchildren), `'des'` (all descendants).
   *
   * @see ST_AxisType
   */
  readonly axis: string;

  /**
   * Point type filter(s) for selecting which data points to iterate over.
   * Can be a single type or space-separated list for multi-type matching.
   * Example: `'node'`, `'node asst'`, `'parTrans sibTrans'`.
   *
   * @see ST_ElementType
   */
  readonly ptType: string;

  /**
   * Maximum count of points to iterate over.
   * 0 means no limit (iterate all matching points).
   * Defaults to 0.
   */
  readonly cnt: number;

  /**
   * Starting index (1-based) for the iteration subsequence.
   * Defaults to 1 (start from the first match).
   */
  readonly st: number;

  /**
   * Step value for iteration.
   * 1 = every item, 2 = every other item, etc.
   * Defaults to 1.
   */
  readonly step: number;

  /**
   * Whether to hide the last sibling transition node.
   * When true, the transition node after the last data node is suppressed.
   * Defaults to true.
   */
  readonly hideLastTrans: boolean;

  /**
   * Child elements instantiated for each matching data point.
   * Can include layout nodes, nested forEach, and choose/if/else constructs.
   */
  readonly children: readonly LayoutNodeChild[];
}

// -----------------------------------------------------------------------------
// Choose / IfClause / ElseClause — Conditional logic
// -----------------------------------------------------------------------------

/**
 * OOXML choose element for conditional layout branching.
 *
 * Contains one or more `if` clauses evaluated in order, and an optional
 * `else` clause. The first `if` clause whose condition evaluates to true
 * has its children included in the layout tree. If no `if` clause matches,
 * the `else` clause children are used (if present).
 *
 * @see ECMA-376 Section 21.4.2.4 choose (Choose)
 */
export interface Choose {
  /** Discriminator for LayoutNodeChild union type */
  readonly kind: 'choose';

  /**
   * Optional name for this choose element.
   */
  readonly name: string;

  /**
   * Ordered list of if-clauses.
   * Evaluated in document order; first matching clause wins.
   */
  readonly ifClauses: readonly IfClause[];

  /**
   * Optional else clause.
   * Used when no if-clause condition evaluates to true.
   * Null if no else clause is defined.
   */
  readonly elseClauses: ElseClause | null;
}

/**
 * OOXML if-clause within a choose element.
 *
 * Evaluates a condition based on the current iteration context:
 *   `func(arg)` `op` `val`
 *
 * Where:
 * - `func` determines what value to compute (count, position, variable, etc.)
 * - `arg` provides additional context for the function (used with 'var' function)
 * - `op` is the comparison operator
 * - `val` is the value to compare against
 *
 * The if-clause also supports axis/ptType navigation for context-sensitive
 * evaluation (similar to forEach).
 *
 * @see ECMA-376 Section 21.4.2.14 if (If)
 */
export interface IfClause {
  /**
   * Optional name for this if-clause.
   */
  readonly name: string;

  /**
   * Function to evaluate against the current context.
   * Determines what property of the context is being tested.
   *
   * @see ST_FunctionType
   */
  readonly func: ST_FunctionType;

  /**
   * Argument for the function.
   * Primarily used with `func='var'` to specify which variable to look up.
   *
   * @see ST_FunctionArgument
   */
  readonly arg: ST_FunctionArgument;

  /**
   * Comparison operator for the condition.
   *
   * @see ST_FunctionOperator
   */
  readonly op: ST_FunctionOperator;

  /**
   * Value to compare the function result against.
   * For numeric functions (cnt, pos, depth, etc.), this is a number as string.
   * For variable functions (var), this is the expected variable value.
   */
  readonly val: string;

  /**
   * Axis type(s) for navigation context.
   * Used when the function needs to navigate the data model
   * (e.g., counting children along a specific axis).
   *
   * @see ST_AxisType
   */
  readonly axis: string;

  /**
   * Point type filter(s) for navigation.
   *
   * @see ST_ElementType
   */
  readonly ptType: string;

  /**
   * Maximum count of points for axis navigation.
   * 0 means no limit. Defaults to 0.
   */
  readonly cnt: number;

  /**
   * Starting index (1-based) for axis navigation subsequence.
   * Defaults to 1.
   */
  readonly st: number;

  /**
   * Step value for axis navigation.
   * Defaults to 1.
   */
  readonly step: number;

  /**
   * Whether to hide the last sibling transition during navigation.
   * Defaults to true.
   */
  readonly hideLastTrans: boolean;

  /**
   * Child layout elements included when this condition is true.
   */
  readonly children: readonly LayoutNodeChild[];
}

/**
 * OOXML else-clause within a choose element.
 *
 * Contains layout children that are used when no if-clause condition
 * evaluates to true. Acts as the default/fallback branch.
 *
 * @see ECMA-376 Section 21.4.2.11 else (Else)
 */
export interface ElseClause {
  /**
   * Optional name for this else-clause.
   */
  readonly name: string;

  /**
   * Child layout elements included when no if-clause matches.
   */
  readonly children: readonly LayoutNodeChild[];
}

// -----------------------------------------------------------------------------
// LayoutNodeChild — Discriminated union for layout tree children
// -----------------------------------------------------------------------------

/**
 * Discriminated union type for children of a layout node.
 *
 * A layout node's children can be:
 * - A nested `LayoutNode` (static child)
 * - A `ForEach` element (data-driven iteration)
 * - A `Choose` element (conditional branching)
 *
 * Discriminated via the `kind` field:
 * - `kind: 'layoutNode'` → LayoutNode (defined in ooxml-layout-types.ts)
 * - `kind: 'forEach'` → ForEach
 * - `kind: 'choose'` → Choose
 *
 * Note: The actual LayoutNode type with `kind: 'layoutNode'` is defined
 * in the layout definition types (managed by Agent 1). This union is
 * designed to be extended via intersection when all types are combined.
 */
export type LayoutNodeChild = ForEach | Choose | LayoutNodeChildRef;

/**
 * Reference placeholder for layout node children.
 *
 * This type represents a layout node child in the discriminated union.
 * The actual LayoutNode interface (with algorithm, shape, constraints, etc.)
 * is defined in the layout definition types. This interface provides the
 * minimal shape needed for the union discriminator to work.
 */
export interface LayoutNodeChildRef {
  /** Discriminator for LayoutNodeChild union type */
  readonly kind: 'layoutNode';
  /** Layout node name (optional — most inner layout nodes don't have names) */
  readonly name?: string;
}

// -----------------------------------------------------------------------------
// IterationContext — Runtime context during forEach/choose evaluation
// -----------------------------------------------------------------------------

/**
 * Runtime context available during forEach and choose/if evaluation.
 *
 * This context is maintained by the layout engine as it processes
 * forEach loops and evaluates choose/if conditions. It provides all
 * the information needed to evaluate functions like cnt, pos, depth, var.
 *
 * @see ECMA-376 Section 21.4.2.13 forEach
 * @see ECMA-376 Section 21.4.2.14 if
 */
export interface IterationContext {
  /**
   * The current data model point being processed.
   * This is the point selected by the innermost forEach loop.
   * Represented as a model ID string (matches DataModelPoint.modelId).
   */
  readonly currentPoint: string;

  /**
   * 1-based position of the current point within the forEach iteration.
   * First item is position 1, second is 2, etc.
   */
  readonly position: number;

  /**
   * Total count of items in the current forEach iteration.
   * Used by the `cnt` function and for computing `revPos`.
   */
  readonly count: number;

  /**
   * Depth of the current point in the data model tree.
   * The document root (doc node) is depth 0, its children are depth 1, etc.
   */
  readonly depth: number;

  /**
   * Current variable values from the variable list.
   * Used by the `var` function to look up variable values.
   *
   * @see VariableList
   */
  readonly variables: VariableList;
}

// =============================================================================
// 1e: Variable List Types
// =============================================================================

// -----------------------------------------------------------------------------
// ST_Direction — Layout direction
// -----------------------------------------------------------------------------

/**
 * OOXML layout direction enumeration.
 *
 * Controls the direction of layout flow:
 * - `'norm'` — Normal direction (left-to-right for LTR locales)
 * - `'rev'` — Reversed direction (right-to-left for LTR locales)
 *
 * @see ECMA-376 Section 21.4.7.18 ST_Direction
 */
export type ST_Direction = 'norm' | 'rev';

// -----------------------------------------------------------------------------
// ST_HierBranch — Hierarchy branching style
// -----------------------------------------------------------------------------

/**
 * OOXML hierarchy branch style enumeration.
 *
 * Controls how child branches are arranged in hierarchy layouts:
 * - `'std'` — Standard branching (balanced left/right)
 * - `'init'` — Initial branching (uses the data model's initial setting)
 * - `'l'` — All branches to the left
 * - `'r'` — All branches to the right
 * - `'hang'` — Hanging arrangement (children hang below)
 *
 * @see ECMA-376 Section 21.4.7.24 ST_HierBranchStyle
 */
export type ST_HierBranch = 'std' | 'init' | 'l' | 'r' | 'hang';

// -----------------------------------------------------------------------------
// ST_AnimOneStr — One-by-one animation style
// -----------------------------------------------------------------------------

/**
 * OOXML one-by-one animation string enumeration.
 *
 * Controls how diagram elements animate one at a time:
 * - `'none'` — Disable one-by-one animation
 * - `'one'` — Animate one element at a time
 * - `'branch'` — Animate one branch at a time
 *
 * @see ECMA-376 Section 21.4.7.3 ST_AnimOneStr
 */
export type ST_AnimOneStr = 'none' | 'one' | 'branch';

// -----------------------------------------------------------------------------
// ST_AnimLvlStr — Animation level style
// -----------------------------------------------------------------------------

/**
 * OOXML animation level string enumeration.
 *
 * Controls how diagram elements animate by level:
 * - `'none'` — Disable level-based animation
 * - `'lvl'` — Animate by hierarchy level
 * - `'ctr'` — Animate from the center outward
 *
 * @see ECMA-376 Section 21.4.7.2 ST_AnimLvlStr
 */
export type ST_AnimLvlStr = 'none' | 'lvl' | 'ctr';

// -----------------------------------------------------------------------------
// ST_ResizeHandlesStr — Resize handle behavior
// -----------------------------------------------------------------------------

/**
 * OOXML resize handles string enumeration.
 *
 * Controls how resize handles behave on Diagram shapes:
 * - `'exact'` — Exact resize (resize to precise dimensions)
 * - `'rel'` — Relative resize (maintain proportional relationships)
 *
 * @see ECMA-376 Section 21.4.7.39 ST_ResizeHandlesStr
 */
export type ST_ResizeHandlesStr = 'exact' | 'rel';

// -----------------------------------------------------------------------------
// VariableList — Layout variable definitions
// -----------------------------------------------------------------------------

/**
 * OOXML variable list for layout definitions.
 *
 * Variables control high-level layout behavior and are referenced by
 * `choose/if` conditions using `func='var'` and `arg='<variableName>'`.
 *
 * Each variable has a defined default value per the OOXML specification.
 * Layout definitions can override these defaults in their `varLst` element.
 *
 * @see ECMA-376 Section 21.4.2.31 varLst (Variable List)
 */
export interface VariableList {
  /**
   * Whether this is an organization chart layout.
   * Affects assistant node handling and hierarchy branching behavior.
   *
   * Default: `false`
   *
   * @see ECMA-376 Section 21.4.2.18 orgChart
   */
  readonly orgChart: boolean;

  /**
   * Maximum number of children per node.
   * Used by algorithms to limit branching. A value of -1 means unlimited.
   *
   * Default: `-1` (no limit)
   *
   * @see ECMA-376 Section 21.4.2.3 chMax
   */
  readonly chMax: number;

  /**
   * Preferred number of children per node.
   * Used by algorithms for optimal layout computation. A value of -1
   * means no preference.
   *
   * Default: `-1` (no preference)
   *
   * @see ECMA-376 Section 21.4.2.5 chPref
   */
  readonly chPref: number;

  /**
   * Whether bullets are enabled for text content.
   * When true, text nodes may render with bullet formatting.
   *
   * Default: `false`
   *
   * @see ECMA-376 Section 21.4.2.2 bulletEnabled
   */
  readonly bulletEnabled: boolean;

  /**
   * Layout direction.
   * Controls the primary flow direction for the layout algorithm.
   * - `'norm'` — Normal (left-to-right for LTR locales)
   * - `'rev'` — Reversed (right-to-left for LTR locales)
   *
   * Default: `'norm'`
   *
   * @see ECMA-376 Section 21.4.2.10 dir
   */
  readonly dir: ST_Direction;

  /**
   * Hierarchy branching style.
   * Controls how child branches are arranged in hierarchy layouts.
   *
   * Default: `'std'`
   *
   * @see ECMA-376 Section 21.4.2.15 hierBranch
   */
  readonly hierBranch: ST_HierBranch;

  /**
   * One-by-one animation style.
   * Controls how diagram elements animate individually.
   *
   * Default: `'none'`
   *
   * @see ECMA-376 Section 21.4.2.1 animOne
   */
  readonly animOne: ST_AnimOneStr;

  /**
   * Animation level style.
   * Controls how diagram elements animate by hierarchy level.
   *
   * Default: `'none'`
   *
   * @see ECMA-376 Section 21.4.2.0 animLvl
   */
  readonly animLvl: ST_AnimLvlStr;

  /**
   * Resize handle behavior.
   * Controls whether shapes use exact or relative resizing.
   *
   * Default: `'rel'`
   *
   * @see ECMA-376 Section 21.4.2.17 resizeHandles
   */
  readonly resizeHandles: ST_ResizeHandlesStr;
}

// -----------------------------------------------------------------------------
// Default variable values
// -----------------------------------------------------------------------------

/**
 * Default values for the OOXML variable list.
 *
 * These defaults are used when a layout definition does not specify
 * explicit values in its `varLst` element. Values are defined per
 * the ECMA-376 specification.
 *
 * @see ECMA-376 Section 21.4.2.31 varLst (Variable List)
 */
export const VARIABLE_LIST_DEFAULTS: Readonly<VariableList> = {
  orgChart: false,
  chMax: -1,
  chPref: -1,
  bulletEnabled: false,
  dir: 'norm',
  hierBranch: 'std',
  animOne: 'none',
  animLvl: 'none',
  resizeHandles: 'rel',
} as const;

// =============================================================================
// Constraint Type Groupings (for solver use)
// =============================================================================

/**
 * Positional constraint types.
 *
 * These control the absolute or relative position of layout nodes.
 */
export const POSITIONAL_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'l',
  't',
  'r',
  'b',
  'lOff',
  'tOff',
  'rOff',
  'bOff',
  'ctrX',
  'ctrY',
  'ctrXOff',
  'ctrYOff',
] as const;

/**
 * Dimensional constraint types.
 *
 * These control the width and height of layout nodes.
 */
export const DIMENSIONAL_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'w',
  'h',
  'wOff',
  'hOff',
] as const;

/**
 * Margin constraint types.
 *
 * These control the internal margins of layout nodes.
 */
export const MARGIN_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'lMarg',
  'tMarg',
  'rMarg',
  'bMarg',
  'begMarg',
  'endMarg',
] as const;

/**
 * Font constraint types.
 *
 * These control font sizing within layout nodes.
 */
export const FONT_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'primFontSz',
  'secFontSz',
] as const;

/**
 * Spacing constraint types.
 *
 * These control spacing between layout nodes.
 */
export const SPACING_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'sp',
  'sibSp',
  'secSibSp',
] as const;

/**
 * Geometry constraint types.
 *
 * These control geometric properties like connector distance, diameter, etc.
 */
export const GEOMETRY_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'connDist',
  'diam',
  'stemThick',
  'begPad',
  'endPad',
  'wArH',
  'hArH',
  'bendDist',
] as const;

/**
 * User-defined constraint types (userA through userZ).
 *
 * These 26 custom variables can be used as intermediary values
 * in complex constraint chains. A constraint can set userA, and
 * other constraints can reference userA as their refType.
 */
export const USER_DEFINED_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  'userA',
  'userB',
  'userC',
  'userD',
  'userE',
  'userF',
  'userG',
  'userH',
  'userI',
  'userJ',
  'userK',
  'userL',
  'userM',
  'userN',
  'userO',
  'userP',
  'userQ',
  'userR',
  'userS',
  'userT',
  'userU',
  'userV',
  'userW',
  'userX',
  'userY',
  'userZ',
] as const;

/**
 * All 64 constraint types as an array.
 *
 * Useful for validation, iteration, and exhaustiveness checks.
 */
export const ALL_CONSTRAINT_TYPES: readonly ST_ConstraintType[] = [
  ...POSITIONAL_CONSTRAINT_TYPES,
  ...DIMENSIONAL_CONSTRAINT_TYPES,
  ...MARGIN_CONSTRAINT_TYPES,
  ...FONT_CONSTRAINT_TYPES,
  ...SPACING_CONSTRAINT_TYPES,
  ...GEOMETRY_CONSTRAINT_TYPES,
  'pyraAcctRatio',
  'alignOff',
  ...USER_DEFINED_CONSTRAINT_TYPES,
  'none',
] as const;

/**
 * All 13 axis types as an array.
 *
 * Useful for validation and exhaustiveness checks.
 */
export const ALL_AXIS_TYPES: readonly ST_AxisType[] = [
  'self',
  'ch',
  'des',
  'desOrSelf',
  'par',
  'ancst',
  'ancstOrSelf',
  'followSib',
  'precedSib',
  'follow',
  'preced',
  'root',
  'none',
] as const;

/**
 * All 10 element types as an array.
 *
 * Useful for validation and exhaustiveness checks.
 */
export const ALL_ELEMENT_TYPES: readonly ST_ElementType[] = [
  'all',
  'doc',
  'node',
  'norm',
  'nonNorm',
  'asst',
  'nonAsst',
  'parTrans',
  'pres',
  'sibTrans',
] as const;

/**
 * All 8 function types as an array.
 *
 * Useful for validation and exhaustiveness checks.
 */
export const ALL_FUNCTION_TYPES: readonly ST_FunctionType[] = [
  'cnt',
  'pos',
  'revPos',
  'posEven',
  'posOdd',
  'var',
  'depth',
  'maxDepth',
] as const;

/**
 * All 6 function operators as an array.
 *
 * Useful for validation and exhaustiveness checks.
 */
export const ALL_FUNCTION_OPERATORS: readonly ST_FunctionOperator[] = [
  'equ',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
] as const;

/**
 * All 10 function argument types as an array.
 *
 * Useful for validation and exhaustiveness checks.
 */
export const ALL_FUNCTION_ARGUMENTS: readonly ST_FunctionArgument[] = [
  'none',
  'orgChart',
  'chMax',
  'chPref',
  'bulEnabled',
  'dir',
  'hierBranch',
  'animOne',
  'animLvl',
  'resizeHandles',
] as const;
