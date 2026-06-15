use bridge_core as bridge;

use super::{YrsComputeEngine, format_inference::is_formula_parse_input, mutation, services};
use crate::snapshot::MutationResult;
use cell_types::{CellId, SheetId};
use value_types::{CellValue, ComputeError};

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "core_cells",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Cell editing
    // -------------------------------------------------------------------

    /// User edits a cell. Writes to yrs Doc with ORIGIN_USER_EDIT,
    /// updates the mirror, and triggers recalculation.
    #[bridge::write(scope = "cell")]
    pub fn set_cell(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: mutation::CellInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let should_apply_formula_format = is_formula_parse_input(&input);
        let (mut recalc, format_result) =
            self.with_undo_group_if(should_apply_formula_format, |engine| {
                let recalc = services::cell_editing::set_cell(
                    &mut engine.stores,
                    &mut engine.mirror,
                    &mut engine.mutation,
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
                Ok((recalc, format_result))
            })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.set_cell(sheet_id, cell_id, row, col, input)
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (mut recalc, format_result) = self.with_undo_group_if(true, |engine| {
            let recalc = services::cell_editing::set_array_formula(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                sheet_id,
                top_row,
                left_col,
                bottom_row,
                right_col,
                &formula,
            )?;
            let format_result =
                engine.apply_formula_inherited_number_formats(&[(*sheet_id, top_row, left_col)])?;
            Ok((recalc, format_result))
        })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let should_apply_formula_format = raw_input.trim().starts_with('=');
        let (mut recalc, format_result) =
            self.with_undo_group_if(should_apply_formula_format, |engine| {
                let recalc = services::cell_editing::set_cell_value_parsed(
                    &mut engine.stores,
                    &mut engine.mirror,
                    &mut engine.mutation,
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
                Ok((recalc, format_result))
            })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
    }

    /// Set a cell value as literal text, bypassing all type coercion.
    #[bridge::write(scope = "cell")]
    pub fn set_cell_value_as_text(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        value: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut recalc = services::cell_editing::set_cell_value_as_text(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            row,
            col,
            value,
        )?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }

    /// Batch-set cell values using rich input parsing.
    #[bridge::write(scope = "sheet")]
    pub fn set_cell_values_parsed(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, String)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let formula_format_candidates: Vec<(SheetId, u32, u32)> = updates
            .iter()
            .filter_map(|(row, col, raw_input)| {
                let input = mutation::CellInput::Parse {
                    text: raw_input.clone(),
                };
                is_formula_parse_input(&input).then_some((*sheet_id, *row, *col))
            })
            .collect();
        let group_undo = !updates.is_empty();
        let (mut recalc, format_result) = self.with_undo_group_if(group_undo, |engine| {
            let recalc = services::cell_editing::set_cell_values_parsed(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                sheet_id,
                &updates,
            )?;
            let format_result =
                engine.apply_formula_inherited_number_formats(&formula_format_candidates)?;
            Ok((recalc, format_result))
        })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        let mut result = MutationResult::from_recalc(recalc);
        result
            .property_changes
            .extend(format_result.property_changes);
        Ok((patches, result))
    }

    /// Import pre-parsed cell values in bulk.
    #[bridge::write(scope = "sheet")]
    pub fn import_values(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellValue, Option<String>)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let group_undo = !updates.is_empty();
        let mut recalc = self.with_undo_group_if(group_undo, |engine| {
            services::cell_editing::import_values(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                sheet_id,
                &updates,
            )
        })?;
        self.prepare_recalc_for_flush(&mut recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, MutationResult::from_recalc(recalc)))
    }
}
