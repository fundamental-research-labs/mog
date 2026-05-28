//! Bridge Mode 1 service wrappers — stateless pure function groups.
//!
//! These zero-sized types exist solely to host `#[bridge::api]` / `#[bridge::pure]`
//! annotations so that `bridge-wasm` and `bridge-tauri` can generate bindings for
//! stateless functions that don't require a `YrsComputeEngine` instance.
//!
//! Each wrapper mirrors the public API surface already consumed by the WASM bindings
//! in `compute-core-wasm/src/lib.rs`.

use std::cmp::Ordering;

use bridge_core as bridge;
use value_types::{CellValue, FiniteF64};

// `ChartStatistics` was moved to `snapshot-types` in nullable-boundary so the
// `no_bare_f64_at_boundary` walker can scan it. The producer below
// (`chart_compute_statistics`) re-exports the relocated type for
// existing imports; downstream callers continue to write
// `bridge_pure::ChartStatistics`.
pub use snapshot_types::queries::ChartStatistics;

// ===========================================================================
// Pivot
// ===========================================================================

use compute_pivot::types::{
    PivotEngineConfig, PivotError, PivotExpansionState, PivotField, PivotTableResult,
};
use domain_types::domain::pivot::PivotTableConfig;

/// Stateless pivot table computation functions.
pub struct PivotBridge;

#[bridge::api(group = "pivot", fn_prefix = "", crate_path = "compute_core")]
impl PivotBridge {
    /// Compute a pivot table from config and data.
    /// Validates the config, then runs the core pivot computation.
    #[bridge::pure]
    pub fn pivot_compute(
        config: PivotTableConfig,
        data: Vec<Vec<CellValue>>,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, compute_pivot::types::PivotError> {
        let config = PivotEngineConfig::try_from(config)
            .map_err(|message| PivotError::ValidationError { message })?;
        let resolved = compute_pivot::validate_and_resolve(&config)?;
        Ok(compute_pivot::compute_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        ))
    }

    /// Compute a pivot table with ShowValuesAs post-processing.
    #[bridge::pure]
    pub fn pivot_compute_with_show_values_as(
        config: PivotTableConfig,
        data: Vec<Vec<CellValue>>,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, compute_pivot::types::PivotError> {
        let config = PivotEngineConfig::try_from(config)
            .map_err(|message| PivotError::ValidationError { message })?;
        let resolved = compute_pivot::validate_and_resolve(&config)?;
        Ok(compute_pivot::compute_with_show_values_as_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        ))
    }

    /// Detect field metadata from source data (first row = headers).
    #[bridge::pure]
    pub fn pivot_detect_fields(data: Vec<Vec<CellValue>>) -> Vec<PivotField> {
        compute_pivot::detect_fields(&data)
    }

    /// Validate a pivot config and return error messages.
    #[bridge::pure]
    pub fn pivot_validate_config(config: PivotTableConfig) -> Vec<String> {
        match PivotEngineConfig::try_from(config) {
            Ok(config) => compute_pivot::validate_config(&config),
            Err(message) => vec![message],
        }
    }

    /// Drill down into a specific pivot cell to get source row indices.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn pivot_drill_down(
        config: PivotTableConfig,
        data: Vec<Vec<CellValue>>,
        row_key: &str,
        column_key: &str,
    ) -> Result<Vec<usize>, compute_pivot::types::PivotError> {
        let config = PivotEngineConfig::try_from(config)
            .map_err(|message| PivotError::ValidationError { message })?;
        let resolved = compute_pivot::validate_and_resolve(&config)?;
        Ok(compute_pivot::drill_down_resolved(
            &resolved, &data, row_key, column_key,
        ))
    }
}

// ===========================================================================
// Table
// ===========================================================================

use compute_table::types::{
    DynamicFilter, FilterCriteria, FilterDropdownData, RowVisibility, Slicer, SlicerCache,
    SlicerSortOrder, SortSpec, Table, TableBoolOption, TableCellFormat, TableColumn, TableRange,
    TableTopBottomFilter,
};

/// Stateless table engine functions (filter, sort, slicer, visibility, styles, structured refs).
pub struct TableBridge;

