//! Core types for the relational compute engine.
//!
//! These types define a declarative query model with no layout, no UI state,
//! and no presentation concerns.

use std::collections::HashMap;
use value_types::CellValue;

// ============================================================================
// Query Model
// ============================================================================

/// A declarative relational query over tabular data.
///
/// Describes what to compute without any layout or presentation concerns.
/// The engine executes this and returns a `QueryResult`.
#[derive(Debug, Clone)]
pub struct RelationalQuery {
    /// Row axis grouping fields (hierarchical GROUP BY).
    pub row_fields: Vec<GroupField>,

    /// Column axis grouping fields (cross-tabulation).
    pub column_fields: Vec<GroupField>,

    /// Measures to aggregate at each group intersection.
    pub measures: Vec<Measure>,

    /// Row-level predicates (WHERE clause).
    pub filters: Vec<QueryFilter>,

    /// Post-aggregation computed measures.
    pub calculated_measures: Vec<CalculatedMeasure>,

    /// Whether to include subtotals at each grouping level (ROLLUP).
    pub subtotals: SubtotalConfig,

    /// Whether to include grand totals.
    pub grand_totals: GrandTotalConfig,
}

// ============================================================================
// GroupField
// ============================================================================

/// A field used for grouping (GROUP BY).
#[derive(Debug, Clone)]
pub struct GroupField {
    /// Unique identifier for this field.
    pub id: String,

    /// Column index in source data.
    pub column_index: usize,

    /// How to bucket values (text identity, date periods, numeric intervals).
    pub grouping: GroupingStrategy,

    /// Sort order for group labels.
    pub sort: SortConfig,
}

/// How to bucket values for grouping.
#[derive(Debug, Clone)]
pub enum GroupingStrategy {
    /// Group by exact value (case-insensitive text, exact number).
    Identity,

    /// Group by date period (Year, Quarter, Month, etc.).
    Date(DateGroupingKind),

    /// Group by numeric interval (e.g., 0-10, 10-20, ...).
    Number(NumberGroupingKind),
}

/// Date grouping periods — mirrors `pivot_types::DateGrouping`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateGroupingKind {
    Year,
    Quarter,
    Month,
    Week,
    Day,
    Hour,
    Minute,
    Second,
}

/// Number grouping configuration.
#[derive(Debug, Clone)]
pub struct NumberGroupingKind {
    /// Start of the first interval.
    pub start: f64,
    /// End of the last interval.
    pub end: f64,
    /// Width of each interval.
    pub interval: f64,
}

/// Sort configuration for a group field.
#[derive(Debug, Clone)]
pub struct SortConfig {
    /// Sort by label or by aggregated measure value.
    pub sort_by: SortBy,

    /// Ascending or descending.
    pub direction: SortDirection,

    /// Optional custom sort order.
    pub custom_order: Option<Vec<CellValue>>,
}

/// What to sort by.
#[derive(Debug, Clone)]
pub enum SortBy {
    /// Sort by the group label itself.
    Label,

    /// Sort by an aggregated measure value.
    Value {
        /// Index into the query's measures array.
        measure_index: usize,
        /// Column key for cross-tab scoping (None = first column or grand total).
        column_key: Option<String>,
    },
}

/// Sort direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    Ascending,
    Descending,
}

// ============================================================================
// Measure
// ============================================================================

/// A measure to aggregate at each group intersection.
#[derive(Debug, Clone)]
pub struct Measure {
    /// Unique identifier.
    pub id: String,

    /// Human-readable name.
    pub name: String,

    /// Column index in source data.
    pub column_index: usize,

    /// Aggregation function.
    pub aggregate: AggregateFunction,

    /// Optional post-aggregation window transform.
    pub window: Option<WindowFunction>,
}

/// Aggregation functions — mirrors compute-stats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggregateFunction {
    Sum,
    Count,
    CountNums,
    Average,
    Max,
    Min,
    Product,
    StdDev,
    StdDevP,
    Var,
    VarP,
    Median,
}

