//! napi-rs binding layer for compute-core.
//!
//! All bindings are auto-generated from `#[bridge::api]` annotations on
//! `ComputeService` (engine methods), the stateless bridge types in
//! `bridge_pure.rs`, and the `ClockBridge` clock descriptor.

// Re-export the clean Rust API facade for downstream consumers.
// Binding crates (PyO3, CLI) should use compute_api directly instead of
// the FFI-shaped bridge surface below.
pub use compute_api;

// Import stateless bridge types so generated pure methods can call Type::method().
use compute_core::bridge_pure::{
    CfBridge, ChartBridge, ClockBridge, FormatBridge, PivotBridge, SchemaBridge, TableBridge,
    VersioningBridge,
};

use compute_api::ComputeService;

// Import types used in engine method signatures (bare identifiers in descriptors).
// The generated modules use `use super::*;` so these must be in scope here.
// Not all types are used by every descriptor target, so allow unused.
#[allow(unused_imports)]
use cell_types::*;
#[allow(unused_imports)]
use compute_core::engine_types::*;
#[allow(unused_imports)]
use compute_core::engine_types::{bindings, cell_ops, sparklines};
#[allow(unused_imports)]
use formula_types::*;
#[allow(unused_imports)]
use snapshot_types::*;
#[allow(unused_imports)]
use value_types::*;
// Table bridge types: bare names used in generated TableBridge descriptors.
// Includes Slicer/SlicerCache/TableColumn (used by engine descriptors) and additional
// types needed by TableBridge pure function descriptors.
#[allow(unused_imports)]
use compute_table::types::{
    DynamicFilter, FilterCriteria, FilterDropdownData, RowVisibility, Slicer, SlicerCache,
    SlicerSortOrder, SortSpec, Table, TableBoolOption, TableCellFormat, TableColumn, TableRange,
    TableStructureChange, TableStyleDef, TableTopBottomFilter,
};
// Chart bridge types: bare names used in generated ChartBridge descriptors.
#[allow(unused_imports)]
use compute_stats::{Point, RegressionMethod, RegressionOutput};
// Principal type: used by ComputeService's R2.4 principal methods.
#[allow(unused_imports)]
use compute_security::Principal;
// CF bridge types: used in generated CfBridge descriptors.
#[allow(unused_imports)]
use compute_cf::types::{CFColorScale, CFDataBar, CFIconSetName};
// XLSX parser bridge type: merged into compute-core NAPI addon.
#[allow(unused_imports)]
use xlsx_api::bridge::XlsxParser;

// ---------------------------------------------------------------------------
// ComputeEngine class (auto-generated from lifecycle + engine descriptors)
// ---------------------------------------------------------------------------

// The lifecycle descriptor generates the struct, constructor, and
// take_lifecycle_result method. Engine descriptors generate instance methods.
bridge_napi::generate_class!(
    struct ComputeEngine(compute_api::ComputeService);,
    compute_api::__bridge_descriptor_ComputeService_service_lifecycle,
    compute_api::__bridge_descriptor_ComputeService_core,
    compute_api::__bridge_descriptor_ComputeService_core_cells,
    compute_api::__bridge_descriptor_ComputeService_core_sync,
    compute_api::__bridge_descriptor_ComputeService_core_undo,
    compute_api::__bridge_descriptor_ComputeService_core_theme,
    compute_api::__bridge_descriptor_ComputeService_viewport,
    compute_api::__bridge_descriptor_ComputeService_tables,
    compute_api::__bridge_descriptor_ComputeService_features,
    compute_api::__bridge_descriptor_ComputeService_formatting,
    compute_api::__bridge_descriptor_ComputeService_structural,
    compute_api::__bridge_descriptor_ComputeService_queries,
    compute_api::__bridge_descriptor_ComputeService_cell_semantics,
    compute_api::__bridge_descriptor_ComputeService_search,
    compute_api::__bridge_descriptor_ComputeService_atomics,
    compute_api::__bridge_descriptor_ComputeService_layout,
    compute_api::__bridge_descriptor_ComputeService_objects,
    compute_api::__bridge_descriptor_ComputeService_objects_comments,
    compute_api::__bridge_descriptor_ComputeService_objects_floating,
    compute_api::__bridge_descriptor_ComputeService_objects_groups,
    compute_api::__bridge_descriptor_ComputeService_objects_hyperlinks,
    compute_api::__bridge_descriptor_ComputeService_objects_pivots,
    compute_api::__bridge_descriptor_ComputeService_objects_z_order,
    compute_api::__bridge_descriptor_ComputeService_delegations,
    compute_api::__bridge_descriptor_ComputeService_viewport_registry,
    compute_api::__bridge_descriptor_ComputeService_export,
    compute_api::__bridge_descriptor_ComputeService_styles,
    compute_api::__bridge_descriptor_ComputeService_screenshot,
    compute_api::__bridge_descriptor_ComputeService_security_ops,
);

// ---------------------------------------------------------------------------
// Generated free functions (stateless bridge types)
// ---------------------------------------------------------------------------

bridge_napi::generate!(
    compute_core::__bridge_descriptor_PivotBridge_pivot,
    compute_core::__bridge_descriptor_TableBridge_table,
    compute_core::__bridge_descriptor_ChartBridge_chart,
    compute_core::__bridge_descriptor_FormatBridge_format,
    compute_core::__bridge_descriptor_SchemaBridge_schema_utils,
    compute_core::__bridge_descriptor_CfBridge_cf_presets,
    compute_core::__bridge_descriptor_ClockBridge_clock,
    compute_core::__bridge_descriptor_VersioningBridge_versioning,
    xlsx_api::__bridge_descriptor_XlsxParser_0,
);

mod chart_render;
mod coordinator;
