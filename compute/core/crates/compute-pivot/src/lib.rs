//! Pivot table computation engine.
//!
//! Pure-function pivot: `(config, data, expansion_state) -> result`.
//! No `CellMirror`, no document state — stateless computation only.
//!
//! ## Modules
//!
//! - `types` — All pivot-specific types (config, result, enums)
//! - `aggregator` — 12 aggregate functions (sum, count, average, etc.)
//! - `sorter` — Natural sort, type-priority, custom order, multi-key
//! - `filter` — Condition operators, include/exclude, top/bottom N
//! - `grouper` — Date/number grouping helpers and key normalization
//! - `show_values_as` — 12 post-aggregation transforms (percentages, ranks, etc.)
//! - `engine` — Orchestrator: compute, detectFields, drillDown, validateConfig

#![warn(clippy::pedantic)]
#![deny(missing_docs)]
#![allow(
    clippy::module_name_repetitions,
    clippy::too_many_lines,
    clippy::similar_names
)]

pub mod types;
pub use compute_stats::values;
pub mod hierarchy;
pub use compute_stats::aggregate as aggregator;
pub use compute_stats::sort as sorter;
pub mod calc_field;
pub mod engine;
pub mod filter;
pub mod grouper;
pub mod presenter;
pub(crate) mod resolved;
pub mod show_values_as;

#[cfg(test)]
mod resolved_tests;
#[cfg(test)]
mod types_tests;

// Re-export key types and engine entry points
pub use engine::{
    compute, compute_resolved, compute_with_show_values_as, compute_with_show_values_as_resolved,
    detect_fields, drill_down, drill_down_resolved, get_all_field_items, get_field_items,
    validate_and_resolve, validate_config,
};
pub use resolved::ResolvedPivotConfig;
pub use types::PivotTableDefExt;
pub use types::{
    AggregateFunction,
    AxisPlacement,
    BinaryFilterOp,
    CalculatedField,
    CellRange,
    DateGrouping,
    DetectedDataType,
    // Identity
    FieldId,
    FilterOperator,
    FilterPlacement,
    LayoutForm,
    NullaryFilterOp,
    NumberGrouping,
    OutputLocation,
    PIVOT_CONFIG_SCHEMA_VERSION,
    PivotColumnHeader,
    PivotEngineConfig,
    // Error
    PivotError,
    // Expansion
    PivotExpansionState,
    // Fields
    PivotField,
    PivotFieldArea,
    // Items
    PivotFieldItems,
    PivotFieldPlacement,
    // Placement flat
    PivotFieldPlacementFlat,
    // Filters
    PivotFilter,
    PivotFilterCondition,
    PivotFilterConditionFlat,
    PivotGrandTotals,
    PivotHeader,
    PivotItemInfo,
    PivotRenderedBounds,
    PivotRow,
    // Config
    PivotTableConfig,
    PivotTableDataOptions,
    PivotTableLayout,
    // Result
    PivotTableResult,
    PivotTableStyle,
    PivotTopBottomFilter,
    // Placement
    PlacementBase,
    RelativePosition,
    // Show values as
    ShowValuesAs,
    ShowValuesAsBaseItem,
    ShowValuesAsConfig,
    SortByValueConfig,
    SortDirection,
    SubtotalLocation,
    TopBottomBy,
    TopBottomType,
    UnaryFilterOp,
    ValuePlacement,
    // Validation
    validate_pivot_config_json,
};
// Re-export selected items from internal modules for doc-tests and downstream use
pub use calc_field::{
    CalcFieldExpr, CalcFieldOp, CalcFieldParseError, evaluate_calc_field, parse_calc_field,
};
pub use hierarchy::GroupHierarchy;
pub use values::kahan_sum;
