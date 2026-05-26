//! Cell Mirror — identity-indexed, in-process cell store.
//!
//! Read cache over the Yrs CRDT document, keyed by CellId.
//! Maintains a bidirectional position<->identity index so A1-notation references resolve to CellIds.
//!
//! # Design
//!
//! The mirror provides two lookup paths:
//! - **Identity path** (hot): `CellId -> CellEntry` via `FxHashMap` (~3-5ns).
//! - **Positional path** (warm): `(row, col) -> CellId` via `pos_to_id`, then identity lookup.
//!
//! Sheet names are stored lowercase for case-insensitive lookup (Excel behavior).
//!
//! # Module layout
//!
//! - [`types`] — `CellEntry`, `SheetMirror`, `CellEdit` type definitions.
//! - [`cell_mirror`] — `CellMirror` struct definition and constructor.
//! - [`read`] — Read-only accessors (get values, resolve positions, sheet lookups).
//! - [`write`] — Mutable cell operations (set, insert, remove, apply edits).
//! - [`snapshot`] — Bulk-loading from `WorkbookSnapshot`.
//! - [`sheet`] — Sheet-level CRUD (remove, rename).
//! - [`structure`] — Structural changes (insert/delete rows/cols, remap positions).
//! - [`metadata`] — Named ranges, tables, dense cache accessors.
//! - [`dense`] — Dense columnar cache for SIMD-accelerated aggregation.

pub mod dense;
pub mod range_view;
pub mod variable_store;

mod cell_mirror;
mod metadata;
mod read;
mod sheet;
mod snapshot;
mod structure;
mod types;
mod write;

#[cfg(test)]
mod materialize_pivot_tests;
#[cfg(test)]
mod test_helpers;

use rustc_hash::FxHashMap;
use std::cell::RefCell;
use unicode_normalization::UnicodeNormalization;

// Re-export the public API.
pub use cell_mirror::CellMirror;
pub(crate) use cell_types::RangeId;
pub use read::MirrorPositionLookup;
pub(crate) use types::FormatRange;
pub use types::{CellEdit, CellEntry, MergeRegion, SheetMirror};

// Thread-local cache for normalized sheet keys.
// Sheet names don't change during recalc, so caching avoids repeated
// NFC normalization + lowercasing of the same names.
//
// **Tier 2 (epoch-scoped)**: Sheet names are stable within a recalc epoch but
// may change between epochs (e.g. after sheet renames).  This cache will be
// consolidated into `crate::eval::cache::epoch_cache::EpochCache` when the evaluator
// is refactored to thread an `EpochCache` reference through the call stack.
// Until then, the thread-local implementation is correct.
thread_local! {
    static NORMALIZED_SHEET_KEY_CACHE: RefCell<FxHashMap<String, String>> =
        RefCell::new(FxHashMap::default());
}

/// Normalize a sheet name for HashMap keying: NFC + lowercase.
///
/// NFC is the W3C standard and handles Hebrew, Arabic, Korean Jamo,
/// Vietnamese, Latin diacritics, and CJK compatibility characters.
/// This ensures that sheet names arriving from different XML sources
/// (workbook.xml vs formula text) with different Unicode encodings
/// (NFC vs NFD) resolve to the same HashMap key.
///
/// Results are cached in a thread-local map for the duration of a recalc.
fn normalize_sheet_key(name: &str) -> String {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| {
        let cache_ref = cache.borrow();
        if let Some(cached) = cache_ref.get(name) {
            return cached.clone();
        }
        drop(cache_ref);
        let normalized = name.nfc().collect::<String>().to_lowercase();
        cache
            .borrow_mut()
            .insert(name.to_owned(), normalized.clone());
        normalized
    })
}

/// Clear all module-level caches.
///
/// Called at recalc entry to ensure stale data from a previous recalc
/// (e.g. after sheet renames) does not persist.
pub fn clear_caches() {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| cache.borrow_mut().clear());
}

