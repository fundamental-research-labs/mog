//! Formatting methods (cell format, CF rules, schemas, row/col format) for YrsComputeEngine.

use super::YrsComputeEngine;
use super::services;
use super::validation;
use crate::snapshot::MutationResult;
use crate::storage::properties;
use crate::storage::sheet::cf_store::{CFCellRange, CFIconSetPreset, CFPresetCategory};
use crate::storage::sheet::schemas::{CellValidationResult, ColumnSchema, RangeSchema};
use bridge_core as bridge;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::CellFormat;
use domain_types::ResolvedCellFormat;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use value_types::CellValue;
use value_types::ComputeError;

mod cell_formats;
mod cf_geometry;
mod conditional_formats;
mod display_text;
mod displayed;
mod range_mutations;
mod range_queries;
mod row_col;
mod schema_map;
mod schemas;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "formatting",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "workbook")]
    pub fn set_schema_map(
        &mut self,
        entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
        version: f64,
    ) {
        schema_map::set_schema_map(self, entries, version)
    }

    #[bridge::write(scope = "workbook")]
    pub fn update_schema(
        &mut self,
        sheet_id: String,
        column: u32,
        schema: crate::schema::types::ColumnSchema,
        version: f64,
    ) -> bool {
        schema_map::update_schema(self, sheet_id, column, schema, version)
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_schema(&mut self, sheet_id: String, column: u32, version: f64) -> bool {
        schema_map::remove_schema(self, sheet_id, column, version)
    }

    #[bridge::write(scope = "workbook")]
    pub fn clear_schemas(&mut self) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schema_map::clear_schemas(self)
    }

    #[bridge::read(scope = "cell")]
    pub fn get_cell_format(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        cell_formats::get_cell_format(self, sheet_id, cell_id, row, col)
    }

    #[bridge::read(scope = "cell")]
    pub fn get_cell_format_with_cf(
        &self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        cell_formats::get_cell_format_with_cf(self, sheet_id, cell_id, row, col)
    }

    #[bridge::read(scope = "cell")]
    pub fn get_resolved_format(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> ResolvedCellFormat {
        cell_formats::get_resolved_format(self, sheet_id, row, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        format: &CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        cell_formats::set_cell_format(self, sheet_id, cell_id, format)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        cell_formats::clear_cell_format(self, sheet_id, cell_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn toggle_format_property(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        property: &str,
        active_row: u32,
        active_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_mutations::toggle_format_property(
            self, sheet_id, ranges, property, active_row, active_col,
        )
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_mutations::set_format_for_ranges(self, sheet_id, ranges, format)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_mutations::clear_format_for_ranges(self, sheet_id, ranges)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_cell_properties_batch(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_mutations::set_cell_properties_batch(self, sheet_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::add_cf_rule(self, sheet_id, rule)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::update_cf_rule(self, sheet_id, rule_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::delete_cf_rule(self, sheet_id, rule_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn reorder_cf_rules(
        &mut self,
        sheet_id: &SheetId,
        rule_ids: Vec<String>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::reorder_cf_rules(self, sheet_id, rule_ids)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_all_cf_rules(&self, sheet_id: &SheetId) -> Vec<ConditionalFormat> {
        conditional_formats::get_all_cf_rules(self, sheet_id)
    }

    #[bridge::read(scope = "cell")]
    pub fn get_cf_rules_for_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<ConditionalFormat> {
        conditional_formats::get_cf_rules_for_cell(self, sheet_id, row, col)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_conditional_format(
        &self,
        sheet_id: &SheetId,
        format_id: &str,
    ) -> Option<ConditionalFormat> {
        conditional_formats::get_conditional_format(self, sheet_id, format_id)
    }

    #[bridge::read(scope = "cell")]
    pub fn has_cf_for_cell(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        conditional_formats::has_cf_for_cell(self, sheet_id, row, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_cf_ranges(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        new_ranges: &[CFCellRange],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::update_cf_ranges(self, sheet_id, format_id, new_ranges)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_cf_formats_for_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::clear_cf_formats_for_sheet(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_rule_to_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule: &CFRule,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::add_rule_to_cf(self, sheet_id, format_id, rule)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_rule_in_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::update_rule_in_cf(self, sheet_id, format_id, rule_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_rule_from_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        conditional_formats::delete_rule_from_cf(self, sheet_id, format_id, rule_id)
    }

    #[bridge::read(scope = "workbook")]
    pub fn cf_ranges_overlap(&self, a: &CFCellRange, b: &CFCellRange) -> bool {
        cf_geometry::cf_ranges_overlap(self, a, b)
    }

    #[bridge::read(scope = "workbook")]
    pub fn cf_range_contains(&self, outer: &CFCellRange, inner: &CFCellRange) -> bool {
        cf_geometry::cf_range_contains(self, outer, inner)
    }

    #[bridge::read(scope = "workbook")]
    pub fn cf_subtract_range(
        &self,
        original: &CFCellRange,
        subtract: &CFCellRange,
    ) -> Vec<CFCellRange> {
        cf_geometry::cf_subtract_range(self, original, subtract)
    }

    #[bridge::read(scope = "workbook")]
    pub fn cf_intersect_ranges(&self, a: &CFCellRange, b: &CFCellRange) -> Option<CFCellRange> {
        cf_geometry::cf_intersect_ranges(self, a, b)
    }

    #[bridge::read(scope = "workbook")]
    pub fn cf_is_valid_range(&self, range: &CFCellRange) -> bool {
        cf_geometry::cf_is_valid_range(self, range)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_icon_set_presets(&self) -> Vec<CFIconSetPreset> {
        cf_geometry::get_icon_set_presets(self)
    }

    #[bridge::read(scope = "workbook")]
    pub fn get_cf_preset_by_id(&self, id: &str) -> Option<CFPresetCategory> {
        cf_geometry::get_cf_preset_by_id(self, id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_row_format(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        format: CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::set_row_format(self, sheet_id, row, format)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        format: CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::set_col_format(self, sheet_id, col, format)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::clear_col_format(self, sheet_id, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_col_format_range(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
        format: CellFormat,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::set_col_format_range(self, sheet_id, start_col, end_col, format)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_row_formats(
        &self,
        sheet_id: &SheetId,
        rows: Vec<u32>,
    ) -> Vec<(u32, Option<CellFormat>)> {
        row_col::get_row_formats(self, sheet_id, rows)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_row_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::set_row_formats(self, sheet_id, updates)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_col_formats(
        &self,
        sheet_id: &SheetId,
        cols: Vec<u32>,
    ) -> Vec<(u32, Option<CellFormat>)> {
        row_col::get_col_formats(self, sheet_id, cols)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_col_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat)>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        row_col::set_col_formats(self, sheet_id, updates)
    }

    #[bridge::read(scope = "range")]
    pub fn query_range_properties(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<Vec<Vec<Option<CellFormat>>>, ComputeError> {
        range_queries::query_range_properties(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::read(scope = "cell")]
    pub fn get_displayed_cell_properties(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> CellFormat {
        displayed::get_displayed_cell_properties(self, sheet_id, row, col)
    }

    #[bridge::read(scope = "range")]
    pub fn get_displayed_range_properties(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<Vec<Vec<CellFormat>>, ComputeError> {
        displayed::get_displayed_range_properties(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_column_schema(&self, sheet_id: &SheetId, col_index: u32) -> Option<ColumnSchema> {
        schemas::get_column_schema(self, sheet_id, col_index)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_column_schema(
        &mut self,
        sheet_id: &SheetId,
        col_index: u32,
        schema: &ColumnSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schemas::set_column_schema(self, sheet_id, col_index, schema)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_column_schema(
        &mut self,
        sheet_id: &SheetId,
        col_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schemas::clear_column_schema(self, sheet_id, col_index)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_all_column_schemas(&self, sheet_id: &SheetId) -> Vec<(u32, ColumnSchema)> {
        schemas::get_all_column_schemas(self, sheet_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_range_schema(&self, sheet_id: &SheetId, schema_id: &str) -> Option<RangeSchema> {
        schemas::get_range_schema(self, sheet_id, schema_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_range_schemas_for_sheet(&self, sheet_id: &SheetId) -> Vec<RangeSchema> {
        schemas::get_range_schemas_for_sheet(self, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema: &RangeSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schemas::set_range_schema(self, sheet_id, schema)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
        updates: &RangeSchema,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schemas::update_range_schema(self, sheet_id, schema_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        schemas::delete_range_schema(self, sheet_id, schema_id)
    }

    #[bridge::read(scope = "cell")]
    pub fn validate_cell_value(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        value: &str,
    ) -> CellValidationResult {
        schemas::validate_cell_value(self, sheet_id, row, col, value)
    }
}
