//! Native hydration from snapshots and parsed workbooks.
//!
//! Imports allocate compact row and column runs and sparse cell identities once,
//! then pass those identities to metadata, range classification, and cell_store assembly.

mod features;
mod form_controls;
mod helpers;
mod import;
mod imported_pivot_classification;
mod print_defined_names;
mod sheet;
mod snapshot;
mod styles;
mod table_styles;
mod workbook;

pub(crate) use self::sheet::hydrate_sheet;
pub(crate) use self::sheet::{
    SheetIdAllocation, allocate_sheet_ids, allocate_sheet_ids_with_previous_allocation,
};
pub(crate) use self::styles::{
    ImportedRangeStyle, hydrate_cell_styles, merge_style_palette_incremental, remap_sheet_style_ids,
};
pub(crate) use self::table_styles::merge_custom_table_styles_from_ooxml;
pub(crate) use self::workbook::hydrate_workbook_tables;

use cell_types::{AxisIdentityId, AxisIdentityStore, CellId, ColId, RowId, SheetId};

use crate::import::parse_output_to_snapshot::anchor_collection::IdentityAnchorReason;

/// A CellId allocated for metadata that is anchored to a grid position without
/// requiring an authored cell value.
#[derive(Debug, Clone)]
pub(crate) struct AnchoredCellIdentity {
    pub cell_id: CellId,
    pub row: u32,
    pub col: u32,
    pub reasons: Vec<IdentityAnchorReason>,
}

// ===========================================================================
// Hydration ID map — captures allocated IDs for cross-system consistency
// ===========================================================================

/// Mapping of allocated IDs produced during hydration.
///
/// When `hydrate_from_parse_output` runs, it allocates monotonic IDs for
/// sheets and cells via the `IdAllocator`. Other systems (e.g. the
/// `WorkbookSnapshot` builder) need the *same* IDs so that storage and evaluation share a single identity space. This struct captures those
/// IDs in parse-order so they can be threaded to downstream consumers.
#[derive(Debug, Clone, Default)]
pub struct HydrationIdMap {
    /// Imported table catalog carried into the native snapshot during construction.
    pub canonical_tables: Vec<domain_types::domain::table::TableCatalogEntry>,
    /// Sheet IDs in the same order as `ParseOutput.sheets`.
    pub sheet_ids: Vec<SheetId>,
    /// Cell IDs per sheet, in the same order as `SheetData.cells`.
    /// `cell_ids[sheet_index][cell_index]` = CellId for that cell.
    pub cell_ids: Vec<Vec<CellId>>,
    /// Sparse identities needed by metadata anchors, without authored cell values.
    /// Each entry is `(SheetId, CellId, row, col)` and is installed through the native snapshot.
    pub identities: Vec<(SheetId, CellId, u32, u32)>,
    /// Compact or explicit row identities, in sheet order.
    pub row_axes: Vec<AxisIdentityStore<RowId>>,
    /// Compact or explicit column identities, in sheet order.
    pub col_axes: Vec<AxisIdentityStore<ColId>>,
}

impl HydrationIdMap {
    /// Add identities discovered by metadata hydration before native index assembly.
    pub(crate) fn install_snapshot_identities(
        &self,
        snapshot: &mut crate::snapshot::WorkbookSnapshot,
    ) {
        let mut by_sheet: std::collections::HashMap<
            SheetId,
            Vec<snapshot_types::CellIdentityPosition>,
        > = std::collections::HashMap::new();
        for &(sheet_id, cell_id, row, col) in &self.identities {
            by_sheet
                .entry(sheet_id)
                .or_default()
                .push(snapshot_types::CellIdentityPosition { cell_id, row, col });
        }
        for sheet in &mut snapshot.sheets {
            let Ok(sheet_id) = SheetId::from_uuid_str(&sheet.id) else {
                continue;
            };
            let Some(identities) = by_sheet.remove(&sheet_id) else {
                continue;
            };
            let mut known: std::collections::HashSet<_> = sheet
                .identities
                .iter()
                .map(|identity| identity.cell_id)
                .collect();
            sheet.identities.extend(
                identities
                    .into_iter()
                    .filter(|identity| known.insert(identity.cell_id)),
            );
        }
    }
}

// ===========================================================================
// IdAllocator trait
// ===========================================================================