/// Return the number of entries currently in the sheet name normalization cache.
///
/// Used by [`crate::eval::cache::epoch_cache::EpochCache::stats()`] for diagnostics.
pub fn sheet_name_cache_entry_count() -> usize {
    NORMALIZED_SHEET_KEY_CACHE.with(|cache| cache.borrow().len())
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use cell_types::{CellId, RowId, SheetId, SheetPos};
    use domain_types::domain::table::{Table as CanonicalTable, TableColumn};
    use formula_types::{NamedRangeDef, Scope, TableDef};
    use value_types::{CellValue, FiniteF64};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    fn simple_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(42.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                        row: 0,
                        col: 1,
                        value: CellValue::Text("Hello".into()),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                        row: 1,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(100.0)),
                        formula: Some("=A1*2+16".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        }
    }

    /// Helper: build a mirror with one sheet and a few cells for structural tests.
    fn mirror_with_grid() -> (CellMirror, SheetId) {
        let sheet_id = make_sheet_id(1);
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, "Grid".to_string(), 10, 5);
        mirror.add_sheet_mirror(sheet_id, "Grid".to_string(), sheet_mirror);

        // Insert a 3x3 grid of cells: rows 0-2, cols 0-2
        // cell_id = row * 10 + col + 100 (arbitrary)
        for row in 0..3u32 {
            for col in 0..3u32 {
                let cell_id = make_cell_id((row * 10 + col + 100) as u128);
                let entry = CellEntry {
                    value: CellValue::Number(FiniteF64::must((row * 10 + col) as f64)),
                    formula: None,
                };
                mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(row, col), entry);
            }
        }

        (mirror, sheet_id)
    }

    // -----------------------------------------------------------------------
    // from_snapshot
    // -----------------------------------------------------------------------

    #[test]
    fn test_from_snapshot_basic() {
        let snap = simple_snapshot();
        let mirror = CellMirror::from_snapshot(snap).unwrap();

        // Should have 1 sheet
        assert_eq!(mirror.sheet_ids().count(), 1);

        // Sheet lookup by name (case-insensitive)
        let sid = mirror.sheet_by_name("sheet1").unwrap();
        let sheet = mirror.get_sheet(&sid).unwrap();
        assert_eq!(sheet.name, "Sheet1");
        // Ghost-row fix tightens dimensions to actual content bounds:
        // cells occupy rows 0–1 and cols 0–1, so rows=2, cols=2
        assert_eq!(sheet.rows, 2);
        assert_eq!(sheet.cols, 2);
        assert_eq!(sheet.cells.len(), 3);
    }

    #[test]
    fn test_from_snapshot_uuid_parsing() {
        let snap = simple_snapshot();
        let mirror = CellMirror::from_snapshot(snap).unwrap();
        let sid = mirror.sheet_by_name("Sheet1").unwrap();

        // Verify the sheet UUID parsed correctly
        assert_eq!(
            sid,
            SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
        );

        // Verify cell UUID parsed correctly
        let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap();
        let val = mirror.get_cell_value(&cell_id).unwrap();
        assert_eq!(*val, CellValue::Number(FiniteF64::must(42.0)));
    }

    #[test]
    fn test_from_snapshot_formula() {
        let snap = simple_snapshot();
        let mirror = CellMirror::from_snapshot(snap).unwrap();

        // CellEntry.formula is None in the mirror (yrs doc is the authoritative source).
        // The scheduler's formula_strings map is the authoritative source.
        let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();
        assert!(mirror.get_formula(&cell_id).is_none());
    }

    #[test]
    fn test_from_snapshot_invalid_uuid() {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "not-a-uuid".to_string(),
                name: "Bad".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };
        assert!(CellMirror::from_snapshot(snap).is_err());
    }

    #[test]
    fn test_from_snapshot_invalid_cell_uuid() {
        // Use a non-Null value so the cell is not skipped as a ghost cell.
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![CellData {
                    cell_id: "invalid".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(1.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };
        assert!(CellMirror::from_snapshot(snap).is_err());
    }

    // -----------------------------------------------------------------------
    // Cell read/write by identity
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_cell_value_across_sheets() {
        let (mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(100); // row=0, col=0
        let val = mirror.get_cell_value(&cell_id).unwrap();
        assert_eq!(*val, CellValue::Number(FiniteF64::must(0.0)));
    }

    #[test]
    fn test_get_cell_value_in_sheet() {
        let (mirror, sheet_id) = mirror_with_grid();
        let cell_id = make_cell_id(111); // row=1, col=1
        let val = mirror.get_cell_value_in_sheet(&sheet_id, &cell_id).unwrap();
        assert_eq!(*val, CellValue::Number(FiniteF64::must(11.0)));
    }

    #[test]
    fn test_get_cell_value_nonexistent() {
        let (mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(999);
        assert!(mirror.get_cell_value(&cell_id).is_none());
    }

    #[test]
    fn test_set_value_mut() {
        let (mut mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(100);
        assert!(mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(999.0))));
        assert_eq!(
            *mirror.get_cell_value(&cell_id).unwrap(),
            CellValue::Number(FiniteF64::must(999.0))
        );
    }

    #[test]
    fn test_set_value_mut_nonexistent() {
        let (mut mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(999);
        assert!(!mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(1.0))));
    }

    #[test]
    fn test_set_formula() {
        let (mut mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(100);
        // set_formula now accepts Option<IdentityFormula>; use None for clearing
        assert!(mirror.set_formula(&cell_id, None));
        assert!(mirror.get_formula(&cell_id).is_none());
    }

    #[test]
    fn test_set_formula_nonexistent() {
        let (mut mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(999);
        assert!(!mirror.set_formula(&cell_id, None));
    }

    // -----------------------------------------------------------------------
    // Cell read/write by position
    // -----------------------------------------------------------------------

    #[test]
    fn test_get_cell_value_at() {
        let (mirror, sheet_id) = mirror_with_grid();
        let val = mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(2, 1))
            .unwrap();
        assert_eq!(*val, CellValue::Number(FiniteF64::must(21.0)));
    }

    #[test]
    fn test_get_cell_value_at_empty() {
        let (mirror, sheet_id) = mirror_with_grid();
        // row=5 is outside our 3x3 grid
        assert!(
            mirror
                .get_cell_value_at(&sheet_id, SheetPos::new(5, 0))
                .is_none()
        );
    }

    #[test]
    fn test_resolve_cell_id() {
        let (mirror, sheet_id) = mirror_with_grid();
        let cell_id = mirror
            .resolve_cell_id(&sheet_id, SheetPos::new(1, 2))
            .unwrap();
        assert_eq!(cell_id, make_cell_id(112));
    }

    #[test]
    fn test_resolve_position() {
        let (mirror, _) = mirror_with_grid();
        let cell_id = make_cell_id(121); // row=2, col=1
        let pos = mirror.resolve_position(&cell_id).unwrap();
        assert_eq!(pos, SheetPos::new(2, 1));
    }

    // -----------------------------------------------------------------------
    // Insert and remove cells
    // -----------------------------------------------------------------------

    #[test]
    fn test_insert_cell() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let cell_id = make_cell_id(500);
        let entry = CellEntry {
            value: CellValue::Text("new cell".into()),
            formula: None,
        };
        mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(5, 5), entry);

        assert_eq!(
            *mirror.get_cell_value(&cell_id).unwrap(),
            CellValue::Text("new cell".into())
        );
        assert_eq!(
            mirror.resolve_position(&cell_id).unwrap(),
            SheetPos::new(5, 5)
        );
        assert_eq!(
            mirror
                .resolve_cell_id(&sheet_id, SheetPos::new(5, 5))
                .unwrap(),
            cell_id
        );
    }

    #[test]
    fn test_remove_cell() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let cell_id = make_cell_id(100);
        assert!(mirror.get_cell_value(&cell_id).is_some());
        assert!(mirror.resolve_position(&cell_id).is_some());

        mirror.remove_cell(&cell_id);

        assert!(mirror.get_cell_value(&cell_id).is_none());
        assert!(mirror.resolve_position(&cell_id).is_none());
        assert!(
            mirror
                .resolve_cell_id(&sheet_id, SheetPos::new(0, 0))
                .is_none()
        );
    }

    #[test]
    fn test_remove_cell_nonexistent() {
        let (mut mirror, _) = mirror_with_grid();
        // Should not panic
        mirror.remove_cell(&make_cell_id(999));
    }

    // -----------------------------------------------------------------------
    // apply_edit / apply_edits
    // -----------------------------------------------------------------------

    #[test]
    fn test_apply_edit() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let cell_id = make_cell_id(600);
        // apply_edit formula param is now Option<IdentityFormula>; use None
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(7, 3),
            CellValue::Boolean(true),
            None,
        );

        assert_eq!(
            *mirror.get_cell_value(&cell_id).unwrap(),
            CellValue::Boolean(true)
        );
        assert!(mirror.get_formula(&cell_id).is_none());
        assert_eq!(
            mirror.resolve_position(&cell_id).unwrap(),
            SheetPos::new(7, 3)
        );
    }

    #[test]
    fn test_apply_edits_batch() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let edits = vec![
            CellEdit {
                sheet: sheet_id,
                cell: make_cell_id(700),
                pos: SheetPos::new(4, 0),
                value: CellValue::Number(FiniteF64::must(1.0)),
                formula: None,
            },
            CellEdit {
                sheet: sheet_id,
                cell: make_cell_id(701),
                pos: SheetPos::new(4, 1),
                value: CellValue::Number(FiniteF64::must(2.0)),
                formula: None,
            },
            CellEdit {
                sheet: sheet_id,
                cell: make_cell_id(702),
                pos: SheetPos::new(4, 2),
                value: CellValue::Number(FiniteF64::must(3.0)),
                // CellEdit.formula is now Option<IdentityFormula>; use None
                formula: None,
            },
        ];

        mirror.apply_edits(&edits);

        assert_eq!(
            *mirror.get_cell_value(&make_cell_id(700)).unwrap(),
            CellValue::Number(FiniteF64::must(1.0))
        );
        assert_eq!(
            *mirror.get_cell_value(&make_cell_id(702)).unwrap(),
            CellValue::Number(FiniteF64::must(3.0))
        );
        // Formula is no longer stored in CellEntry (yrs doc is the authoritative source)
        assert!(mirror.get_formula(&make_cell_id(702)).is_none());
    }

    #[test]
    fn test_remove_sheet() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        mirror.remove_sheet(&sheet_id);

        assert!(mirror.get_sheet(&sheet_id).is_none());
        assert!(mirror.sheet_by_name("Grid").is_none());
    }

    #[test]
    fn test_rename_sheet() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        mirror.rename_sheet(&sheet_id, "Renamed");

        assert!(mirror.sheet_by_name("Grid").is_none());
        assert_eq!(mirror.sheet_by_name("renamed").unwrap(), sheet_id);
        assert_eq!(mirror.get_sheet(&sheet_id).unwrap().name, "Renamed");
    }

    #[test]
    fn test_sheet_name_case_insensitive() {
        let (mirror, sheet_id) = mirror_with_grid();
        assert_eq!(mirror.sheet_by_name("grid"), Some(sheet_id));
        assert_eq!(mirror.sheet_by_name("GRID"), Some(sheet_id));
        assert_eq!(mirror.sheet_by_name("Grid"), Some(sheet_id));
        assert_eq!(mirror.sheet_by_name("gRiD"), Some(sheet_id));
    }

    #[test]
    fn test_sheet_ids_iterator() {
        let snap = simple_snapshot();
        let mirror = CellMirror::from_snapshot(snap).unwrap();
        let ids: Vec<&SheetId> = mirror.sheet_ids().collect();
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn test_remove_nonexistent_sheet() {
        let (mut mirror, _) = mirror_with_grid();
        // Should not panic
        mirror.remove_sheet(&make_sheet_id(999));
    }

    // -----------------------------------------------------------------------
    // Structural changes — InsertRows
    // -----------------------------------------------------------------------

    #[test]
    fn test_insert_rows_shifts_positions() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Insert 2 rows at row 1 — rows 1,2 become 3,4; row 0 stays
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: vec![RowId::from_raw(901), RowId::from_raw(902)],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // Row 0 cells unchanged
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(100))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 1)),
            Some(&make_cell_id(101))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 2)),
            Some(&make_cell_id(102))
        );

        // Old row 1 -> now row 3
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(3, 0)),
            Some(&make_cell_id(110))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(3, 1)),
            Some(&make_cell_id(111))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(3, 2)),
            Some(&make_cell_id(112))
        );

        // Old row 2 -> now row 4
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(4, 0)),
            Some(&make_cell_id(120))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(4, 1)),
            Some(&make_cell_id(121))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(4, 2)),
            Some(&make_cell_id(122))
        );

        // Rows 1-2 are empty (newly inserted)
        assert!(sheet.pos_to_id.get(&SheetPos::new(1, 0)).is_none());
        assert!(sheet.pos_to_id.get(&SheetPos::new(2, 0)).is_none());

        // Reverse index also updated
        assert_eq!(
            sheet.id_to_pos.get(&make_cell_id(110)),
            Some(&SheetPos::new(3, 0))
        );
        assert_eq!(
            sheet.id_to_pos.get(&make_cell_id(120)),
            Some(&SheetPos::new(4, 0))
        );

        // Sheet rows updated
        assert_eq!(sheet.rows, 12);
    }

    // -----------------------------------------------------------------------
    // Structural changes — DeleteRows
    // -----------------------------------------------------------------------

    #[test]
    fn test_delete_rows_removes_and_shifts() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Delete row 1 (1 row). Cells at row=1 are deleted, row=2 shifts to row=1.
        let deleted = vec![make_cell_id(110), make_cell_id(111), make_cell_id(112)];
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: deleted,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // Row 0 unchanged
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(100))
        );

        // Old row 1 cells gone
        assert!(sheet.cells.get(&make_cell_id(110)).is_none());
        assert!(sheet.cells.get(&make_cell_id(111)).is_none());
        assert!(sheet.cells.get(&make_cell_id(112)).is_none());

        // Old row 2 -> now row 1
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 0)),
            Some(&make_cell_id(120))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 1)),
            Some(&make_cell_id(121))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 2)),
            Some(&make_cell_id(122))
        );

        // Reverse index
        assert_eq!(
            sheet.id_to_pos.get(&make_cell_id(120)),
            Some(&SheetPos::new(1, 0))
        );

        // Sheet rows updated
        assert_eq!(sheet.rows, 9);

        // Total cells: started with 9, deleted 3 = 6
        assert_eq!(sheet.cells.len(), 6);
    }

    // -----------------------------------------------------------------------
    // Structural changes — InsertCols
    // -----------------------------------------------------------------------

    #[test]
    fn test_insert_cols_shifts_positions() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Insert 1 col at col 1 — col 1,2 become 2,3; col 0 stays
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertCols {
                at: 1,
                count: 1,
                new_col_ids: vec![cell_types::ColId::from_raw(801)],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // Col 0 unchanged for all rows
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(100))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 0)),
            Some(&make_cell_id(110))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 0)),
            Some(&make_cell_id(120))
        );

        // Old col 1 -> now col 2
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 2)),
            Some(&make_cell_id(101))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 2)),
            Some(&make_cell_id(111))
        );

        // Old col 2 -> now col 3
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 3)),
            Some(&make_cell_id(102))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 3)),
            Some(&make_cell_id(112))
        );

        // Col 1 is empty (newly inserted)
        assert!(sheet.pos_to_id.get(&SheetPos::new(0, 1)).is_none());

        // Sheet cols updated
        assert_eq!(sheet.cols, 6);
    }

    // -----------------------------------------------------------------------
    // Structural changes — DeleteCols
    // -----------------------------------------------------------------------

    #[test]
    fn test_delete_cols_removes_and_shifts() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Delete col 0 (1 col). Cells at col=0 deleted, cols 1,2 shift to 0,1.
        let deleted = vec![make_cell_id(100), make_cell_id(110), make_cell_id(120)];
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::DeleteCols {
                at: 0,
                count: 1,
                deleted_cell_ids: deleted,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // Old col 0 cells gone
        assert!(sheet.cells.get(&make_cell_id(100)).is_none());
        assert!(sheet.cells.get(&make_cell_id(110)).is_none());
        assert!(sheet.cells.get(&make_cell_id(120)).is_none());

        // Old col 1 -> now col 0
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(101))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 0)),
            Some(&make_cell_id(111))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 0)),
            Some(&make_cell_id(121))
        );

        // Old col 2 -> now col 1
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 1)),
            Some(&make_cell_id(102))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 1)),
            Some(&make_cell_id(112))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 1)),
            Some(&make_cell_id(122))
        );

        // Sheet cols updated
        assert_eq!(sheet.cols, 4);

        // Total cells: 9 - 3 = 6
        assert_eq!(sheet.cells.len(), 6);
    }

    // -----------------------------------------------------------------------
    // Structural changes — RemapPositions
    // -----------------------------------------------------------------------

    #[test]
    fn test_remap_positions() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Swap rows 0 and 2 for col 0
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::RemapPositions {
                updates: vec![
                    (make_cell_id(100), 2, 0), // was (0,0) -> (2,0)
                    (make_cell_id(120), 0, 0), // was (2,0) -> (0,0)
                ],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 0)),
            Some(&make_cell_id(100))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(120))
        );
        assert_eq!(
            sheet.id_to_pos.get(&make_cell_id(100)),
            Some(&SheetPos::new(2, 0))
        );
        assert_eq!(
            sheet.id_to_pos.get(&make_cell_id(120)),
            Some(&SheetPos::new(0, 0))
        );
    }

    // -----------------------------------------------------------------------
    // Named Ranges
    // -----------------------------------------------------------------------

    #[test]
    fn test_named_range_crud() {
        let mut mirror = CellMirror::new();
        let def = NamedRangeDef::from_positions(
            "MyRange".to_string(),
            Scope::Sheet(make_sheet_id(1)),
            make_cell_id(901),
            make_cell_id(902),
            0,
            0,
            9,
            2,
        );

        mirror.set_named_range("MyRange".to_string(), def);

        // Case-insensitive lookup
        assert!(mirror.get_named_range("myrange").is_some());
        assert!(mirror.get_named_range("MYRANGE").is_some());
        assert!(mirror.get_named_range("MyRange").is_some());

        let nr = mirror.get_named_range("myrange").unwrap();
        assert_eq!(nr.refers_to.refs.len(), 1);

        // Remove
        mirror.remove_named_range("MYRANGE");
        assert!(mirror.get_named_range("myrange").is_none());
    }

    #[test]
    fn test_named_range_from_snapshot() {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![NamedRangeDef::from_positions(
                "TestRange".to_string(),
                Scope::Workbook,
                make_cell_id(801),
                make_cell_id(802),
                0,
                0,
                5,
                5,
            )],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let mirror = CellMirror::from_snapshot(snap).unwrap();
        assert!(mirror.get_named_range("testrange").is_some());
    }

    // -----------------------------------------------------------------------
    // Tables
    // -----------------------------------------------------------------------

    fn make_canonical_table(
        name: &str,
        sheet: SheetId,
        start_row: u32,
        end_row: u32,
        end_col: u32,
        col_names: &[&str],
        has_header_row: bool,
        has_totals_row: bool,
    ) -> CanonicalTable {
        CanonicalTable {
            id: name.to_string(),
            name: name.to_string(),
            display_name: name.to_string(),
            sheet_id: sheet.to_uuid_string(),
            range: cell_types::SheetRange::new(start_row, 0, end_row, end_col),
            columns: col_names
                .iter()
                .enumerate()
                .map(|(i, n)| TableColumn {
                    id: format!("{}", i + 1),
                    name: n.to_string(),
                    index: i as u32,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                })
                .collect(),
            has_header_row,
            has_totals_row,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
        }
    }

    #[test]
    fn test_table_crud() {
        let mut mirror = CellMirror::new();
        let table = make_canonical_table(
            "Sales",
            make_sheet_id(1),
            0,
            10,
            3,
            &["Date", "Product", "Amount", "Total"],
            true,
            false,
        );

        mirror.set_table(table);
        assert!(mirror.get_table("Sales").is_some());
        assert!(mirror.get_table("NotExist").is_none());

        let t = mirror.get_table("Sales").unwrap();
        assert_eq!(t.columns.len(), 4);
        assert_eq!(t.range.start_row(), 0);
        assert_eq!(t.range.end_row(), 10);

        // Update table
        let updated = make_canonical_table(
            "Sales",
            make_sheet_id(1),
            0,
            20,
            3,
            &["Date", "Product", "Amount", "Total"],
            true,
            true,
        );
        mirror.set_table(updated);
        let t = mirror.get_table("Sales").unwrap();
        assert_eq!(t.range.end_row(), 20);
        assert!(t.has_totals_row);

        // Remove
        mirror.remove_table("Sales");
        assert!(mirror.get_table("Sales").is_none());
    }

    #[test]
    fn test_table_from_snapshot() {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![TableDef {
                name: "Table1".to_string(),
                sheet: SheetId::from_raw(1),
                start_row: 0,
                start_col: 0,
                end_row: 5,
                end_col: 2,
                columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
                has_headers: true,
                has_totals: false,
            }],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let mirror = CellMirror::from_snapshot(snap).unwrap();
        assert!(mirror.get_table("Table1").is_some());
    }

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_empty_mirror() {
        let mirror = CellMirror::new();
        assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
        assert!(mirror.get_formula(&make_cell_id(1)).is_none());
        assert!(mirror.resolve_position(&make_cell_id(1)).is_none());
        assert!(mirror.sheet_by_name("anything").is_none());
        assert_eq!(mirror.sheet_ids().count(), 0);
    }

    #[test]
    fn test_empty_snapshot() {
        let snap = WorkbookSnapshot {
            sheets: vec![],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };
        let mirror = CellMirror::from_snapshot(snap).unwrap();
        assert_eq!(mirror.sheet_ids().count(), 0);
    }

    #[test]
    fn test_empty_sheet() {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Empty".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };
        let mirror = CellMirror::from_snapshot(snap).unwrap();
        let sid = mirror.sheet_by_name("empty").unwrap();
        let sheet = mirror.get_sheet(&sid).unwrap();
        assert_eq!(sheet.cells.len(), 0);
        assert!(
            mirror
                .get_cell_value_at(&sid, SheetPos::new(0, 0))
                .is_none()
        );
    }

    #[test]
    fn test_insert_cell_overwrites() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let cell_id = make_cell_id(100); // Already at (0, 0)

        // Overwrite with new entry
        let entry = CellEntry {
            value: CellValue::Text("overwritten".into()),
            formula: None,
        };
        mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(0, 0), entry);

        assert_eq!(
            *mirror.get_cell_value(&cell_id).unwrap(),
            CellValue::Text("overwritten".into())
        );
        assert!(mirror.get_formula(&cell_id).is_none());
    }

    #[test]
    fn test_multiple_sheets() {
        let mut mirror = CellMirror::new();

        let snap1 = SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440010".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(1.0)),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        };
        let snap2 = SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
            name: "Sheet2".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440020".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(2.0)),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![],
        };

        mirror.add_sheet(snap1).unwrap();
        mirror.add_sheet(snap2).unwrap();

        assert_eq!(mirror.sheet_ids().count(), 2);

        let sid1 = mirror.sheet_by_name("sheet1").unwrap();
        let sid2 = mirror.sheet_by_name("sheet2").unwrap();
        assert_ne!(sid1, sid2);

        let cell1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440010").unwrap();
        let cell2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440020").unwrap();

        assert_eq!(
            *mirror.get_cell_value_in_sheet(&sid1, &cell1).unwrap(),
            CellValue::Number(FiniteF64::must(1.0))
        );
        assert_eq!(
            *mirror.get_cell_value_in_sheet(&sid2, &cell2).unwrap(),
            CellValue::Number(FiniteF64::must(2.0))
        );

        // Cross-sheet: cell1 not in sheet2
        assert!(mirror.get_cell_value_in_sheet(&sid2, &cell1).is_none());
    }

    #[test]
    fn test_structure_change_on_nonexistent_sheet() {
        let mut mirror = CellMirror::new();
        // Should not panic
        mirror.apply_structure_change(
            &make_sheet_id(999),
            &formula_types::StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: vec![],
            },
        );
    }

    #[test]
    fn test_insert_rows_at_beginning() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Insert 1 row at the very beginning — all rows shift down by 1
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 0,
                count: 1,
                new_row_ids: vec![RowId::from_raw(999)],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // All original cells shifted down by 1
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 0)),
            Some(&make_cell_id(100))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 0)),
            Some(&make_cell_id(110))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(3, 0)),
            Some(&make_cell_id(120))
        );

        // Row 0 is empty
        assert!(sheet.pos_to_id.get(&SheetPos::new(0, 0)).is_none());
    }

    #[test]
    fn test_insert_rows_at_end() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Insert 2 rows at row 3 (past all existing cells) — no positions change
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 3,
                count: 2,
                new_row_ids: vec![RowId::from_raw(997), RowId::from_raw(998)],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();

        // All positions unchanged
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(0, 0)),
            Some(&make_cell_id(100))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(1, 0)),
            Some(&make_cell_id(110))
        );
        assert_eq!(
            sheet.pos_to_id.get(&SheetPos::new(2, 0)),
            Some(&make_cell_id(120))
        );

        assert_eq!(sheet.rows, 12);
    }

    #[test]
    fn test_delete_all_rows_with_cells() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Delete all 3 rows that have cells
        let all_cell_ids: Vec<CellId> = (0..3u32)
            .flat_map(|r| (0..3u32).map(move |c| make_cell_id((r * 10 + c + 100) as u128)))
            .collect();

        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::DeleteRows {
                at: 0,
                count: 3,
                deleted_cell_ids: all_cell_ids,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.cells.len(), 0);
        assert_eq!(sheet.pos_to_id.len(), 0);
        assert_eq!(sheet.id_to_pos.len(), 0);
        assert_eq!(sheet.rows, 7);
    }

    #[test]
    fn test_apply_edit_to_nonexistent_sheet() {
        let mut mirror = CellMirror::new();
        // Should not panic — edit is silently ignored since sheet doesn't exist
        mirror.apply_edit(
            &make_sheet_id(999),
            make_cell_id(1),
            SheetPos::new(0, 0),
            CellValue::Null,
            None,
        );
        assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
    }

    #[test]
    fn test_insert_cell_to_nonexistent_sheet() {
        let mut mirror = CellMirror::new();
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        // Should not panic
        mirror.insert_cell(
            &make_sheet_id(999),
            make_cell_id(1),
            SheetPos::new(0, 0),
            entry,
        );
        assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
    }

    #[test]
    fn test_rename_nonexistent_sheet() {
        let mut mirror = CellMirror::new();
        // Should not panic
        mirror.rename_sheet(&make_sheet_id(999), "NewName");
    }

    #[test]
    fn test_default_trait() {
        let mirror = CellMirror::default();
        assert_eq!(mirror.sheet_ids().count(), 0);
    }

    // -----------------------------------------------------------------------
    // Unicode NFC normalization
    // -----------------------------------------------------------------------

    #[test]
    fn test_sheet_name_nfc_nfd_normalization() {
        // "cafe\u{0301}" is NFD (e + combining acute), "caf\u{00e9}" is NFC (precomposed e-acute).
        // Both should resolve to the same sheet.
        let nfc_name = "caf\u{00e9}"; // NFC: é = U+00E9
        let nfd_name = "cafe\u{0301}"; // NFD: e + combining acute U+0301

        // Verify they are indeed different byte sequences
        assert_ne!(nfc_name, nfd_name);

        let sheet_id = make_sheet_id(42);
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
        mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

        // Look up with NFC name (same encoding as stored)
        assert_eq!(mirror.sheet_by_name(nfc_name), Some(sheet_id));
        // Look up with NFD name (different encoding)
        assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
        // Case-insensitive + NFC: uppercase NFD should also work
        let upper_nfd = "CAFE\u{0301}";
        assert_eq!(mirror.sheet_by_name(upper_nfd), Some(sheet_id));
    }

    #[test]
    fn test_sheet_name_nfc_hebrew() {
        // Hebrew with nikud (vowel points) — NFC vs NFD can differ
        // U+05E9 (shin) + U+05C1 (shin dot) = NFC shin-with-dot U+FB2A
        let nfc_name = "\u{FB2A}"; // Precomposed: shin with shin dot
        let nfd_name = "\u{05E9}\u{05C1}"; // Decomposed: shin + shin dot

        let sheet_id = make_sheet_id(43);
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
        mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

        assert_eq!(mirror.sheet_by_name(nfc_name), Some(sheet_id));
        assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
    }

    #[test]
    fn test_rename_sheet_nfc_normalization() {
        let nfc_name = "caf\u{00e9}";
        let nfd_name = "cafe\u{0301}";

        let sheet_id = make_sheet_id(44);
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, "OldName".to_string(), 10, 5);
        mirror.add_sheet_mirror(sheet_id, "OldName".to_string(), sheet_mirror);

        // Rename to NFC name
        mirror.rename_sheet(&sheet_id, nfc_name);
        // Should be findable via NFD name
        assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));
        // Old name should be gone
        assert!(mirror.sheet_by_name("OldName").is_none());
    }

    #[test]
    fn test_remove_sheet_nfc_normalization() {
        let nfc_name = "caf\u{00e9}";
        let nfd_name = "cafe\u{0301}";

        let sheet_id = make_sheet_id(45);
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, nfc_name.to_string(), 10, 5);
        mirror.add_sheet_mirror(sheet_id, nfc_name.to_string(), sheet_mirror);

        // Verify it exists
        assert_eq!(mirror.sheet_by_name(nfd_name), Some(sheet_id));

        // Remove it
        mirror.remove_sheet(&sheet_id);

        // Should be gone for both encodings
        assert!(mirror.sheet_by_name(nfc_name).is_none());
        assert!(mirror.sheet_by_name(nfd_name).is_none());
    }

    // -----------------------------------------------------------------------
    // CellEntry::is_ghost
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_ghost_null_no_formula() {
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        assert!(entry.is_ghost());
    }

    #[test]
    fn test_is_ghost_null_with_formula() {
        // CellEntry.formula is now IdentityFormula; use a minimal one for this test
        let formula = formula_types::IdentityFormula {
            template: "1".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let entry = CellEntry {
            value: CellValue::Null,
            formula: Some(Box::new(formula)),
        };
        assert!(!entry.is_ghost());
    }

    #[test]
    fn test_is_ghost_number_no_formula() {
        let entry = CellEntry {
            value: CellValue::Number(FiniteF64::must(0.0)),
            formula: None,
        };
        assert!(!entry.is_ghost());
    }

    // -----------------------------------------------------------------------
    // Regression Tests — dense cache + col_data + table case-insensitivity
    // -----------------------------------------------------------------------

    #[test]
    fn test_set_value_mut_invalidates_dense_cache() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        // Materialize column 0 into dense cache using direct field access
        // to avoid borrow conflicts (get_sheet borrows &self, dense_cache_mut borrows &mut self).
        let sheet = &mirror.sheets[&sheet_id];
        mirror.dense_cache.materialize(&sheet_id, 0, sheet);
        assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

        // set_value_mut should invalidate the dense cache for that column
        let cell_id = make_cell_id(100); // row=0, col=0
        mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(999.0)));
        assert!(
            mirror.dense_cache().get(&sheet_id, 0).is_none(),
            "dense cache should be invalidated after set_value_mut"
        );
    }

    #[test]
    fn test_insert_cell_invalidates_dense_cache() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        let sheet = &mirror.sheets[&sheet_id];
        mirror.dense_cache.materialize(&sheet_id, 0, sheet);
        assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

        // insert_cell should invalidate the dense cache
        let entry = CellEntry {
            value: CellValue::Number(FiniteF64::must(777.0)),
            formula: None,
        };
        mirror.insert_cell(&sheet_id, make_cell_id(500), SheetPos::new(5, 0), entry);
        assert!(
            mirror.dense_cache().get(&sheet_id, 0).is_none(),
            "dense cache should be invalidated after insert_cell"
        );
    }

    #[test]
    fn test_remove_cell_clears_col_data_and_dense_cache() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // First populate col_data by applying an edit (which updates col_data)
        let cell_id = make_cell_id(100); // row=0, col=0
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 0),
            CellValue::Number(FiniteF64::must(42.0)),
            None,
        );

        // Materialize dense cache
        let sheet = &mirror.sheets[&sheet_id];
        mirror.dense_cache.materialize(&sheet_id, 0, sheet);
        assert!(mirror.dense_cache().get(&sheet_id, 0).is_some());

        // Remove the cell
        mirror.remove_cell(&cell_id);

        // Dense cache should be invalidated
        assert!(
            mirror.dense_cache().get(&sheet_id, 0).is_none(),
            "dense cache should be invalidated after remove_cell"
        );

        // col_data should have Null at the old position
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        if let Some(col_vec) = sheet.col_data.get(&0) {
            if !col_vec.is_empty() {
                assert_eq!(
                    col_vec[0],
                    CellValue::Null,
                    "col_data should be cleared to Null after remove_cell"
                );
            }
        }
    }

    #[test]
    fn test_col_data_grows_on_out_of_bounds_insert() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // The grid has cells at rows 0-2, cols 0-2. col_data may have vectors of length ~3.
        // Insert a cell at row 8 (beyond col_data vector length) — should grow, not silently drop.
        let entry = CellEntry {
            value: CellValue::Number(FiniteF64::must(88.0)),
            formula: None,
        };
        mirror.insert_cell(&sheet_id, make_cell_id(800), SheetPos::new(8, 0), entry);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        if let Some(col_vec) = sheet.col_data.get(&0) {
            assert!(
                col_vec.len() > 8,
                "col_data vector should have grown to accommodate row 8"
            );
            assert_eq!(
                col_vec[8],
                CellValue::Number(FiniteF64::must(88.0)),
                "col_data should contain the inserted value at row 8"
            );
        }
    }

    #[test]
    fn test_col_data_grows_on_set_value_mut() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Insert a cell at a high row that won't be in col_data initially
        let cell_id = make_cell_id(900);
        let entry = CellEntry {
            value: CellValue::Number(FiniteF64::must(1.0)),
            formula: None,
        };
        mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(9, 0), entry);

        // Now set_value_mut at row 9 — the col_data vector should grow to accommodate
        mirror.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(99.0)));

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        if let Some(col_vec) = sheet.col_data.get(&0) {
            assert!(
                col_vec.len() > 9,
                "col_data should grow for set_value_mut at high row"
            );
            assert_eq!(col_vec[9], CellValue::Number(FiniteF64::must(99.0)));
        }
    }

    #[test]
    fn test_col_data_rebuilt_after_insert_rows() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Populate col_data via apply_edit
        mirror.apply_edit(
            &sheet_id,
            make_cell_id(100),
            SheetPos::new(0, 0),
            CellValue::Number(FiniteF64::must(10.0)),
            None,
        );
        mirror.apply_edit(
            &sheet_id,
            make_cell_id(110),
            SheetPos::new(1, 0),
            CellValue::Number(FiniteF64::must(20.0)),
            None,
        );

        // Insert 2 rows at row 1 — row 1 becomes row 3
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: vec![
                    cell_types::RowId::from_raw(901),
                    cell_types::RowId::from_raw(902),
                ],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        if let Some(col_vec) = sheet.col_data.get(&0) {
            // Row 0 should still have value 10.0
            assert_eq!(
                col_vec[0],
                CellValue::Number(FiniteF64::must(10.0)),
                "row 0 value should be preserved after insert_rows"
            );
            // Row 3 (shifted from row 1) should have value 20.0
            if col_vec.len() > 3 {
                assert_eq!(
                    col_vec[3],
                    CellValue::Number(FiniteF64::must(20.0)),
                    "shifted row value should be at new position in col_data"
                );
            }
        }
    }

    #[test]
    fn test_col_data_rebuilt_after_delete_rows() {
        let (mut mirror, sheet_id) = mirror_with_grid();

        // Delete row 0 — cells at row 0 are deleted, row 1 shifts to row 0
        let deleted = vec![make_cell_id(100), make_cell_id(101), make_cell_id(102)];
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::DeleteRows {
                at: 0,
                count: 1,
                deleted_cell_ids: deleted,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // After deleting row 0, old row 1 (cell_id 110, value=10.0) should be at row 0
        if let Some(col_vec) = sheet.col_data.get(&0) {
            assert_eq!(
                col_vec[0],
                CellValue::Number(FiniteF64::must(10.0)),
                "after delete, shifted cell should be at new position in col_data"
            );
        }
    }

    #[test]
    fn test_table_case_insensitive_set() {
        let mut mirror = CellMirror::new();
        let table1 = make_canonical_table("Sales", make_sheet_id(1), 0, 10, 3, &["A"], true, false);
        mirror.set_table(table1);

        // Setting with different casing should update, not create duplicate
        let table2 = make_canonical_table("SALES", make_sheet_id(1), 0, 20, 3, &["A"], true, true);
        mirror.set_table(table2);

        // Should only have one table
        let t = mirror.get_table("sales").unwrap();
        assert_eq!(
            t.range.end_row(),
            20,
            "set_table with different casing should update existing"
        );
        assert!(t.has_totals_row);
    }

    #[test]
    fn test_table_case_insensitive_remove() {
        let mut mirror = CellMirror::new();
        let table = make_canonical_table("Sales", make_sheet_id(1), 0, 10, 3, &["A"], true, false);
        mirror.set_table(table);
        assert!(mirror.get_table("Sales").is_some());

        // Remove with different casing should work
        mirror.remove_table("SALES");
        assert!(
            mirror.get_table("Sales").is_none(),
            "remove_table with different casing should remove the table"
        );
    }

    // -------------------------------------------------------------------
    // col_data sizing invariant after structural mutations
    // -------------------------------------------------------------------

    #[test]
    fn test_col_data_padded_to_sheet_rows_after_insert() {
        // Regression: rebuild_col_data must pad vectors to sheet.rows
        // (matching snapshot load invariant), not just to last-occupied-row+1.
        let (mut mirror, sheet_id) = mirror_with_grid();
        // mirror_with_grid: 3×3 grid in a 10×5 sheet, rows 0-2 occupied

        // Insert 2 rows at row 1 → sheet.rows goes from 10 to 12
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: vec![RowId::from_raw(801), RowId::from_raw(802)],
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.rows, 12, "sheet.rows should be 10 + 2 = 12");
        for (col, col_vec) in &sheet.col_data {
            assert_eq!(
                col_vec.len(),
                sheet.rows as usize,
                "col_data[{col}] should be padded to sheet.rows ({}) but was {}",
                sheet.rows,
                col_vec.len(),
            );
        }
    }

    #[test]
    fn test_col_data_padded_to_sheet_rows_after_delete() {
        let (mut mirror, sheet_id) = mirror_with_grid();
        // Delete row 0
        let deleted = vec![make_cell_id(100), make_cell_id(101), make_cell_id(102)];
        mirror.apply_structure_change(
            &sheet_id,
            &formula_types::StructureChange::DeleteRows {
                at: 0,
                count: 1,
                deleted_cell_ids: deleted,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.rows, 9, "sheet.rows should be 10 - 1 = 9");
        for (col, col_vec) in &sheet.col_data {
            assert_eq!(
                col_vec.len(),
                sheet.rows as usize,
                "col_data[{col}] should be padded to sheet.rows ({}) but was {}",
                sheet.rows,
                col_vec.len(),
            );
        }
    }
}
