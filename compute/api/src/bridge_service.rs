//! Bridge service — auto-generated delegate facade for FFI bindings (WASM, N-API, Tauri).
//!
//! `ComputeService` is the **single bridge surface** for all FFI consumers.
//! WASM, N-API, and Tauri binding crates consume descriptors from `ComputeService`,
//! not from `ComputeEngine` directly.
//!
//! **How it works:**
//! - `bridge_delegate::delegate!()` consumes bridge descriptors from `compute-core`
//!   (on `ComputeEngine`) and auto-generates delegate methods on `ComputeService`
//!   that call through `Dispatch`.
//! - The macro also re-emits descriptor macros (`__bridge_descriptor_ComputeService_*`)
//!   that WASM/NAPI/Tauri binding crates consume via `generate!()`.
//! - Return types are passed through as-is (including `(Vec<u8>, MutationResult)` for
//!   write methods) so binding crates get viewport patches for TS compatibility.
//!
//! **Result:** Zero hand-written boilerplate. Adding a method to `ComputeEngine`
//! with `#[bridge::api]` automatically makes it available on `ComputeService` and
//! across all FFI targets.

use crate::dispatch::Dispatch;
use bridge_core as bridge;

// The delegate macro expands `super::mutation::BridgeSortOptions` from the
// features bridge descriptor. We bring `mutation` into scope so it resolves.
use super::mutation;

// Types required by bridge_delegate macro expansion (referenced in bridge descriptors).
use compute_core::CellInfo;
use compute_core::bridge_types::{BorderPatchOperation, PivotExpansionState, PivotTableResult};
use compute_core::storage::engine::CsvImportOptions;
use compute_core::storage::engine::search::{WorkbookComment, WorkbookPivotTable, WorkbookTable};
use compute_core::storage::sheet::{
    filters as sheet_filters, grouping as sheet_grouping, sparklines as sheet_sparklines,
};
use compute_core::storage::workbook::imported_pivots::ImportedPivotViewRecord;
use domain_types::domain::cell_style::CellStyleDef;
use domain_types::domain::comment::{Comment, CommentMention, CommentType};
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use domain_types::domain::floating_object::FloatingObject;
use domain_types::domain::hyperlink::Hyperlink;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{
    FrozenPanes, PrintRange, PrintTitles, SheetMeta, SheetScrollPosition, SheetSettings,
    SheetViewOptions, SplitViewConfig,
};
use domain_types::domain::slicer::{
    NamedSlicerStyle, SlicerCustomStyle, StoredSlicer, StoredSlicerUpdate,
};
use domain_types::domain::table::Table as CanonicalTable;
use domain_types::domain::validation::{CellValidationResult, ColumnSchema, RangeSchema};
use domain_types::{CellFormat, ImportDiagnostic, ResolvedCellFormat, SheetProtectionOptions};
use snapshot_types::{RuntimeDiagnosticsOptions, RuntimeDiagnosticsPage};

/// Bridge service wrapping the compute engine for FFI exposure.
///
/// Holds a `Dispatch` handle (same mechanism as `Workbook`/`Sheet`).
/// Each instance is stored in a registry keyed by `doc_id`.

pub struct ComputeService {
    dispatch: Dispatch,
}

