//! Hydration — populating a YrsStorage from external data sources.
//!
//! Two entry points:
//!
//! 1. `populate_yrs_only()` — snapshot path. Reads from a
//!    `WorkbookSnapshot` (UUID-keyed) and populates the Yrs document.
//!
//! 2. `hydrate_from_parse_output()` — XLSX import path. Reads from a
//!    `ParseOutput` (position-keyed, domain-types) and writes structured
//!    Y.Maps using the `yrs_schema` modules.
//!
//! ## Architecture (XLSX import path)
//!
//! ```text
//! ParseOutput (position-keyed)
//!     │
//!     ▼
//! hydrate_from_parse_output()
//!     ├── Per sheet:
//!     │   ├── allocate SheetId
//!     │   ├── create sheet map with meta, cells, grid_index
//!     │   ├── allocate CellIds → cells map (via build_cell_prelim)
//!     │   ├── build grid index (posToId / idToPos)
//!     │   ├── allocate RowIds / ColIds (registries + indices)
//!     │   ├── domain objects via yrs_schema modules
//!     │   └── sheet metadata (frozen pane, view, protection, print)
//!     └── Workbook-level data (named ranges, tables, theme, protection)
//! ```

// NOTE: `impl YrsStorage` is intentionally split across `snapshot.rs` (populate/snapshot path)
// and `import.rs` (XLSX import path). This is valid Rust — impl blocks can span multiple files
// in the same crate.

mod data_tables;
mod features;
mod helpers;
mod import;
mod sheet;
mod snapshot;
mod styles;
mod view;
mod workbook;

pub(crate) use self::sheet::hydrate_sheet;
pub(crate) use self::sheet::{
    SheetIdAllocation, allocate_sheet_ids, allocate_sheet_ids_with_sheet_id,
};
pub(crate) use self::styles::{
    ImportedRangeStyle, merge_style_palette_incremental, remap_sheet_style_ids,
};
pub use self::workbook::write_theme_data_to_yrs;

use cell_types::{CellId, ColId, RowId, SheetId};

use crate::import::parse_output_to_snapshot::anchor_collection::IdentityAnchorReason;

/// A CellId allocated for metadata that is anchored to a grid position without
/// requiring a physical Yrs cell entry.
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
/// `WorkbookSnapshot` builder) need the *same* IDs so that Yrs storage and
/// ComputeCore share a single identity space. This struct captures those
/// IDs in parse-order so they can be threaded to downstream consumers.
#[derive(Debug, Clone, Default)]
pub struct HydrationIdMap {
    /// Sheet IDs in the same order as `ParseOutput.sheets`.
    pub sheet_ids: Vec<SheetId>,
    /// Cell IDs per sheet, in the same order as `SheetData.cells`.
    /// `cell_ids[sheet_index][cell_index]` = CellId for that cell.
    pub cell_ids: Vec<Vec<CellId>>,
    /// Physical placeholder cells created during hydration for features that
    /// still require a Yrs cell entry, such as merges and hyperlinks on empty
    /// cells. Each entry is `(SheetId, CellId, row, col)`.
    /// These must be registered in the GridIndex so that position-based lookups
    /// (e.g. `find_cell_id_at`) can find them.
    pub phantom_cells: Vec<(SheetId, CellId, u32, u32)>,
    /// Metadata-only identities, such as comment/note anchors on empty cells.
    /// These are durable in Yrs `gridIndex` but do not have entries under `cells`.
    pub identity_only_cells: Vec<(SheetId, CellId, u32, u32)>,
    /// Row IDs per sheet, indexed by positional row index.
    /// `row_ids[sheet_index][row_position]` = RowId allocated during hydration.
    pub row_ids: Vec<Vec<RowId>>,
    /// Column IDs per sheet, indexed by positional column index.
    /// `col_ids[sheet_index][col_position]` = ColId allocated during hydration.
    pub col_ids: Vec<Vec<ColId>>,
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
}

/// Default allocator backed by a `cell_types::IdAllocator` instance.
///
/// Uses the same monotonic counter approach as the storage-level allocator.
/// Each `DefaultIdAllocator` instance has its own counter; for shared global
/// allocation, wrap in a static or pass the same instance throughout hydration.
pub struct DefaultIdAllocator {
    inner: cell_types::IdAllocator,
}

impl DefaultIdAllocator {
    /// Create a new allocator with counter starting at 1.
    pub fn new() -> Self {
        Self {
            inner: cell_types::IdAllocator::new(),
        }
    }

    /// Create a new allocator with counter starting at `seed`.
    ///
    /// Use this when importing sheets into an existing document to avoid
    /// ID collisions with already-allocated identities.
    pub fn with_seed(seed: u64) -> Self {
        Self {
            inner: cell_types::IdAllocator::with_seed(seed),
        }
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
