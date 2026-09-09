use bridge_core as bridge;

use super::{ComputeEngine, format_inference::is_formula_parse_input, mutation, services};
use crate::snapshot::MutationResult;
use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "core_cells",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    // -------------------------------------------------------------------
    // Cell editing
    // -------------------------------------------------------------------

    /// Apply a cell edit through the native mutation pipeline,
    /// updates the cell store, and triggers recalculation.
    #[bridge::write(scope = "cell")]
    pub fn set_cell(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: mutation::CellInput,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let should_apply_formula_format = is_formula_parse_input(&input);
            let (mut recalc, format_result) = {
                let recalc = services::cell_editing::set_cell(
                    &mut engine.stores,
                    &mut engine.cell_store,
                    sheet_id,
                    cell_id,
                    row,
                    col,
                    &input,
                )?;
                let format_result = if should_apply_formula_format {
                    engine.apply_formula_inherited_number_formats(&[(*sheet_id, row, col)])?
                } else {
                    MutationResult::empty()
                };
                (recalc, format_result)
            };
            engine.postprocess_mutation_recalc(&mut recalc);

            let mut result = MutationResult::from_recalc(recalc);
            result
                .property_changes
                .extend(format_result.property_changes);
            Ok(result)
        })
    }

    /// Binary variant of [`set_cell`].
    #[bridge::write(scope = "cell")]
    #[bridge::skip(napi)]
    pub fn set_cell_binary(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: mutation::CellInput,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| engine.set_cell(sheet_id, cell_id, row, col, input))
    }

    /// Enter a CSE (`Ctrl+Shift+Enter`) array formula on the given
    /// rectangular range. The formula is stored only on the top-left
    /// anchor; covered cells are projections of the array result and
    /// are read-only. Editing any covered cell via [`set_cell`]
    /// returns [`ComputeError::PartialArrayWrite`].
    ///
    /// Replaces the TS-side `arrayFormulaCells` registry — the CSE
    /// state is now authoritative in compute-core, surfaced via the
    /// `is_cse_anchor` / `is_array_formula` metadata fields on
    /// [`crate::snapshot::ActiveCellData`].
    #[bridge::write(scope = "sheet")]
    pub fn set_array_formula(
        &mut self,
        sheet_id: &SheetId,
        top_row: u32,
        left_col: u32,
        bottom_row: u32,
        right_col: u32,
        formula: String,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let (mut recalc, format_result) = {
                let recalc = services::cell_editing::set_array_formula(
                    &mut engine.stores,
                    &mut engine.cell_store,
                    sheet_id,
                    top_row,
                    left_col,
                    bottom_row,
                    right_col,
                    &formula,
                )?;
                let format_result = engine
                    .apply_formula_inherited_number_formats(&[(*sheet_id, top_row, left_col)])?;
                (recalc, format_result)
            };
            engine.postprocess_mutation_recalc(&mut recalc);

            let mut result = MutationResult::from_recalc(recalc);
            result
                .property_changes
                .extend(format_result.property_changes);
            Ok(result)
        })
    }

    // -------------------------------------------------------------------
    // Rich cell value operations (wired from cell_values module)
    // -------------------------------------------------------------------

    /// Set a single cell value using rich input parsing.
    #[bridge::write(scope = "cell")]
    pub fn set_cell_value_parsed(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        raw_input: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let should_apply_formula_format = raw_input.trim().starts_with('=');
            let (mut recalc, format_result) = {
                let recalc = services::cell_editing::set_cell_value_parsed(
                    &mut engine.stores,
                    &mut engine.cell_store,
                    sheet_id,
                    row,
                    col,
                    raw_input,
                )?;
                let format_result = if should_apply_formula_format {
                    engine.apply_formula_inherited_number_formats(&[(*sheet_id, row, col)])?
                } else {
                    MutationResult::empty()
                };
                (recalc, format_result)
            };
            engine.postprocess_mutation_recalc(&mut recalc);

            let mut result = MutationResult::from_recalc(recalc);
            result
                .property_changes
                .extend(format_result.property_changes);
            Ok(result)
        })
    }

    /// Set a cell value as literal text, bypassing all type coercion.
    #[bridge::write(scope = "cell")]
    pub fn set_cell_value_as_text(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        value: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut recalc = services::cell_editing::set_cell_value_as_text(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                row,
                col,
                value,
            )?;
            engine.postprocess_mutation_recalc(&mut recalc);

            Ok(MutationResult::from_recalc(recalc))
        })
    }

    /// Batch-set cell values using rich input parsing.
    #[bridge::write(scope = "sheet")]
    pub fn set_cell_values_parsed(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, String)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let formula_format_candidates: Vec<(SheetId, u32, u32)> = updates
                .iter()
                .filter_map(|(row, col, raw_input)| {
                    let input = mutation::CellInput::Parse {
                        text: raw_input.clone(),
                    };
                    is_formula_parse_input(&input).then_some((*sheet_id, *row, *col))
                })
                .collect();

            let (mut recalc, format_result) = {
                let recalc = services::cell_editing::set_cell_values_parsed(
                    &mut engine.stores,
                    &mut engine.cell_store,
                    sheet_id,
                    &updates,
                )?;
                let format_result =
                    engine.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                (recalc, format_result)
            };
            engine.postprocess_mutation_recalc(&mut recalc);

            let mut result = MutationResult::from_recalc(recalc);
            result
                .property_changes
                .extend(format_result.property_changes);
            Ok(result)
        })
    }

    /// Import pre-parsed cell values in bulk.
    #[bridge::write(scope = "sheet")]
    pub fn import_values(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellValue, Option<String>)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut recalc = services::cell_editing::import_values(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                &updates,
            )?;
            engine.postprocess_mutation_recalc(&mut recalc);

            Ok(MutationResult::from_recalc(recalc))
        })
    }
}