/// Post-aggregation window transforms (database window functions).
#[derive(Debug, Clone)]
pub enum WindowFunction {
    PercentOfGrandTotal,
    PercentOfColumnTotal,
    PercentOfRowTotal,
    PercentOfParentRowTotal,
    PercentOfParentColumnTotal,
    RunningTotal,
    PercentRunningTotal,
    RankAscending,
    RankDescending,
    Difference {
        base_field: String,
        base_item: BaseItem,
    },
    PercentDifference {
        base_field: String,
        base_item: BaseItem,
    },
    Index,
}

/// Base item for Difference/PercentDifference window functions.
#[derive(Debug, Clone)]
pub enum BaseItem {
    Previous,
    Next,
    Specific(CellValue),
}

// ============================================================================
// Filter
// ============================================================================

/// A row-level filter predicate (WHERE clause).
#[derive(Debug, Clone)]
pub struct QueryFilter {
    /// The field this filter applies to.
    pub field_id: String,

    /// Column index of the filtered field in source data.
    pub column_index: usize,

    /// Values to include (allowlist).
    pub include_values: Option<Vec<CellValue>>,

    /// Values to exclude (denylist).
    pub exclude_values: Option<Vec<CellValue>>,

    /// Condition predicate.
    pub condition: Option<FilterCondition>,

    /// Top/bottom N filter.
    pub top_bottom: Option<TopBottomFilter>,

    /// Whether to show items with no data.
    pub show_items_with_no_data: bool,
}

/// A filter condition — wraps `pivot_types::PivotFilterCondition`.
#[derive(Debug, Clone)]
pub enum FilterCondition {
    /// Delegates to the pivot filter condition evaluation.
    Pivot(pivot_types::PivotFilterCondition),
}

/// Top/bottom N filter.
#[derive(Debug, Clone)]
pub struct TopBottomFilter {
    /// Top or bottom.
    pub filter_type: TopBottomType,
    /// Count, percentage, or sum threshold.
    pub n: f64,
    /// How to interpret n.
    pub by: TopBottomBy,
    /// Index into measures for the ranking field.
    pub measure_index: Option<usize>,
}

/// Top or bottom selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopBottomType {
    Top,
    Bottom,
}

/// How to interpret the N value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TopBottomBy {
    Items,
    Count,
    Percent,
    Sum,
}

// ============================================================================
// Calculated Measure
// ============================================================================

/// A post-aggregation computed measure.
#[derive(Debug, Clone)]
pub struct CalculatedMeasure {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// The original formula string.
    pub formula: String,
    /// Pre-parsed expression (stored as opaque type — parsed by pivot layer).
    pub parsed_expr: Option<CalcExpr>,
}

/// Opaque calculated field expression.
/// The relational engine evaluates this using field name → value lookups.
#[derive(Debug, Clone)]
pub enum CalcExpr {
    Number(f64),
    Field(String),
    BinaryOp {
        op: CalcOp,
        left: Box<CalcExpr>,
        right: Box<CalcExpr>,
    },
    UnaryNeg(Box<CalcExpr>),
}

/// Binary operators for calculated measures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalcOp {
    Add,
    Sub,
    Mul,
    Div,
}

// ============================================================================
// Subtotal / Grand Total Config
// ============================================================================

/// Configuration for subtotals (ROLLUP).
#[derive(Debug, Clone)]
pub struct SubtotalConfig {
    /// Per-depth subtotal enable. `enabled[i]` = whether depth `i` gets subtotals.
    pub enabled: Vec<bool>,
}

/// Configuration for grand totals.
#[derive(Debug, Clone)]
pub struct GrandTotalConfig {
    /// Show grand total row (bottom).
    pub show_row: bool,
    /// Show grand total column (rightmost).
    pub show_column: bool,
}

// ============================================================================
// Query Result
// ============================================================================

/// The result of executing a relational query.
///
/// A tree structure where each node carries aggregated measure values.
/// No layout, no spans, no rendered bounds — pure data.
#[derive(Debug, Clone)]
pub struct QueryResult {
    /// The row hierarchy with aggregated values at each node.
    pub row_tree: Vec<AggregatedNode>,

    /// The column hierarchy (tree structure for cross-tabulation).
    pub column_tree: Vec<AggregatedNode>,

    /// Grand totals (row, column, corner).
    pub grand_totals: QueryGrandTotals,

