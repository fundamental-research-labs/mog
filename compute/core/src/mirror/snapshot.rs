//! Snapshot deserialization — bulk-loading a CellMirror from a WorkbookSnapshot.

use std::sync::Arc;

use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetId, SheetPos};
use rustc_hash::FxHashMap;
use value_types::{CellValue, ComputeError};

use super::cell_mirror::CellMirror;
use super::sheet_key::normalize_sheet_key;
use super::types::{CellEntry, SheetMirror};

/// Parse an A1-style range reference (e.g., "A1:C5") into
/// (start_row, start_col, end_row, end_col), all 0-based.
fn parse_a1_range(s: &str) -> Option<(u32, u32, u32, u32)> {
    // Delegates to compute-parser; rejects single-cell forms (callers here
    // require a two-endpoint range to compute projection spill dimensions).
    if !s.contains(':') {
        return None;
    }
    let range = compute_parser::parse_a1_range(s)?;
    let (sr, sc) = match range.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (er, ec) = match range.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some((sr, sc, er, ec))
}

impl CellMirror {
    /// Build a `CellMirror` from a JSON-path `WorkbookSnapshot`.
    ///
    /// Parses UUID strings to u128 via `CellId::from_uuid_str()`.
    #[tracing::instrument(name = "mirror_from_snapshot", skip_all)]
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<Self, ComputeError> {
        let mut mirror = Self::new();

        // Pre-size cell_to_sheet for the total cell count across all sheets.
        // This avoids incremental rehashing as cells are inserted sheet-by-sheet.
        let total_cells: usize = snapshot.sheets.iter().map(|s| s.cells.len()).sum();
        mirror.cell_to_sheet.reserve(total_cells);

        // Pre-size sheet_names for the number of sheets.
        let sheet_count = snapshot.sheets.len();
        mirror.sheet_names.reserve(sheet_count);
        mirror.sheets.reserve(sheet_count);

        // Named ranges
        for nr in snapshot.named_ranges {
            let scope = nr.scope.clone();
            mirror.variables.insert(scope, nr.name.clone(), nr);
        }

        // Tables — snapshot carries Vec<TableDef> (formula engine view).
        // Convert each to a canonical Table and also keep the TableDef cache.
        mirror.table_defs = snapshot.tables;
        mirror.tables = mirror
            .table_defs
            .iter()
            .map(|td| domain_types::domain::table::Table {
                id: td.name.clone(),
                name: td.name.clone(),
                display_name: td.name.clone(),
                sheet_id: td.sheet.to_uuid_string(),
                range: cell_types::SheetRange::new(
                    td.start_row,
                    td.start_col,
                    td.end_row,
                    td.end_col,
                ),
                columns: td
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(i, name)| domain_types::domain::table::TableColumn {
                        id: format!("{}", i + 1),
                        name: name.clone(),
                        index: i as u32,
                        totals_function: None,
                        totals_label: None,
                        calculated_formula: None,
                    })
                    .collect(),
                has_header_row: td.has_headers,
                has_totals_row: td.has_totals,
                style: "TableStyleMedium2".to_string(),
                banded_rows: true,
                banded_columns: false,
                emphasize_first_column: false,
                emphasize_last_column: false,
                show_filter_buttons: true,
                auto_expand: true,
                auto_calculated_columns: true,
            })
            .collect();

        // Pivot tables
        mirror.pivot_tables = snapshot.pivot_tables;

        // Data table regions
        mirror.data_table_regions = snapshot.data_table_regions;

        // Sheets
        for sheet_snap in snapshot.sheets {
            let cell_count = sheet_snap.cells.len();
            let _span = tracing::info_span!("mirror_add_sheet", cell_count).entered();
            mirror.add_sheet(sheet_snap)?;
        }

