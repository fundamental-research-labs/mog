use cell_types::{CellId, SheetId};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// CellChange types (existing, preserved for backward compat)
// ---------------------------------------------------------------------------

/// The kind of change that occurred to a cell or entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellChangeKind {
    /// An entry was added or its value was modified.
    Modified,
    /// An entry was removed.
    Removed,
}

/// Describes a single cell change detected by the observer.
#[derive(Debug, Clone, PartialEq)]
pub struct CellChange {
    pub sheet_id: SheetId,
    pub cell_id: CellId,
    pub kind: CellChangeKind,
    /// The previous cell value before this change, if available.
    /// Extracted from yrs `EntryChange::Updated`/`Removed` variants.
    pub old_value: Option<CellValue>,
}

// ---------------------------------------------------------------------------
// Leaf change types for each domain
// ---------------------------------------------------------------------------

/// A property change detected by the observer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyCellChange {
    pub sheet_id: SheetId,
    pub cell_id: CellId,
    pub kind: CellChangeKind,
}

/// A dimension change (row height or col width).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DimensionCellChange {
    pub sheet_id: SheetId,
    /// The hex key in the rowHeights/colWidths map.
    pub key: String,
    pub kind: CellChangeKind,
}

/// A merge range change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeCellChange {
    pub sheet_id: SheetId,
    /// The merge key (typically a range string or hex ID).
    pub key: String,
    pub kind: CellChangeKind,
}

/// A visibility change (hidden row or hidden column).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VisibilityCellChange {
    pub sheet_id: SheetId,
    /// The row/column key.
    pub key: String,
    pub kind: CellChangeKind,
}

/// A comment change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentCellChange {
    pub sheet_id: SheetId,
    /// The cell hex key for the comment.
    pub key: String,
    pub kind: CellChangeKind,
}

/// A sheet-level change (the sub-map itself changed, details opaque).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetLevelChange {
    pub sheet_id: SheetId,
    /// Specific entry key, if available.
    pub key: Option<String>,
    pub kind: CellChangeKind,
}

/// A floating object change (charts, shapes, images).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FloatingObjectCellChange {
    pub sheet_id: SheetId,
    /// The floating object ID (plain string, not hex).
    pub object_id: String,
    pub kind: CellChangeKind,
}

/// A pivot table change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotCellChange {
    pub sheet_id: SheetId,
    /// The pivot table ID (plain string).
    pub pivot_id: String,
    pub kind: CellChangeKind,
}

/// A table change (workbook-level).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TableCellChange {
    /// The table key/ID.
    pub key: String,
    pub kind: CellChangeKind,
}

/// A sheet metadata change (name, visibility, order).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetMetaChange {
    pub sheet_id: SheetId,
    /// The specific meta field that changed (e.g., "name", "rows", "cols").
    pub field: Option<String>,
    pub kind: CellChangeKind,
}

/// A `gridIndex/posToId` entry change — a `(row, col)` position was
/// bound to (or unbound from) a `CellId` in the authoritative yrs-side
/// identity store.
///
/// Emitted whenever a peer receives a remote write that mirrored into
/// the `gridIndex/posToId` sub-map (e.g. a cell value, a comment, a
/// format on a previously-empty cell). The consuming engine uses this
/// to hydrate its in-memory `GridIndex` so that subsequent
/// position-based lookups (`find_cell_id_at`, `cell_position`)
/// resolve immediately, without waiting for the associated payload
/// event to arrive first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GridIndexCellChange {
    pub sheet_id: SheetId,
    pub cell_id: CellId,
    /// The row-identity hex (matches an entry in this sheet's
    /// `rowOrder` YArray). The consumer resolves this to a row index
    /// on demand.
    pub row_hex: String,
    /// The column-identity hex (matches an entry in this sheet's
    /// `colOrder` YArray).
    pub col_hex: String,
    pub kind: CellChangeKind,
}

// ---------------------------------------------------------------------------
// PivotChange types (kept for backward compat during migration)
// ---------------------------------------------------------------------------

/// The kind of change that occurred to a pivot table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PivotChangeKind {
    /// A pivot table was created or updated.
    Set,
    /// A pivot table was removed.
    Removed,
}

/// Describes a single pivot table change detected by the observer.
/// Kept for backward compatibility during migration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PivotChange {
    pub sheet_id: SheetId,
    pub pivot_id: String,
    pub kind: PivotChangeKind,
}

// ---------------------------------------------------------------------------
// DocumentChanges
// ---------------------------------------------------------------------------