    /// Number of source rows that passed filters.
    pub filtered_row_count: usize,

    /// Number of source rows total.
    pub source_row_count: usize,

    /// Number of measures in the query.
    pub measure_count: usize,

    /// Column leaf keys in order (for value array indexing).
    pub column_leaf_keys: Vec<String>,
}

/// Grand totals in the query result.
#[derive(Debug, Clone, Default)]
pub struct QueryGrandTotals {
    /// Row grand total: aggregated values across all rows for each (column, measure) pair.
    /// Layout: [`col0_m0`, `col0_m1`, ..., `col1_m0`, ...]
    pub row: Option<Vec<CellValue>>,

    /// Column grand totals: per-row-node totals across all columns.
    /// Maps row node key → Vec<CellValue> of length `measure_count`.
    pub column: Option<HashMap<String, Vec<CellValue>>>,

    /// Corner grand total: aggregated across all data, one per measure.
    pub corner: Option<Vec<CellValue>>,
}

/// A node in the aggregated tree.
///
/// Recursive structure preserving the GROUP BY hierarchy. Values are
/// computed for ALL nodes — the consumer decides which to display.
#[derive(Debug, Clone)]
pub struct AggregatedNode {
    /// The group key (unique within siblings).
    pub key: String,

    /// The display value for this group.
    pub value: CellValue,

    /// Which field this node groups by.
    pub field_id: String,

    /// Depth in the hierarchy (0 = outermost grouping).
    pub depth: usize,

    /// Aggregated measure values for each (`column_leaf`, measure) pair.
    /// Layout: [`col0_measure0`, `col0_measure1`, ..., `col1_measure0`, ...]
    /// Length = `num_column_leaves` * `num_measures`.
    pub values: Vec<CellValue>,

    /// Subtotal values (ROLLUP). Same layout as `values`.
    /// Present when subtotals are enabled for this depth.
    pub subtotal_values: Option<Vec<CellValue>>,

    /// Source row indices that belong to this group (leaf-level membership).
    pub row_indices: Vec<usize>,

    /// Child nodes (next grouping level).
    pub children: Vec<AggregatedNode>,

    /// Key of the parent node, if any.
    pub parent_key: Option<String>,
}

impl AggregatedNode {
    /// Check if this is a leaf node (no children).
    #[must_use]
    pub fn is_leaf(&self) -> bool {
        self.children.is_empty()
    }

    /// Get all leaf nodes in this subtree.
    #[must_use]
    pub fn leaves(&self) -> Vec<&AggregatedNode> {
        if self.children.is_empty() {
            vec![self]
        } else {
            self.children.iter().flat_map(|c| c.leaves()).collect()
        }
    }

    /// Get all row indices from this node and all descendants.
    #[must_use]
    pub fn all_row_indices(&self) -> Vec<usize> {
        let mut result = Vec::new();
        self.collect_row_indices(&mut result);
        result
    }

    /// Collect all row indices into an existing Vec, avoiding recursive allocation.
    fn collect_row_indices(&self, out: &mut Vec<usize>) {
        if self.children.is_empty() {
            out.extend_from_slice(&self.row_indices);
        } else {
            for child in &self.children {
                child.collect_row_indices(out);
            }
        }
    }
}

impl QueryResult {
    /// Create an empty result (no data).
    #[must_use]
    pub fn empty(source_row_count: usize) -> Self {
        Self {
            row_tree: Vec::new(),
            column_tree: Vec::new(),
            grand_totals: QueryGrandTotals::default(),
            filtered_row_count: 0,
            source_row_count,
            measure_count: 0,
            column_leaf_keys: Vec::new(),
        }
    }

    /// Get all column leaf nodes (for cross-tabulation).
    #[must_use]
    pub fn column_leaves(&self) -> Vec<&AggregatedNode> {
        fn collect_leaves<'a>(nodes: &'a [AggregatedNode], out: &mut Vec<&'a AggregatedNode>) {
            for node in nodes {
                if node.children.is_empty() {
                    out.push(node);
                } else {
                    collect_leaves(&node.children, out);
                }
            }
        }
        let mut leaves = Vec::new();
        collect_leaves(&self.column_tree, &mut leaves);
        leaves
    }
}