#[bridge::api(group = "table", fn_prefix = "", crate_path = "compute_core")]
impl TableBridge {
    /// Evaluate a column filter against column data, returning a per-row bitmap.
    ///
    /// This pure FFI surface does not carry per-cell format data, so color
    /// filters fall through to all-pass here. Real color filtering happens in
    /// `apply_filter` which has access to the format cascade.
    ///
    /// The "now" reference for date-range operators (Last Month, This Year,
    /// Today, …) reads through the injected clock — i.e. the same source as
    /// NOW()/TODAY(). On a cloud worker the JS bridge feeds the clock with a
    /// serial computed in the user's session timezone, so "Last Month"
    /// resolves to the user's calendar month, not the host's UTC month.
    #[bridge::pure]
    pub fn table_evaluate_column_filter(
        criteria: FilterCriteria,
        column_data: Vec<CellValue>,
    ) -> Vec<u8> {
        let now = crate::eval::clock::current_calendar_date();
        let week_start_day = chrono::Weekday::Sun;
        compute_table::filter::evaluate_column_filter(
            &criteria,
            &column_data,
            None,
            Some(now),
            Some(week_start_day),
        )
    }

    /// Compute sort permutation for multi-column sort.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn table_compute_sort_order(
        specs: Vec<SortSpec>,
        data: Vec<Vec<CellValue>>,
        total_rows: usize,
    ) -> Vec<usize> {
        let refs: Vec<&[CellValue]> = data.iter().map(|v| v.as_slice()).collect();
        compute_table::sort::compute_sort_order(&specs, &refs, total_rows)
    }

    /// Build a slicer cache from slicer definition and column data.
    #[bridge::pure]
    pub fn table_build_slicer_cache(
        slicer: Slicer,
        column_data: Vec<CellValue>,
        row_visibility: Option<Vec<u8>>,
    ) -> SlicerCache {
        compute_table::slicer_cache::build_slicer_cache(
            &slicer,
            &column_data,
            row_visibility.as_deref(),
        )
    }

    /// Build filter dropdown data for a column.
    #[bridge::pure]
    pub fn table_build_filter_dropdown(
        column_data: Vec<CellValue>,
        current_filter: Option<FilterCriteria>,
        row_visibility: Option<Vec<u8>>,
    ) -> FilterDropdownData {
        compute_table::filter_dropdown::build_filter_dropdown_data(
            &column_data,
            current_filter.as_ref(),
            row_visibility.as_deref(),
        )
    }

    /// Resolve a dynamic filter rule against column data.
    ///
    /// "now" reads through the injected clock (see `current_calendar_date`)
    /// so dynamic-filter rules with relative date predicates resolve in the
    /// user's session timezone, not host UTC.
    #[bridge::pure]
    pub fn table_resolve_dynamic_filter(
        filter: DynamicFilter,
        column_data: Vec<CellValue>,
    ) -> FilterCriteria {
        let now = crate::eval::clock::current_calendar_date();
        let week_start_day = chrono::Weekday::Sun;
        compute_table::resolve_dynamic_filter(&filter, &column_data, Some(now), week_start_day)
    }

    /// Evaluate a top/bottom filter directly.
    #[bridge::pure]
    pub fn table_evaluate_top_bottom(
        filter: TableTopBottomFilter,
        column_data: Vec<CellValue>,
    ) -> Vec<u8> {
        compute_table::evaluate_top_bottom_direct(&filter, &column_data)
    }

    /// Resolve cell format for a table cell at (row, col).
    #[bridge::pure]
    pub fn table_resolve_cell_format(table: Table, row: u32, col: u32) -> Option<TableCellFormat> {
        compute_table::styles::resolve_table_cell_format(&table, row, col)
    }

    /// Resolve a structured reference against table definitions.
    #[bridge::pure]
    pub fn table_resolve_structured_ref(
        sref: formula_types::StructuredRef,
        tables: Vec<Table>,
        current_row: Option<u32>,
    ) -> Vec<compute_table::types::TableRange> {
        compute_table::structured_refs::resolve_structured_ref(&sref, &tables, current_row)
    }

    /// Adjust a structured reference after a structural change.
    #[bridge::pure]
    pub fn table_adjust_structured_ref(
        sref: formula_types::StructuredRef,
        change: compute_table::types::TableStructureChange,
    ) -> formula_types::StructuredRef {
        compute_table::structured_refs::adjust_structured_ref(&sref, &change)
    }

    /// Format a structured reference to display string.
    #[bridge::pure]
    pub fn table_format_structured_ref(sref: formula_types::StructuredRef) -> String {
        compute_table::structured_refs::format_structured_ref(&sref)
    }

    /// Compose multiple row bitmaps via intersection.
    #[bridge::pure]
    pub fn table_compose_bitmaps(bitmaps: Vec<Vec<u8>>) -> Vec<u8> {
        let refs: Vec<&[u8]> = bitmaps.iter().map(|v| v.as_slice()).collect();
        compute_table::visibility::compose_bitmaps(&refs)
    }

    /// Create row visibility from a bitmap.
    #[bridge::pure]
    pub fn table_create_row_visibility(bitmap: Vec<u8>) -> RowVisibility {
        compute_table::visibility::create_row_visibility(&bitmap)
    }

    /// Create a fully-visible bitmap for `count` rows.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn table_all_visible(count: usize) -> RowVisibility {
        compute_table::visibility::all_visible(count)
    }

    // --- Slicer operations ---

    /// Toggle a value in a slicer's selected set.
    #[bridge::pure]
    pub fn table_toggle_slicer_value(slicer: Slicer, value: CellValue) -> Slicer {
        compute_table::slicer::toggle_slicer_value(&slicer, &value)
    }

    /// Select specific values in a slicer.
    #[bridge::pure]
    pub fn table_select_slicer_values(slicer: Slicer, values: Vec<CellValue>) -> Slicer {
        compute_table::slicer::select_slicer_values(&slicer, &values)
    }

    /// Clear all slicer selections (show all).
    #[bridge::pure]
    pub fn table_clear_slicer_selection(slicer: Slicer) -> Slicer {
        compute_table::slicer::clear_slicer_selection(&slicer)
    }

    /// Select all values in a slicer using the cache.
    #[bridge::pure]
    pub fn table_select_all_slicer_values(slicer: Slicer, cache: SlicerCache) -> Slicer {
        compute_table::slicer::select_all_slicer_values(&slicer, &cache)
    }

    /// Set the sort order on a slicer.
    #[bridge::pure]
    pub fn table_set_slicer_sort_order(slicer: Slicer, order: SlicerSortOrder) -> Slicer {
        compute_table::slicer::set_slicer_sort_order(&slicer, order)
    }

    /// Convert a slicer to filter criteria.
    #[bridge::pure]
    pub fn table_slicer_to_filter_criteria(slicer: Slicer) -> FilterCriteria {
        compute_table::slicer::slicer_to_filter_criteria(&slicer)
    }

    /// Get all 67 built-in Excel table style definitions.
    #[bridge::pure]
    pub fn table_get_built_in_styles() -> Vec<compute_table::types::TableStyleDef> {
        compute_table::styles::get_all_built_in_styles()
            .into_iter()
            .cloned()
            .collect()
    }

    /// Parse a structured reference string into a `StructuredRef`.
    #[bridge::pure]
    pub fn table_parse_structured_ref(input: &str) -> Option<formula_types::StructuredRef> {
        compute_parser::parse_structured_ref(input).ok()
    }

    // --- Table Model Operations ---

    /// Create a new table from configuration.
    #[bridge::pure]
    pub fn table_create_table(
        name: String,
        sheet_id: String,
        range: TableRange,
        header_values: Vec<String>,
        id: Option<String>,
        style: Option<String>,
    ) -> Result<Table, String> {
        let refs: Vec<&str> = header_values.iter().map(|s| s.as_str()).collect();
        let opts = compute_table::table::CreateTableOptions {
            id,
            has_header_row: Some(true),
            has_totals_row: Some(false),
            style_id: style,
        };
        compute_table::table::create_table(&name, &sheet_id, range, &refs, Some(opts))
            .map_err(|e| e.to_string())
    }

    /// Resize a table to a new range.
    #[bridge::pure]
    pub fn table_resize_table(table: Table, new_range: TableRange) -> Result<Table, String> {
        compute_table::table::resize_table(&table, new_range).map_err(|e| e.to_string())
    }

    /// Add a column at the specified position.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn table_add_column(table: Table, name: String, position: Option<usize>) -> Table {
        compute_table::table::add_column(&table, &name, position)
    }

    /// Remove a column by id.
    #[bridge::pure]
    pub fn table_remove_column(table: Table, column_id: String) -> Table {
        compute_table::table::remove_column(&table, &column_id)
    }

    /// Rename a column by id.
    #[bridge::pure]
    pub fn table_rename_column(
        table: Table,
        column_id: String,
        new_name: String,
    ) -> Result<Table, String> {
        compute_table::table::rename_column(&table, &column_id, &new_name)
            .map_err(|e| e.to_string())
    }

    /// Set (or clear) the totals function for a column.
    #[bridge::pure]
    pub fn table_set_totals_function(
        table: Table,
        column_id: String,
        func: compute_table::types::TotalsFunction,
    ) -> Table {
        compute_table::table::set_totals_function(&table, &column_id, func)
    }

    /// Toggle a table boolean display option.
    #[bridge::pure]
    pub fn table_set_table_option(table: Table, option: TableBoolOption, value: bool) -> Table {
        compute_table::table::set_table_option(&table, option, value)
    }

    /// Toggle the totals row on/off, adjusting the range.
    #[bridge::pure]
    pub fn table_toggle_totals_row(table: Table) -> Table {
        compute_table::table::toggle_totals_row(&table)
    }

    /// Get the data range (excludes header and totals rows).
    #[bridge::pure]
    pub fn table_get_data_range(table: Table) -> Option<TableRange> {
        compute_table::table::get_data_range(&table)
    }

    /// Get the header row range, or null if no header row.
    #[bridge::pure]
    pub fn table_get_header_range(table: Table) -> Option<TableRange> {
        compute_table::table::get_header_range(&table)
    }

    /// Get the totals row range, or null if no totals row.
    #[bridge::pure]
    pub fn table_get_totals_range(table: Table) -> Option<TableRange> {
        compute_table::table::get_totals_range(&table)
    }

    /// Get the data range for a specific column by id.
    #[bridge::pure]
    pub fn table_get_column_data_range(table: Table, column_id: String) -> Option<TableRange> {
        compute_table::table::get_column_data_range(&table, &column_id)
    }

    /// Find a column by name (case-insensitive).
    #[bridge::pure]
    pub fn table_get_column_by_name(table: Table, name: String) -> Option<TableColumn> {
        compute_table::table::get_column_by_name(&table, &name).cloned()
    }

    /// Find a column by id.
    #[bridge::pure]
    pub fn table_get_column_by_id(table: Table, id: String) -> Option<TableColumn> {
        compute_table::table::get_column_by_id(&table, &id).cloned()
    }

    /// Find the column at a given grid column index.
    #[bridge::pure]
    pub fn table_get_column_at_grid_col(table: Table, grid_col: u32) -> Option<TableColumn> {
        compute_table::table::get_column_at_position(&table, grid_col).cloned()
    }

    /// Check if a cell is inside the table range.
    #[bridge::pure]
    pub fn table_is_in_table(table: Table, row: u32, col: u32) -> bool {
        compute_table::table::is_position_in_table(&table, row, col)
    }

    /// Check if a row is the header row.
    #[bridge::pure]
    pub fn table_is_in_header_row(table: Table, row: u32) -> bool {
        compute_table::table::is_in_header_row(&table, row)
    }

    /// Check if a row is the totals row.
    #[bridge::pure]
    pub fn table_is_in_totals_row(table: Table, row: u32) -> bool {
        compute_table::table::is_in_totals_row(&table, row)
    }

    /// Check if a cell is in the data range.
    #[bridge::pure]
    pub fn table_is_in_data_range(table: Table, row: u32, col: u32) -> bool {
        compute_table::table::is_in_data_range(&table, row, col)
    }

    /// Validate a proposed table name and check uniqueness.
    #[bridge::pure]
    pub fn table_validate_table_name(
        name: String,
        existing_names: Vec<String>,
    ) -> TableNameValidationResult {
        // First validate format
        if let Err(e) = compute_table::table::validate_table_name(&name) {
            return TableNameValidationResult {
                valid: false,
                reason: Some(e.to_string()),
            };
        }
        // Then check uniqueness
        let lower_name = name.to_lowercase();
        for existing in &existing_names {
            if existing.to_lowercase() == lower_name {
                return TableNameValidationResult {
                    valid: false,
                    reason: Some(format!("Table name \"{}\" already exists", name)),
                };
            }
        }
        TableNameValidationResult {
            valid: true,
            reason: None,
        }
    }

    /// Generate a unique table name ("Table1", "Table2", ...).
    #[bridge::pure]
    pub fn table_generate_table_name(existing_names: Vec<String>) -> String {
        let refs: Vec<&str> = existing_names.iter().map(|s| s.as_str()).collect();
        compute_table::table::generate_table_name(&refs)
    }

    /// Check if two ranges overlap.
    #[bridge::pure]
    pub fn table_ranges_overlap(a: TableRange, b: TableRange) -> bool {
        compute_table::queries::ranges_overlap(&a, &b)
    }

    /// Generate the SUBTOTAL formula for a totals row cell.
    #[bridge::pure]
    pub fn table_get_totals_formula(
        func: compute_table::types::TotalsFunction,
        column_name: String,
    ) -> String {
        compute_table::table::get_subtotal_formula(&func, &column_name).unwrap_or_default()
    }

    // --- Compare / Value Identity Operations ---

    /// Compare two CellValues using Excel ordering. Returns -1, 0, or 1.
    #[bridge::pure]
    pub fn table_compare_values(a: CellValue, b: CellValue) -> i32 {
        match compute_table::compare::compare_values(&a, &b) {
            Ordering::Less => -1,
            Ordering::Equal => 0,
            Ordering::Greater => 1,
        }
    }

    /// Produce a canonical string key for deduplication.
    #[bridge::pure]
    pub fn table_cell_value_key(value: CellValue) -> String {
        compute_table::compare::cell_value_key(&value)
    }

    /// Compare two CellValues for equality (case-insensitive strings, NaN=NaN).
    #[bridge::pure]
    pub fn table_cell_values_equal(a: CellValue, b: CellValue) -> bool {
        compute_table::compare::cell_values_equal(&a, &b)
    }

    /// Check if a value is in a list (using canonical equality).
    #[bridge::pure]
    pub fn table_value_in_list(value: CellValue, list: Vec<CellValue>) -> bool {
        compute_table::compare::value_in_list(&value, &list)
    }

    /// Format a CellValue for display in UI elements.
    #[bridge::pure]
    pub fn table_format_cell_display(value: CellValue) -> String {
        compute_table::compare::format_cell_display(&value)
    }
}

