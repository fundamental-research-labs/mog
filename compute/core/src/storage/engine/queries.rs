//! Read-only query methods for ComputeEngine.

mod a1_named_values;
mod cell_regions;
mod document_sheets;
mod helpers;
mod projections_settings;
mod ranges_search_formula;
mod styles_named_ranges;
mod workbook_settings;

use super::ComputeEngine;
use crate::diagnostics::formula_references::{
    FormulaReferenceDiagnosticsOptions, FormulaReferenceDiagnosticsPage,
};
use crate::engine_types::{
    CellPosition, CellPositionResult, ColumnEdge, DataBounds, DefaultFont,
    FormulaCircularReferenceValidation, ProjectionData, RectBounds, RegexSearchOptions,
    RegexSearchResult, RowEdge, SheetProtectionConfig, SignCheckOptions, SignCheckResult,
    WorkbookSearchResult,
};
use crate::range_manager::{A1CellRef, A1RangeRef};
use crate::snapshot::{
    BatchRangeRequest, BatchRangeResponse, CalculationSettings, IdentityCell, MutationResult,
    ProtectedWorkbookOperation, RangeQueryResult, RuntimeDiagnosticsOptions,
    RuntimeDiagnosticsPage, RustWorkbookSettingsPatch, WorkbookProtectionOptions, WorkbookSettings,
};
use bridge_core as bridge;
use cell_types::{SheetId, SheetPos};
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{FrozenPanes, SheetMeta, SheetScrollPosition, SheetViewOptions};
use domain_types::domain::slicer::{NamedSlicerStyle, SlicerCustomStyle};
use domain_types::{DefinedName, ImportDiagnostic, NameValidationResult};
use value_types::{CellValue, ComputeError};

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "queries",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    #[bridge::read]
    pub fn get_workbook_settings(&self) -> WorkbookSettings {
        workbook_settings::get_workbook_settings(self)
    }

    #[bridge::read]
    pub fn get_formula_reference_diagnostics(
        &self,
        options: FormulaReferenceDiagnosticsOptions,
    ) -> Result<FormulaReferenceDiagnosticsPage, ComputeError> {
        workbook_settings::get_formula_reference_diagnostics(self, options)
    }

    #[bridge::read]
    pub fn get_import_diagnostics(&self) -> Vec<ImportDiagnostic> {
        self.import_report.diagnostics.clone()
    }

    #[bridge::read]
    pub fn get_runtime_diagnostics(
        &self,
        options: RuntimeDiagnosticsOptions,
    ) -> RuntimeDiagnosticsPage {
        self.runtime_diagnostics.page(options)
    }

    #[bridge::write]
    pub fn set_workbook_settings(
        &mut self,
        settings: WorkbookSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let current = self.get_workbook_settings();
        let authored = WorkbookSettings {
            selected_sheet_ids: current.selected_sheet_ids.clone(),
            custom_settings: current.custom_settings.clone(),
            ..settings.clone()
        };
        if authored == current {
            self.without_history(|engine| {
                workbook_settings::set_workbook_settings(engine, settings)
            })
        } else {
            self.with_history(|engine| workbook_settings::set_workbook_settings(engine, settings))
        }
    }

    #[bridge::write]
    pub fn patch_workbook_settings(
        &mut self,
        patch: RustWorkbookSettingsPatch,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let authored = RustWorkbookSettingsPatch {
            selected_sheet_ids: None,
            custom_settings: None,
            ..patch.clone()
        };
        if authored == RustWorkbookSettingsPatch::default() {
            self.without_history(|engine| workbook_settings::patch_workbook_settings(engine, patch))
        } else {
            self.with_history(|engine| workbook_settings::patch_workbook_settings(engine, patch))
        }
    }

    #[bridge::read]
    pub fn get_document_properties(&self) -> domain_types::DocumentProperties {
        document_sheets::get_document_properties(self)
    }

    #[bridge::write]
    pub fn set_document_properties(
        &mut self,
        props: domain_types::DocumentProperties,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| document_sheets::set_document_properties(engine, props))
    }

    #[bridge::read]
    pub fn get_all_sheet_ids(&self) -> Vec<String> {
        document_sheets::get_all_sheet_ids(self)
    }

    #[bridge::read]
    pub fn get_sheet_name(&self, sheet_id: &SheetId) -> Option<String> {
        document_sheets::get_sheet_name(self, sheet_id)
    }

    #[bridge::read]
    pub fn is_sheet_hidden(&self, sheet_id: &SheetId) -> bool {
        document_sheets::is_sheet_hidden(self, sheet_id)
    }

    #[bridge::read]
    pub fn is_sheet_calculation_enabled(&self, sheet_id: &SheetId) -> bool {
        document_sheets::is_sheet_calculation_enabled(self, sheet_id)
    }

    #[bridge::read]
    pub fn is_sheet_protected(&self, sheet_id: &SheetId) -> bool {
        document_sheets::is_sheet_protected(self, sheet_id)
    }

    #[bridge::read]
    pub fn is_row_hidden_query(&self, sheet_id: &SheetId, row: u32) -> bool {
        document_sheets::is_row_hidden_query(self, sheet_id, row)
    }

    #[bridge::read]
    pub fn is_col_hidden_query(&self, sheet_id: &SheetId, col: u32) -> bool {
        document_sheets::is_col_hidden_query(self, sheet_id, col)
    }

    #[bridge::read]
    pub fn get_hidden_rows(&self, sheet_id: &SheetId) -> Vec<u32> {
        document_sheets::get_hidden_rows(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_filter_hidden_rows(&self, sheet_id: &SheetId) -> Vec<u32> {
        document_sheets::get_filter_hidden_rows(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_hidden_columns(&self, sheet_id: &SheetId) -> Vec<u32> {
        document_sheets::get_hidden_columns(self, sheet_id)
    }

    #[bridge::skip(ts_bridge)]
    #[bridge::read]
    pub fn get_data_bounds(&self, sheet_id: &SheetId) -> Option<DataBounds> {
        document_sheets::get_data_bounds(self, sheet_id)
    }

    #[bridge::read]
    #[bridge::skip(napi)]
    pub fn get_sheet_index(&self, sheet_id: &SheetId) -> Option<usize> {
        document_sheets::get_sheet_index(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_frozen_panes_query(&self, sheet_id: &SheetId) -> FrozenPanes {
        document_sheets::get_frozen_panes_query(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_view_options_query(&self, sheet_id: &SheetId) -> SheetViewOptions {
        document_sheets::get_view_options_query(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_scroll_position_query(&self, sheet_id: &SheetId) -> SheetScrollPosition {
        document_sheets::get_scroll_position_query(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_tab_color_query(&self, sheet_id: &SheetId) -> Option<String> {
        document_sheets::get_tab_color_query(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_sheet_protection_config(&self, sheet_id: &SheetId) -> SheetProtectionConfig {
        document_sheets::get_sheet_protection_config(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_row_height_query(&self, sheet_id: &SheetId, row: u32) -> f64 {
        document_sheets::get_row_height_query(self, sheet_id, row)
    }

    #[bridge::read]
    pub fn get_col_width_query(&self, sheet_id: &SheetId, col: u32) -> f64 {
        document_sheets::get_col_width_query(self, sheet_id, col)
    }

    #[bridge::read]
    pub fn get_default_row_height(&self, sheet_id: &SheetId) -> f64 {
        document_sheets::get_default_row_height(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_default_col_width(&self, sheet_id: &SheetId) -> f64 {
        document_sheets::get_default_col_width(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_row_heights_batch(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Vec<(u32, f64)> {
        document_sheets::get_row_heights_batch(self, sheet_id, start_row, end_row)
    }

    #[bridge::read]
    pub fn get_col_widths_batch(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<(u32, f64)> {
        document_sheets::get_col_widths_batch(self, sheet_id, start_col, end_col)
    }

    #[bridge::read]
    pub fn get_col_width_chars_query(&self, sheet_id: &SheetId, col: u32) -> f64 {
        document_sheets::get_col_width_chars_query(self, sheet_id, col)
    }

    #[bridge::read]
    pub fn get_default_col_width_chars(&self, sheet_id: &SheetId) -> f64 {
        document_sheets::get_default_col_width_chars(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_col_widths_batch_chars(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<(u32, f64)> {
        document_sheets::get_col_widths_batch_chars(self, sheet_id, start_col, end_col)
    }

    #[bridge::read]
    pub fn get_all_named_ranges_wire(&self) -> Vec<crate::engine_types::queries::DefinedNameWire> {
        document_sheets::get_all_named_ranges_wire(self)
    }

    #[bridge::read]
    pub fn get_dependents(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<CellPositionResult> {
        document_sheets::get_dependents(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_precedents(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<CellPositionResult> {
        document_sheets::get_precedents(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_merge_at_cell_query(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellMergeInfo> {
        document_sheets::get_merge_at_cell_query(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_all_merges_in_sheet(&self, sheet_id: &SheetId) -> Vec<ResolvedMergedRegion> {
        document_sheets::get_all_merges_in_sheet(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_cell_id_at(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        document_sheets::get_cell_id_at(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_cell_position(
        &self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
    ) -> Option<CellPositionResult> {
        document_sheets::get_cell_position(self, sheet_id, cell_id_hex)
    }

    #[bridge::read]
    pub fn resolve_cell_positions(
        &self,
        cell_id_hexes: Vec<String>,
    ) -> Vec<Option<CellPositionResult>> {
        document_sheets::resolve_cell_positions(self, cell_id_hexes)
    }

    #[bridge::read]
    pub fn is_projection_source(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        document_sheets::is_projection_source(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn is_projected_position(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        document_sheets::is_projected_position(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_projection_range(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<RectBounds> {
        projections_settings::get_projection_range(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_projection_source(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<SheetPos> {
        projections_settings::get_projection_source(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_viewport_projection_data(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<ProjectionData> {
        projections_settings::get_viewport_projection_data(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::read]
    pub fn get_calc_mode(&self) -> String {
        projections_settings::get_calc_mode(self)
    }

    #[bridge::read]
    pub fn get_default_font(&self) -> DefaultFont {
        projections_settings::get_default_font(self)
    }

    #[bridge::read]
    pub fn get_workbook_setting(&self, key: &str) -> Option<serde_json::Value> {
        projections_settings::get_workbook_setting(self, key)
    }

    #[bridge::write]
    pub fn set_workbook_setting(
        &mut self,
        key: &str,
        value: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        if matches!(key, "selectedSheetIds" | "customSettings" | "workbookViews") {
            self.without_history(|engine| {
                projections_settings::set_workbook_setting(engine, key, value)
            })
        } else {
            self.with_history(|engine| {
                projections_settings::set_workbook_setting(engine, key, value)
            })
        }
    }

    #[bridge::write]
    pub fn reset_workbook_settings(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| projections_settings::reset_workbook_settings(engine))
    }

    #[bridge::read]
    pub fn get_calculation_settings(&self) -> CalculationSettings {
        projections_settings::get_calculation_settings(self)
    }

    #[bridge::write]
    pub fn set_calculation_settings(
        &mut self,
        settings: CalculationSettings,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| projections_settings::set_calculation_settings(engine, settings))
    }

    #[bridge::read]
    pub fn is_iterative_calculation_enabled(&self) -> bool {
        projections_settings::is_iterative_calculation_enabled(self)
    }

    #[bridge::write]
    pub fn set_iterative_calculation_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            projections_settings::set_iterative_calculation_enabled(engine, enabled)
        })
    }

    #[bridge::write]
    pub fn protect_workbook(
        &mut self,
        password_hash: Option<String>,
        options: Option<WorkbookProtectionOptions>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            projections_settings::protect_workbook(engine, password_hash, options)
        })
    }

    #[bridge::write]
    pub fn unprotect_workbook(
        &mut self,
        password_hash: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| projections_settings::unprotect_workbook(engine, password_hash))
    }

    #[bridge::read]
    pub fn get_workbook_protection_options(&self) -> WorkbookProtectionOptions {
        projections_settings::get_workbook_protection_options(self)
    }

    #[bridge::read]
    pub fn has_workbook_protection_password(&self) -> bool {
        projections_settings::has_workbook_protection_password(self)
    }

    #[bridge::read]
    pub fn is_workbook_protected(&self) -> bool {
        projections_settings::is_workbook_protected(self)
    }

    #[bridge::read]
    pub fn is_workbook_operation_allowed(
        &self,
        operation: ProtectedWorkbookOperation,
    ) -> Result<bool, ComputeError> {
        projections_settings::is_workbook_operation_allowed(self, operation)
    }

    #[bridge::write]
    pub fn set_default_table_style_id(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            projections_settings::set_default_table_style_id(engine, style_id)
        })
    }

    #[bridge::read]
    pub fn get_default_table_style_id(&self) -> Option<String> {
        projections_settings::get_default_table_style_id(self)
    }

    #[bridge::write]
    pub fn set_default_slicer_style(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| projections_settings::set_default_slicer_style(engine, style_id))
    }

    #[bridge::read]
    pub fn get_default_slicer_style(&self) -> Option<String> {
        projections_settings::get_default_slicer_style(self)
    }

    #[bridge::read]
    pub fn get_slicer_style_count(&self) -> u32 {
        styles_named_ranges::get_slicer_style_count(self)
    }

    #[bridge::read]
    pub fn get_slicer_style(&self, name: &str) -> Option<NamedSlicerStyle> {
        styles_named_ranges::get_slicer_style(self, name)
    }

    #[bridge::read]
    pub fn list_slicer_styles(&self) -> Vec<NamedSlicerStyle> {
        styles_named_ranges::list_slicer_styles(self)
    }

    #[bridge::write]
    pub fn add_slicer_style(
        &mut self,
        name: &str,
        style: SlicerCustomStyle,
        make_unique_name: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            styles_named_ranges::add_slicer_style(engine, name, style, make_unique_name)
        })
    }

    #[bridge::write]
    pub fn delete_slicer_style(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| styles_named_ranges::delete_slicer_style(engine, name))
    }

    #[bridge::write]
    pub fn duplicate_slicer_style(
        &mut self,
        name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| styles_named_ranges::duplicate_slicer_style(engine, name))
    }

    #[bridge::write]
    pub fn set_default_pivot_table_style(
        &mut self,
        style_id: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            styles_named_ranges::set_default_pivot_table_style(engine, style_id)
        })
    }

    #[bridge::read]
    pub fn get_default_pivot_table_style(&self) -> Option<String> {
        styles_named_ranges::get_default_pivot_table_style(self)
    }

    #[bridge::read]
    pub fn get_custom_setting(&self, key: &str) -> Option<String> {
        styles_named_ranges::get_custom_setting(self, key)
    }

    #[bridge::write]
    pub fn set_custom_setting(
        &mut self,
        key: &str,
        value: Option<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.without_history(|engine| styles_named_ranges::set_custom_setting(engine, key, value))
    }

    #[bridge::read]
    pub fn list_custom_settings(&self) -> Vec<(String, String)> {
        styles_named_ranges::list_custom_settings(self)
    }

    #[bridge::read]
    pub fn get_named_range_by_id(&self, id: &str) -> Option<DefinedName> {
        styles_named_ranges::get_named_range_by_id(self, id)
    }

    #[bridge::read]
    pub fn get_named_range_by_name(
        &self,
        name: &str,
        scope: Option<String>,
    ) -> Option<DefinedName> {
        styles_named_ranges::get_named_range_by_name(self, name, scope)
    }

    #[bridge::read]
    pub fn get_named_ranges_by_scope(&self, scope: Option<String>) -> Vec<DefinedName> {
        styles_named_ranges::get_named_ranges_by_scope(self, scope)
    }

    #[bridge::read]
    pub fn get_visible_named_ranges(&self) -> Vec<DefinedName> {
        styles_named_ranges::get_visible_named_ranges(self)
    }

    #[bridge::read]
    pub fn named_range_exists(&self, name: &str, scope: Option<String>) -> bool {
        styles_named_ranges::named_range_exists(self, name, scope)
    }

    #[bridge::read]
    #[bridge::skip(napi)]
    pub fn named_range_count(&self) -> usize {
        styles_named_ranges::named_range_count(self)
    }

    #[bridge::read]
    pub fn validate_named_range_name(
        &self,
        name: &str,
        scope: Option<String>,
        exclude_id: Option<String>,
    ) -> NameValidationResult {
        styles_named_ranges::validate_named_range_name(self, name, scope, exclude_id)
    }

    #[bridge::read]
    pub fn resolve_named_range(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<DefinedName> {
        styles_named_ranges::resolve_named_range(self, name, current_sheet)
    }

    #[bridge::read]
    pub fn get_visible_sheet_ids(&self) -> Vec<String> {
        styles_named_ranges::get_visible_sheet_ids(self)
    }

    #[bridge::read]
    pub fn get_hidden_sheet_ids(&self) -> Vec<String> {
        styles_named_ranges::get_hidden_sheet_ids(self)
    }

    #[bridge::read]
    pub fn count_visible_sheets(&self) -> u32 {
        styles_named_ranges::count_visible_sheets(self)
    }

    #[bridge::read]
    pub fn get_sheet_order(&self) -> Vec<String> {
        styles_named_ranges::get_sheet_order(self)
    }

    #[bridge::read]
    pub fn get_first_sheet_id(&self) -> Option<String> {
        styles_named_ranges::get_first_sheet_id(self)
    }

    #[bridge::read]
    pub fn get_print_settings(
        &self,
        sheet_id: &SheetId,
    ) -> domain_types::domain::print::PrintSettings {
        styles_named_ranges::get_print_settings(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_hf_images(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
        styles_named_ranges::get_hf_images(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_sheet_meta(&self, sheet_id: &SheetId) -> Option<SheetMeta> {
        styles_named_ranges::get_sheet_meta(self, sheet_id)
    }

    #[bridge::read]
    pub fn has_sheet_protection_password(&self, sheet_id: &SheetId) -> bool {
        styles_named_ranges::has_sheet_protection_password(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_cell_data(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<serde_json::Value> {
        cell_regions::get_cell_data(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_cell_data_by_id_hex(
        &self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
    ) -> Option<serde_json::Value> {
        cell_regions::get_cell_data_by_id_hex(self, sheet_id, cell_id_hex)
    }

    #[bridge::read]
    pub fn get_display_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        cell_regions::get_display_value(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_raw_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        cell_regions::get_raw_value(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_effective_value(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<serde_json::Value> {
        cell_regions::get_effective_value(self, sheet_id, row, col)
    }

    #[bridge::read]
    #[bridge::skip(napi)]
    pub fn get_cell_count(&self, sheet_id: &SheetId) -> usize {
        cell_regions::get_cell_count(self, sheet_id)
    }

    #[bridge::read]
    pub fn get_current_region(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
    ) -> RectBounds {
        cell_regions::get_current_region(self, sheet_id, start_row, start_col)
    }

    #[bridge::read]
    pub fn find_data_edge(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        direction: &str,
    ) -> CellPosition {
        cell_regions::find_data_edge(self, sheet_id, row, col, direction)
    }

    #[bridge::read]
    pub fn find_last_row(&self, sheet_id: &SheetId, col: u32) -> ColumnEdge {
        cell_regions::find_last_row(self, sheet_id, col)
    }

    #[bridge::read]
    pub fn find_last_column(&self, sheet_id: &SheetId, row: u32) -> RowEdge {
        cell_regions::find_last_column(self, sheet_id, row)
    }

    #[bridge::read]
    pub fn get_cells_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<String> {
        a1_named_values::get_cells_in_range(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    #[bridge::read]
    #[allow(clippy::too_many_arguments)]
    pub fn get_data_bounds_for_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        is_full_column: bool,
        is_full_row: bool,
    ) -> Option<RectBounds> {
        a1_named_values::get_data_bounds_for_range(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            is_full_column,
            is_full_row,
        )
    }

    #[bridge::read]
    pub fn parse_range_ref(&self, range_str: &str) -> Option<A1RangeRef> {
        a1_named_values::parse_range_ref(self, range_str)
    }

    #[bridge::read]
    pub fn stringify_range_ref(&self, range: A1RangeRef) -> Option<String> {
        a1_named_values::stringify_range_ref(self, range)
    }

    #[bridge::read]
    pub fn parse_cell_ref(&self, cell_str: &str) -> Option<A1CellRef> {
        a1_named_values::parse_cell_ref(self, cell_str)
    }

    #[bridge::read]
    pub fn stringify_cell_ref(&self, cell: A1CellRef) -> Option<String> {
        a1_named_values::stringify_cell_ref(self, cell)
    }

    #[bridge::read]
    pub fn get_merges_in_range_spatial(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<MergeRegion> {
        a1_named_values::get_merges_in_range_spatial(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::read]
    pub fn get_merge_at_cell_spatial(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellMergeInfo> {
        a1_named_values::get_merge_at_cell_spatial(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn get_named_range_display_value(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<String> {
        a1_named_values::get_named_range_display_value(self, name, current_sheet)
    }

    #[bridge::read]
    pub fn get_named_range_typed_value(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<CellValue> {
        a1_named_values::get_named_range_typed_value(self, name, current_sheet)
    }

    #[bridge::read]
    pub fn get_named_range_type(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<String> {
        a1_named_values::get_named_range_type(self, name, current_sheet)
    }

    #[bridge::read]
    pub fn get_named_range_array_values(
        &self,
        name: &str,
        current_sheet: Option<String>,
    ) -> Option<Vec<Vec<CellValue>>> {
        a1_named_values::get_named_range_array_values(self, name, current_sheet)
    }

    #[bridge::read]
    pub fn format_cell_value_for_display(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        a1_named_values::format_cell_value_for_display(self, sheet_id, row, col)
    }

    #[bridge::read]
    pub fn query_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> RangeQueryResult {
        ranges_search_formula::query_range(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    #[bridge::read]
    pub fn get_range_with_identity(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<IdentityCell> {
        ranges_search_formula::get_range_with_identity(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::read]
    pub fn query_ranges(&self, requests: Vec<BatchRangeRequest>) -> BatchRangeResponse {
        ranges_search_formula::query_ranges(self, requests)
    }

    #[bridge::read]
    pub fn regex_search(
        &self,
        sheet_id: &SheetId,
        options: RegexSearchOptions,
    ) -> RegexSearchResult {
        ranges_search_formula::regex_search(self, sheet_id, options)
    }

    #[bridge::read]
    pub fn find_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Option<crate::engine_types::queries::FindInRangeResult> {
        ranges_search_formula::find_in_range(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    #[bridge::read]
    pub fn find_all_in_range(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::engine_types::queries::FindInRangeOptions,
    ) -> Vec<crate::engine_types::queries::FindInRangeResult> {
        ranges_search_formula::find_all_in_range(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    #[bridge::read]
    pub fn regex_search_all_sheets(&self, options: RegexSearchOptions) -> WorkbookSearchResult {
        ranges_search_formula::regex_search_all_sheets(self, options)
    }

    #[bridge::read]
    pub fn sign_check(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: SignCheckOptions,
    ) -> SignCheckResult {
        ranges_search_formula::sign_check(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    #[bridge::read]
    pub fn validate_formula_syntax(
        &self,
        _sheet_id: &SheetId,
        formula: &str,
    ) -> Option<(String, Option<u32>)> {
        ranges_search_formula::validate_formula_syntax(self, _sheet_id, formula)
    }

    #[bridge::read]
    pub fn validate_formula_circular_reference(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        formula: &str,
    ) -> Option<FormulaCircularReferenceValidation> {
        ranges_search_formula::validate_formula_circular_reference(
            self, sheet_id, row, col, formula,
        )
    }

    #[bridge::read]
    pub fn evaluate_expression(
        &self,
        sheet_id: &SheetId,
        expression: &str,
    ) -> Result<CellValue, ComputeError> {
        ranges_search_formula::evaluate_expression(self, sheet_id, expression)
    }
}

impl ComputeEngine {
    fn build_scope_chain(&self, current_sheet: Option<&str>) -> Vec<formula_types::Scope> {
        let mut chain = Vec::with_capacity(2);
        if let Some(hex) = current_sheet
            && let Some(raw) = compute_document::hex::hex_to_id(hex)
        {
            chain.push(formula_types::Scope::Sheet(SheetId::from_raw(raw)));
        }
        chain.push(formula_types::Scope::Workbook);
        chain
    }

    fn resolve_sheet_from_range(
        &self,
        range: &crate::range_manager::A1RangeRef,
    ) -> Option<SheetId> {
        let sheet_ids = self.stores.storage.sheet_order();
        if let Some(ref sheet_name) = range.sheet_name {
            sheet_ids
                .iter()
                .find(|sid| {
                    crate::storage::sheet::properties::get_sheet_name(&self.stores.storage, sid)
                        .as_deref()
                        == Some(sheet_name.as_str())
                })
                .copied()
        } else {
            sheet_ids.first().copied()
        }
    }
}
