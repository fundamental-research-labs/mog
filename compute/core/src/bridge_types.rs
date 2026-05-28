//! Re-exports of all types that appear in bridge method signatures.
//!
//! Downstream descriptor consumers (bridge-delegate, bridge-wasm, bridge-napi)
//! import `compute_core::bridge_types::*` to resolve all types in expanded
//! descriptor macros. Single source of truth — add new types here when they
//! first appear in a `#[bridge::api]`-annotated method signature.

// Type crate wildcard re-exports (covers bare type names like CellId, CellValue, etc.)
pub use cell_types::*;
pub use domain_types::{CellBorderSide, CellBorders};
pub use formula_types::*;
#[allow(ambiguous_glob_reexports)]
pub use snapshot_types::*;
pub use value_types::*;

// Engine types (covers bare names like Comment, FloatingObject, StoredSlicer, etc.)
pub use crate::diagnostics::formula_references::*;
pub use crate::engine_types::*;

// Print types (PageBreaks moved from domain_types to domain_types::domain::print)
pub use domain_types::domain::print::{PageBreakEntry, PageBreaks, PrintSettings};

// Sorting bridge types (used in features.rs sort_range bridge method)
pub use crate::storage::engine::mutation::{
    BridgeSortCriterion, BridgeSortMode, BridgeSortOptions,
};

// CellInput enum — structural intent for cell writes (replaces \x00 sentinel).
pub use crate::storage::engine::mutation::CellInput;
pub use domain_types::domain::filter::{ColorPosition, SortBy, SortOrder};

// Range manager types (bare names in query methods)
pub use crate::range_manager::{A1CellRef, A1RangeRef};

// Module re-exports — used as path prefixes in bridge signatures
// (e.g., `filters::FilterState`, `grouping::GroupDefinition`)
pub use crate::storage::cells::data_ops as cell_ops;
pub use crate::storage::sheet::bindings;
pub use crate::storage::sheet::cf_store;
pub use crate::storage::sheet::filters;
pub use crate::storage::sheet::grouping;
pub use crate::storage::sheet::schemas;
pub use crate::storage::sheet::sparklines;
pub use crate::storage::workbook::named_ranges;
pub use crate::storage::workbook::named_ranges::{DefinedName, NameValidationResult};
pub use crate::storage::workbook::slicers;

// External crate re-exports
pub use compute_formats;
pub use compute_pivot;
pub use compute_table;
pub use serde_json;

// Types from external crates used directly (not via module path)
pub use crate::table::types::{Slicer, SlicerCache, Table, TableColumn};
pub use compute_pivot::types::{
    PivotExpansionState, PivotFieldItems, PivotItemInfo, PivotTableResult,
};
pub use domain_types::domain::pivot::PivotTableConfig;

// Cell format from properties (used in formatting bridge methods)
// CellFormat and FontSize come via `crate::engine_types::*` (which re-exports from domain_types)

// Wire type for schema map entries (used in formatting bridge methods).
// SchemaKey contains SheetId (non-string), so we accept String sheet_id over the bridge
// and convert inside the method body.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMapEntryWire {
    pub sheet_id: String,
    pub column: u32,
    pub schema: crate::schema::types::ColumnSchema,
}