/// Result of table name validation.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNameValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// ===========================================================================
// Chart
// ===========================================================================

use compute_stats::{Point, RegressionMethod, RegressionOutput};

/// Stateless chart data transform functions.
pub struct ChartBridge;

#[bridge::api(group = "chart", fn_prefix = "", crate_path = "compute_core")]
impl ChartBridge {
    /// Apply a chain of data transforms (filter, aggregate, sort, bin, etc.).
    #[bridge::pure]
    pub fn chart_apply_transforms(
        data: Vec<compute_charts::types::DataRow>,
        transforms: Vec<compute_charts::types::Transform>,
    ) -> Vec<compute_charts::types::DataRow> {
        compute_charts::transforms::apply_transforms(&data, &transforms)
    }

    /// Compute a regression (trendline) from (x, y) points.
    #[bridge::pure]
    pub fn chart_compute_regression(
        points: Vec<Point>,
        method: RegressionMethod,
        degree: Option<u32>,
        options: compute_stats::regression::RegressionOptions,
    ) -> RegressionOutput {
        compute_stats::regression::create_regression(&points, method, degree.unwrap_or(2), &options)
    }

    /// Compute kernel density estimation.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn chart_compute_density(
        values: Vec<f64>,
        bandwidth: Option<f64>,
        steps: Option<usize>,
    ) -> compute_charts::types::DensityResult {
        compute_charts::transforms::density::kernel_density_estimation(
            &values, bandwidth, None, steps,
        )
    }

    /// Compute histogram bins.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::pure]
    #[bridge::skip(napi)]
    pub fn chart_compute_bins(
        values: Vec<f64>,
        maxbins: Option<usize>,
        step: Option<f64>,
        nice: Option<bool>,
    ) -> Vec<compute_charts::types::HistogramBin> {
        compute_charts::transforms::bin::histogram(&values, maxbins, step, nice)
    }

    /// Compute stacked values for a stacked chart.
    #[bridge::pure]
    pub fn chart_compute_stacking(
        inputs: Vec<compute_charts::types::StackInput>,
        mode: Option<compute_charts::types::StackMode>,
    ) -> Vec<compute_charts::types::StackOutput> {
        compute_charts::stacking::compute_stack(&inputs, mode)
    }

    /// Compute descriptive statistics for a numeric array.
    #[bridge::pure]
    pub fn chart_compute_statistics(values: Vec<f64>) -> ChartStatistics {
        // Each statistic individually maps to `Option<FiniteF64>` — `None`
        // signals "undefined for this input" (empty vec, degenerate set,
        // or overflow). `FiniteF64::new` rejects NaN/±∞ at the boundary,
        // exactly the contract the walker enforces.
        let (q1, q3, iqr) = if values.len() >= 2 {
            let q = compute_stats::statistics::quartiles(&values);
            (
                FiniteF64::new(q.q1),
                FiniteF64::new(q.q3),
                FiniteF64::new(compute_stats::statistics::iqr(&values)),
            )
        } else {
            (None, None, None)
        };

        ChartStatistics {
            mean: FiniteF64::new(compute_stats::statistics::mean(&values)),
            median: FiniteF64::new(compute_stats::statistics::median(&values)),
            std_dev: FiniteF64::new(compute_stats::statistics::std_dev(&values)),
            sample_std_dev: FiniteF64::new(compute_stats::statistics::sample_std_dev(&values)),
            min: FiniteF64::new(compute_stats::statistics::min_val(&values)),
            max: FiniteF64::new(compute_stats::statistics::max_val(&values)),
            variance: FiniteF64::new(compute_stats::statistics::variance(&values)),
            sample_variance: FiniteF64::new(compute_stats::statistics::sample_variance(&values)),
            sum: FiniteF64::new(compute_stats::statistics::sum(&values)),
            range: FiniteF64::new(compute_stats::statistics::range(&values)),
            q1,
            q3,
            iqr,
        }
    }
}

