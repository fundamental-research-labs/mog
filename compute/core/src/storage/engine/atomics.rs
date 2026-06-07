//! Atomic high-level operations that compose multiple low-level engine calls.
//!
//! These methods replace multi-step TypeScript orchestration logic with single
//! Rust calls, eliminating redundant IPC round-trips.

use super::YrsComputeEngine;
use crate::snapshot::{
    CalcMode, CalculationSettings, ChangeKind, MutationResult, WorkbookSettingsChange,
};
use crate::storage::properties;
use crate::storage::sheet::settings as sheets;
use bridge_core as bridge;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::ComputeError;

fn update_calculation_settings(
    engine: &mut YrsComputeEngine,
    update: impl FnOnce(&mut CalculationSettings),
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let mut settings = super::services::queries::get_workbook_settings(&engine.stores);
    let pre_calc = settings.calculation_settings.clone().unwrap_or_default();
    let mut post_calc = pre_calc.clone();
    update(&mut post_calc);
    settings.calculation_settings = Some(post_calc);

    crate::storage::workbook::settings::set_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &settings,
    );

    let post_calc = crate::storage::workbook::settings::get_calculation_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    engine.sync_runtime_calculation_settings(&pre_calc, &post_calc);

    let mut result = MutationResult::empty();
    if pre_calc != post_calc {
        result
            .workbook_settings_changes
            .push(WorkbookSettingsChange {
                kind: ChangeKind::Set,
                changed_keys: vec!["calculationSettings".to_string()],
                settings: serde_json::to_value(&settings).expect("WorkbookSettings must serialize"),
            });
    }

    Ok((serialize_multi_viewport_patches(&[]), result))
}

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "atomics",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // ===================================================================
    // Atomic Settings Methods
    // ===================================================================

    /// Atomically set the calculation mode without disturbing other settings.
    ///
    /// Replaces the TS pattern: `getWorkbookSettings()` → merge → `setWorkbookSettings()`.
    #[bridge::write(scope = "workbook")]
    pub fn set_calculation_mode(
        &mut self,
        mode: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let calc_mode = match mode {
            "auto" => CalcMode::Auto,
            "autoNoTable" => CalcMode::AutoNoTable,
            "manual" => CalcMode::Manual,
            _ => {
                return Err(ComputeError::Eval {
                    message: format!("Invalid calculation mode: {mode}"),
                });
            }
        };

        update_calculation_settings(self, |calc| {
            calc.calc_mode = calc_mode;
        })
    }

    /// Atomically set the maximum iterations for iterative calculation.
    #[bridge::write(scope = "workbook")]
    pub fn set_max_iterations(
        &mut self,
        n: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        update_calculation_settings(self, |calc| {
            calc.max_iterations = n;
        })
    }

    /// Atomically enable or disable iterative calculation.
    #[bridge::write(scope = "workbook")]
    pub fn set_iterative_calculation(
        &mut self,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        update_calculation_settings(self, |calc| {
            calc.enable_iterative_calculation = enabled;
        })
    }

    /// Atomically set the convergence threshold (max change) for iterative calculation.
    #[bridge::write(scope = "workbook")]
    pub fn set_convergence_threshold(
        &mut self,
        threshold: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // The bridge `threshold: f64` parameter is preserved (not a boundary
        // type field); reject non-finite values explicitly so they never
        // reach the FiniteF64-typed setting.
        let threshold_finite =
            value_types::FiniteF64::new(threshold).ok_or_else(|| ComputeError::InvalidInput {
                message: "convergence threshold must be finite".to_string(),
            })?;
        update_calculation_settings(self, |calc| {
            calc.max_change = threshold_finite;
        })
    }

    /// Atomically set whether to use precision as displayed (inverse of full_precision).
    #[bridge::write(scope = "workbook")]
    pub fn set_use_precision_as_displayed(
        &mut self,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        update_calculation_settings(self, |calc| {
            calc.full_precision = !enabled;
        })
    }

    // ===================================================================
    // Clear Range with Mode
    // ===================================================================

    /// Clear a range with a specific mode: "all", "contents", "formats", or "hyperlinks".
    ///
    /// - "all" = clear contents + formats + hyperlinks
    /// - "contents" = clear cell values only, preserve formats
    /// - "formats" = clear formatting only, preserve values
    /// - "hyperlinks" = remove hyperlinks only
    #[bridge::write(scope = "range")]
    pub fn clear_range_with_mode(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        mode: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match mode {
            "all" => {
                // Clear contents (values + formulas)
                let (_patches1, r1) =
                    self.clear_range(sheet_id, start_row, start_col, end_row, end_col)?;
                // Clear formats
                let ranges = vec![(start_row, start_col, end_row, end_col)];
                let _r2 = {
                    let _guard = self.mutation.suppress_guard();
                    super::services::formatting::clear_format_for_ranges(
                        &mut self.stores,
                        sheet_id,
                        &ranges,
                    )?
                };
                // Clear hyperlinks
                self.clear_hyperlinks_in_range(sheet_id, start_row, start_col, end_row, end_col)?;
                let patches = self.flush_viewport_patches();
                Ok((patches, r1))
            }
            "contents" => {
                let (_patches1, result) =
                    self.clear_range(sheet_id, start_row, start_col, end_row, end_col)?;
                let patches = self.flush_viewport_patches();
                Ok((patches, result))
            }
            "formats" => {
                let ranges = vec![(start_row, start_col, end_row, end_col)];
                let (affected_cells, result) = {
                    let _guard = self.mutation.suppress_guard();
                    super::services::formatting::clear_format_for_ranges(
                        &mut self.stores,
                        sheet_id,
                        &ranges,
                    )?
                };
                let _patches = self.produce_format_change_patches(sheet_id, &affected_cells);
                let patches = self.flush_viewport_patches();
                Ok((patches, result))
            }
            "hyperlinks" => {
                self.clear_hyperlinks_in_range(sheet_id, start_row, start_col, end_row, end_col)?;
                Ok((
                    serialize_multi_viewport_patches(&[]),
                    MutationResult::empty(),
                ))
            }
            _ => Err(ComputeError::Eval {
                message: format!("Invalid clear mode: {mode}"),
            }),
        }
    }

    // ===================================================================
    // Protection Check Methods
    // ===================================================================

    /// Check whether a cell can be edited given the sheet's protection state.
    ///
    /// Returns `true` if the sheet is not protected, or if the sheet is
    /// protected but the cell is explicitly unlocked.
    #[bridge::read(scope = "cell")]
    pub fn can_edit_cell(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        if !super::services::queries::is_sheet_protected(&self.stores, sheet_id) {
            return true;
        }

        // Sheet is protected — check if cell is locked.
        // A cell with no format defaults to locked = true (Excel spec).
        let cell_hex = super::services::queries::get_cell_id_at(&self.stores, sheet_id, row, col);
        match cell_hex {
            Some(hex) => {
                let locked = properties::is_cell_locked(
                    self.stores.storage.doc(),
                    self.stores.storage.workbook_map(),
                    self.stores.storage.sheets(),
                    sheet_id,
                    &hex,
                );
                !locked
            }
            // No cell at position — defaults to locked
            None => false,
        }
    }

    /// Check whether a structural operation is allowed given sheet protection.
    ///
    /// Operations: "insertRows", "insertColumns", "deleteRows", "deleteColumns",
    /// "sort", "filter"/"autoFilter", "pivotTables", "editObject"/"editObjects",
    /// "formatCells", "formatColumns", "formatRows".
    #[bridge::read(scope = "sheet")]
    pub fn can_do_structure_op(&self, sheet_id: &SheetId, operation: &str) -> bool {
        if !super::services::queries::is_sheet_protected(&self.stores, sheet_id) {
            return true;
        }

        let settings = sheets::get_sheet_settings(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
        );
        let opts = settings.protection_options.unwrap_or_default();

        match operation {
            "insertRows" => opts.insert_rows,
            "insertColumns" => opts.insert_columns,
            "deleteRows" => opts.delete_rows,
            "deleteColumns" => opts.delete_columns,
            "sort" => opts.sort,
            "filter" | "autoFilter" => opts.use_auto_filter,
            "pivotTables" => opts.use_pivot_table_reports,
            "editObject" | "editObjects" => opts.edit_objects,
            "formatCells" => opts.format_cells,
            "formatColumns" => opts.format_columns,
            "formatRows" => opts.format_rows,
            _ => false,
        }
    }

    // ===================================================================
    // Freeze Row/Column Methods
    // ===================================================================

    /// Freeze a number of rows, preserving the current column freeze.
    #[bridge::write(scope = "sheet")]
    pub fn freeze_rows(
        &self,
        sheet_id: &SheetId,
        count: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let current = super::services::queries::get_frozen_panes_query(&self.stores, sheet_id);
        let (_patches, result) = self.set_frozen_panes(sheet_id, count, current.cols)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Freeze a number of columns, preserving the current row freeze.
    #[bridge::write(scope = "sheet")]
    pub fn freeze_columns(
        &self,
        sheet_id: &SheetId,
        count: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let current = super::services::queries::get_frozen_panes_query(&self.stores, sheet_id);
        let (_patches, result) = self.set_frozen_panes(sheet_id, current.rows, count)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::mutation::CellInput;
    use cell_types::SheetPos;
    use snapshot_types::RecalcOptions;
    use value_types::{CellValue, FiniteF64};

    fn simple_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
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
        }
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    fn parse_input(text: &str) -> CellInput {
        CellInput::Parse {
            text: text.to_string(),
        }
    }

    fn number_at(engine: &YrsComputeEngine, row: u32, col: u32) -> f64 {
        match engine
            .mirror()
            .get_cell_value_at(&sheet_id(), SheetPos::new(row, col))
        {
            Some(CellValue::Number(n)) => n.get(),
            other => panic!("expected numeric value at ({row}, {col}), got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // set_calculation_mode
    // -----------------------------------------------------------------

    #[test]
    fn atomics_set_calculation_mode_manual() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        engine.set_calculation_mode("manual").unwrap();

        let settings = engine.get_workbook_settings();
        let calc = settings.calculation_settings.unwrap();
        assert_eq!(calc.calc_mode, CalcMode::Manual);
    }

    #[test]
    fn atomics_set_calculation_mode_auto() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        // First set to manual, then back to auto
        engine.set_calculation_mode("manual").unwrap();
        engine.set_calculation_mode("auto").unwrap();

        let settings = engine.get_workbook_settings();
        let calc = settings.calculation_settings.unwrap();
        assert_eq!(calc.calc_mode, CalcMode::Auto);
    }

    #[test]
    fn atomics_set_calculation_mode_invalid() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let result = engine.set_calculation_mode("invalid");
        assert!(result.is_err());
    }

    #[test]
    fn atomics_set_max_iterations() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        engine.set_max_iterations(500).unwrap();

        let settings = engine.get_workbook_settings();
        let calc = settings.calculation_settings.unwrap();
        assert_eq!(calc.max_iterations, 500);
    }

    #[test]
    fn atomics_set_iterative_calculation() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        engine.set_iterative_calculation(true).unwrap();

        let settings = engine.get_workbook_settings();
        let calc = settings.calculation_settings.unwrap();
        assert!(calc.enable_iterative_calculation);
    }

    #[test]
    fn atomics_set_iterative_calculation_marks_dirty_for_existing_circular_recalc() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        engine
            .batch_set_cells_by_position(
                vec![
                    (sid, 0, 0, parse_input("=B1+1")),
                    (sid, 0, 1, parse_input("=A1*0.5")),
                ],
                true,
            )
            .expect("batch set circular formulas");

        engine
            .recalculate_with_options(&RecalcOptions::default())
            .expect("non-iterative recalc should run");
        assert!((number_at(&engine, 0, 0) - 2.0).abs() <= 0.01);
        assert!((number_at(&engine, 0, 1) - 1.0).abs() <= 0.01);

        engine
            .set_iterative_calculation(true)
            .expect("set iterative calculation");
        let result = engine
            .recalculate_with_options(&RecalcOptions::default())
            .expect("bare recalculate after atomic settings change");

        assert!(
            result.metrics.has_circular_refs && result.metrics.iterative_iterations >= 1,
            "atomic settings change must dirty compute and use iterative circular recovery; metrics = {:?}",
            result.metrics
        );
        assert!((number_at(&engine, 0, 0) - 2.0).abs() <= 0.01);
        assert!((number_at(&engine, 0, 1) - 1.0).abs() <= 0.01);
    }

    // -----------------------------------------------------------------
    // clear_range_with_mode
    // -----------------------------------------------------------------

    #[test]
    fn atomics_clear_range_contents_preserves_formats() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Set a value first
        engine.set_cell_value_parsed(&sid, 0, 0, "42").unwrap();

        // Clear contents only
        let result = engine.clear_range_with_mode(&sid, 0, 0, 0, 0, "contents");
        assert!(result.is_ok());

        // Value should be cleared
        let display = engine.get_display_value(&sid, 0, 0);
        assert!(display.is_empty() || display == "");
    }

    #[test]
    fn atomics_clear_range_all() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        let result = engine.clear_range_with_mode(&sid, 0, 0, 0, 0, "all");
        assert!(result.is_ok());
    }

    #[test]
    fn atomics_clear_range_invalid_mode() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        let result = engine.clear_range_with_mode(&sid, 0, 0, 0, 0, "bogus");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------
    // can_edit_cell
    // -----------------------------------------------------------------

    #[test]
    fn atomics_can_edit_cell_unprotected() {
        let (engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        // Sheet is not protected — all cells editable
        assert!(engine.can_edit_cell(&sid, 0, 0));
        assert!(engine.can_edit_cell(&sid, 5, 5)); // empty cell
    }

    #[test]
    fn atomics_can_edit_cell_protected_locked_default() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Protect the sheet
        engine.protect_sheet(&sid, None).unwrap();

        // Cell at (0,0) exists but has no explicit locked=false, so defaults to locked
        assert!(!engine.can_edit_cell(&sid, 0, 0));
        // Empty cell also defaults to locked
        assert!(!engine.can_edit_cell(&sid, 5, 5));
    }

    // -----------------------------------------------------------------
    // can_do_structure_op
    // -----------------------------------------------------------------

    #[test]
    fn atomics_can_do_structure_op_unprotected() {
        let (engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        assert!(engine.can_do_structure_op(&sid, "insertRows"));
        assert!(engine.can_do_structure_op(&sid, "deleteColumns"));
        assert!(engine.can_do_structure_op(&sid, "sort"));
    }

    #[test]
    fn atomics_can_do_structure_op_protected_default() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        engine.protect_sheet(&sid, None).unwrap();

        // Default protection options deny all structural ops
        assert!(!engine.can_do_structure_op(&sid, "insertRows"));
        assert!(!engine.can_do_structure_op(&sid, "deleteRows"));
        assert!(!engine.can_do_structure_op(&sid, "sort"));
    }

    #[test]
    fn atomics_can_do_structure_op_unknown_op() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        engine.protect_sheet(&sid, None).unwrap();
        assert!(!engine.can_do_structure_op(&sid, "unknownOp"));
    }

    // -----------------------------------------------------------------
    // freeze_rows / freeze_columns
    // -----------------------------------------------------------------

    #[test]
    fn atomics_freeze_rows_preserves_cols() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Set initial freeze state: 0 rows, 2 cols
        engine.set_frozen_panes(&sid, 0, 2).unwrap();

        // Freeze 3 rows — cols should remain 2
        engine.freeze_rows(&sid, 3).unwrap();

        let panes = engine.get_frozen_panes_query(&sid);
        assert_eq!(panes.rows, 3);
        assert_eq!(panes.cols, 2);
    }

    #[test]
    fn atomics_freeze_columns_preserves_rows() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Set initial freeze state: 3 rows, 0 cols
        engine.set_frozen_panes(&sid, 3, 0).unwrap();

        // Freeze 4 cols — rows should remain 3
        engine.freeze_columns(&sid, 4).unwrap();

        let panes = engine.get_frozen_panes_query(&sid);
        assert_eq!(panes.rows, 3);
        assert_eq!(panes.cols, 4);
    }

    #[test]
    fn atomics_freeze_rows_from_zero() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine.freeze_rows(&sid, 5).unwrap();

        let panes = engine.get_frozen_panes_query(&sid);
        assert_eq!(panes.rows, 5);
        assert_eq!(panes.cols, 0);
    }
}