        Ok(mirror)
    }

    /// Add a new sheet from a snapshot.
    ///
    /// Recomputes materialized `rows`/`cols` from actual cell positions rather
    /// than trusting the snapshot's claimed dimensions. This prevents "ghost
    /// rows" — empty formatting-only cells at extreme positions in XLSX files —
    /// from inflating dense/content storage.
    ///
    /// The snapshot's declared dimensions are still retained separately as the
    /// formula grid extent, so explicit ranges and whole-column references keep
    /// seeing blank cells inside the logical workbook grid.
    pub fn add_sheet(&mut self, snapshot: SheetSnapshot) -> Result<(), ComputeError> {
        let sheet_id = SheetId::from_uuid_str(&snapshot.id)?;
        // Pre-size cell maps based on snapshot cell count to avoid rehashing.
        let cell_hint = snapshot.cells.len();
        let mut sheet_mirror = SheetMirror::with_capacity(
            sheet_id,
            snapshot.name.clone(),
            snapshot.rows,
            snapshot.cols,
            cell_hint,
        );

        // Track actual data extent from non-empty cells.
        let mut actual_max_row: u32 = 0;
        let mut actual_max_col: u32 = 0;
        let mut has_content = false;

        // Track identity extent (all cells including ghosts for comment targets).
        let mut identity_max_row: u32 = 0;
        let mut identity_max_col: u32 = 0;
        let mut has_identity = false;

        // Collect array formula metadata for projection pre-registration.
        // Each entry: (cell_id, start_row, start_col, end_row, end_col).
        let mut array_projections: Vec<(CellId, u32, u32, u32, u32)> = Vec::new();

        // Collect (row, col, value) for col_data building in a single pass.
        // This avoids a second iteration over pos_to_id + cells HashMap lookup.
        let mut col_data_entries: Vec<(u32, u32, CellValue)> =
            Vec::with_capacity(snapshot.cells.len());
        let mut occupied_cols: rustc_hash::FxHashSet<u32> = rustc_hash::FxHashSet::default();

        for cell_data in snapshot.cells {
            let has_formula = cell_data.formula.is_some() || cell_data.identity_formula.is_some();
            let is_ghost = matches!(cell_data.value, CellValue::Null) && !has_formula;

            // ALL cells get identity registration (including ghost cells for comment targets).
            let entry = CellEntry {
                value: cell_data.value.clone(),
                formula: cell_data.identity_formula.map(Box::new),
            };

            let cell_id = CellId::from_uuid_str(&cell_data.cell_id)?;
            let pos = SheetPos::new(cell_data.row, cell_data.col);
            sheet_mirror.pos_to_id.insert(pos, cell_id);
            sheet_mirror.id_to_pos.insert(cell_id, pos);
            sheet_mirror.cells.insert(cell_id, entry);
            self.cell_to_sheet.insert(cell_id, sheet_id);

            // Track identity extent (all cells including ghosts).
            has_identity = true;
            if cell_data.row + 1 > identity_max_row {
                identity_max_row = cell_data.row + 1;
            }
            if cell_data.col + 1 > identity_max_col {
                identity_max_col = cell_data.col + 1;
            }

            // Ghost cells get identity but don't affect content dimensions or col_data.
            if is_ghost {
                continue;
            }

            // --- Content cells only below this point ---

            // Move original value for col_data building (no extra clone needed).
            let col_data_value = cell_data.value;

            // Track actual content extent.
            has_content = true;
            if cell_data.row + 1 > actual_max_row {
                actual_max_row = cell_data.row + 1;
            }
            if cell_data.col + 1 > actual_max_col {
                actual_max_col = cell_data.col + 1;
            }

            // Collect array formula source metadata for projection pre-registration.
            // The array_ref field (from XLSX `<f t="array" ref="A1:C5">`) tells us
            // the spill extent so we can register the projection before first recalc.
            if let Some(ref array_ref_str) = cell_data.array_ref
                && let Some((sr, sc, er, ec)) = parse_a1_range(array_ref_str)
            {
                array_projections.push((cell_id, sr, sc, er, ec));
            }

            // Save for col_data building (avoids second pass).
            col_data_entries.push((cell_data.row, cell_data.col, col_data_value));
            occupied_cols.insert(cell_data.col);
        }

        // Use actual data extent as authoritative dimensions.
        // This handles two cases:
        // 1. Ghost rows: snapshot over-reports (e.g., 144K rows from formatting-only cells)
        //    → actual_max_row (e.g., 537) is the correct bound
        // 2. Missing dimensions: snapshot under-reports (e.g., rows=0)
        //    → actual_max_row is the correct bound
        if has_content {
            sheet_mirror.rows = actual_max_row;
            sheet_mirror.cols = actual_max_col;
        } else {
            // No content cells — tighten to zero so full-column refs don't
            // iterate the snapshot's claimed dimensions (which may be inflated
            // by ghost rows from formatting-only cells).
            sheet_mirror.rows = 0;
            sheet_mirror.cols = 0;
        }

        // Preserve the workbook-declared grid for formula range semantics.
        // `rows`/`cols` above stay content-bounded; `grid_rows`/`grid_cols`
        // are what lets A1:A5 or C:C include blank cells inside a sparse sheet.
        sheet_mirror.grid_rows = snapshot.rows.max(sheet_mirror.rows);
        sheet_mirror.grid_cols = snapshot.cols.max(sheet_mirror.cols);

        // Set identity dimensions (includes ghost cells for comment targets).
        if has_identity {
            sheet_mirror.identity_rows = identity_max_row;
            sheet_mirror.identity_cols = identity_max_col;
        }

        // Build column-major dense storage from collected entries (single-pass).
        // First pass: find max row per column to avoid over-allocating.
        if sheet_mirror.rows > 0 {
            let mut col_max_row: rustc_hash::FxHashMap<u32, u32> = rustc_hash::FxHashMap::default();
            for &(row, col, _) in &col_data_entries {
                col_max_row
                    .entry(col)
                    .and_modify(|m| *m = (*m).max(row))
                    .or_insert(row);
            }

            sheet_mirror.col_data.reserve(occupied_cols.len());
            for (row, col, value) in col_data_entries {
                let max_row = col_max_row.get(&col).copied().unwrap_or(0);
                let col_len = (max_row + 1).min(sheet_mirror.rows) as usize;
                if (row as usize) < col_len {
                    let col_vec = sheet_mirror
                        .col_data
                        .entry(col)
                        .or_insert_with(|| vec![CellValue::Null; col_len]);
                    col_vec[row as usize] = value;
                }
            }
        }

        // Emit post-tightening dimensions for profiling (zero-cost when no subscriber).
        let non_null_count = sheet_mirror.cells.len();
        let _dims = tracing::info_span!("mirror_sheet_dims",
            sheet = %snapshot.name,
            snapshot_rows = snapshot.rows,
            snapshot_cols = snapshot.cols,
            actual_rows = sheet_mirror.rows,
            actual_cols = sheet_mirror.cols,
            grid_rows = sheet_mirror.grid_rows,
            grid_cols = sheet_mirror.grid_cols,
            non_null_cells = non_null_count,
        )
        .entered();

        // Pre-register projections for dynamic array source cells.
        // This populates the ProjectionRegistry before first recalc so that
        // projection-aware dep extraction works immediately for XLSX-loaded files,
        // eliminating the need for projection stabilization on the first recalc cycle.
        if !array_projections.is_empty() {
            let proj_count = array_projections.len();
            let _proj_span = tracing::info_span!("register_snapshot_projections",
                sheet = %snapshot.name,
                count = proj_count,
            )
            .entered();
            for (cell_id, sr, sc, er, ec) in array_projections {
                let rows = er - sr + 1;
                let cols = ec - sc + 1;
                if rows > 1 || cols > 1 {
                    // Multi-cell CSE: register the projection with declared dimensions.
                    self.projection_registry
                        .register(cell_id, sheet_id, sr, sc, rows, cols);
                } else {
                    // 1×1 CSE array formula (e.g., single-cell TRANSPOSE entered with
                    // Ctrl+Shift+Enter). Mark it so spill handling applies implicit
                    // intersection instead of dynamic array spill.
                    self.cse_single_cell.insert(cell_id);
                }
                // Both single- and multi-cell CSE entries are anchors;
                // editing any covered position must be rejected.
                self.cse_anchors.insert(cell_id);
            }
        }

        // Hydrate RangeViews from snapshot ranges.
        // Only insert the RangeView objects here — spatial index building,
        // virtual CellId registration, and col_data rebuild depend on
        // row_to_index/col_to_index which aren't populated until
        // install_row_col_indexes runs. finalize_range_hydration() completes
        // the setup after those maps are available.
        for range_data in &snapshot.ranges {
            use super::range_view::RangeView;

            let mut row_offset_by_id: FxHashMap<cell_types::RowId, u32> = FxHashMap::default();
            for (i, &rid) in range_data.row_ids.iter().enumerate() {
                row_offset_by_id.insert(rid, i as u32);
            }
            let mut col_offset_by_id: FxHashMap<cell_types::ColId, u32> = FxHashMap::default();
            for (i, &cid) in range_data.col_ids.iter().enumerate() {
                col_offset_by_id.insert(cid, i as u32);
            }

            let rv = RangeView {
                range_id: range_data.range_id,
                kind: range_data.kind,
                anchor: range_data.anchor.clone(),
                encoding: range_data.encoding,
                payload: Arc::from(range_data.payload.as_slice()),
                row_offset_by_id,
                col_offset_by_id,
                overrides: FxHashMap::default(),
                override_count: 0,
                folded_up_to: None,
            };

            sheet_mirror.range_views.insert(range_data.range_id, rv);
        }

        self.sheet_names
            .insert(normalize_sheet_key(&snapshot.name), sheet_id);
        self.sheets.insert(sheet_id, sheet_mirror);
        Ok(())
    }

    /// Hydrate domain caches from Yrs document state.
    ///
    /// Called after the Yrs document has been populated (e.g., from a snapshot
    /// or sync update). Reads domain maps from the Yrs transaction and populates
    /// the corresponding SheetMirror domain caches.
    ///
    /// Currently a no-op placeholder: the WorkbookSnapshot does not yet carry
    /// domain data (merges, dimensions, comments, sparklines). As snapshot fields
    /// are added, this method will read from the Yrs document
    /// and populate the mirror caches accordingly.
    pub fn hydrate_domain_maps(&mut self) {
        // Placeholder for domain map hydration.
        //
        // When SheetSnapshot gains fields like `merges`, `row_heights`, etc.,
        // this method will iterate over sheets and populate:
        //   - sheet.merge_regions
        //   - sheet.row_heights / col_widths
        //   - sheet.hidden_rows / hidden_cols
        //   - sheet.comment_cells / sparkline_cells
        //
        // For now, all domain caches start empty (initialized in SheetMirror::new)
        // and are populated incrementally via the write API as storage domain
        // modules (merges.rs, dimensions.rs, comments.rs, etc.) call into the mirror.
    }

    /// Test-only helper: add a pre-built SheetMirror directly.
    #[cfg(test)]
    pub fn add_sheet_mirror(&mut self, sheet_id: SheetId, name: String, sheet_mirror: SheetMirror) {
        // Maintain cell_to_sheet for all cells in this sheet mirror
        for cell_id in sheet_mirror.cells.keys() {
            self.cell_to_sheet.insert(*cell_id, sheet_id);
        }
        self.sheet_names
            .insert(normalize_sheet_key(&name), sheet_id);
        self.sheets.insert(sheet_id, sheet_mirror);
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval::cache::range_store::{RangeKey, materialize_range};
    use crate::eval::context::traits::DataSource;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

    #[test]
    fn test_parse_a1_range() {
        assert_eq!(parse_a1_range("A1:C5"), Some((0, 0, 4, 2)));
        assert_eq!(parse_a1_range("B2:D10"), Some((1, 1, 9, 3)));
        assert_eq!(parse_a1_range("$A$1:$C$5"), Some((0, 0, 4, 2)));
    }

    #[test]
    fn test_parse_a1_range_invalid() {
        assert_eq!(parse_a1_range("A1"), None); // No colon
        assert_eq!(parse_a1_range("A1:B2:C3"), None); // Too many parts
        assert_eq!(parse_a1_range(""), None);
    }

    // -----------------------------------------------------------------------
    // Projection pre-registration during snapshot load
    // -----------------------------------------------------------------------

    /// Helper: create a minimal WorkbookSnapshot with one sheet.
    fn make_snapshot(sheet_uuid: &str, cells: Vec<CellData>) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_uuid.to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells,
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

    #[test]
    fn test_snapshot_projection_preregistration() {
        // Cell A1 has formula =SEQUENCE(5) with array_ref="A1:A5"
        // This means it spills 5 rows in column A.
        let source_uuid = "550e8400-e29b-41d4-a716-446655440001";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![CellData {
                cell_id: source_uuid.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(1.0), // cached value of first element
                formula: Some("SEQUENCE(5)".to_string()),
                identity_formula: None,
                array_ref: Some("A1:A5".to_string()),
            }],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();

        let source_id = CellId::from_uuid_str(source_uuid).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();

        // The source cell should be registered in the projection registry.
        assert!(
            mirror.projection_registry.is_source(&source_id),
            "Source cell should be registered as a projection source"
        );

        // Verify projection metadata.
        let proj = mirror.projection_registry.get(&source_id).unwrap();
        assert_eq!(proj.origin_row, 0);
        assert_eq!(proj.origin_col, 0);
        assert_eq!(proj.rows, 5);
        assert_eq!(proj.cols, 1);

        // resolve() should find the source for positions within the spill range.
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 0, 0),
            Some((source_id, 0, 0))
        );
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 4, 0),
            Some((source_id, 4, 0))
        );
        // Outside spill range.
        assert!(
            mirror
                .projection_registry
                .resolve(&sheet_id, 5, 0)
                .is_none()
        );
    }

    #[test]
    fn test_snapshot_projection_multi_column() {
        // Cell B2 has array_ref="B2:D4" — a 3x3 spill.
        let source_uuid = "550e8400-e29b-41d4-a716-446655440010";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![CellData {
                cell_id: source_uuid.to_string(),
                row: 1,
                col: 1,
                value: CellValue::number(1.0),
                formula: Some("SEQUENCE(3,3)".to_string()),
                identity_formula: None,
                array_ref: Some("B2:D4".to_string()),
            }],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();

        let source_id = CellId::from_uuid_str(source_uuid).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();

        assert!(mirror.projection_registry.is_source(&source_id));
        let proj = mirror.projection_registry.get(&source_id).unwrap();
        assert_eq!(proj.origin_row, 1);
        assert_eq!(proj.origin_col, 1);
        assert_eq!(proj.rows, 3);
        assert_eq!(proj.cols, 3);

        // Check corners
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 1, 1),
            Some((source_id, 0, 0))
        );
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 3, 3),
            Some((source_id, 2, 2))
        );
        // Outside
        assert!(
            mirror
                .projection_registry
                .resolve(&sheet_id, 4, 1)
                .is_none()
        );
        assert!(
            mirror
                .projection_registry
                .resolve(&sheet_id, 1, 4)
                .is_none()
        );
    }

    #[test]
    fn test_snapshot_no_projection_for_1x1_array() {
        // A 1x1 array_ref (e.g., "A1:A1") should NOT register a projection
        // because it's just the source cell with no spill.
        let source_uuid = "550e8400-e29b-41d4-a716-446655440020";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![CellData {
                cell_id: source_uuid.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(42.0),
                formula: Some("SEQUENCE(1)".to_string()),
                identity_formula: None,
                array_ref: Some("A1:A1".to_string()),
            }],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();
        let source_id = CellId::from_uuid_str(source_uuid).unwrap();

        assert!(
            !mirror.projection_registry.is_source(&source_id),
            "1x1 array should NOT be registered as projection"
        );
    }

    #[test]
    fn test_snapshot_no_projection_without_array_ref() {
        // A regular formula cell without array_ref should not register.
        let cell_uuid = "550e8400-e29b-41d4-a716-446655440030";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![CellData {
                cell_id: cell_uuid.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(100.0),
                formula: Some("SUM(B1:B10)".to_string()),
                identity_formula: None,
                array_ref: None,
            }],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();
        let cell_id = CellId::from_uuid_str(cell_uuid).unwrap();

        assert!(!mirror.projection_registry.is_source(&cell_id));
    }

    #[test]
    fn test_snapshot_multiple_projections_same_sheet() {
        // Two array formula sources on the same sheet.
        let source1_uuid = "550e8400-e29b-41d4-a716-446655440041";
        let source2_uuid = "550e8400-e29b-41d4-a716-446655440042";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![
                CellData {
                    cell_id: source1_uuid.to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: Some("SEQUENCE(3)".to_string()),
                    identity_formula: None,
                    array_ref: Some("A1:A3".to_string()),
                },
                CellData {
                    cell_id: source2_uuid.to_string(),
                    row: 0,
                    col: 5,
                    value: CellValue::number(10.0),
                    formula: Some("SEQUENCE(1,4)".to_string()),
                    identity_formula: None,
                    array_ref: Some("F1:I1".to_string()),
                },
            ],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();

        let s1 = CellId::from_uuid_str(source1_uuid).unwrap();
        let s2 = CellId::from_uuid_str(source2_uuid).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();

        assert!(mirror.projection_registry.is_source(&s1));
        assert!(mirror.projection_registry.is_source(&s2));

        let p1 = mirror.projection_registry.get(&s1).unwrap();
        assert_eq!((p1.rows, p1.cols), (3, 1));

        let p2 = mirror.projection_registry.get(&s2).unwrap();
        assert_eq!((p2.rows, p2.cols), (1, 4));

        // Verify resolve for each
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 2, 0),
            Some((s1, 2, 0))
        );
        assert_eq!(
            mirror.projection_registry.resolve(&sheet_id, 0, 8),
            Some((s2, 0, 3))
        );
    }

    #[test]
    fn test_snapshot_projection_with_absolute_refs() {
        // array_ref may use absolute references like "$A$1:$A$5"
        let source_uuid = "550e8400-e29b-41d4-a716-446655440050";
        let sheet_uuid = "550e8400-e29b-41d4-a716-446655440000";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![CellData {
                cell_id: source_uuid.to_string(),
                row: 0,
                col: 0,
                value: CellValue::number(1.0),
                formula: Some("SEQUENCE(5)".to_string()),
                identity_formula: None,
                array_ref: Some("$A$1:$A$5".to_string()),
            }],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();
        let source_id = CellId::from_uuid_str(source_uuid).unwrap();

        assert!(mirror.projection_registry.is_source(&source_id));
        let proj = mirror.projection_registry.get(&source_id).unwrap();
        assert_eq!(proj.rows, 5);
        assert_eq!(proj.cols, 1);
    }

    #[test]
    fn ghost_cells_get_identity_but_not_content_dimensions() {
        let sheet_uuid = "550e8400e29b41d4a716446655440000";
        let ghost_uuid = "550e8400e29b41d4a716446655440099";
        let content_uuid = "550e8400e29b41d4a716446655440001";

        let snapshot = make_snapshot(
            sheet_uuid,
            vec![
                // Content cell at row 5, col 2
                CellData {
                    cell_id: content_uuid.to_string(),
                    row: 5,
                    col: 2,
                    value: CellValue::number(42.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // Ghost cell (comment target) at row 100, col 50
                CellData {
                    cell_id: ghost_uuid.to_string(),
                    row: 100,
                    col: 50,
                    value: CellValue::Null,
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
        );

        let mirror = CellMirror::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_uuid).unwrap();
        let sheet = mirror.sheets.get(&sheet_id).unwrap();

        // Content dimensions should NOT be inflated by the ghost cell
        assert_eq!(sheet.rows, 6, "Content rows should be 6 (row 5 + 1)");
        assert_eq!(sheet.cols, 3, "Content cols should be 3 (col 2 + 1)");

        // Formula dimensions preserve the declared workbook grid but do not
        // inherit identity-only ghost extent.
        assert_eq!(sheet.grid_rows, 100);
        assert_eq!(sheet.grid_cols, 26);
        assert_eq!(DataSource::sheet_rows(&mirror, &sheet_id), Some(100));
        assert_eq!(DataSource::sheet_cols(&mirror, &sheet_id), Some(26));

        // Identity dimensions should include the ghost cell
        assert_eq!(
            sheet.identity_rows, 101,
            "Identity rows should be 101 (row 100 + 1)"
        );
        assert_eq!(
            sheet.identity_cols, 51,
            "Identity cols should be 51 (col 50 + 1)"
        );

        // Ghost cell should have identity (findable by position)
        let ghost_id = CellId::from_uuid_str(ghost_uuid).unwrap();
        let ghost_pos = SheetPos::new(100, 50);
        assert_eq!(sheet.cell_id_at(ghost_pos), Some(ghost_id));
        assert_eq!(sheet.position_of(&ghost_id), Some(ghost_pos));

        // Ghost cell should be in cells map
        assert!(sheet.get_cell(&ghost_id).is_some());

        // Content cell should also work
        let content_id = CellId::from_uuid_str(content_uuid).unwrap();
        assert_eq!(sheet.cell_id_at(SheetPos::new(5, 2)), Some(content_id));

        // Range materialization pads only the eval-time array out to the
        // formula grid; it does not pad SheetMirror::col_data storage.
        let range = RangeKey::new(sheet_id, 0, 2, 99, 2);
        let values = materialize_range(&range, &mirror, None);
        assert_eq!(values.rows(), 100);
        assert_eq!(values.get(5, 0), Some(&CellValue::number(42.0)));
        assert_eq!(values.get(99, 0), Some(&CellValue::Null));
        assert_eq!(sheet.get_column_slice(2).map(|col| col.len()), Some(6));
    }
}