/// Trait for allocating unique identity values during hydration.
///
/// The hydration layer needs to assign UUIDs (as hex strings) to cells, sheets,
/// rows, and columns. This trait abstracts the allocation so that:
/// - Production code can use `uuid::Uuid::new_v4()` or the `cell_types::IdAllocator`
/// - Tests can use deterministic/sequential allocators for reproducibility
pub trait IdAllocator {
    /// Allocate a new unique CellId.
    fn alloc_cell_id(&mut self) -> CellId;
    /// Allocate a new unique SheetId.
    fn alloc_sheet_id(&mut self) -> SheetId;
    /// Allocate a new unique RowId.
    fn alloc_row_id(&mut self) -> RowId;
    /// Allocate a new unique ColId.
    fn alloc_col_id(&mut self) -> ColId;
    /// Allocate an ordered row axis. Custom allocators retain explicit identities.
    fn alloc_row_axis(&mut self, len: u32) -> AxisIdentityStore<RowId> {
        AxisIdentityStore::Explicit((0..len).map(|_| self.alloc_row_id()).collect())
    }
    /// Allocate an ordered column axis. Custom allocators retain explicit identities.
    fn alloc_col_axis(&mut self, len: u32) -> AxisIdentityStore<ColId> {
        AxisIdentityStore::Explicit((0..len).map(|_| self.alloc_col_id()).collect())
    }
}

/// Default allocator backed by a `cell_types::IdAllocator` instance.
///
/// Uses the same monotonic counter approach as the storage-level allocator.
/// Each `DefaultIdAllocator` instance has its own counter; for shared global
/// allocation, wrap in a static or pass the same instance throughout hydration.
pub struct DefaultIdAllocator {
    inner: std::sync::Arc<cell_types::IdAllocator>,
}

impl DefaultIdAllocator {
    /// Hydrate directly in the engine's existing identity domain.
    pub(crate) fn with_shared(inner: std::sync::Arc<cell_types::IdAllocator>) -> Self {
        Self { inner }
    }

    /// Create a new allocator with counter starting at 1.
    pub fn new() -> Self {
        Self {
            inner: std::sync::Arc::new(cell_types::IdAllocator::new()),
        }
    }

    /// Create a new allocator with counter starting at `seed`.
    ///
    /// Use this when importing sheets into an existing document to avoid
    /// ID collisions with already-allocated identities.
    pub fn with_seed(seed: u64) -> Self {
        Self {
            inner: std::sync::Arc::new(cell_types::IdAllocator::with_seed(seed)),
        }
    }

    pub(crate) fn reserve_axis<Id: AxisIdentityId>(&self, axis: &AxisIdentityStore<Id>) {
        if let Some(run_id) = axis.max_run_id() {
            self.inner.ensure_axis_run_past(run_id);
        }
    }

    pub(crate) fn stamp_snapshot_counters(&self, snapshot: &mut crate::snapshot::WorkbookSnapshot) {
        snapshot.identity_high_water_mark = Some(
            self.inner
                .high_water_mark()
                .max(snapshot.next_identity_counter()),
        );
        snapshot.axis_run_high_water_mark = Some(
            self.inner
                .axis_run_high_water_mark()
                .max(snapshot.next_axis_run_counter()),
        );
    }

    pub fn alloc_range_id(&mut self) -> cell_types::RangeId {
        self.inner.next_range_id()
    }
}

impl Default for DefaultIdAllocator {
    fn default() -> Self {
        Self::new()
    }
}

impl IdAllocator for DefaultIdAllocator {
    fn alloc_row_axis(&mut self, len: u32) -> AxisIdentityStore<RowId> {
        AxisIdentityStore::from_runs([self.inner.next_axis_run(len)])
    }
    fn alloc_col_axis(&mut self, len: u32) -> AxisIdentityStore<ColId> {
        AxisIdentityStore::from_runs([self.inner.next_axis_run(len)])
    }
    fn alloc_cell_id(&mut self) -> CellId {
        CellId::from_raw(self.inner.next_u128())
    }
    fn alloc_sheet_id(&mut self) -> SheetId {
        SheetId::from_raw(self.inner.next_u128())
    }
    fn alloc_row_id(&mut self) -> RowId {
        RowId::from_raw(self.inner.next_u128())
    }
    fn alloc_col_id(&mut self) -> ColId {
        ColId::from_raw(self.inner.next_u128())
    }
}