impl ComputeService {
    /// Create a new service from a dispatch handle.
    pub fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Access the underlying dispatch handle (for binding crates that need
    /// to call `flush_viewport_patches()` on the engine directly).
    pub fn dispatch(&self) -> &Dispatch {
        &self.dispatch
    }
}

// ---------------------------------------------------------------------------
// Auto-generated delegate methods from ComputeEngine bridge descriptors.
//
// Each descriptor group generates:
// 1. `impl ComputeService { ... }` with delegate methods
// 2. `__bridge_descriptor_ComputeService_<group>` macro for WASM/NAPI consumption
// ---------------------------------------------------------------------------

bridge_delegate::delegate!(
    target = ComputeService,
    dispatch = dispatch,
    compute_core::__bridge_descriptor_ComputeEngine_core,
    compute_core::__bridge_descriptor_ComputeEngine_core_cells,
    compute_core::__bridge_descriptor_ComputeEngine_core_undo,
    compute_core::__bridge_descriptor_ComputeEngine_core_theme,
    compute_core::__bridge_descriptor_ComputeEngine_viewport,
    compute_core::__bridge_descriptor_ComputeEngine_tables,
    compute_core::__bridge_descriptor_ComputeEngine_features,
    compute_core::__bridge_descriptor_ComputeEngine_formatting,
    compute_core::__bridge_descriptor_ComputeEngine_structural,
    compute_core::__bridge_descriptor_ComputeEngine_queries,
    compute_core::__bridge_descriptor_ComputeEngine_cell_semantics,
    compute_core::__bridge_descriptor_ComputeEngine_search,
    compute_core::__bridge_descriptor_ComputeEngine_atomics,
    compute_core::__bridge_descriptor_ComputeEngine_layout,
    compute_core::__bridge_descriptor_ComputeEngine_objects,
    compute_core::__bridge_descriptor_ComputeEngine_objects_annotations,
    compute_core::__bridge_descriptor_ComputeEngine_objects_comments,
    compute_core::__bridge_descriptor_ComputeEngine_objects_floating,
    compute_core::__bridge_descriptor_ComputeEngine_objects_groups,
    compute_core::__bridge_descriptor_ComputeEngine_objects_hyperlinks,
    compute_core::__bridge_descriptor_ComputeEngine_objects_pivots,
    compute_core::__bridge_descriptor_ComputeEngine_objects_z_order,
    compute_core::__bridge_descriptor_ComputeEngine_delegations,
    compute_core::__bridge_descriptor_ComputeEngine_viewport_registry,
    compute_core::__bridge_descriptor_ComputeEngine_export,
    compute_core::__bridge_descriptor_ComputeEngine_styles,
    compute_core::__bridge_descriptor_ComputeEngine_screenshot,
);

// ---------------------------------------------------------------------------
// Lifecycle and special methods — defined directly on ComputeService with
// bridge annotations so codegen picks them up for WASM/NAPI/Tauri.
// ---------------------------------------------------------------------------

#[bridge::api(
    group = "service_lifecycle",
    service = "ComputeService",
    key = "doc_id",
    fn_prefix = "compute",
    crate_path = "compute_api"
)]
impl ComputeService {
    /// Create a new `ComputeService` from a workbook snapshot, returning the
    /// service and the initial recalc result.
    #[bridge::lifecycle(create)]
    pub fn init(
        snapshot: snapshot_types::WorkbookSnapshot,
        layout_metrics: Option<domain_types::units::LayoutMetrics>,
    ) -> Result<(Self, snapshot_types::RecalcResult), value_types::ComputeError> {
        let (engine, recalc) =
            compute_core::storage::engine::ComputeEngine::from_snapshot_with_layout_metrics(
                snapshot,
                layout_metrics.unwrap_or_default(),
            )?;
        let dispatch = crate::dispatch::Dispatch::from_engine(engine).map_err(|e| {
            value_types::ComputeError::Eval {
                message: e.to_string(),
            }
        })?;
        Ok((ComputeService::new(dispatch), recalc))
    }

    /// Perform a full recalculation of all formula cells using the existing
    /// dependency graph and AST caches. Does NOT rebuild the ComputeCore —
    /// just re-evaluates all formulas in topological order.
    #[bridge::write]
    pub fn full_recalc(
        &mut self,
        options: snapshot_types::RecalcOptions,
    ) -> Result<snapshot_types::RecalcResult, value_types::ComputeError> {
        self.dispatch
            .call_engine(move |engine| engine.recalculate_with_options(&options))
            .map_err(|e| value_types::ComputeError::Eval {
                message: e.to_string(),
            })?
    }
}