// ===========================================================================
// Format / Date-Time
// ===========================================================================

/// Stateless number/date formatting and parsing utilities.
pub struct FormatBridge;

#[bridge::api(group = "format", fn_prefix = "compute", crate_path = "compute_core")]
impl FormatBridge {
    /// Prepare a date value (serial number + format code) from Y/M/D.
    #[bridge::pure]
    pub fn prepare_date_value(
        year: i32,
        month: u32,
        day: u32,
        existing_format: Option<String>,
    ) -> compute_formats::DateValueResult {
        compute_formats::prepare_date_value(year, month, day, existing_format.as_deref())
    }

    /// Prepare a time value (serial number + format code) from H/M/S.
    #[bridge::pure]
    pub fn prepare_time_value(
        hours: u32,
        minutes: u32,
        seconds: u32,
        existing_format: Option<String>,
    ) -> compute_formats::DateValueResult {
        compute_formats::prepare_time_value(hours, minutes, seconds, existing_format.as_deref())
    }

    /// Detect the format type category from a number format code string.
    ///
    /// Returns one of: "General", "Number", "Currency", "Accounting", "Date",
    /// "Time", "Percentage", "Fraction", "Scientific", "Text", "Special", "Custom".
    /// These match the TS `NumberFormatCategory` enum values.
    #[bridge::pure]
    pub fn detect_format_type(format_code: String) -> String {
        let ft = compute_formats::detect_format_type(&format_code);
        match ft {
            compute_formats::FormatType::General => "General",
            compute_formats::FormatType::Number => "Number",
            compute_formats::FormatType::Currency => "Currency",
            compute_formats::FormatType::Accounting => "Accounting",
            compute_formats::FormatType::Date => "Date",
            compute_formats::FormatType::Time => "Time",
            compute_formats::FormatType::Percentage => "Percentage",
            compute_formats::FormatType::Fraction => "Fraction",
            compute_formats::FormatType::Scientific => "Scientific",
            compute_formats::FormatType::Text => "Text",
            compute_formats::FormatType::Special => "Special",
            compute_formats::FormatType::Custom => "Custom",
        }
        .to_string()
    }

