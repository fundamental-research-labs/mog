//! Formatting methods (cell format, CF rules, schemas, row/col format) for ComputeEngine.

use super::ComputeEngine;
use super::services;
use super::validation;
use crate::bridge_types::BorderPatchOperation;
use crate::snapshot::MutationResult;
use crate::storage::properties;
use crate::storage::sheet::cf_store::{CFCellRange, CFIconSetPreset, CFPresetCategory};
use crate::storage::sheet::schemas::{CellValidationResult, ColumnSchema, RangeSchema};
use bridge_core as bridge;
use cell_types::{CellId, SheetId, SheetPos};
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
    service = "ComputeEngine",
    key = "doc_id",
    group = "formatting",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    #[bridge::write(scope = "workbook")]
    pub fn set_schema_map(
        &mut self,
        entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
        version: f64,
    ) {
        self.without_history(|engine| schema_map::set_schema_map(engine, entries, version))
    }

    #[bridge::write(scope = "workbook")]
    pub fn update_schema(
        &mut self,
        sheet_id: String,
        column: u32,
        schema: crate::schema::types::ColumnSchema,
        version: f64,
    ) -> bool {
        self.without_history(|engine| {
            schema_map::update_schema(engine, sheet_id, column, schema, version)
        })
    }

    #[bridge::write(scope = "workbook")]
    pub fn remove_schema(&mut self, sheet_id: String, column: u32, version: f64) -> bool {
        self.without_history(|engine| schema_map::remove_schema(engine, sheet_id, column, version))
    }

    #[bridge::write(scope = "workbook")]
    pub fn clear_schemas(&mut self) -> Result<MutationResult, ComputeError> {
        self.without_history(|engine| schema_map::clear_schemas(engine))
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

    #[bridge::read(scope = "cell")]
    pub fn get_transferable_format(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> ResolvedCellFormat {
        cell_formats::get_transferable_format(self, sheet_id, row, col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
        format: &CellFormat,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| cell_formats::set_cell_format(engine, sheet_id, cell_id, format))
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_cell_format(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &CellId,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| cell_formats::clear_cell_format(engine, sheet_id, cell_id))
    }

    #[bridge::write(scope = "sheet")]
    pub fn toggle_format_property(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        property: &str,
        active_row: u32,
        active_col: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::toggle_format_property(
                engine, sheet_id, ranges, property, active_row, active_col,
            )
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::set_format_for_ranges(engine, sheet_id, ranges, format)
        })
    }

    /// Apply a transient UI format without adding an undo step or clearing redo.
    #[bridge::write(scope = "sheet")]
    pub fn set_format_for_ranges_ui_state(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
    ) -> Result<MutationResult, ComputeError> {
        let result =
            self.without_history(|engine| engine.set_format_for_ranges(sheet_id, ranges, format));
        if result.is_ok() {
            self.rebase_history_ui_format(*sheet_id, ranges, format);
        }
        result
    }

    /// Apply a tri-state format patch: values set properties and clear_fields
    /// remove direct properties while omitted properties remain unchanged.
    #[bridge::write(scope = "sheet")]
    pub fn patch_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &CellFormat,
        clear_fields: &[String],
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::patch_format_for_ranges(engine, sheet_id, ranges, format, clear_fields)
        })
    }

    /// Apply an ordered batch of nested border patches as one command.
    /// Supplied edges/flags replace complete members, cleared members remove
    /// direct overrides, and omitted members remain unchanged.
    #[bridge::write(scope = "sheet")]
    pub fn patch_borders(
        &mut self,
        sheet_id: &SheetId,
        operations: Vec<BorderPatchOperation>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| range_mutations::patch_borders(engine, sheet_id, operations))
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_format_for_ranges(
        &mut self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)],
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::clear_format_for_ranges(engine, sheet_id, ranges)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_cell_properties_batch(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellFormat)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::set_cell_properties_batch(engine, sheet_id, updates)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn patch_cell_properties_batch(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, u32, CellFormat, Vec<String>)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            range_mutations::patch_cell_properties_batch(engine, sheet_id, updates)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule: serde_json::Value,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| conditional_formats::add_cf_rule(engine, sheet_id, rule))
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::update_cf_rule(engine, sheet_id, rule_id, updates)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_cf_rule(
        &mut self,
        sheet_id: &SheetId,
        rule_id: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| conditional_formats::delete_cf_rule(engine, sheet_id, rule_id))
    }

    #[bridge::write(scope = "sheet")]
    pub fn reorder_cf_rules(
        &mut self,
        sheet_id: &SheetId,
        rule_ids: Vec<String>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::reorder_cf_rules(engine, sheet_id, rule_ids)
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::update_cf_ranges(engine, sheet_id, format_id, new_ranges)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_cf_formats_for_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::clear_cf_formats_for_sheet(engine, sheet_id)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn add_rule_to_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule: &CFRule,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::add_rule_to_cf(engine, sheet_id, format_id, rule)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_rule_in_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::update_rule_in_cf(engine, sheet_id, format_id, rule_id, updates)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_rule_from_cf(
        &mut self,
        sheet_id: &SheetId,
        format_id: &str,
        rule_id: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            conditional_formats::delete_rule_from_cf(engine, sheet_id, format_id, rule_id)
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::set_row_format(engine, sheet_id, row, format))
    }

    #[bridge::write(scope = "sheet")]
    pub fn patch_row_format(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        format: CellFormat,
        clear_fields: Vec<String>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            row_col::patch_row_format(engine, sheet_id, row, format, clear_fields)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::set_col_format(engine, sheet_id, col, format))
    }

    #[bridge::write(scope = "sheet")]
    pub fn patch_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        format: CellFormat,
        clear_fields: Vec<String>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            row_col::patch_col_format(engine, sheet_id, col, format, clear_fields)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_col_format(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::clear_col_format(engine, sheet_id, col))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_col_format_range(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            row_col::set_col_format_range(engine, sheet_id, start_col, end_col, format)
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::set_row_formats(engine, sheet_id, updates))
    }

    #[bridge::write(scope = "sheet")]
    pub fn patch_row_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat, Vec<String>)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::patch_row_formats(engine, sheet_id, updates))
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::set_col_formats(engine, sheet_id, updates))
    }

    #[bridge::write(scope = "sheet")]
    pub fn patch_col_formats(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(u32, CellFormat, Vec<String>)>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| row_col::patch_col_formats(engine, sheet_id, updates))
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| schemas::set_column_schema(engine, sheet_id, col_index, schema))
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_column_schema(
        &mut self,
        sheet_id: &SheetId,
        col_index: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| schemas::clear_column_schema(engine, sheet_id, col_index))
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| schemas::set_range_schema(engine, sheet_id, schema))
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
        updates: &RangeSchema,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            schemas::update_range_schema(engine, sheet_id, schema_id, updates)
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_range_schema(
        &mut self,
        sheet_id: &SheetId,
        schema_id: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| schemas::delete_range_schema(engine, sheet_id, schema_id))
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

impl ComputeEngine {
    /// Resolve displayed formats for an ordered list of cell positions.
    ///
    /// The result is palette-compressed with `u32` IDs aligned one-for-one to
    /// `positions`. This Rust-native bulk API intentionally avoids the bridge's
    /// dense-range and `u16` viewport-palette constraints.
    pub fn get_displayed_formats_for_cells(
        &self,
        sheet_id: &SheetId,
        positions: &[(u32, u32)],
    ) -> crate::engine_types::DisplayedFormatProjection {
        displayed::get_displayed_formats_for_cells(self, sheet_id, positions)
    }
}
