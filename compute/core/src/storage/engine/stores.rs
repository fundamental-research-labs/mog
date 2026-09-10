//! Shared data layer for all engine services.
//!
//! `EngineStores` groups the storage, indexes, and compute scheduler that are
//! accessed by every service module within the engine. Splitting these into a
//! dedicated sub-struct is Phase 1a of the engine decomposition: it makes borrow
//! boundaries explicit so that service modules can take `&mut EngineStores`
//! without borrowing viewport or session state.

use std::sync::{Arc, OnceLock, RwLock};

use rustc_hash::FxHashMap;

use cell_types::{IdAllocator, SheetId};
use compute_layout_index::PixelLayout;

use compute_cf::types::CellCFResult;

use crate::identity::GridIndex;
use crate::range_manager::MergeList;
use crate::scheduler::ComputeCore;
use crate::storage::WorkbookStorage;

use super::merge_index::MergeSpatialItem;

/// Per-sheet cache of conditional formatting evaluation results.
pub(crate) struct CFCacheEntry {
    pub results: FxHashMap<(u32, u32), CellCFResult>,
}

/// Shared data layer for all engine services.
///
/// Groups native metadata, per-sheet indexes, the compute scheduler, and caches
/// that are read or mutated by virtually every engine operation. Extracting
/// these into a single struct lets service modules borrow them as a unit
/// without conflicting with viewport and session state.
pub(crate) struct EngineStores {
    /// Native workbook, worksheet, and cell metadata.
    pub(super) storage: WorkbookStorage,

    /// Engine-local pixel conversion profile for spreadsheet dimensions.
    pub(super) layout_metrics: domain_types::units::LayoutMetrics,

    /// Shared ID allocator for GridIndex operations (RowId/ColId).
    pub(super) grid_id_alloc: Arc<IdAllocator>,

    /// UUID allocator with an independent random namespace for authored metadata.
    pub(crate) id_alloc: Arc<IdAllocator>,

    /// Per-sheet compact axis identity and order lookup.
    pub(super) grid_indexes: FxHashMap<SheetId, GridIndex>,

    /// Derived geometry, populated only by pixel consumers.
    pub(super) pixel_layouts: RwLock<FxHashMap<SheetId, PixelLayoutEntry>>,

    /// Resolved merge rectangles, queried by linear scan.
    pub(super) merge_indexes: FxHashMap<SheetId, MergeList<MergeSpatialItem>>,

    /// Formula parser, dep graph, recalc scheduler.
    pub(super) compute: ComputeCore,

    /// Per-sheet conditional formatting evaluation cache.
    /// Populated lazily during viewport rendering; invalidated on cell/CF mutations.
    pub(super) cf_cache: FxHashMap<SheetId, CFCacheEntry>,

    /// Font database for text measurement (autofit, PDF export).
    /// Bundled fonts are loaded only by autofit or screenshot requests.
    pub(super) font_db: OnceLock<compute_text_measurement::FontDb>,

    /// Text measurement cache (shared across autofit calls).
    pub(super) measurement_cache: compute_text_measurement::MeasurementCache,
}

pub(super) struct PixelLayoutEntry {
    rows: Arc<compute_document::identity::AxisIndex<cell_types::RowId>>,
    cols: Arc<compute_document::identity::AxisIndex<cell_types::ColId>>,
    layout: Arc<PixelLayout>,
}

impl EngineStores {
    /// Resolve geometry from canonical dimensions. Axis identities also form part
    /// of the cache key, so growth, sorting, and structural edits cannot reuse
    /// positions from a previous axis ordering.
    pub(super) fn pixel_layout(&self, sheet_id: &SheetId) -> Option<Arc<PixelLayout>> {
        let grid = self.grid_indexes.get(sheet_id)?;
        let rows = grid.row_axis();
        let cols = grid.col_axis();
        {
            let cache = self
                .pixel_layouts
                .read()
                .expect("pixel layout cache poisoned");
            if let Some(entry) = cache.get(sheet_id)
                && Arc::ptr_eq(&entry.rows, &rows)
                && Arc::ptr_eq(&entry.cols, &cols)
            {
                return Some(Arc::clone(&entry.layout));
            }
        }
        let layout = Arc::new(super::construction::build_pixel_layout_for_sheet(
            &self.storage,
            sheet_id,
            grid.row_count(),
            grid.col_count(),
            Some(grid),
            self.layout_metrics,
        ));
        self.pixel_layouts
            .write()
            .expect("pixel layout cache poisoned")
            .insert(
                *sheet_id,
                PixelLayoutEntry {
                    rows,
                    cols,
                    layout: Arc::clone(&layout),
                },
            );
        Some(layout)
    }

    pub(super) fn invalidate_pixel_layout(&self, sheet_id: &SheetId) {
        self.pixel_layouts
            .write()
            .expect("pixel layout cache poisoned")
            .remove(sheet_id);
    }

    /// Generate a unique 32-char hex ID using the full client-partitioned u128.
    pub(crate) fn next_id_simple(&self) -> String {
        let n = self.id_alloc.next_u128();
        format!("{:032x}", n)
    }

    /// Generate a unique standard UUID-format string.
    pub(crate) fn next_id_uuid_string(&self) -> String {
        cell_types::CellId::from_raw(self.id_alloc.next_u128()).to_uuid_string()
    }
}