    /// Classify a cell value into a RangeValueType string.
    ///
    /// Returns one of: "Empty", "String", "Double", "Boolean", "Error".
    /// These match the TS `RangeValueType` enum values.
    #[bridge::pure]
    pub fn classify_value_type(value: Option<CellValue>) -> String {
        match value {
            None => "Empty",
            Some(CellValue::Null) => "Empty",
            Some(CellValue::Text(ref s)) if s.is_empty() => "Empty",
            Some(CellValue::Text(ref s)) if s.starts_with('#') => "Error",
            Some(CellValue::Text(_)) => "String",
            Some(CellValue::Number(_)) => "Double",
            Some(CellValue::Boolean(_)) => "Boolean",
            Some(CellValue::Error(..)) => "Error",
            Some(CellValue::Array(_)) => "String",
            Some(CellValue::Control(_)) => "Boolean",
            Some(CellValue::Image(_)) => "String",
        }
        .to_string()
    }
}

// ===========================================================================
// Schema
// ===========================================================================

/// Stateless schema validation and inference functions.
pub struct SchemaBridge;

#[bridge::api(
    group = "schema_utils",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl SchemaBridge {
    /// Validate a cell value against a column schema.
    #[bridge::pure]
    pub fn schema_validate(
        value: CellValue,
        schema: compute_schema::ColumnSchema,
    ) -> compute_schema::ValidationResult {
        compute_schema::validator::validate(&value, &schema)
    }

    /// Resolve the editor type for a given input.
    #[bridge::pure]
    pub fn schema_resolve_editor(
        input: compute_schema::editor::EditorTypeResolutionInput,
    ) -> compute_schema::EditorTypeResolutionResult {
        compute_schema::editor::resolve_editor_type(&input)
    }

    /// Infer a schema type from a single cell value.
    #[bridge::pure]
    pub fn schema_infer_type(value: CellValue) -> compute_schema::SchemaType {
        compute_schema::inference::infer_type(&value)
    }

    /// Infer a column schema from multiple values.
    #[bridge::pure]
    pub fn schema_infer_column(values: Vec<CellValue>) -> compute_schema::InferredSchema {
        compute_schema::inference::infer_column_schema(&values)
    }
}

