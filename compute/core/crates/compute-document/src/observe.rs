//! # Document Observer
//!
//! Bridges yrs document changes to the compute engine's recalculation system.
//!
//! The `DocumentObserver` watches ALL yrs sub-maps (cells, properties, merges,
//! dimensions, visibility, comments, filters, grouping, sparklines, conditional
//! formats, floating objects, pivot tables, tables, etc.) and produces a unified
//! `DocumentChanges` struct containing typed change entries for each domain.
//!
//! This replaces the previous `StorageObserver` (cells only) and `PivotObserver`
//! (pivot tables only) with a single, comprehensive observer.
//!
//! # Origin filtering
//!
//! Changes originating from formula result writes (`ORIGIN_FORMULA_RESULT`) are
//! excluded to prevent infinite recalc loops: user edits trigger recalc, which
//! writes formula results, which should NOT trigger another recalc.
//!
//! # Usage
//!
//! ```ignore
//! use compute_document::observe::DocumentObserver;
//!
//! let doc = yrs::Doc::new();
//! let sheets = doc.get_or_insert_map("sheets");
//! let workbook = doc.get_or_insert_map("workbook");
//! let observer = DocumentObserver::new(&sheets, &workbook);
//!
//! // ... perform edits via transactions ...
//!
//! let changes = observer.drain_all_changes();
//! // feed `changes` to the appropriate handlers
//! ```

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use yrs::types::{EntryChange, Event, Events, PathSegment};
use yrs::{Any, DeepObservable, Map, MapRef, Out, ReadTxn, Subscription, TransactionMut};

use value_types::CellValue;

use crate::hex::{parse_cell_id, parse_sheet_id};
use crate::schema::{
    KEY_CELL_PROPERTIES, KEY_CELLS, KEY_COL_FORMATS, KEY_COL_WIDTHS, KEY_COMMENTS,
    KEY_CONDITIONAL_FORMAT, KEY_FILTERS, KEY_FLOATING_OBJECTS, KEY_GROUPING, KEY_HIDDEN_COLS,
    KEY_HIDDEN_ROWS, KEY_MERGES, KEY_NAMED_RANGES, KEY_PIVOT_TABLES, KEY_PROPERTIES,
    KEY_RANGE_BINDINGS, KEY_ROW_FORMATS, KEY_ROW_HEIGHTS, KEY_SORTING, KEY_SPARKLINES, KEY_TABLES,
    KEY_WORKBOOK_SETTINGS,
};
use crate::undo::ORIGIN_FORMULA_RESULT;
use cell_types::{CellId, SheetId};

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

// ---------------------------------------------------------------------------
// DocumentObserver
// ---------------------------------------------------------------------------

/// Observes changes to the yrs "sheets" and "workbook" maps, producing a
/// unified [`DocumentChanges`] containing typed change entries for every domain.
///
/// This replaces both `StorageObserver` and `PivotObserver` with a single
/// observer that watches all sub-maps.
///
/// Call [`drain_all_changes`](DocumentObserver::drain_all_changes) to retrieve
/// all accumulated changes, or [`drain_changes`](DocumentObserver::drain_changes)
/// for backward-compatible cell-only changes.
pub struct DocumentObserver {
    /// Accumulated changes from yrs callbacks.
    changes: Arc<Mutex<DocumentChanges>>,

    /// Suppression depth counter. When > 0, observe_deep callbacks return
    /// immediately without processing events or allocating. Supports nesting:
    /// `set_suppressed(true)` increments, `set_suppressed(false)` decrements.
    /// Used during forward mutations where the caller already constructs side
    /// effects directly and would immediately discard observer output.
    suppress_depth: Arc<AtomicU32>,

    /// Subscription handle for the sheets map -- kept alive so the callback
    /// remains active.
    _sheets_subscription: Subscription,

    /// Subscription handle for the workbook map.
    _workbook_subscription: Subscription,
}

/// Convert an `EntryChange` to a `CellChangeKind`.
fn entry_change_kind(change: &EntryChange) -> CellChangeKind {
    match change {
        EntryChange::Inserted(_) | EntryChange::Updated(_, _) => CellChangeKind::Modified,
        EntryChange::Removed(_) => CellChangeKind::Removed,
    }
}

/// Convert a raw yrs `Any` to a `CellValue`.
/// Mirrors the logic in `cell_serde::yrs_any_to_cell_value` but operates on
/// bare `Any` values (from `Out::Any` or `EntryChange`) instead of reading
/// from a `MapRef`.
fn any_to_cell_value(any: &Any) -> CellValue {
    match any {
        Any::Number(n) => CellValue::number(*n),
        Any::String(s) => {
            if let Some(err) = value_types::CellError::parse_error_str(s) {
                CellValue::Error(err, None)
            } else {
                CellValue::Text(std::sync::Arc::clone(s))
            }
        }
        Any::Bool(b) => CellValue::Boolean(*b),
        Any::Null | Any::Undefined => CellValue::Null,
        _ => CellValue::Null,
    }
}

/// Extract the old cell value from an `EntryChange` at depth 2.
///
/// At depth 2, entries in the cells map are entire cell sub-maps.
/// `Updated(old, _)` / `Removed(old)` contain the old cell entry as `Out`.
///
/// **yrs limitation:** When a cell map is replaced at depth 2, the old `YMap`
/// reference becomes orphaned and its contents cannot be read from the current
/// transaction. In this case we return `None`. Old values ARE reliably captured
/// at depth 3 (in-place field modifications), which covers the common case of
/// user edits to existing cells.
fn extract_old_value_from_entry<T: ReadTxn>(change: &EntryChange, txn: &T) -> Option<CellValue> {
    let old_out = match change {
        EntryChange::Updated(old, _) | EntryChange::Removed(old) => old,
        EntryChange::Inserted(_) => return None,
    };
    match old_out {
        Out::YMap(map_ref) => {
            // Try to read the "v" key from the old cell map. This often fails
            // because the old map is orphaned after depth-2 replacement.
            match map_ref.get(txn, crate::schema::KEY_VALUE) {
                Some(Out::Any(any)) => Some(any_to_cell_value(&any)),
                _ => None,
            }
        }
        Out::Any(any) => Some(any_to_cell_value(any)),
        _ => None,
    }
}

/// Extract sheet_id from path position 0.
fn extract_sheet_id(path: &VecDeque<PathSegment>) -> Option<SheetId> {
    match path.front() {
        Some(PathSegment::Key(hex)) => parse_sheet_id(hex),
        _ => None,
    }
}

