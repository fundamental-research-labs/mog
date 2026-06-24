//! High-level cell semantics methods for YrsComputeEngine.
//!
//! These methods consolidate what TypeScript currently does across multiple IPC
//! calls into single Rust calls: typed cell values, 2D range reads, and combined
//! cell info queries. By living in the engine, all FFI targets (WASM, Tauri,
//! N-API) get them automatically.

use super::{YrsComputeEngine, services};
use crate::storage::cells::values as cell_values;
use crate::storage::properties;
use bridge_core as bridge;
use cell_types::{SheetId, SheetPos};
use compute_formats;
use domain_types::CellFormat;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// CellInfo — combined cell metadata returned by get_cell_info
// ---------------------------------------------------------------------------

/// Structured cell information combining value, formula, format, and display.
///
/// Replaces what TypeScript does in 3-4 separate IPC calls.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CellInfo {
    /// The semantic value (computed for formulas, raw otherwise).
    pub value: CellValue,
    /// The formula string (with leading '='), if this is a formula cell.
    pub formula: Option<String>,
    /// The effective cell format (merged from column → row → cell cascade).
    pub format: Option<CellFormat>,
    /// The formatted display string (what the user sees in the grid).
    pub formatted: String,
}

/// R4 redaction impl. Value and formula are payload; format is shape
/// (visible at Structure level). `formatted` is the display string —
/// we zero it on denial so the UI shows the placeholder, not the raw
/// formatted value.
impl compute_security::RedactMaybe for CellInfo {
    fn redact(&mut self, level: compute_security::AccessLevel) {
        self.value.redact(level);
        self.formula.redact(level);
        // `formatted` is a String; at Structure level it gets the
        // text placeholder, which matches the user-visible ARCHITECTURE
        // §7 contract (Structure = type placeholder, None = blank).
        self.formatted.redact(level);
    }
}

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "cell_semantics",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Get the semantic value of a cell.
    ///
    /// For formula cells, returns the computed value from the mirror.
    /// For value cells, returns the raw value.
    /// For empty cells, returns `CellValue::Null`.
    ///
    /// Uses the CellMirror as the authority (it is always populated, unlike
    /// the Yrs grid index which is only written for interactive edits).
    #[bridge::read(scope = "cell")]
    pub fn get_cell_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
        match cell_values::get_effective_value(&self.mirror, sheet_id, row, col) {
            Some(v) => v,
            None => CellValue::Null,
        }
    }

    /// Get values for a rectangular range as a 2D array (row-major).
    ///
    /// Iterates the full rectangular bounds — empty cells appear as `CellValue::Null`.
    /// This consolidates the TS `queryRange()` + reshape pattern into a single call.
    #[bridge::read(scope = "range")]
    pub fn get_range_values_2d(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<Vec<CellValue>> {
        let num_rows = (end_row.saturating_sub(start_row) + 1) as usize;
        let num_cols = (end_col.saturating_sub(start_col) + 1) as usize;
        let mut result = Vec::with_capacity(num_rows);

        for r in start_row..=end_row {
            let mut row_values = Vec::with_capacity(num_cols);
            for c in start_col..=end_col {
                row_values.push(self.get_cell_value(sheet_id, r, c));
            }
            result.push(row_values);
        }

        result
    }

    /// Get structured cell information: value, formula, format, and display string.
    ///
    /// Combines what TypeScript does in 3-4 separate IPC calls into one.
    /// Returns `None` only if the cell is completely empty (no value, no formula).
    #[bridge::read(scope = "cell")]
    pub fn get_cell_info(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<CellInfo> {
        let value = self.get_cell_value(sheet_id, row, col);

        // Get formula: prefer ComputeCore's formula strings, then identity
        // formulas, then formula-owning region anchors such as CSE arrays.
        let formula = {
            let cell_id = self
                .mirror
                .resolve_cell_id(sheet_id, SheetPos::new(row, col));
            if let Some(formula) = super::formula_read::formula_text_at(
                &self.stores,
                &self.mirror,
                sheet_id,
                row,
                col,
                cell_id.as_ref(),
            ) {
                Some(formula)
            } else if let Some(grid_index) = self.stores.grid_indexes.get(sheet_id) {
                let raw = cell_values::get_raw_value(
                    &self.mirror,
                    self.stores.storage.doc(),
                    self.stores.storage.sheets(),
                    sheet_id,
                    row,
                    col,
                    grid_index,
                );
                if raw.starts_with('=') {
                    Some(raw)
                } else {
                    None
                }
            } else {
                None
            }
        };

        // Get effective format
        let cell_id_hex = self.format_lookup_cell_id_hex(sheet_id, row, col);
        let table_fmt =
            services::resolve_structured_format_at_cell(&self.mirror, sheet_id, row, col);
        let effective = properties::get_effective_format(
            &self.stores.storage,
            sheet_id,
            &cell_id_hex,
            row,
            col,
            table_fmt.as_ref(),
            self.stores.grid_indexes.get(sheet_id),
            self.mirror.get_sheet(sheet_id),
        );

        // Get formatted display string
        let formatted = if value.is_null() {
            String::new()
        } else {
            self.format_value_at_cell(&value, sheet_id, row, col)
        };

        // Return None only for truly empty cells (no value, no formula)
        if value.is_null() && formula.is_none() {
            return None;
        }

        Some(CellInfo {
            value,
            formula,
            format: Some(effective),
            formatted,
        })
    }

    // -------------------------------------------------------------------
    // Raw cell data + editing value
    // -------------------------------------------------------------------

    /// Get the raw internal cell data including formula string, raw value, and computed value.
    ///
    /// Unlike viewport queries which normalize values, this returns all internal
    /// fields so callers can distinguish formula cells from value cells.
    #[bridge::read(scope = "cell")]
    pub fn get_raw_cell_data(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        include_formula: bool,
    ) -> Option<crate::snapshot::RawCellData> {
        let pos = SheetPos::new(row, col);

        let cell_id = self.mirror.resolve_cell_id(sheet_id, pos);

        let formula = if include_formula {
            super::formula_read::formula_text_at(
                &self.stores,
                &self.mirror,
                sheet_id,
                row,
                col,
                cell_id.as_ref(),
            )
        } else {
            None
        };

        let mirror_value = self.mirror.get_cell_value_at(sheet_id, pos).cloned();

        if mirror_value.is_none() && formula.is_none() {
            return None;
        }

        let (raw, computed) = if formula.is_some() {
            (Some(CellValue::Null), mirror_value)
        } else {
            (mirror_value, None)
        };

        Some(crate::snapshot::RawCellData {
            raw,
            formula,
            computed,
        })
    }

    /// Get the value a user would see in the formula bar for editing.
    ///
    /// If the cell has a formula, returns the formula string with "=" prefix.
    /// Otherwise returns the raw value as a string.
    #[bridge::read(scope = "cell")]
    pub fn get_value_for_editing(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        super::services::queries::get_raw_value(&self.mirror, &self.stores, sheet_id, row, col)
    }

    // -------------------------------------------------------------------
    // 2D range queries: display text, value types, format categories
    // -------------------------------------------------------------------

    /// Get formatted display text for a range as a 2D array.
    #[bridge::read(scope = "range")]
    pub fn get_display_text_2d(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<Vec<String>> {
        let num_rows = (end_row - start_row + 1) as usize;
        let num_cols = (end_col - start_col + 1) as usize;
        let mut result: Vec<Vec<String>> = (0..num_rows)
            .map(|_| vec![String::new(); num_cols])
            .collect();

        super::services::queries::for_each_cell_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            true,
            &mut |visit| {
                let r = (visit.row - start_row) as usize;
                let c = (visit.col - start_col) as usize;
                if !visit.formatted.is_empty() {
                    result[r][c] = visit.formatted;
                } else {
                    let s = visit.value.to_string();
                    if !s.is_empty() {
                        result[r][c] = s;
                    }
                }
            },
        );

        result
    }

    /// Get per-cell value type classification for a range as a 2D array.
    ///
    /// Each element is one of: "Empty", "String", "Double", "Boolean", "Error".
    #[bridge::read(scope = "range")]
    pub fn get_value_types_2d(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<Vec<String>> {
        let num_rows = (end_row - start_row + 1) as usize;
        let num_cols = (end_col - start_col + 1) as usize;
        let empty = "Empty".to_string();
        let mut result: Vec<Vec<String>> = (0..num_rows)
            .map(|_| vec![empty.clone(); num_cols])
            .collect();

        super::services::queries::for_each_cell_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            false,
            &mut |visit| {
                let r = (visit.row - start_row) as usize;
                let c = (visit.col - start_col) as usize;
                result[r][c] = classify_cell_value_type(&visit.value).to_string();
            },
        );

        result
    }

    /// Get per-cell number format category for a range as a 2D array.
    ///
    /// Each element matches the TS `NumberFormatCategory` enum.
    #[bridge::read(scope = "range")]
    pub fn get_format_categories_2d(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<Vec<String>> {
        let num_rows = (end_row - start_row + 1) as usize;
        let num_cols = (end_col - start_col + 1) as usize;
        let general = "General".to_string();
        let mut result: Vec<Vec<String>> = (0..num_rows)
            .map(|_| vec![general.clone(); num_cols])
            .collect();

        super::services::queries::for_each_cell_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            true,
            &mut |visit| {
                let r = (visit.row - start_row) as usize;
                let c = (visit.col - start_col) as usize;
                let format_code = visit
                    .effective_format
                    .number_format
                    .as_deref()
                    .unwrap_or("General");
                let ft = compute_formats::detect_format_type(format_code);
                result[r][c] = format!("{ft:?}");
            },
        );

        result
    }
}

// ---------------------------------------------------------------------------
// Value type classification helper
// ---------------------------------------------------------------------------

fn classify_cell_value_type(value: &CellValue) -> &'static str {
    match value {
        CellValue::Null => "Empty",
        CellValue::Text(s) if s.is_empty() => "Empty",
        CellValue::Text(s) if s.starts_with('#') => "Error",
        CellValue::Text(_) => "String",
        CellValue::Number(_) => "Double",
        CellValue::Boolean(_) => "Boolean",
        CellValue::Error(..) => "Error",
        CellValue::Array(_) => "String",
        CellValue::Control(_) => "Boolean",
        CellValue::Image(_) => "String",
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::YrsComputeEngine;
    use cell_types::SheetId;
    use value_types::{CellError, CellValue, FiniteF64};

    fn blank_snapshot() -> WorkbookSnapshot {
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
                        value: CellValue::Number(FiniteF64::must(10.0)),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                        row: 0,
                        col: 1,
                        value: CellValue::Text("hello".into()),
                        formula: None,
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

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    // ---------------------------------------------------------------
    // get_cell_value
    // ---------------------------------------------------------------

    #[test]
    fn test_get_cell_value_number() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        let val = engine.get_cell_value(&sid, 0, 0);
        assert_eq!(val, CellValue::Number(FiniteF64::must(10.0)));
    }

    #[test]
    fn test_get_cell_value_text() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        let val = engine.get_cell_value(&sid, 0, 1);
        assert_eq!(val, CellValue::Text("hello".into()));
    }

    #[test]
    fn test_get_cell_value_formula_returns_computed() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        // Set formula via interactive edit (populates Yrs grid index)
        engine.set_cell_value_parsed(&sid, 1, 0, "=A1+10").unwrap();
        let val = engine.get_cell_value(&sid, 1, 0);
        assert_eq!(val, CellValue::Number(FiniteF64::must(20.0)));
    }

    #[test]
    fn test_get_cell_value_empty() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        let val = engine.get_cell_value(&sid, 4, 2);
        assert!(val.is_null());
    }

    // ---------------------------------------------------------------
    // get_value_for_editing
    // ---------------------------------------------------------------

    #[test]
    fn test_get_value_for_editing_formula_returns_formula_source() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();

        engine.set_cell_value_parsed(&sid, 1, 0, "=A1+10").unwrap();

        assert_eq!(engine.get_value_for_editing(&sid, 1, 0), "=A1+10");
    }

    #[test]
    fn test_get_value_for_editing_scalar_values_return_raw_edit_text() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();

        engine.set_cell_value_parsed(&sid, 2, 0, "42.5").unwrap();
        engine.set_cell_value_parsed(&sid, 2, 1, "TRUE").unwrap();
        engine
            .set_cell_value_parsed(&sid, 2, 2, "plain text")
            .unwrap();

        assert_eq!(engine.get_value_for_editing(&sid, 2, 0), "42.5");
        assert_eq!(engine.get_value_for_editing(&sid, 2, 1), "TRUE");
        assert_eq!(engine.get_value_for_editing(&sid, 2, 2), "plain text");
    }

    #[test]
    fn test_get_value_for_editing_empty_cell_returns_empty_string() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();

        assert_eq!(engine.get_value_for_editing(&sid, 9, 9), "");
    }

    #[test]
    fn test_get_value_for_editing_error_cell_returns_excel_error_text() {
        let mut snap = blank_snapshot();
        snap.sheets[0].cells.push(CellData {
            cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
            row: 3,
            col: 0,
            value: CellValue::Error(CellError::Div0, None),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
        let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
        let sid = sheet_id();

        assert_eq!(engine.get_value_for_editing(&sid, 3, 0), "#DIV/0!");
    }

    #[test]
    fn test_get_value_for_editing_forced_text_strips_apostrophe_and_does_not_parse() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();

        engine.set_cell_value_as_text(&sid, 4, 0, "'00123").unwrap();
        engine
            .set_cell_value_as_text(&sid, 4, 1, "'=A1+10")
            .unwrap();

        assert_eq!(engine.get_value_for_editing(&sid, 4, 0), "00123");
        assert_eq!(engine.get_value_for_editing(&sid, 4, 1), "=A1+10");
    }

    #[test]
    fn test_get_value_for_editing_date_serial_preserves_current_raw_contract() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .set_cell_value_parsed(&sid, 5, 0, "3/15/2024")
            .unwrap();

        assert_eq!(engine.get_value_for_editing(&sid, 5, 0), "45366");
    }

    // ---------------------------------------------------------------
    // get_range_values_2d
    // ---------------------------------------------------------------

    #[test]
    fn test_get_range_values_2d() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        // Add a formula cell via interactive edit
        engine.set_cell_value_parsed(&sid, 1, 0, "=A1+10").unwrap();
        // A1:B2 — 2x2 grid
        let grid = engine.get_range_values_2d(&sid, 0, 0, 1, 1);
        assert_eq!(grid.len(), 2);
        assert_eq!(grid[0].len(), 2);

        // A1 = 10
        assert_eq!(grid[0][0], CellValue::Number(FiniteF64::must(10.0)));
        // B1 = "hello"
        assert_eq!(grid[0][1], CellValue::Text("hello".into()));
        // A2 = 20 (computed from =A1+10)
        assert_eq!(grid[1][0], CellValue::Number(FiniteF64::must(20.0)));
        // B2 = empty
        assert!(grid[1][1].is_null());
    }

    #[test]
    fn test_get_range_values_2d_with_gaps() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        // A1:C3 — 3x3 grid, most cells empty
        let grid = engine.get_range_values_2d(&sid, 0, 0, 2, 2);
        assert_eq!(grid.len(), 3);
        assert_eq!(grid[0].len(), 3);

        // Row 0: [10, "hello", empty]
        assert_eq!(grid[0][0], CellValue::Number(FiniteF64::must(10.0)));
        assert_eq!(grid[0][1], CellValue::Text("hello".into()));
        assert!(grid[0][2].is_null());

        // Row 1: all empty
        assert!(grid[1][0].is_null());
        assert!(grid[1][1].is_null());
        assert!(grid[1][2].is_null());

        // Row 2: all empty
        assert!(grid[2][0].is_null());
        assert!(grid[2][1].is_null());
        assert!(grid[2][2].is_null());
    }

    // ---------------------------------------------------------------
    // get_cell_info
    // ---------------------------------------------------------------

    #[test]
    fn test_get_cell_info_value_cell() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        let info = engine.get_cell_info(&sid, 0, 0);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.value, CellValue::Number(FiniteF64::must(10.0)));
        assert!(info.formula.is_none());
        assert!(info.format.is_some());
        assert_eq!(info.formatted, "10");
    }

    #[test]
    fn test_get_cell_info_formula_cell() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        // Set formula via interactive edit (populates Yrs grid index for formula detection)
        engine.set_cell_value_parsed(&sid, 1, 0, "=A1+10").unwrap();
        let info = engine.get_cell_info(&sid, 1, 0);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.value, CellValue::Number(FiniteF64::must(20.0)));
        assert_eq!(info.formula, Some("=A1+10".to_string()));
        assert!(info.format.is_some());
        assert_eq!(info.formatted, "20");
    }

    #[test]
    fn test_get_cell_info_empty_returns_none() {
        let (engine, _) = YrsComputeEngine::from_snapshot(blank_snapshot()).unwrap();
        let sid = sheet_id();
        let info = engine.get_cell_info(&sid, 9, 9);
        assert!(info.is_none());
    }
}