// ===========================================================================
// CF Presets
// ===========================================================================

/// Stateless conditional formatting preset functions.
pub struct CfBridge;

#[bridge::api(
    group = "cf_presets",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl CfBridge {
    /// Get all built-in data bar presets.
    #[bridge::pure]
    pub fn get_data_bar_presets() -> Vec<compute_cf::types::CFDataBar> {
        crate::cf::presets::data_bar_presets().to_vec()
    }

    /// Get all built-in color scale presets.
    #[bridge::pure]
    pub fn get_color_scale_presets() -> Vec<compute_cf::types::CFColorScale> {
        crate::cf::presets::color_scale_presets().to_vec()
    }

    /// Get all built-in icon set preset names.
    #[bridge::pure]
    pub fn get_icon_set_preset_names() -> Vec<compute_cf::types::CFIconSetName> {
        crate::cf::presets::icon_set_preset_names().to_vec()
    }

    /// Get all CF presets (data bars, color scales, icon set names) in one call.
    #[bridge::pure]
    pub fn get_cf_presets() -> CfPresets {
        CfPresets {
            data_bars: crate::cf::presets::data_bar_presets().to_vec(),
            color_scales: crate::cf::presets::color_scale_presets().to_vec(),
            icon_set_names: crate::cf::presets::icon_set_preset_names().to_vec(),
        }
    }
}

/// Combined CF preset response returned by `get_cf_presets()`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CfPresets {
    pub data_bars: Vec<compute_cf::types::CFDataBar>,
    pub color_scales: Vec<compute_cf::types::CFColorScale>,
    pub icon_set_names: Vec<compute_cf::types::CFIconSetName>,
}

// ===========================================================================
// Clock
// ===========================================================================

/// Stateless clock injection for NOW()/TODAY().
pub struct ClockBridge;

#[bridge::api(group = "clock", fn_prefix = "compute", crate_path = "compute_core")]
impl ClockBridge {
    /// Set the global "current time" for NOW()/TODAY() as an Excel serial date number.
    ///
    /// On WASM, this should be called from JavaScript before each recalc.
    /// On native targets, this overrides the system clock (useful for testing).
    /// Pass `0.0` to clear the override (native falls back to system clock).
    #[bridge::pure]
    pub fn set_current_time(timestamp_serial: f64) {
        crate::eval::clock::set_current_time(timestamp_serial);
    }
}
