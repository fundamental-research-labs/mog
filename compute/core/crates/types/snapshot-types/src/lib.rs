//! Snapshot types for IPC initialization and incremental updates.
//!
//! Two serialization paths, chosen by the caller at the IPC boundary:
//! - **JSON path** ([`WorkbookSnapshot`]): String UUIDs, parsed at boundary via `uuid::Uuid`.
//!   Used by Tauri commands (default).
//! - **Bincode path** ([`WorkbookSnapshotBin`]): Raw u128 IDs directly, no UUID string
//!   parsing overhead. Used for large workbooks where UUID parsing is measurable.
//!
//! Incremental updates use [`CellEdit`] (TS to Rust) and [`RecalcResult`] (Rust to TS).

mod error;
mod init;
mod mutation;
mod recalc;
mod scenario;
mod settings;
pub mod versioning;
mod viewport;

pub mod bindings;
pub mod cell_ops;
pub mod grouping;
pub mod object_ops;
pub mod properties;
pub mod queries;

#[cfg(test)]
mod test_helpers;

pub use error::*;
pub use init::{
    CellData, CellDataBin, ColAxisIdentityRef, ColAxisIdentityRefBin, DataTableOoxmlFlags,
    DataTableRegionDef, PivotTableDef, RangeData, RangeDataBin, RowAxisIdentityRef,
    RowAxisIdentityRefBin, SheetSnapshot, SheetSnapshotBin, SnapshotAxisIdentityRun,
    SnapshotAxisIdentityRunRef, WORKBOOK_SNAPSHOT_SCHEMA_VERSION_COMPACT_AXIS_IDENTITY,
    WORKBOOK_SNAPSHOT_SCHEMA_VERSION_CURRENT, WORKBOOK_SNAPSHOT_SCHEMA_VERSION_DENSE_IDENTITY,
    WorkbookSnapshot, WorkbookSnapshotBin,
};
pub use mutation::{
    AutomaticConversionCategory, Axis, CfChange, ChangeKind, CommentChange, DimensionChange,
    FilterChange, FloatingObjectBounds, FloatingObjectChange, FloatingObjectChangeKind,
    GroupingChange, MergeChange, MutationResult, NamedRangeChange, PageBreakChange,
    PivotTableChange, PolicyPreservedParseOutcome, PolicyPreservedParseSummary, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, PropertyChange, RangeChange, RangeChangeKind,
    RuntimeDiagnosticsOptions, RuntimeDiagnosticsPage, RuntimeOperationDiagnostic,
    ScrollPositionChange, SheetChange, SheetChangeField, SheetLifecycleRuntimeHint,
    SheetSettingsChange, SheetViewCell, SheetViewRange, SlicerChange, SlicerChangeKind,
    SlicerSourceType, SortingChange, SparklineChange, SplitConfigChange, StructureChangeResult,
    StructureChangeType, TableChange, UndoState, ViewSelectionChange, VisibilityChange,
    WorkbookSettingsChange,
};
pub use recalc::{
    CellChange, CellEdit, CellErrorInfo, ParseResult, ProjectionCellData, ProjectionChange,
    RecalcMetrics, RecalcOptions, RecalcResult, RecalcValidationAnnotation, RecalcValidationError,
};
pub use scenario::{
    Scenario, ScenarioActiveState, ScenarioApplyResult, ScenarioCreateInput, ScenarioCreateResult,
    ScenarioOriginalCellValue, ScenarioRemoveResult, ScenarioRestoreResult, ScenarioUpdateInput,
    ScenarioUpdateResult, ScenarioValidationError,
};
pub use settings::{
    AutomaticConversionPolicy, AutomaticConversionPolicyPatch, CalcMode, CalculationSettings,
    EnterKeyDirection, NonNullPatch, NullablePatch, ProtectedWorkbookOperation,
    RustWorkbookSettingsPatch, WorkbookProtectionOptions, WorkbookSettings,
};
pub use versioning::*;
// Floating object types are now in domain-types::domain::floating_object.
// SerializedFloatingObject and FloatingObjectType have been removed.
pub use viewport::{
    ActiveCellData, BatchRangeEntry, BatchRangeRequest, BatchRangeResponse, BatchRangeResult,
    IdentityCell, RangeCellData, RangeQueryResult, SelectionAggregates, ViewportMerge,
};
// Binary viewport rendering types have been moved to
// compute-core/src/storage/engine/viewport_render_types.rs
// so they can directly reference CellFormat.

// Bridge DTO modules (migrated from compute-core/src/domain_types/)
pub use bindings::*;
pub use cell_ops::*;
pub use grouping::*;
pub use object_ops::*;
pub use properties::*;
pub use queries::*;