impl DocumentObserver {
    /// Create a new `DocumentObserver` attached to the given "sheets" and
    /// "workbook" `MapRef`s.
    ///
    /// The observer registers `observe_deep` callbacks on both maps. When
    /// any sub-map within either map changes, the observer records typed
    /// change entries that can be retrieved via
    /// [`drain_all_changes`](DocumentObserver::drain_all_changes).
    pub fn new(sheets_map: &MapRef, workbook_map: &MapRef) -> Self {
        let changes: Arc<Mutex<DocumentChanges>> = Arc::new(Mutex::new(DocumentChanges::default()));
        let suppress_depth: Arc<AtomicU32> = Arc::new(AtomicU32::new(0));

        // --- Sheets map subscription ---
        let sheets_changes = changes.clone();
        let sheets_suppress = suppress_depth.clone();
        let sheets_subscription =
            sheets_map.observe_deep(move |txn: &TransactionMut, events: &Events| {
                // Fast exit when suppressed — no event iteration, no allocation.
                if sheets_suppress.load(Ordering::Relaxed) > 0 {
                    return;
                }

                // Check origin -- skip formula-result writes to prevent recalc loops.
                if let Some(origin) = txn.origin()
                    && origin.as_ref() == ORIGIN_FORMULA_RESULT
                {
                    return;
                }

                let mut buffer = sheets_changes.lock().expect("observer lock poisoned");

                for event in events.iter() {
                    match event {
                        Event::Map(map_event) => {
                            let path = map_event.path();

                            // path.len() == 0: top-level sheets map changed —
                            // a sheet was added or removed.
                            if path.is_empty() {
                                let keys = map_event.keys(txn);
                                for (key, change) in keys {
                                    if let Some(sheet_id) = parse_sheet_id(key) {
                                        match change {
                                            EntryChange::Inserted(_) => {
                                                buffer.sheet_additions.push(sheet_id);
                                            }
                                            EntryChange::Removed(_) => {
                                                buffer.sheet_deletions.push(sheet_id);
                                            }
                                            EntryChange::Updated(_, _) => {
                                                // Treat update as an addition (re-sync).
                                                buffer.sheet_additions.push(sheet_id);
                                            }
                                        }
                                    }
                                }
                                continue;
                            }

                            // path.len() == 1: sheet-level sub-map keys, not actionable.
                            if path.len() < 2 {
                                continue;
                            }

                            let sheet_id = match extract_sheet_id(&path) {
                                Some(id) => id,
                                None => continue,
                            };

                            // Determine which sub-map this event is for.
                            let sub_map_key = match path.get(1) {
                                Some(PathSegment::Key(k)) => k.clone(),
                                _ => continue,
                            };

                            match sub_map_key.as_ref() {
                                // --- cells ---
                                k if k == KEY_CELLS => {
                                    if path.len() == 2 {
                                        // Entries added/removed from the cells map.
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            if let Some(cell_id) = parse_cell_id(key) {
                                                let old_value =
                                                    extract_old_value_from_entry(change, txn);
                                                buffer.cells.push(CellChange {
                                                    sheet_id,
                                                    cell_id,
                                                    kind: entry_change_kind(change),
                                                    old_value,
                                                });
                                            }
                                        }
                                    } else if path.len() == 3 {
                                        // A cell's internal map (v, f) was updated in place.
                                        // Iterate the field-level keys to capture old "v" value.
                                        if let Some(PathSegment::Key(hex)) = path.get(2)
                                            && let Some(cell_id) = parse_cell_id(hex)
                                        {
                                            let old_value = {
                                                let field_keys = map_event.keys(txn);
                                                field_keys.get(crate::schema::KEY_VALUE).and_then(
                                                    |ch| match ch {
                                                        EntryChange::Updated(Out::Any(old), _) => {
                                                            Some(any_to_cell_value(old))
                                                        }
                                                        EntryChange::Removed(Out::Any(old)) => {
                                                            Some(any_to_cell_value(old))
                                                        }
                                                        _ => None,
                                                    },
                                                )
                                            };
                                            buffer.cells.push(CellChange {
                                                sheet_id,
                                                cell_id,
                                                kind: CellChangeKind::Modified,
                                                old_value,
                                            });
                                        }
                                    }
                                }

                                // --- properties ---
                                k if k == KEY_CELL_PROPERTIES => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            if let Some(cell_id) = parse_cell_id(key) {
                                                buffer.properties.push(PropertyCellChange {
                                                    sheet_id,
                                                    cell_id,
                                                    kind: entry_change_kind(change),
                                                });
                                            }
                                        }
                                    } else if path.len() == 3 {
                                        // Entry modified in place — cell_id is at path[2].
                                        if let Some(PathSegment::Key(hex)) = path.get(2)
                                            && let Some(cell_id) = parse_cell_id(hex)
                                        {
                                            buffer.properties.push(PropertyCellChange {
                                                sheet_id,
                                                cell_id,
                                                kind: CellChangeKind::Modified,
                                            });
                                        }
                                    }
                                }

                                // --- rowHeights ---
                                k if k == KEY_ROW_HEIGHTS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.row_heights.push(DimensionCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                }

                                // --- colWidths ---
                                k if k == KEY_COL_WIDTHS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.col_widths.push(DimensionCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                }

                                // --- merges ---
                                k if k == KEY_MERGES => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.merges.push(MergeCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    } else if path.len() == 3
                                        && let Some(PathSegment::Key(k)) = path.get(2)
                                    {
                                        buffer.merges.push(MergeCellChange {
                                            sheet_id,
                                            key: k.to_string(),
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }

                                // --- hiddenRows ---
                                k if k == KEY_HIDDEN_ROWS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.hidden_rows.push(VisibilityCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                }

                                // --- hiddenCols ---
                                k if k == KEY_HIDDEN_COLS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.hidden_cols.push(VisibilityCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                }

                                // --- comments ---
                                k if k == KEY_COMMENTS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.comments.push(CommentCellChange {
                                                sheet_id,
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    } else if path.len() == 3
                                        && let Some(PathSegment::Key(k)) = path.get(2)
                                    {
                                        buffer.comments.push(CommentCellChange {
                                            sheet_id,
                                            key: k.to_string(),
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }

                                // --- filters ---
                                k if k == KEY_FILTERS => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.filters,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- grouping ---
                                k if k == KEY_GROUPING => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.grouping,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- sparklines ---
                                k if k == KEY_SPARKLINES => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.sparklines,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- conditionalFormat ---
                                k if k == KEY_CONDITIONAL_FORMAT => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.conditional_formats,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- sorting ---
                                k if k == KEY_SORTING => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.sorting,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- rowFormats ---
                                k if k == KEY_ROW_FORMATS => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.row_formats,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- colFormats ---
                                k if k == KEY_COL_FORMATS => {
                                    Self::push_sheet_level_change(
                                        &mut buffer.col_formats,
                                        sheet_id,
                                        &path,
                                        map_event,
                                        txn,
                                    );
                                }

                                // --- floatingObjects ---
                                k if k == KEY_FLOATING_OBJECTS => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.floating_objects.push(
                                                FloatingObjectCellChange {
                                                    sheet_id,
                                                    object_id: key.to_string(),
                                                    kind: entry_change_kind(change),
                                                },
                                            );
                                        }
                                    } else if path.len() == 3
                                        && let Some(PathSegment::Key(k)) = path.get(2)
                                    {
                                        buffer.floating_objects.push(FloatingObjectCellChange {
                                            sheet_id,
                                            object_id: k.to_string(),
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }

                                // --- pivotTables ---
                                k if k == KEY_PIVOT_TABLES => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.pivot_tables.push(PivotCellChange {
                                                sheet_id,
                                                pivot_id: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    } else if path.len() == 3
                                        && let Some(PathSegment::Key(k)) = path.get(2)
                                    {
                                        buffer.pivot_tables.push(PivotCellChange {
                                            sheet_id,
                                            pivot_id: k.to_string(),
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }

                                // --- meta ---
                                k if k == KEY_PROPERTIES => {
                                    if path.len() == 2 {
                                        let keys = map_event.keys(txn);
                                        for (key, change) in keys {
                                            buffer.sheet_meta.push(SheetMetaChange {
                                                sheet_id,
                                                field: Some(key.to_string()),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    } else if path.len() == 3 {
                                        let field = match path.get(2) {
                                            Some(PathSegment::Key(k)) => Some(k.to_string()),
                                            _ => None,
                                        };
                                        buffer.sheet_meta.push(SheetMetaChange {
                                            sheet_id,
                                            field,
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }

                                // --- Authoritative yrs-side identity: gridIndex ---
                                // `gridIndex/posToId` maps "rowHex:colHex" -> cellHex
                                // and is the CRDT-synchronised position-to-CellId
                                // store (post-R51). Entry inserts and removals
                                // here must propagate into the receiving engine's
                                // in-memory `GridIndex` — otherwise metadata-only
                                // writes (comments, formats, hyperlinks on an
                                // empty cell) leave the peer unable to resolve
                                // the new cell's position. `idToPos` is the
                                // inverse map; we observe only `posToId` to
                                // avoid double-counting.
                                "gridIndex" => {
                                    if path.len() == 3
                                        && let Some(PathSegment::Key(sub)) = path.get(2)
                                        && sub.as_ref() == "posToId"
                                    {
                                        let keys = map_event.keys(txn);
                                        for (pos_key, change) in keys {
                                            let Some((row_hex, col_hex)) = pos_key.split_once(':')
                                            else {
                                                continue;
                                            };
                                            if row_hex.is_empty() || col_hex.is_empty() {
                                                continue;
                                            }
                                            let cell_id_opt = match change {
                                                EntryChange::Inserted(Out::Any(Any::String(s)))
                                                | EntryChange::Updated(
                                                    _,
                                                    Out::Any(Any::String(s)),
                                                ) => parse_cell_id(s.as_ref()),
                                                EntryChange::Removed(Out::Any(Any::String(s))) => {
                                                    parse_cell_id(s.as_ref())
                                                }
                                                _ => None,
                                            };
                                            let Some(cell_id) = cell_id_opt else {
                                                continue;
                                            };
                                            buffer.grid_index.push(GridIndexCellChange {
                                                sheet_id,
                                                cell_id,
                                                row_hex: row_hex.to_string(),
                                                col_hex: col_hex.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                    // `idToPos` and the `gridIndex` sub-map
                                    // entry itself: no events emitted.
                                }

                                // --- Structural YArray changes: rowOrder/colOrder ---
                                // rowOrder/colOrder YArray changes indicate structural mutations
                                // (row/col insert/delete/reorder). Detect them for rebuild.
                                "rowOrder" | "colOrder" => {
                                    buffer.structural_changes.push(sheet_id);
                                }

                                // --- Unknown sub-maps: silently skip ---
                                // When new sub-maps are added to the schema, they will hit this
                                // arm. No crash, no noise — add a match arm when ready.
                                _ => {}
                            }
                        }
                        // YArray events: detect rowOrder/colOrder structural changes.
                        Event::Array(arr_event) => {
                            let path = arr_event.path();
                            // path = [sheetHex, "rowOrder"|"colOrder"]
                            if path.len() >= 2
                                && let Some(PathSegment::Key(sub_key)) = path.get(1)
                                && (sub_key.as_ref() == "rowOrder"
                                    || sub_key.as_ref() == "colOrder")
                                && let Some(sheet_id) = extract_sheet_id(&path)
                            {
                                buffer.structural_changes.push(sheet_id);
                            }
                        }
                        // Other event types — skip.
                        _ => {}
                    }
                }
            });

        // --- Workbook map subscription ---
        let workbook_changes = changes.clone();
        let workbook_suppress = suppress_depth.clone();
        let workbook_subscription =
            workbook_map.observe_deep(move |txn: &TransactionMut, events: &Events| {
                // Fast exit when suppressed — no event iteration, no allocation.
                if workbook_suppress.load(Ordering::Relaxed) > 0 {
                    return;
                }

                if let Some(origin) = txn.origin()
                    && origin.as_ref() == ORIGIN_FORMULA_RESULT
                {
                    return;
                }

                let mut buffer = workbook_changes.lock().expect("observer lock poisoned");

                for event in events.iter() {
                    if let Event::Map(map_event) = event {
                        let path = map_event.path();

                        if path.is_empty() {
                            // Top-level workbook map changed — entries added/removed.
                            // Most sub-map *content* changes fire below at path.len() >= 1.
                            // BUT: when an entire sub-map is added or removed at the
                            // workbook root (e.g. lazy-create of `tables` on first
                            // write, or undo unwinding that lazy-create), yrs only
                            // emits the workbook-root event — the inner map's
                            // contents disappear without their own events.
                            //
                            // Fix: detect known sub-map keys here and emit a synthetic
                            // "domain changed" entry so the engine's mirror-sync
                            // pipeline (`sync_tables_from_yrs`,
                            // `sync_named_ranges_from_yrs`) re-reads yrs and
                            // reconciles the mirror. Without this, an undo that
                            // removes the lazy-created sub-map leaves the mirror
                            // holding stale data.
                            let keys = map_event.keys(txn);
                            for (key, change) in keys {
                                let kind = entry_change_kind(change);
                                match key.as_ref() {
                                    k if k == KEY_TABLES => {
                                        // Domain reset: the *content* of the tables sub-map is
                                        // being created/destroyed wholesale. Push a sentinel
                                        // entry; sync_tables_from_yrs is idempotent and will
                                        // re-read yrs and reconcile the mirror.
                                        buffer.tables.push(TableCellChange {
                                            key: String::new(),
                                            kind,
                                        });
                                    }
                                    k if k == KEY_RANGE_BINDINGS => {
                                        buffer.tables.push(TableCellChange {
                                            key: String::new(),
                                            kind,
                                        });
                                    }
                                    k if k == KEY_NAMED_RANGES => {
                                        buffer.named_ranges.push(SheetLevelChange {
                                            sheet_id: SheetId::from_raw(0),
                                            key: None,
                                            kind,
                                        });
                                    }
                                    k if k == KEY_WORKBOOK_SETTINGS => {
                                        buffer.workbook_settings_changed = true;
                                    }
                                    _ => {
                                        // Other workbook sub-maps (slicers, etc.)
                                        // don't currently have a mirror-sync pipeline keyed on
                                        // observer changes. They're either read on-demand from
                                        // yrs or driven by direct mutation paths.
                                    }
                                }
                            }
                            continue;
                        }

                        // Path: [Key(sub_map_key), ...]
                        let sub_map_key = match path.front() {
                            Some(PathSegment::Key(k)) => k.clone(),
                            _ => continue,
                        };

                        match sub_map_key.as_ref() {
                            // --- tables ---
                            k if k == KEY_TABLES => {
                                if path.len() == 1 {
                                    // Entries added/removed from the tables map.
                                    let keys = map_event.keys(txn);
                                    for (key, change) in keys {
                                        buffer.tables.push(TableCellChange {
                                            key: key.to_string(),
                                            kind: entry_change_kind(change),
                                        });
                                    }
                                } else if path.len() == 2 {
                                    // A table's internal map was modified in place.
                                    if let Some(PathSegment::Key(k)) = path.get(1) {
                                        buffer.tables.push(TableCellChange {
                                            key: k.to_string(),
                                            kind: CellChangeKind::Modified,
                                        });
                                    }
                                }
                            }

                            // --- rangeBindings ---
                            k if k == KEY_RANGE_BINDINGS => {
                                if path.len() == 1 {
                                    let keys = map_event.keys(txn);
                                    for (key, change) in keys {
                                        if key.as_ref().starts_with("table:") {
                                            buffer.tables.push(TableCellChange {
                                                key: key.to_string(),
                                                kind: entry_change_kind(change),
                                            });
                                        }
                                    }
                                }
                            }

                            // --- namedRanges ---
                            k if k == KEY_NAMED_RANGES => {
                                if path.len() == 1 {
                                    let keys = map_event.keys(txn);
                                    for (key, change) in keys {
                                        buffer.named_ranges.push(SheetLevelChange {
                                            // Named ranges are workbook-level; use a zero sheet_id.
                                            sheet_id: SheetId::from_raw(0),
                                            key: Some(key.to_string()),
                                            kind: entry_change_kind(change),
                                        });
                                    }
                                } else if path.len() == 2 {
                                    let field = match path.get(1) {
                                        Some(PathSegment::Key(k)) => Some(k.to_string()),
                                        _ => None,
                                    };
                                    buffer.named_ranges.push(SheetLevelChange {
                                        sheet_id: SheetId::from_raw(0),
                                        key: field,
                                        kind: CellChangeKind::Modified,
                                    });
                                }
                            }

                            // --- workbookSettings ---
                            k if k == KEY_WORKBOOK_SETTINGS => {
                                buffer.workbook_settings_changed = true;
                            }

                            // --- Unknown workbook sub-maps ---
                            _ => {}
                        }
                    } else if let Event::Array(arr_event) = event {
                        // The `sheetOrder` Y.Array is nested inside the workbook
                        // map. Mutations to it (move_sheet, reorder_sheets, and
                        // their undo/redo) emit `Event::Array` events. The path
                        // contains a single `Key("sheetOrder")` segment.
                        let path = arr_event.path();
                        if path.len() == 1
                            && matches!(
                                path.front(),
                                Some(PathSegment::Key(k)) if k.as_ref() == crate::schema::KEY_SHEET_ORDER
                            )
                        {
                            buffer.sheet_order_changed = true;
                        }
                    }
                }

            });

        Self {
            changes,
            suppress_depth,
            _sheets_subscription: sheets_subscription,
            _workbook_subscription: workbook_subscription,
        }
    }

    /// Helper: push a sheet-level change for sub-maps where we track entries
    /// at a coarse granularity (key + kind).
    fn push_sheet_level_change(
        target: &mut Vec<SheetLevelChange>,
        sheet_id: SheetId,
        path: &VecDeque<PathSegment>,
        map_event: &yrs::types::map::MapEvent,
        txn: &TransactionMut,
    ) {
        if path.len() == 2 {
            let keys = map_event.keys(txn);
            for (key, change) in keys {
                target.push(SheetLevelChange {
                    sheet_id,
                    key: Some(key.to_string()),
                    kind: entry_change_kind(change),
                });
            }
        } else if path.len() >= 3 {
            // Deeper modification — report the entry key from path[2].
            let key = match path.get(2) {
                Some(PathSegment::Key(k)) => Some(k.to_string()),
                _ => None,
            };
            target.push(SheetLevelChange {
                sheet_id,
                key,
                kind: CellChangeKind::Modified,
            });
        }
    }

    /// Suppress or unsuppress the observer. Supports nesting: each
    /// `set_suppressed(true)` increments a depth counter, each
    /// `set_suppressed(false)` decrements it. The observer is active only
    /// when the depth is 0.
    ///
    /// When suppressed, the `observe_deep` callbacks return immediately without
    /// iterating events, parsing keys, or allocating `DocumentChanges`. This
    /// eliminates wasted work during forward mutations where the caller already
    /// constructs side effects directly and would otherwise discard the observer
    /// output via `drain_changes()`.
    ///
    /// **IMPORTANT**: Only suppress during forward mutation yrs writes. Never
    /// suppress during undo/redo/sync — those paths rely on the observer to
    /// detect what changed.
    pub fn set_suppressed(&self, suppress: bool) {
        if suppress {
            self.suppress_depth.fetch_add(1, Ordering::Relaxed);
        } else {
            let prev = self.suppress_depth.fetch_sub(1, Ordering::Relaxed);
            debug_assert!(
                prev > 0,
                "set_suppressed(false) called more times than set_suppressed(true)"
            );
        }
    }

    /// Returns true if the observer is currently suppressed.
    pub fn is_suppressed(&self) -> bool {
        self.suppress_depth.load(Ordering::Relaxed) > 0
    }

    /// Drain all accumulated changes, returning them and clearing the buffer.
    ///
    /// This is the primary API for retrieving the full set of domain-specific
    /// changes detected since the last drain.
    pub fn drain_all_changes(&self) -> DocumentChanges {
        let mut buffer = self.changes.lock().expect("observer lock poisoned");
        std::mem::take(&mut *buffer)
    }

    /// Drain only cell changes (backward-compatible convenience wrapper).
    ///
    /// During migration, callers that only need cell changes can use this
    /// method. Non-cell changes are discarded.
    pub fn drain_changes(&self) -> Vec<CellChange> {
        let all = self.drain_all_changes();
        all.cells
    }

    /// Drain pivot changes, converting to the legacy `PivotChange` format.
    ///
    /// Backward-compatible wrapper for code that previously used `PivotObserver`.
    pub fn drain_pivot_changes(&self) -> Vec<PivotChange> {
        let mut buffer = self.changes.lock().expect("observer lock poisoned");
        let pivot_changes: Vec<PivotCellChange> = std::mem::take(&mut buffer.pivot_tables);
        pivot_changes
            .into_iter()
            .map(|pc| PivotChange {
                sheet_id: pc.sheet_id,
                pivot_id: pc.pivot_id,
                kind: match pc.kind {
                    CellChangeKind::Modified => PivotChangeKind::Set,
                    CellChangeKind::Removed => PivotChangeKind::Removed,
                },
            })
            .collect()
    }

    /// Check whether there are any pending changes without draining them.
    pub fn has_changes(&self) -> bool {
        let buffer = self.changes.lock().expect("observer lock poisoned");
        !buffer.is_empty()
    }

    /// Peek at the number of pending cell changes.
    pub fn pending_count(&self) -> usize {
        let buffer = self.changes.lock().expect("observer lock poisoned");
        buffer.cells.len()
    }
}

impl std::fmt::Debug for DocumentObserver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let count = self.pending_count();
        f.debug_struct("DocumentObserver")
            .field("pending_changes", &count)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Backward-compatible type aliases
// ---------------------------------------------------------------------------

/// Type alias for backward compatibility. Use [`DocumentObserver`] directly.
pub type StorageObserver = DocumentObserver;

/// Deprecated: Use [`DocumentObserver`] directly.
/// This struct is kept only as a type alias for backward compatibility.
pub type PivotObserver = DocumentObserver;

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hex::{hex_to_id, id_to_hex};
    use crate::undo::{ORIGIN_FORMULA_RESULT, ORIGIN_REMOTE, ORIGIN_USER_EDIT};
    use std::sync::Arc;
    use yrs::{Any, Doc, Map, MapPrelim, Out, Transact};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    /// Assert that a `CellChange` matches the expected base fields (ignoring `old_value`).
    fn assert_cell_change_base(
        actual: &CellChange,
        sheet_id: SheetId,
        cell_id: CellId,
        kind: CellChangeKind,
    ) {
        assert_eq!(actual.sheet_id, sheet_id, "sheet_id mismatch");
        assert_eq!(actual.cell_id, cell_id, "cell_id mismatch");
        assert_eq!(actual.kind, kind, "kind mismatch");
    }

    /// Check if a `Vec<CellChange>` contains an entry matching the base fields.
    fn contains_cell_change(
        changes: &[CellChange],
        sheet_id: SheetId,
        cell_id: CellId,
        kind: CellChangeKind,
    ) -> bool {
        changes
            .iter()
            .any(|c| c.sheet_id == sheet_id && c.cell_id == cell_id && c.kind == kind)
    }

    /// Set up a Doc with the standard schema and return (doc, sheets_map, workbook_map).
    fn setup_doc() -> (Doc, MapRef, MapRef) {
        let doc = Doc::new();
        let sheets = doc.get_or_insert_map("sheets");
        let workbook = doc.get_or_insert_map("workbook");
        (doc, sheets, workbook)
    }

    /// Add a sheet with a "cells" sub-map to the sheets map.
    fn add_sheet(doc: &Doc, sheets: &MapRef, sheet_id: SheetId) -> String {
        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let mut txn = doc.transact_mut();
        let sheet_map: MapRef = sheets.insert(
            &mut txn,
            &*sheet_hex,
            MapPrelim::from([] as [(&str, Any); 0]),
        );
        let _cells_map: MapRef =
            sheet_map.insert(&mut txn, "cells", MapPrelim::from([] as [(&str, Any); 0]));
        sheet_hex.to_string()
    }

    /// Add a sub-map to a sheet (for properties, merges, etc.).
    fn add_sub_map(doc: &Doc, sheets: &MapRef, sheet_hex: &str, sub_map_key: &str) {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            let _: MapRef = sheet_map.insert(
                &mut txn,
                sub_map_key,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
        }
    }

    /// Insert a cell into the cells map of a sheet.
    fn insert_cell(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        value: f64,
        formula: Option<&str>,
    ) {
        insert_cell_with_origin(doc, sheets, sheet_hex, cell_id, value, formula, None);
    }

    /// Insert a cell with a specific origin.
    fn insert_cell_with_origin(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        value: f64,
        formula: Option<&str>,
        origin: Option<&[u8]>,
    ) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = match origin {
            Some(o) => doc.transact_mut_with(o),
            None => doc.transact_mut(),
        };
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                let cell_prelim = match formula {
                    Some(f) => MapPrelim::from([
                        ("v", Any::Number(value)),
                        ("f", Any::String(Arc::from(f))),
                    ]),
                    None => MapPrelim::from([("v", Any::Number(value))]),
                };
                cells_map.insert(&mut txn, &*cell_hex, cell_prelim);
            }
        }
    }

    /// Remove a cell from the cells map of a sheet.
    fn remove_cell(doc: &Doc, sheets: &MapRef, sheet_hex: &str, cell_id: CellId) {
        remove_cell_with_origin(doc, sheets, sheet_hex, cell_id, None);
    }

    /// Remove a cell with a specific origin.
    fn remove_cell_with_origin(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        origin: Option<&[u8]>,
    ) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = match origin {
            Some(o) => doc.transact_mut_with(o),
            None => doc.transact_mut(),
        };
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                cells_map.remove(&mut txn, &cell_hex);
            }
        }
    }

    /// Modify a cell's value in-place (depth 3 — updates the "v" key within the
    /// existing cell map, rather than replacing the whole cell entry).
    fn modify_cell_value_in_place(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        new_value: f64,
    ) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &*cell_hex) {
                    cell_map.insert(&mut txn, crate::schema::KEY_VALUE, Any::Number(new_value));
                }
            }
        }
    }

    /// Insert an entry into a sub-map of a sheet.
    fn insert_sub_map_entry(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
        value: Any,
    ) {
        insert_sub_map_entry_with_origin(
            doc,
            sheets,
            sheet_hex,
            sub_map_key,
            entry_key,
            value,
            None,
        );
    }

    fn insert_sub_map_entry_with_origin(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
        value: Any,
        origin: Option<&[u8]>,
    ) {
        let mut txn = match origin {
            Some(o) => doc.transact_mut_with(o),
            None => doc.transact_mut(),
        };
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
                sub_map.insert(&mut txn, entry_key, value);
            }
        }
    }

    /// Insert a nested map entry into a sub-map (for pivotTables, floatingObjects, etc.).
    fn insert_sub_map_map_entry(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
        fields: &[(&str, Any)],
    ) {
        insert_sub_map_map_entry_with_origin(
            doc,
            sheets,
            sheet_hex,
            sub_map_key,
            entry_key,
            fields,
            None,
        );
    }

    fn insert_sub_map_map_entry_with_origin(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
        fields: &[(&str, Any)],
        origin: Option<&[u8]>,
    ) {
        let mut txn = match origin {
            Some(o) => doc.transact_mut_with(o),
            None => doc.transact_mut(),
        };
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
                let entry: MapRef =
                    sub_map.insert(&mut txn, entry_key, MapPrelim::from([] as [(&str, Any); 0]));
                for (k, v) in fields {
                    entry.insert(&mut txn, *k, v.clone());
                }
            }
        }
    }

    /// Remove an entry from a sub-map.
    fn remove_sub_map_entry(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
    ) {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
                sub_map.remove(&mut txn, entry_key);
            }
        }
    }

    /// Update a field within a nested map entry in a sub-map.
    fn update_sub_map_map_field(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        sub_map_key: &str,
        entry_key: &str,
        field: &str,
        value: Any,
    ) {
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(sub_map)) = sheet_map.get(&txn, sub_map_key) {
                if let Some(Out::YMap(entry_map)) = sub_map.get(&txn, entry_key) {
                    entry_map.insert(&mut txn, field, value);
                }
            }
        }
    }

    fn new_observer(sheets: &MapRef, workbook: &MapRef) -> DocumentObserver {
        DocumentObserver::new(sheets, workbook)
    }

    // -----------------------------------------------------------------------
    // Test 1: Observer detects cell addition
    // -----------------------------------------------------------------------

    #[test]
    fn test_observer_detects_cell_addition() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);
        assert!(!observer.has_changes());

        let cell_id = make_cell_id(100);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
        // Insert has no old value.
        assert!(changes[0].old_value.is_none());
    }

    // -----------------------------------------------------------------------
    // Test 2: Observer detects cell modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_observer_detects_cell_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_id = make_cell_id(200);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 10.0, None);

        let observer = new_observer(&sheets, &workbook);

        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 20.0, Some("=A1+10"));

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
        // Depth-2 update: old YMap is orphaned after replacement, so old_value is None.
        // Old values are captured at depth 3 (in-place field modifications) instead.
        assert!(changes[0].old_value.is_none());
    }

    // -----------------------------------------------------------------------
    // Test 3: Observer detects cell removal
    // -----------------------------------------------------------------------

    #[test]
    fn test_observer_detects_cell_removal() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_id = make_cell_id(300);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

        let observer = new_observer(&sheets, &workbook);

        remove_cell(&doc, &sheets, &sheet_hex, cell_id);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Removed);
        // Depth-2 removal: old YMap is orphaned, so old_value is None.
        assert!(changes[0].old_value.is_none());
    }

    // -----------------------------------------------------------------------
    // Test 4: Observer ignores formula-result origin changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_observer_ignores_formula_result_origin() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(400);
        insert_cell_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            cell_id,
            42.0,
            None,
            Some(ORIGIN_FORMULA_RESULT),
        );

        let changes = observer.drain_changes();
        assert!(
            changes.is_empty(),
            "formula-result changes should be ignored, got: {:?}",
            changes
        );

        // Verify the cell was actually written
        let txn = doc.transact();
        let sheet_hex_str = id_to_hex(sheet_id.as_u128());
        let cell_hex = id_to_hex(cell_id.as_u128());
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex_str) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                assert!(
                    cells_map.get(&txn, &cell_hex).is_some(),
                    "cell should exist in yrs despite observer ignoring it"
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Test 5: Observer handles multiple cell changes in one transaction
    // -----------------------------------------------------------------------

    #[test]
    fn test_observer_multiple_changes_one_transaction() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_remove = make_cell_id(503);
        insert_cell(&doc, &sheets, &sheet_hex, cell_remove, 0.0, None);

        let observer = new_observer(&sheets, &workbook);

        {
            let cell_hex_1 = id_to_hex(make_cell_id(501).as_u128());
            let cell_hex_2 = id_to_hex(make_cell_id(502).as_u128());
            let cell_hex_3 = id_to_hex(cell_remove.as_u128());

            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
                if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                    cells_map.insert(
                        &mut txn,
                        &*cell_hex_1,
                        MapPrelim::from([("v", Any::Number(1.0))]),
                    );
                    cells_map.insert(
                        &mut txn,
                        &*cell_hex_2,
                        MapPrelim::from([("v", Any::Number(2.0))]),
                    );
                    cells_map.remove(&mut txn, &cell_hex_3);
                }
            }
        }

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 3, "expected 3 changes, got: {:?}", changes);

        let modified_count = changes
            .iter()
            .filter(|c| c.kind == CellChangeKind::Modified)
            .count();
        let removed_count = changes
            .iter()
            .filter(|c| c.kind == CellChangeKind::Removed)
            .count();
        assert_eq!(modified_count, 2);
        assert_eq!(removed_count, 1);

        assert!(contains_cell_change(
            &changes,
            sheet_id,
            make_cell_id(501),
            CellChangeKind::Modified
        ));
        assert!(contains_cell_change(
            &changes,
            sheet_id,
            make_cell_id(502),
            CellChangeKind::Modified
        ));
        assert!(contains_cell_change(
            &changes,
            sheet_id,
            cell_remove,
            CellChangeKind::Removed
        ));
    }

    // -----------------------------------------------------------------------
    // Test 6: drain_changes clears the buffer
    // -----------------------------------------------------------------------

    #[test]
    fn test_drain_clears_buffer() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(600), 1.0, None);
        assert_eq!(observer.pending_count(), 1);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);

        assert!(!observer.has_changes());
        assert_eq!(observer.pending_count(), 0);
        assert!(observer.drain_changes().is_empty());
    }

    // -----------------------------------------------------------------------
    // Test 7: User-edit origin is observed
    // -----------------------------------------------------------------------

    #[test]
    fn test_user_edit_origin_is_observed() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(700);
        insert_cell_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            cell_id,
            42.0,
            None,
            Some(ORIGIN_USER_EDIT),
        );

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Test 8: Remote origin is observed
    // -----------------------------------------------------------------------

    #[test]
    fn test_remote_origin_is_observed() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(800);
        insert_cell_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            cell_id,
            99.0,
            None,
            Some(ORIGIN_REMOTE),
        );

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_eq!(
            changes[0],
            CellChange {
                sheet_id,
                cell_id,
                kind: CellChangeKind::Modified,
                old_value: None,
            }
        );
    }

    // -----------------------------------------------------------------------
    // Test 9: Changes across multiple sheets
    // -----------------------------------------------------------------------

    #[test]
    fn test_changes_across_multiple_sheets() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet1 = make_sheet_id(1);
        let sheet2 = make_sheet_id(2);
        let hex1 = add_sheet(&doc, &sheets, sheet1);
        let hex2 = add_sheet(&doc, &sheets, sheet2);

        let observer = new_observer(&sheets, &workbook);

        insert_cell(&doc, &sheets, &hex1, make_cell_id(901), 1.0, None);
        insert_cell(&doc, &sheets, &hex2, make_cell_id(902), 2.0, None);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 2);

        assert!(changes.contains(&CellChange {
            sheet_id: sheet1,
            cell_id: make_cell_id(901),
            kind: CellChangeKind::Modified,
            old_value: None,
        }));
        assert!(changes.contains(&CellChange {
            sheet_id: sheet2,
            cell_id: make_cell_id(902),
            kind: CellChangeKind::Modified,
            old_value: None,
        }));
    }

    // -----------------------------------------------------------------------
    // Test 10: Debug formatting
    // -----------------------------------------------------------------------

    #[test]
    fn test_debug_format() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let debug = format!("{:?}", observer);
        assert!(debug.contains("DocumentObserver"));
        assert!(debug.contains("pending_changes: 0"));

        insert_cell(&doc, &sheets, &sheet_hex, make_cell_id(1000), 1.0, None);
        let debug = format!("{:?}", observer);
        assert!(debug.contains("pending_changes: 1"));
    }

    // -----------------------------------------------------------------------
    // Test: Old value capture — depth 3 (in-place value modification)
    // -----------------------------------------------------------------------

    #[test]
    fn test_old_value_capture_depth3_modify_in_place() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_id = make_cell_id(5000);
        // Insert initial cell with value 42.0 (before observer starts).
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

        let observer = new_observer(&sheets, &workbook);

        // Modify the "v" key in-place (depth 3 change).
        modify_cell_value_in_place(&doc, &sheets, &sheet_hex, cell_id, 100.0);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
        assert_eq!(
            changes[0].old_value,
            Some(CellValue::number(42.0)),
            "depth-3 modification should capture old value from 'v' field"
        );
    }

    // -----------------------------------------------------------------------
    // Test: Old value capture — depth 2 (cell re-insertion / full replacement)
    // -----------------------------------------------------------------------

    #[test]
    fn test_old_value_capture_depth2_cell_replacement() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_id = make_cell_id(5001);
        // Insert initial cell with text value before observer.
        {
            let cell_hex = id_to_hex(cell_id.as_u128());
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
                if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                    cells_map.insert(
                        &mut txn,
                        &*cell_hex,
                        MapPrelim::from([("v", Any::String(Arc::from("hello")))]),
                    );
                }
            }
        }

        let observer = new_observer(&sheets, &workbook);

        // Replace with a numeric value (depth 2 — whole cell entry replaced).
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
        assert_cell_change_base(&changes[0], sheet_id, cell_id, CellChangeKind::Modified);
        // Depth-2 replacement: old YMap is orphaned after replacement, old_value is None.
        assert!(changes[0].old_value.is_none());
    }

    // -----------------------------------------------------------------------
    // Test 11: No origin (None) is observed
    // -----------------------------------------------------------------------

    #[test]
    fn test_no_origin_is_observed() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(1100);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 55.0, None);

        let changes = observer.drain_changes();
        assert_eq!(changes.len(), 1);
    }

    // -----------------------------------------------------------------------
    // Test 12: Hex parsing helpers
    // -----------------------------------------------------------------------

    #[test]
    fn test_hex_parsing() {
        let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
        let hex = format!("{:032x}", id);
        assert_eq!(hex_to_id(&hex), Some(id));

        assert!(parse_sheet_id(&hex).is_some());
        assert!(parse_cell_id(&hex).is_some());

        assert_eq!(hex_to_id("not_hex"), None);
        assert!(parse_sheet_id("zzz").is_none());
        assert!(parse_cell_id("zzz").is_none());
    }

    // ===================================================================
    // Step 5: Domain-specific tests
    // ===================================================================

    // -----------------------------------------------------------------------
    // Test 5a: Cell change via drain_all_changes (regression)
    // -----------------------------------------------------------------------

    #[test]
    fn test_drain_all_changes_cells() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(5001);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

        let changes = observer.drain_all_changes();
        assert_eq!(changes.cells.len(), 1);
        assert_eq!(changes.cells[0].sheet_id, sheet_id);
        assert_eq!(changes.cells[0].cell_id, cell_id);
        assert_eq!(changes.cells[0].kind, CellChangeKind::Modified);
        assert!(!changes.has_non_cell_changes());
    }

    // -----------------------------------------------------------------------
    // Test 5b: Property change
    // -----------------------------------------------------------------------

    #[test]
    fn test_property_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

        let observer = new_observer(&sheets, &workbook);

        let cell_id = make_cell_id(5002);
        let cell_hex = id_to_hex(cell_id.as_u128());
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CELL_PROPERTIES,
            &cell_hex,
            Any::String(Arc::from("{\"bold\":true}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.properties.len(), 1);
        assert_eq!(changes.properties[0].sheet_id, sheet_id);
        assert_eq!(changes.properties[0].cell_id, cell_id);
        assert_eq!(changes.properties[0].kind, CellChangeKind::Modified);
        assert!(changes.has_non_cell_changes());
    }

    // -----------------------------------------------------------------------
    // Test 5c: Row height change
    // -----------------------------------------------------------------------

    #[test]
    fn test_row_height_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_HEIGHTS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_ROW_HEIGHTS,
            "row_5",
            Any::Number(30.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.row_heights.len(), 1);
        assert_eq!(changes.row_heights[0].sheet_id, sheet_id);
        assert_eq!(changes.row_heights[0].key, "row_5");
        assert_eq!(changes.row_heights[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Test 5d: Merge change
    // -----------------------------------------------------------------------

    #[test]
    fn test_merge_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_MERGES,
            "A1:C3",
            Any::Bool(true),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.merges.len(), 1);
        assert_eq!(changes.merges[0].sheet_id, sheet_id);
        assert_eq!(changes.merges[0].key, "A1:C3");
        assert_eq!(changes.merges[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Test 5e: Undo property change detection
    // (simulated: write then remove = undo-like behavior)
    // -----------------------------------------------------------------------

    #[test]
    fn test_property_change_undo_simulation() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

        let cell_id = make_cell_id(5005);
        let cell_hex = id_to_hex(cell_id.as_u128());

        // Write property before observer
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CELL_PROPERTIES,
            &cell_hex,
            Any::String(Arc::from("{\"bold\":true}")),
        );

        let observer = new_observer(&sheets, &workbook);

        // "Undo" by removing the property
        remove_sub_map_entry(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES, &cell_hex);

        let changes = observer.drain_all_changes();
        assert_eq!(changes.properties.len(), 1);
        assert_eq!(changes.properties[0].sheet_id, sheet_id);
        assert_eq!(changes.properties[0].cell_id, cell_id);
        assert_eq!(changes.properties[0].kind, CellChangeKind::Removed);
    }

    // -----------------------------------------------------------------------
    // Test 5f: ORIGIN_FORMULA_RESULT filtering for ALL sub-maps
    // -----------------------------------------------------------------------

    #[test]
    fn test_formula_result_filtering_all_sub_maps() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_HEIGHTS);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_ROWS);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

        let observer = new_observer(&sheets, &workbook);

        // Write to all sub-maps with ORIGIN_FORMULA_RESULT — all should be filtered.
        let cell_hex = id_to_hex(make_cell_id(5006).as_u128());
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CELL_PROPERTIES,
            &cell_hex,
            Any::String(Arc::from("fmt")),
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_ROW_HEIGHTS,
            "r1",
            Any::Number(20.0),
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_MERGES,
            "A1:B2",
            Any::Bool(true),
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_HIDDEN_ROWS,
            "r5",
            Any::Bool(true),
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COMMENTS,
            &cell_hex,
            Any::String(Arc::from("comment")),
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FILTERS,
            "autoFilter",
            Any::String(Arc::from("{}")),
            Some(ORIGIN_FORMULA_RESULT),
        );

        // Insert pivot and floating object entries with ORIGIN_FORMULA_RESULT
        insert_sub_map_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-fr",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
            Some(ORIGIN_FORMULA_RESULT),
        );
        insert_sub_map_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FLOATING_OBJECTS,
            "chart-fr",
            &[("type", Any::String(Arc::from("bar")))],
            Some(ORIGIN_FORMULA_RESULT),
        );

        let changes = observer.drain_all_changes();
        assert!(
            changes.is_empty(),
            "all formula-result changes should be filtered, got non-empty: cells={}, props={}, rows={}, merges={}, hidden={}, comments={}, pivots={}, floats={}, filters={}",
            changes.cells.len(),
            changes.properties.len(),
            changes.row_heights.len(),
            changes.merges.len(),
            changes.hidden_rows.len(),
            changes.comments.len(),
            changes.pivot_tables.len(),
            changes.floating_objects.len(),
            changes.filters.len(),
        );
    }

    // -----------------------------------------------------------------------
    // Test 5g: Workbook-level table change
    // -----------------------------------------------------------------------

    #[test]
    fn test_workbook_table_change() {
        let (doc, sheets, workbook) = setup_doc();

        // Create tables sub-map in workbook
        {
            let mut txn = doc.transact_mut();
            let _: MapRef = workbook.insert(
                &mut txn,
                KEY_TABLES,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
        }

        let observer = new_observer(&sheets, &workbook);

        // Insert a table entry
        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(tables_map)) = workbook.get(&txn, KEY_TABLES) {
                let table_entry: MapRef = tables_map.insert(
                    &mut txn,
                    "table-001",
                    MapPrelim::from([] as [(&str, Any); 0]),
                );
                table_entry.insert(&mut txn, "name", Any::String(Arc::from("SalesData")));
            }
        }

        let changes = observer.drain_all_changes();
        assert!(
            !changes.tables.is_empty(),
            "expected table change, got empty"
        );
        assert!(changes.tables.iter().any(|t| t.key == "table-001"));
    }

    #[test]
    fn test_workbook_table_range_binding_change() {
        let (doc, sheets, workbook) = setup_doc();

        // Table metadata is now persisted primarily in workbook.rangeBindings
        // using table:<name> keys. The observer must route those entries through
        // the table domain so engines rebuild their table mirror after sync.
        {
            let mut txn = doc.transact_mut();
            let _: MapRef = workbook.insert(
                &mut txn,
                KEY_RANGE_BINDINGS,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
        }

        let observer = new_observer(&sheets, &workbook);

        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(bindings)) = workbook.get(&txn, KEY_RANGE_BINDINGS) {
                bindings.insert(
                    &mut txn,
                    "table:SalesData",
                    Any::String(Arc::from(r#"{"name":"SalesData"}"#)),
                );
                bindings.insert(
                    &mut txn,
                    "cf:rule-1",
                    Any::String(Arc::from(r#"{"ruleRef":"rule-1"}"#)),
                );
            }
        }

        let changes = observer.drain_all_changes();
        assert_eq!(changes.tables.len(), 1);
        assert_eq!(changes.tables[0].key, "table:SalesData");
        assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Test 5h: Pivot changes detected via DocumentObserver (PivotObserver absorbed)
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_changes_via_document_observer() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);
        assert!(!observer.has_changes());

        // Insert a pivot table
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-001",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.pivot_tables.len(), 1);
        assert_eq!(changes.pivot_tables[0].sheet_id, sheet_id);
        assert_eq!(changes.pivot_tables[0].pivot_id, "pivot-001");
        assert_eq!(changes.pivot_tables[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Pivot backward compat: drain_pivot_changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_drain_pivot_changes_backward_compat() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-002",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let legacy_changes = observer.drain_pivot_changes();
        assert_eq!(legacy_changes.len(), 1);
        assert_eq!(
            legacy_changes[0],
            PivotChange {
                sheet_id,
                pivot_id: "pivot-002".into(),
                kind: PivotChangeKind::Set,
            }
        );
    }

    // -----------------------------------------------------------------------
    // Pivot removal via DocumentObserver
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_removal_via_document_observer() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-003",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let observer = new_observer(&sheets, &workbook);

        remove_sub_map_entry(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES, "pivot-003");

        let legacy_changes = observer.drain_pivot_changes();
        assert_eq!(legacy_changes.len(), 1);
        assert_eq!(
            legacy_changes[0],
            PivotChange {
                sheet_id,
                pivot_id: "pivot-003".into(),
                kind: PivotChangeKind::Removed,
            }
        );
    }

    // -----------------------------------------------------------------------
    // Pivot update (in-place field change)
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_update_via_document_observer() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-004",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-004",
            "sourceRange",
            Any::String(Arc::from("A1:F20")),
        );

        let legacy_changes = observer.drain_pivot_changes();
        assert_eq!(legacy_changes.len(), 1);
        assert_eq!(
            legacy_changes[0],
            PivotChange {
                sheet_id,
                pivot_id: "pivot-004".into(),
                kind: PivotChangeKind::Set,
            }
        );
    }

    // -----------------------------------------------------------------------
    // Pivot: formula-result origin filtered
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_ignores_formula_result() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-fr",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
            Some(ORIGIN_FORMULA_RESULT),
        );

        let changes = observer.drain_pivot_changes();
        assert!(
            changes.is_empty(),
            "formula-result pivot changes should be ignored"
        );
    }

    // -----------------------------------------------------------------------
    // Pivot: user-edit origin is observed
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_user_edit_observed() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry_with_origin(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-ue",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
            Some(ORIGIN_USER_EDIT),
        );

        let changes = observer.drain_pivot_changes();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, PivotChangeKind::Set);
    }

    // -----------------------------------------------------------------------
    // Pivot: multiple pivots across sheets
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_multiple_sheets() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet1 = make_sheet_id(1);
        let sheet2 = make_sheet_id(2);
        let hex1 = add_sheet(&doc, &sheets, sheet1);
        let hex2 = add_sheet(&doc, &sheets, sheet2);
        add_sub_map(&doc, &sheets, &hex1, KEY_PIVOT_TABLES);
        add_sub_map(&doc, &sheets, &hex2, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &hex1,
            KEY_PIVOT_TABLES,
            "pA",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &hex2,
            KEY_PIVOT_TABLES,
            "pB",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let changes = observer.drain_pivot_changes();
        assert_eq!(changes.len(), 2);

        assert!(changes.contains(&PivotChange {
            sheet_id: sheet1,
            pivot_id: "pA".into(),
            kind: PivotChangeKind::Set,
        }));
        assert!(changes.contains(&PivotChange {
            sheet_id: sheet2,
            pivot_id: "pB".into(),
            kind: PivotChangeKind::Set,
        }));
    }

    // -----------------------------------------------------------------------
    // Pivot: drain clears buffer
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_drain_clears() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pX",
            &[("sourceRange", Any::String(Arc::from("A1:D10")))],
        );

        let changes = observer.drain_pivot_changes();
        assert_eq!(changes.len(), 1);

        // Buffer should now be clear for pivots
        assert!(observer.drain_pivot_changes().is_empty());
    }

    // -----------------------------------------------------------------------
    // Internal indexes do NOT produce changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_internal_indexes_ignored() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        // Add internal index sub-maps
        add_sub_map(&doc, &sheets, &sheet_hex, "gridIndex");
        add_sub_map(&doc, &sheets, &sheet_hex, "rowIndex");
        add_sub_map(&doc, &sheets, &sheet_hex, "colIndex");

        let observer = new_observer(&sheets, &workbook);

        // Write to internal indexes
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            "gridIndex",
            "key1",
            Any::Number(1.0),
        );
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            "rowIndex",
            "key2",
            Any::Number(2.0),
        );
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            "colIndex",
            "key3",
            Any::Number(3.0),
        );

        let changes = observer.drain_all_changes();
        assert!(
            changes.is_empty(),
            "internal index changes should not produce DocumentChanges, got non-empty"
        );
    }

    // -----------------------------------------------------------------------
    // Floating object changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_floating_object_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FLOATING_OBJECTS,
            "chart-001",
            &[("type", Any::String(Arc::from("bar")))],
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.floating_objects.len(), 1);
        assert_eq!(changes.floating_objects[0].sheet_id, sheet_id);
        assert_eq!(changes.floating_objects[0].object_id, "chart-001");
        assert_eq!(changes.floating_objects[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Hidden rows/cols changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_hidden_rows_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_ROWS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_HIDDEN_ROWS,
            "row_3",
            Any::Bool(true),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.hidden_rows.len(), 1);
        assert_eq!(changes.hidden_rows[0].sheet_id, sheet_id);
        assert_eq!(changes.hidden_rows[0].key, "row_3");
    }

    #[test]
    fn test_hidden_cols_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_HIDDEN_COLS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_HIDDEN_COLS,
            "col_B",
            Any::Bool(true),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.hidden_cols.len(), 1);
        assert_eq!(changes.hidden_cols[0].sheet_id, sheet_id);
        assert_eq!(changes.hidden_cols[0].key, "col_B");
    }

    // -----------------------------------------------------------------------
    // Comment changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_comment_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);

        let observer = new_observer(&sheets, &workbook);

        let cell_hex = id_to_hex(make_cell_id(6001).as_u128());
        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COMMENTS,
            &cell_hex,
            Any::String(Arc::from("This is a comment")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.comments.len(), 1);
        assert_eq!(changes.comments[0].sheet_id, sheet_id);
        assert_eq!(cell_hex, changes.comments[0].key);
    }

    // -----------------------------------------------------------------------
    // Sheet-level changes: filters, grouping, sparklines, etc.
    // -----------------------------------------------------------------------

    #[test]
    fn test_filter_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FILTERS,
            "autoFilter",
            Any::String(Arc::from("{\"range\":\"A1:D10\"}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.filters.len(), 1);
        assert_eq!(changes.filters[0].sheet_id, sheet_id);
        assert_eq!(changes.filters[0].key, Some("autoFilter".to_string()));
    }

    #[test]
    fn test_grouping_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_GROUPING);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_GROUPING,
            "group1",
            Any::String(Arc::from("{\"rows\":[1,5]}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.grouping.len(), 1);
        assert_eq!(changes.grouping[0].sheet_id, sheet_id);
    }

    #[test]
    fn test_sparkline_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_SPARKLINES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SPARKLINES,
            "spark1",
            Any::String(Arc::from("{\"type\":\"line\"}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sparklines.len(), 1);
        assert_eq!(changes.sparklines[0].sheet_id, sheet_id);
    }

    #[test]
    fn test_conditional_format_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CONDITIONAL_FORMAT);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CONDITIONAL_FORMAT,
            "cf1",
            Any::String(Arc::from("{\"type\":\"colorScale\"}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.conditional_formats.len(), 1);
        assert_eq!(changes.conditional_formats[0].sheet_id, sheet_id);
    }

    // -----------------------------------------------------------------------
    // Sheet meta change
    // -----------------------------------------------------------------------

    #[test]
    fn test_sheet_meta_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PROPERTIES);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PROPERTIES,
            "name",
            Any::String(Arc::from("Sheet1")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sheet_meta.len(), 1);
        assert_eq!(changes.sheet_meta[0].sheet_id, sheet_id);
        assert_eq!(changes.sheet_meta[0].field, Some("name".to_string()));
    }

    // -----------------------------------------------------------------------
    // Col width changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_col_width_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_WIDTHS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COL_WIDTHS,
            "col_A",
            Any::Number(120.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.col_widths.len(), 1);
        assert_eq!(changes.col_widths[0].sheet_id, sheet_id);
        assert_eq!(changes.col_widths[0].key, "col_A");
    }

    // -----------------------------------------------------------------------
    // Row/col format changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_row_format_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_FORMATS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_ROW_FORMATS,
            "row_1",
            Any::String(Arc::from("{\"bold\":true}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.row_formats.len(), 1);
        assert_eq!(changes.row_formats[0].sheet_id, sheet_id);
    }

    #[test]
    fn test_col_format_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_FORMATS);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COL_FORMATS,
            "col_A",
            Any::String(Arc::from("{\"italic\":true}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.col_formats.len(), 1);
        assert_eq!(changes.col_formats[0].sheet_id, sheet_id);
    }

    // -----------------------------------------------------------------------
    // Sorting change
    // -----------------------------------------------------------------------

    #[test]
    fn test_sorting_change() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_SORTING);

        let observer = new_observer(&sheets, &workbook);

        insert_sub_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SORTING,
            "sortState",
            Any::String(Arc::from("{\"col\":0,\"asc\":true}")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sorting.len(), 1);
        assert_eq!(changes.sorting[0].sheet_id, sheet_id);
    }

    // -----------------------------------------------------------------------
    // DocumentChanges::is_empty and has_non_cell_changes
    // -----------------------------------------------------------------------

    #[test]
    fn test_document_changes_is_empty() {
        let dc = DocumentChanges::default();
        assert!(dc.is_empty());
        assert!(!dc.has_non_cell_changes());
    }

    #[test]
    fn test_document_changes_has_non_cell_changes() {
        let mut dc = DocumentChanges::default();
        dc.cells.push(CellChange {
            sheet_id: make_sheet_id(1),
            cell_id: make_cell_id(1),
            kind: CellChangeKind::Modified,
            old_value: None,
        });
        assert!(!dc.is_empty());
        assert!(!dc.has_non_cell_changes());

        dc.properties.push(PropertyCellChange {
            sheet_id: make_sheet_id(1),
            cell_id: make_cell_id(1),
            kind: CellChangeKind::Modified,
        });
        assert!(dc.has_non_cell_changes());
    }

    // -----------------------------------------------------------------------
    // Workbook-level named ranges
    // -----------------------------------------------------------------------

    #[test]
    fn test_workbook_named_range_change() {
        let (doc, sheets, workbook) = setup_doc();

        // Create namedRanges sub-map in workbook
        {
            let mut txn = doc.transact_mut();
            let _: MapRef = workbook.insert(
                &mut txn,
                KEY_NAMED_RANGES,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
        }

        let observer = new_observer(&sheets, &workbook);

        // Insert a named range
        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(nr_map)) = workbook.get(&txn, KEY_NAMED_RANGES) {
                nr_map.insert(&mut txn, "MyRange", Any::String(Arc::from("Sheet1!A1:B10")));
            }
        }

        let changes = observer.drain_all_changes();
        assert_eq!(changes.named_ranges.len(), 1);
        assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
    }

    // -----------------------------------------------------------------------
    // Workbook-level table: formula-result origin filtered
    // -----------------------------------------------------------------------

    #[test]
    fn test_workbook_table_formula_result_filtered() {
        let (doc, sheets, workbook) = setup_doc();

        {
            let mut txn = doc.transact_mut();
            let _: MapRef = workbook.insert(
                &mut txn,
                KEY_TABLES,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
        }

        let observer = new_observer(&sheets, &workbook);

        {
            let mut txn = doc.transact_mut_with(ORIGIN_FORMULA_RESULT);
            if let Some(Out::YMap(tables_map)) = workbook.get(&txn, KEY_TABLES) {
                tables_map.insert(&mut txn, "table-fr", Any::String(Arc::from("data")));
            }
        }

        let changes = observer.drain_all_changes();
        assert!(
            changes.tables.is_empty(),
            "formula-result workbook table changes should be filtered"
        );
    }

    // -----------------------------------------------------------------------
    // Suppression tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_suppressed_true_makes_is_suppressed_true() {
        let (_doc, sheets, workbook) = setup_doc();
        let observer = new_observer(&sheets, &workbook);

        observer.set_suppressed(true);
        assert!(observer.is_suppressed());
    }

    #[test]
    fn test_set_suppressed_false_makes_is_suppressed_false() {
        let (_doc, sheets, workbook) = setup_doc();
        let observer = new_observer(&sheets, &workbook);

        observer.set_suppressed(true);
        observer.set_suppressed(false);
        assert!(!observer.is_suppressed());
    }

    #[test]
    fn test_nested_suppression() {
        let (_doc, sheets, workbook) = setup_doc();
        let observer = new_observer(&sheets, &workbook);

        observer.set_suppressed(true);
        observer.set_suppressed(true);
        assert!(observer.is_suppressed(), "still suppressed after two trues");

        observer.set_suppressed(false);
        assert!(
            observer.is_suppressed(),
            "still suppressed after one false (need two)"
        );

        observer.set_suppressed(false);
        assert!(
            !observer.is_suppressed(),
            "unsuppressed after matching two falses"
        );
    }

    #[test]
    fn test_changes_during_suppression_not_recorded() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(100);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        let observer = new_observer(&sheets, &workbook);

        observer.set_suppressed(true);

        // Insert a cell while suppressed — should NOT be recorded.
        let cell_id = make_cell_id(200);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 42.0, None);

        let changes = observer.drain_all_changes();
        assert!(
            changes.cells.is_empty(),
            "no cell changes should be recorded while suppressed"
        );

        observer.set_suppressed(false);
    }

    #[test]
    fn test_changes_after_unsuppression_are_recorded() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(101);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        let observer = new_observer(&sheets, &workbook);

        // Suppress and unsuppress.
        observer.set_suppressed(true);
        observer.set_suppressed(false);

        // Insert a cell after unsuppression — should be recorded.
        let cell_id = make_cell_id(201);
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 99.0, None);

        let changes = observer.drain_all_changes();
        assert!(
            !changes.cells.is_empty(),
            "cell changes should be recorded after unsuppression"
        );
    }

    // =======================================================================
    // Depth-3 in-place modification tests
    //
    // These cover the path.len() == 3 branches in the observer callback,
    // where a field *inside* an existing nested map entry is modified
    // (as opposed to adding/removing entries from a sub-map at depth 2).
    // =======================================================================

    /// Helper: modify a field inside an existing cell's map (depth-3 change).
    fn modify_cell_field(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        field: &str,
        value: Any,
    ) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(cells_map)) = sheet_map.get(&txn, "cells") {
                if let Some(Out::YMap(cell_map)) = cells_map.get(&txn, &cell_hex) {
                    cell_map.insert(&mut txn, field, value);
                }
            }
        }
    }

    /// Helper: modify a field inside an existing property cell's map (depth-3).
    fn modify_property_field(
        doc: &Doc,
        sheets: &MapRef,
        sheet_hex: &str,
        cell_id: CellId,
        field: &str,
        value: Any,
    ) {
        let cell_hex = id_to_hex(cell_id.as_u128());
        let mut txn = doc.transact_mut();
        if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, sheet_hex) {
            if let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
                if let Some(Out::YMap(cell_map)) = props_map.get(&txn, &cell_hex) {
                    cell_map.insert(&mut txn, field, value);
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Depth-3: Cell in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_cell_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

        let cell_id = make_cell_id(901);
        // First insert the cell (depth-2 add)
        insert_cell(&doc, &sheets, &sheet_hex, cell_id, 1.0, None);

        let observer = new_observer(&sheets, &workbook);

        // Now modify the cell's value field in place (depth-3 change)
        modify_cell_field(&doc, &sheets, &sheet_hex, cell_id, "v", Any::Number(2.0));

        let changes = observer.drain_all_changes();
        assert_eq!(
            changes.cells.len(),
            1,
            "in-place cell modification should produce exactly one change"
        );
        assert_eq!(changes.cells[0].sheet_id, sheet_id);
        assert_eq!(changes.cells[0].cell_id, cell_id);
        assert_eq!(changes.cells[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Property in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_property_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CELL_PROPERTIES);

        let cell_id = make_cell_id(902);
        // Insert a property entry at depth 2
        let cell_hex = id_to_hex(cell_id.as_u128());
        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex) {
                if let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
                    props_map.insert(
                        &mut txn,
                        &*cell_hex,
                        MapPrelim::from([("bold", Any::Bool(false))]),
                    );
                }
            }
        }

        let observer = new_observer(&sheets, &workbook);

        // Modify property field in place (depth 3)
        modify_property_field(&doc, &sheets, &sheet_hex, cell_id, "bold", Any::Bool(true));

        let changes = observer.drain_all_changes();
        assert_eq!(
            changes.properties.len(),
            1,
            "in-place property modification should produce exactly one change"
        );
        assert_eq!(changes.properties[0].sheet_id, sheet_id);
        assert_eq!(changes.properties[0].cell_id, cell_id);
        assert_eq!(changes.properties[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Merge in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_merge_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_MERGES);

        // Insert a merge entry as a nested map
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_MERGES,
            "A1:B2",
            &[("rows", Any::Number(2.0))],
        );

        let observer = new_observer(&sheets, &workbook);

        // Modify merge field in place (depth 3)
        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_MERGES,
            "A1:B2",
            "rows",
            Any::Number(3.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(
            changes.merges.len(),
            1,
            "in-place merge modification should produce exactly one change"
        );
        assert_eq!(changes.merges[0].sheet_id, sheet_id);
        assert_eq!(changes.merges[0].key, "A1:B2");
        assert_eq!(changes.merges[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Comment in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_comment_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COMMENTS);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COMMENTS,
            "comment-1",
            &[("text", Any::String(Arc::from("hello")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COMMENTS,
            "comment-1",
            "text",
            Any::String(Arc::from("updated")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.comments.len(), 1);
        assert_eq!(changes.comments[0].sheet_id, sheet_id);
        assert_eq!(changes.comments[0].key, "comment-1");
        assert_eq!(changes.comments[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Floating object in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_floating_object_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FLOATING_OBJECTS);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FLOATING_OBJECTS,
            "chart-1",
            &[("type", Any::String(Arc::from("line")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FLOATING_OBJECTS,
            "chart-1",
            "type",
            Any::String(Arc::from("bar")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.floating_objects.len(), 1);
        assert_eq!(changes.floating_objects[0].sheet_id, sheet_id);
        assert_eq!(changes.floating_objects[0].object_id, "chart-1");
        assert_eq!(changes.floating_objects[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Pivot table in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_pivot_table_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PIVOT_TABLES);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-1",
            &[("source", Any::String(Arc::from("Sheet1!A1:D10")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PIVOT_TABLES,
            "pivot-1",
            "source",
            Any::String(Arc::from("Sheet1!A1:E20")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.pivot_tables.len(), 1);
        assert_eq!(changes.pivot_tables[0].sheet_id, sheet_id);
        assert_eq!(changes.pivot_tables[0].pivot_id, "pivot-1");
        assert_eq!(changes.pivot_tables[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Sheet meta in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_sheet_meta_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_PROPERTIES);

        // Insert meta as a nested map with a field
        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PROPERTIES,
            "settings",
            &[("zoom", Any::Number(100.0))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_PROPERTIES,
            "settings",
            "zoom",
            Any::Number(150.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sheet_meta.len(), 1);
        assert_eq!(changes.sheet_meta[0].sheet_id, sheet_id);
        assert_eq!(changes.sheet_meta[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Sheet-level change (filters) via push_sheet_level_change
    // -----------------------------------------------------------------------

    #[test]
    fn test_filter_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_FILTERS);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FILTERS,
            "filter-1",
            &[("col", Any::Number(0.0))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_FILTERS,
            "filter-1",
            "col",
            Any::Number(1.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.filters.len(), 1);
        assert_eq!(changes.filters[0].sheet_id, sheet_id);
        assert_eq!(changes.filters[0].key, Some("filter-1".to_string()));
        assert_eq!(changes.filters[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Grouping in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_grouping_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_GROUPING);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_GROUPING,
            "group-1",
            &[("level", Any::Number(1.0))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_GROUPING,
            "group-1",
            "level",
            Any::Number(2.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.grouping.len(), 1);
        assert_eq!(changes.grouping[0].sheet_id, sheet_id);
        assert_eq!(changes.grouping[0].key, Some("group-1".to_string()));
        assert_eq!(changes.grouping[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Sparkline in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_sparkline_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_SPARKLINES);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SPARKLINES,
            "spark-1",
            &[("type", Any::String(Arc::from("line")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SPARKLINES,
            "spark-1",
            "type",
            Any::String(Arc::from("bar")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sparklines.len(), 1);
        assert_eq!(changes.sparklines[0].sheet_id, sheet_id);
        assert_eq!(changes.sparklines[0].key, Some("spark-1".to_string()));
        assert_eq!(changes.sparklines[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Conditional format in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_conditional_format_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_CONDITIONAL_FORMAT);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CONDITIONAL_FORMAT,
            "cf-1",
            &[("rule", Any::String(Arc::from("greaterThan")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_CONDITIONAL_FORMAT,
            "cf-1",
            "rule",
            Any::String(Arc::from("lessThan")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.conditional_formats.len(), 1);
        assert_eq!(changes.conditional_formats[0].sheet_id, sheet_id);
        assert_eq!(changes.conditional_formats[0].key, Some("cf-1".to_string()));
        assert_eq!(
            changes.conditional_formats[0].kind,
            CellChangeKind::Modified
        );
    }

    // -----------------------------------------------------------------------
    // Depth-3: Sorting in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_sorting_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_SORTING);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SORTING,
            "sort-1",
            &[("order", Any::String(Arc::from("asc")))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_SORTING,
            "sort-1",
            "order",
            Any::String(Arc::from("desc")),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.sorting.len(), 1);
        assert_eq!(changes.sorting[0].sheet_id, sheet_id);
        assert_eq!(changes.sorting[0].key, Some("sort-1".to_string()));
        assert_eq!(changes.sorting[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Row format in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_row_format_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_ROW_FORMATS);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_ROW_FORMATS,
            "row-0",
            &[("bold", Any::Bool(false))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_ROW_FORMATS,
            "row-0",
            "bold",
            Any::Bool(true),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.row_formats.len(), 1);
        assert_eq!(changes.row_formats[0].sheet_id, sheet_id);
        assert_eq!(changes.row_formats[0].key, Some("row-0".to_string()));
        assert_eq!(changes.row_formats[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Col format in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_col_format_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();
        let sheet_id = make_sheet_id(1);
        let sheet_hex = add_sheet(&doc, &sheets, sheet_id);
        add_sub_map(&doc, &sheets, &sheet_hex, KEY_COL_FORMATS);

        insert_sub_map_map_entry(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COL_FORMATS,
            "col-A",
            &[("width", Any::Number(100.0))],
        );

        let observer = new_observer(&sheets, &workbook);

        update_sub_map_map_field(
            &doc,
            &sheets,
            &sheet_hex,
            KEY_COL_FORMATS,
            "col-A",
            "width",
            Any::Number(200.0),
        );

        let changes = observer.drain_all_changes();
        assert_eq!(changes.col_formats.len(), 1);
        assert_eq!(changes.col_formats[0].sheet_id, sheet_id);
        assert_eq!(changes.col_formats[0].key, Some("col-A".to_string()));
        assert_eq!(changes.col_formats[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Workbook table in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_workbook_table_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();

        // Insert a table entry at depth 1
        {
            let mut txn = doc.transact_mut();
            let tables: MapRef = workbook.insert(
                &mut txn,
                KEY_TABLES,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
            let entry: MapRef =
                tables.insert(&mut txn, "table-1", MapPrelim::from([] as [(&str, Any); 0]));
            entry.insert(&mut txn, "range", Any::String(Arc::from("A1:D10")));
        }

        let observer = new_observer(&sheets, &workbook);

        // Modify table field in place (depth 2 in workbook = path.len() == 2)
        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(tables)) = workbook.get(&txn, KEY_TABLES) {
                if let Some(Out::YMap(entry)) = tables.get(&txn, "table-1") {
                    entry.insert(&mut txn, "range", Any::String(Arc::from("A1:E20")));
                }
            }
        }

        let changes = observer.drain_all_changes();
        assert_eq!(changes.tables.len(), 1);
        assert_eq!(changes.tables[0].key, "table-1");
        assert_eq!(changes.tables[0].kind, CellChangeKind::Modified);
    }

    // -----------------------------------------------------------------------
    // Depth-3: Workbook named range in-place modification
    // -----------------------------------------------------------------------

    #[test]
    fn test_workbook_named_range_in_place_modification() {
        let (doc, sheets, workbook) = setup_doc();

        // Insert a named range entry
        {
            let mut txn = doc.transact_mut();
            let named: MapRef = workbook.insert(
                &mut txn,
                KEY_NAMED_RANGES,
                MapPrelim::from([] as [(&str, Any); 0]),
            );
            let entry: MapRef =
                named.insert(&mut txn, "MyRange", MapPrelim::from([] as [(&str, Any); 0]));
            entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:B5")));
        }

        let observer = new_observer(&sheets, &workbook);

        // Modify named range field in place
        {
            let mut txn = doc.transact_mut();
            if let Some(Out::YMap(named)) = workbook.get(&txn, KEY_NAMED_RANGES) {
                if let Some(Out::YMap(entry)) = named.get(&txn, "MyRange") {
                    entry.insert(&mut txn, "ref", Any::String(Arc::from("Sheet1!A1:C10")));
                }
            }
        }

        let changes = observer.drain_all_changes();
        assert_eq!(changes.named_ranges.len(), 1);
        assert_eq!(changes.named_ranges[0].key, Some("MyRange".to_string()));
        assert_eq!(changes.named_ranges[0].kind, CellChangeKind::Modified);
    }
}
