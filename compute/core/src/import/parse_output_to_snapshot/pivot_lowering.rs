//! Pivot-table lowering — boundary 1.17.
//!
//! Convert `ParsedPivotTable` → `snapshot_types::PivotTableDef`.
//!
//! Pivot tables in `ParseOutput` use `ParsedPivotTable` which wraps a
//! `PivotTableConfig` (compute-level config) + optional OOXML preservation data.
//! We extract the structural metadata needed for GETPIVOTDATA lookup.

use domain_types::ParseOutput;
use snapshot_types::PivotTableDef;

use crate::import::phantom::parse_range_ref;

use super::SheetResolver;

pub(crate) fn convert_pivot_tables(
    output: &ParseOutput,
    resolver: &SheetResolver<'_>,
) -> Vec<PivotTableDef> {
    output
        .pivot_tables
        .iter()
        .filter_map(|pt| {
            let config = &pt.config;

            // Resolve output sheet name to sheet UUID.
            let sheet_uuid = resolver.by_name(&config.output_sheet_name)?.to_string();

            // Output location from config anchor cell.
            let start_row = config.output_location.row;
            let start_col = config.output_location.col;

            // Derive pivot region bounds from the actual cells on the output sheet.
            // We scan cells to find the last occupied row/col within the pivot's
            // column range, since the config alone doesn't carry row counts.
            let num_row_fields = config.row_placements().len() as u32;
            let num_data_fields = config.value_placements().len().max(1) as u32;
            let has_col_fields = !config.column_placements().is_empty();
            let first_data_row: u32 =
                config
                    .first_data_row
                    .unwrap_or(if has_col_fields { 2 } else { 1 });
            let first_data_col = config.first_data_col.unwrap_or(num_row_fields.max(1));

            let parsed_ref_range = config.ref_range.as_deref().and_then(|ref_range| {
                let (_sheet, range) = compute_parser::split_sheet_prefix(ref_range);
                parse_range_ref(range)
            });

            // Scan the output sheet to find the actual extent of the pivot region.
            let est_cols = first_data_col + num_data_fields;
            let est_end_col = start_col + est_cols.saturating_sub(1);
            let (end_row, end_col) = parsed_ref_range
                .map(
                    |(_ref_start_row, _ref_start_col, ref_end_row, ref_end_col)| {
                        (ref_end_row, ref_end_col)
                    },
                )
                .or_else(|| {
                    output
                        .sheets
                        .iter()
                        .find(|s| s.name == config.output_sheet_name)
                        .map(|sheet| {
                            let mut max_row = start_row;
                            let mut max_col = est_end_col;
                            for cell in &sheet.cells {
                                if cell.row >= start_row
                                    && cell.col >= start_col
                                    && cell.col <= est_end_col
                                    && !matches!(cell.value, value_types::CellValue::Null)
                                {
                                    if cell.row > max_row {
                                        max_row = cell.row;
                                    }
                                    if cell.col > max_col {
                                        max_col = cell.col;
                                    }
                                }
                            }
                            (max_row, max_col)
                        })
                })
                .unwrap_or((start_row + first_data_row, est_end_col));

            // Data field display names from value placements.
            let data_field_names: Vec<String> = config
                .value_placements()
                .iter()
                .map(|p| {
                    p.display_name().map(|s| s.to_string()).unwrap_or_else(|| {
                        let field_name = config
                            .get_field(p.field_id().as_str())
                            .map(|f| f.name.as_str())
                            .unwrap_or("?");
                        format!("Sum of {}", field_name)
                    })
                })
                .collect();

            // Cache field names come from config.fields.
            let cache_field_names: Vec<String> =
                config.fields.iter().map(|f| f.name.clone()).collect();

            let row_field_indices: Vec<u32> = config
                .row_placements()
                .iter()
                .filter_map(|p| {
                    config
                        .fields
                        .iter()
                        .position(|f| f.id.as_str() == p.field_id().as_str())
                        .map(|i| i as u32)
                })
                .collect();

            let col_field_indices: Vec<u32> = config
                .column_placements()
                .iter()
                .filter_map(|p| {
                    config
                        .fields
                        .iter()
                        .position(|f| f.id.as_str() == p.field_id().as_str())
                        .map(|i| i as u32)
                })
                .collect();

            let data_on_rows = config.data_on_rows.unwrap_or_else(|| {
                config.value_placements().len() > 1 && config.column_placements().is_empty()
            });

            Some(PivotTableDef {
                id: config.id.clone(),
                name: config.name.clone(),
                sheet: sheet_uuid,
                start_row,
                start_col,
                end_row,
                end_col,
                rendered_rows: Some(end_row.saturating_sub(start_row).saturating_add(1)),
                rendered_cols: Some(end_col.saturating_sub(start_col).saturating_add(1)),
                first_data_row,
                first_data_col,
                data_field_names,
                cache_field_names,
                row_field_indices,
                col_field_indices,
                data_on_rows,
                style: config.style.clone(),
                show_row_grand_totals: config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_row_grand_totals),
                show_column_grand_totals: config
                    .layout
                    .as_ref()
                    .and_then(|layout| layout.show_column_grand_totals),
            })
        })
        .collect()
}
