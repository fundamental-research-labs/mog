//! Delegation methods (scenarios, bindings, batch ops, sheet management) for YrsComputeEngine.

mod batch_cells;
mod compute_sheets_named;
mod defined_names_print_cells;
mod scenarios_bindings;
mod sheet_lifecycle;
mod sheet_settings_print;
mod what_if_sync;

use super::YrsComputeEngine;
use crate::snapshot::{
    CellEdit, MutationResult, Scenario, ScenarioCreateInput, ScenarioUpdateInput, SheetSnapshot,
};
use crate::storage::sheet::bindings;
use crate::storage::workbook::named_ranges;
use bridge_core as bridge;
use cell_types::{CellId, SheetId};
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{
    PrintRange, PrintTitles, SheetProtectionOptions, SheetSettings, SplitViewConfig,
};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "delegations",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "workbook")]
    pub fn create_scenario(
        &self,
        input: ScenarioCreateInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::create_scenario(self, input)
    }

    #[bridge::write(scope = "workbook")]
    pub fn update_scenario(
        &self,
        scenario_id: &str,
        input: ScenarioUpdateInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::update_scenario(self, scenario_id, input)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_scenario(
        &self,
        scenario_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::remove_scenario(self, scenario_id)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_all_scenarios(&self) -> Vec<Scenario> {
        scenarios_bindings::get_all_scenarios(self)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_active_scenario_state(&self) -> Option<crate::snapshot::ScenarioActiveState> {
        scenarios_bindings::get_active_scenario_state(self)
    }

    #[bridge::write(scope = "workbook")]
    pub fn apply_scenario(
        &mut self,
        scenario_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::apply_scenario(self, scenario_id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn restore_scenario(
        &mut self,
        baseline_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::restore_scenario(self, baseline_id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_active_scenario(
        &self,
        scenario_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::set_active_scenario(self, scenario_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn create_binding(
        &self,
        sheet_id: &SheetId,
        binding: bindings::CreateBindingInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::create_binding(self, sheet_id, binding)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
        updates: bindings::UpdateBindingFields,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::update_binding(self, sheet_id, binding_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::remove_binding(self, sheet_id, binding_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_all_bindings(&self, sheet_id: &SheetId) -> Vec<bindings::SheetDataBinding> {
        scenarios_bindings::get_all_bindings(self, sheet_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_binding(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
    ) -> Option<bindings::SheetDataBinding> {
        scenarios_bindings::get_binding(self, sheet_id, binding_id)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_bindings_for_connection(
        &self,
        connection_id: &str,
    ) -> Vec<bindings::SheetDataBinding> {
        scenarios_bindings::get_bindings_for_connection(self, connection_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_refresh_metadata(
        &self,
        sheet_id: &SheetId,
        binding_id: &str,
        last_refresh: i64,
        last_row_count: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::update_refresh_metadata(
            self,
            sheet_id,
            binding_id,
            last_refresh,
            last_row_count,
        )
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_bindings_for_connection(
        &self,
        connection_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        scenarios_bindings::remove_bindings_for_connection(self, connection_id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn batch_set_cells(
        &mut self,
        edits: Vec<(SheetId, CellId, u32, u32, super::mutation::CellInput)>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::batch_set_cells(self, edits, skip_cycle_check)
    }

    #[bridge::write(scope = "workbook")]
    pub fn batch_clear_cells(
        &mut self,
        cell_ids: Vec<CellId>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::batch_clear_cells(self, cell_ids)
    }

    #[bridge::write(scope = "workbook")]
    pub fn batch_set_cells_by_position(
        &mut self,
        edits: Vec<(SheetId, u32, u32, super::mutation::CellInput)>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::batch_set_cells_by_position(self, edits, skip_cycle_check)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_cells_batch(
        &mut self,
        sheet_id: &SheetId,
        cells: Vec<crate::snapshot::BatchCellInput>,
    ) -> Result<crate::snapshot::SetCellsBatchResult, ComputeError> {
        batch_cells::set_cells_batch(self, sheet_id, cells)
    }

    #[bridge::write(scope = "cell")]
    pub fn set_date_value(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        year: i32,
        month: u32,
        day: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::set_date_value(self, sheet_id, row, col, year, month, day)
    }

    #[bridge::write(scope = "cell")]
    pub fn set_time_value(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        hours: u32,
        minutes: u32,
        seconds: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::set_time_value(self, sheet_id, row, col, hours, minutes, seconds)
    }

    #[bridge::write(scope = "range")]
    pub fn clear_range_by_position(
        &mut self,
        sheet_id: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::clear_range_by_position(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    #[bridge::write(scope = "workbook")]
    pub fn apply_changes(
        &mut self,
        changes: Vec<CellEdit>,
        skip_cycle_check: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        batch_cells::apply_changes(self, changes, skip_cycle_check)
    }

    #[bridge::write(scope = "workbook")]
    pub fn add_compute_sheet(
        &mut self,
        snapshot: SheetSnapshot,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        compute_sheets_named::add_compute_sheet(self, snapshot)
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_compute_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        compute_sheets_named::remove_compute_sheet(self, sheet_id)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn rename_compute_sheet(
        &mut self,
        sheet_id: &SheetId,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        compute_sheets_named::rename_compute_sheet(self, sheet_id, name)
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_named_range(
        &mut self,
        name: String,
        def: NamedRangeDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        compute_sheets_named::set_named_range(self, name, def)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_named_range(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        compute_sheets_named::remove_named_range(self, name)
    }

    #[bridge::read(scope = "sheet")]
    pub fn eval_cf(
        &self,
        sheet_id: &SheetId,
        rules: Vec<crate::cf::types::CFRuleWire>,
    ) -> Vec<crate::cf::types::CellCFResult> {
        compute_sheets_named::eval_cf(self, sheet_id, rules)
    }

    #[bridge::write(scope = "sheet")]
    pub fn to_identity_formula(
        &mut self,
        sheet_id: &SheetId,
        formula_a1: &str,
    ) -> Result<IdentityFormula, ComputeError> {
        compute_sheets_named::to_identity_formula(self, sheet_id, formula_a1)
    }

    #[bridge::read(scope = "sheet")]
    pub fn to_a1_display(&self, sheet_id: &SheetId, formula: &IdentityFormula) -> String {
        compute_sheets_named::to_a1_display(self, sheet_id, formula)
    }

    #[bridge::read(scope = "workbook")]
    pub fn to_a1_display_qualified(&self, sheet_id: &SheetId, formula: &IdentityFormula) -> String {
        compute_sheets_named::to_a1_display_qualified(self, sheet_id, formula)
    }

    #[bridge::read(scope = "workbook")]
    #[bridge::skip(tauri)]
    pub fn solve(&self, params: &crate::solver::SolverParams) -> crate::solver::SolverResult {
        what_if_sync::solve(self, params)
    }

    #[bridge::read(scope = "workbook")]
    pub fn goal_seek(
        &self,
        params: &crate::solver::GoalSeekParams,
    ) -> crate::solver::GoalSeekResult {
        what_if_sync::goal_seek(self, params)
    }

    #[bridge::read(scope = "workbook")]
    pub fn data_table(
        &self,
        params: &crate::data_table::DataTableParams,
    ) -> crate::data_table::DataTableResult {
        what_if_sync::data_table(self, params)
    }

    #[bridge::write(scope = "range")]
    pub fn create_data_table(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        input: &crate::data_table::CreateDataTableInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        what_if_sync::create_data_table(
            self, sheet_id, start_row, start_col, end_row, end_col, input,
        )
    }

    #[bridge::read(scope = "workbook")]
    pub fn sync_full_state(&self) -> Vec<u8> {
        what_if_sync::sync_full_state(self)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "workbook")]
    pub fn create_sheet(&mut self, name: &str) -> Result<(String, MutationResult), ComputeError> {
        sheet_lifecycle::create_sheet(self, name)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "workbook")]
    pub fn create_default_sheet(
        &mut self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        sheet_lifecycle::create_default_sheet(self, name)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn delete_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::delete_sheet(self, sheet_id)
    }

    #[bridge::structural(scope = "workbook")]
    pub fn reorder_sheets(
        &mut self,
        new_order: Vec<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::reorder_sheets(self, new_order)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::structural(scope = "sheet")]
    pub fn copy_sheet(
        &mut self,
        sheet_id: &SheetId,
        new_name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        sheet_lifecycle::copy_sheet(self, sheet_id, new_name)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_frozen_panes(
        &self,
        sheet_id: &SheetId,
        rows: u32,
        cols: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_frozen_panes(self, sheet_id, rows, cols)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_view_option(
        &self,
        sheet_id: &SheetId,
        key: &str,
        value: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_view_option(self, sheet_id, key, value)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_scroll_position(
        &self,
        sheet_id: &SheetId,
        top_row: u32,
        left_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_scroll_position(self, sheet_id, top_row, left_col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn move_sheet(
        &self,
        sheet_id: &SheetId,
        new_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::move_sheet(self, sheet_id, new_index)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_tab_color(
        &self,
        sheet_id: &SheetId,
        color: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_tab_color(self, sheet_id, color)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_hidden(
        &mut self,
        sheet_id: &SheetId,
        hidden: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_sheet_hidden(self, sheet_id, hidden)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_enable_calculation(
        &mut self,
        sheet_id: &SheetId,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_sheet_enable_calculation(self, sheet_id, enabled)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_visibility(
        &mut self,
        sheet_id: &SheetId,
        state: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_lifecycle::set_sheet_visibility(self, sheet_id, state)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_visibility(&self, sheet_id: &SheetId) -> Result<String, ComputeError> {
        sheet_lifecycle::get_sheet_visibility(self, sheet_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_settings(&self, sheet_id: &SheetId) -> SheetSettings {
        sheet_settings_print::get_sheet_settings(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_setting(
        &mut self,
        sheet_id: &SheetId,
        key: &str,
        value: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::set_sheet_setting(self, sheet_id, key, value)
    }

    #[bridge::write(scope = "sheet")]
    pub fn protect_sheet(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::protect_sheet(self, sheet_id, password_hash)
    }

    #[bridge::write(scope = "sheet")]
    pub fn protect_sheet_with_options(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
        options: SheetProtectionOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::protect_sheet_with_options(self, sheet_id, password_hash, options)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_sheet_protection_options(
        &mut self,
        sheet_id: &SheetId,
        options: SheetProtectionOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::set_sheet_protection_options(self, sheet_id, options)
    }

    #[bridge::write(scope = "sheet")]
    pub fn unprotect_sheet(
        &mut self,
        sheet_id: &SheetId,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::unprotect_sheet(self, sheet_id, password_hash)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_page_breaks(&self, sheet_id: &SheetId) -> PageBreaks {
        sheet_settings_print::get_page_breaks(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_horizontal_page_break(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::add_horizontal_page_break(self, sheet_id, row)
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_horizontal_page_break(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::remove_horizontal_page_break(self, sheet_id, row)
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_vertical_page_break(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::add_vertical_page_break(self, sheet_id, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_vertical_page_break(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::remove_vertical_page_break(self, sheet_id, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_all_page_breaks(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::clear_all_page_breaks(self, sheet_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_print_area(&self, sheet_id: &SheetId) -> Option<PrintRange> {
        sheet_settings_print::get_print_area(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_print_area(
        &mut self,
        sheet_id: &SheetId,
        area: Option<PrintRange>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::set_print_area(self, sheet_id, area)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_print_titles(&self, sheet_id: &SheetId) -> PrintTitles {
        sheet_settings_print::get_print_titles(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_print_titles(
        &mut self,
        sheet_id: &SheetId,
        titles: PrintTitles,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::set_print_titles(self, sheet_id, titles)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_split_config(&self, sheet_id: &SheetId) -> Option<SplitViewConfig> {
        sheet_settings_print::get_split_config(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_split_config(
        &mut self,
        sheet_id: &SheetId,
        config: Option<SplitViewConfig>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sheet_settings_print::set_split_config(self, sheet_id, config)
    }

    #[bridge::write(scope = "workbook")]
    pub fn create_named_range(
        &mut self,
        input: named_ranges::DefinedNameInput,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::create_named_range(self, input)
    }

    #[bridge::write(scope = "workbook")]
    pub fn update_named_range(
        &mut self,
        id: &str,
        updates: named_ranges::NamedRangeUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::update_named_range(self, id, updates)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_named_range_by_id(
        &mut self,
        id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::remove_named_range_by_id(self, id)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_named_ranges_by_scope(
        &mut self,
        scope: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::remove_named_ranges_by_scope(self, scope)
    }

    #[bridge::write(scope = "workbook")]
    #[bridge::skip(napi)]
    pub fn import_named_ranges(
        &mut self,
        names: Vec<named_ranges::DefinedName>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::import_named_ranges(self, names)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_print_settings(
        &mut self,
        sheet_id: &SheetId,
        settings: domain_types::domain::print::PrintSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::set_print_settings(self, sheet_id, settings)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_hf_image(
        &mut self,
        sheet_id: &SheetId,
        info: domain_types::domain::print::HeaderFooterImageInfo,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::set_hf_image(self, sheet_id, info)
    }

    #[bridge::write(scope = "sheet")]
    pub fn remove_hf_image(
        &mut self,
        sheet_id: &SheetId,
        position: domain_types::domain::print::HfImagePosition,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::remove_hf_image(self, sheet_id, position)
    }

    #[bridge::write(scope = "range")]
    pub fn clear_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::clear_range(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::write(scope = "range")]
    pub fn clear_range_and_return_ids(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::clear_range_and_return_ids(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::write(scope = "range")]
    #[allow(clippy::too_many_arguments)]
    pub fn replace_all_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        text: String,
        replacement: String,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        defined_names_print_cells::replace_all_in_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            text,
            replacement,
            options,
        )
    }
}