/// All changes detected in a single yrs observation drain.
///
/// Each field is a `Vec` that is zero-cost when empty (no heap allocation
/// until a change is actually pushed). This struct aggregates all domain
/// changes from both the sheets map and the workbook map.
#[derive(Debug, Default)]
pub struct DocumentChanges {
    /// Cell value/formula changes (existing CellChange type).
    pub cells: Vec<CellChange>,
    /// Cell format/property changes.
    pub properties: Vec<PropertyCellChange>,
    /// Row height changes.
    pub row_heights: Vec<DimensionCellChange>,
    /// Column width changes.
    pub col_widths: Vec<DimensionCellChange>,
    /// Merge range changes.
    pub merges: Vec<MergeCellChange>,
    /// Row visibility changes.
    pub hidden_rows: Vec<VisibilityCellChange>,
    /// Column visibility changes.
    pub hidden_cols: Vec<VisibilityCellChange>,
    /// Comment changes.
    pub comments: Vec<CommentCellChange>,
    /// Filter changes.
    pub filters: Vec<SheetLevelChange>,
    /// Grouping changes.
    pub grouping: Vec<SheetLevelChange>,
    /// Sparkline changes.
    pub sparklines: Vec<SheetLevelChange>,
    /// Conditional format changes.
    pub conditional_formats: Vec<SheetLevelChange>,
    /// Floating object changes (charts, shapes, images).
    pub floating_objects: Vec<FloatingObjectCellChange>,
    /// Pivot table changes (absorbs PivotObserver).
    pub pivot_tables: Vec<PivotCellChange>,
    /// Table changes (workbook-level).
    pub tables: Vec<TableCellChange>,
    /// Sheet metadata changes (name, visibility, order).
    pub sheet_meta: Vec<SheetMetaChange>,
    /// Row format changes.
    pub row_formats: Vec<SheetLevelChange>,
    /// Column format changes.
    pub col_formats: Vec<SheetLevelChange>,
    /// Sorting changes.
    pub sorting: Vec<SheetLevelChange>,
    /// Named range changes (workbook-level).
    pub named_ranges: Vec<SheetLevelChange>,
    /// Sheet additions (new sheets detected via observer).
    pub sheet_additions: Vec<SheetId>,
    /// Sheet deletions (removed sheets detected via observer).
    pub sheet_deletions: Vec<SheetId>,
    /// Sheets with structural row/col order changes (YArray mutations).
    pub structural_changes: Vec<SheetId>,
    /// `gridIndex/posToId` entry changes — position ↔ `CellId`
    /// bindings that need to be mirrored into the in-memory
    /// `GridIndex` on the receiving engine.
    pub grid_index: Vec<GridIndexCellChange>,
    /// Whether the workbook-level `sheetOrder` Y.Array was mutated
    /// (move_sheet, reorder_sheets, or undo/redo thereof).
    ///
    /// The `sheetOrder` array is a Y.Array inside the workbook map;
    /// mutations to it emit `Event::Array` events (not `Event::Map`),
    /// which the workbook observer must explicitly handle. When true,
    /// `build_mutation_result_from_changes` emits `SheetChange{field: Order}`
    /// entries so the TS mirror updates tab positions.
    pub sheet_order_changed: bool,
    /// Whether the `workbookSettings` sub-map changed.
    /// When `true`, `build_mutation_result_from_changes` re-reads the
    /// full workbook settings from yrs and emits a `WorkbookSettingsChange`.
    pub workbook_settings_changed: bool,
}

impl DocumentChanges {
    /// Returns true if no changes were detected in any domain.
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
            && self.properties.is_empty()
            && self.row_heights.is_empty()
            && self.col_widths.is_empty()
            && self.merges.is_empty()
            && self.hidden_rows.is_empty()
            && self.hidden_cols.is_empty()
            && self.comments.is_empty()
            && self.filters.is_empty()
            && self.grouping.is_empty()
            && self.sparklines.is_empty()
            && self.conditional_formats.is_empty()
            && self.floating_objects.is_empty()
            && self.pivot_tables.is_empty()
            && self.tables.is_empty()
            && self.sheet_meta.is_empty()
            && self.row_formats.is_empty()
            && self.col_formats.is_empty()
            && self.sorting.is_empty()
            && self.named_ranges.is_empty()
            && self.sheet_additions.is_empty()
            && self.sheet_deletions.is_empty()
            && self.structural_changes.is_empty()
            && self.grid_index.is_empty()
            && !self.sheet_order_changed
            && !self.workbook_settings_changed
    }

    /// Returns true if there are any changes outside the `cells` field.
    ///
    /// Useful during migration: callers that only handle cell changes can
    /// check this to know if they're missing non-cell changes.
    pub fn has_non_cell_changes(&self) -> bool {
        !self.properties.is_empty()
            || !self.row_heights.is_empty()
            || !self.col_widths.is_empty()
            || !self.merges.is_empty()
            || !self.hidden_rows.is_empty()
            || !self.hidden_cols.is_empty()
            || !self.comments.is_empty()
            || !self.filters.is_empty()
            || !self.grouping.is_empty()
            || !self.sparklines.is_empty()
            || !self.conditional_formats.is_empty()
            || !self.floating_objects.is_empty()
            || !self.pivot_tables.is_empty()
            || !self.tables.is_empty()
            || !self.sheet_meta.is_empty()
            || !self.row_formats.is_empty()
            || !self.col_formats.is_empty()
            || !self.sorting.is_empty()
            || !self.named_ranges.is_empty()
            || !self.sheet_additions.is_empty()
            || !self.sheet_deletions.is_empty()
            || !self.grid_index.is_empty()
            || self.sheet_order_changed
            || self.workbook_settings_changed
    }
}
