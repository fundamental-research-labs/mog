use crate::types::{AggregateFunction, PivotRenderedBounds, PivotTableConfig};
use cell_types::SheetId;

/// Extension trait adding `to_pivot_table_def()` to `PivotTableConfig`.
///
/// This method lives here (not in `pivot-types`) because it depends on `snapshot-types`.
pub trait PivotTableDefExt {
    /// Register total addresses from the same typed slots the native renderer writes.
    fn to_pivot_table_def_from_result(
        &self,
        result: &crate::types::PivotTableResult,
        output_sheet_id: &SheetId,
    ) -> snapshot_types::PivotTableDef;

    /// Derive a lightweight `PivotTableDef` from this config and the rendered bounds.
    fn to_pivot_table_def(
        &self,
        bounds: &PivotRenderedBounds,
        output_sheet_id: &SheetId,
    ) -> snapshot_types::PivotTableDef;
}

impl PivotTableDefExt for PivotTableConfig {
    fn to_pivot_table_def_from_result(
        &self,
        result: &crate::types::PivotTableResult,
        output_sheet_id: &SheetId,
    ) -> snapshot_types::PivotTableDef {
        let mut def = self.to_pivot_table_def(&result.rendered_bounds, output_sheet_id);
        let count = def.data_field_names.len();
        let bounds = &result.rendered_bounds;
        if bounds.total_rows == 0 || bounds.total_cols == 0 || count == 0 {
            return def;
        }
        let row_groups = !def.row_field_indices.is_empty();
        let col_groups = !def.col_field_indices.is_empty();
        let location = if col_groups
            && result.grand_totals.row.is_some()
            && result.grand_totals.column.is_some()
        {
            result
                .grand_totals
                .grand
                .as_ref()
                .filter(|values| values.len() == count)
                .and_then(|_| {
                    bounds
                        .total_cols
                        .checked_sub(count as u32)
                        .map(|col| (bounds.total_rows - 1, col))
                })
        } else if !col_groups
            && result
                .grand_totals
                .row
                .as_ref()
                .is_some_and(|values| values.len() == count)
        {
            Some((bounds.total_rows - 1, bounds.first_data_col))
        } else if !row_groups && col_groups {
            result
                .grand_totals
                .column
                .as_ref()
                .filter(|rows| rows.len() == 1 && rows[0].len() == count)
                .and_then(|_| {
                    bounds
                        .total_cols
                        .checked_sub(count as u32)
                        .map(|col| (bounds.first_data_row, col))
                })
        } else if !row_groups
            && !col_groups
            && result.rows.len() == 1
            && result.rows[0].values.len() == count
        {
            Some((bounds.first_data_row, bounds.first_data_col))
        } else {
            None
        };
        if let Some((row, first_col)) = location {
            for index in 0..count {
                if row < bounds.total_rows && first_col + (index as u32) < bounds.total_cols {
                    def.grand_total_cells
                        .push(snapshot_types::PivotGrandTotalCell {
                            data_field_index: index as u32,
                            row: def.start_row + row,
                            col: def.start_col + first_col + index as u32,
                        });
                }
            }
        }
        def
    }

    #[allow(clippy::cast_possible_truncation)]
    fn to_pivot_table_def(
        &self,
        bounds: &PivotRenderedBounds,
        output_sheet_id: &SheetId,
    ) -> snapshot_types::PivotTableDef {
        let start_row = self.output_location.row;
        let start_col = self.output_location.col;

        let mut data_field_names: Vec<String> = self
            .value_placements()
            .iter()
            .map(|p| {
                if let Some(name) = p.display_name() {
                    name.to_string()
                } else {
                    let field_name = self
                        .get_field(p.field_id().as_str())
                        .map_or("?", |f| f.name.as_str());
                    let agg = p.aggregate_function().unwrap_or(AggregateFunction::Sum);
                    format!("{} of {}", agg_label(agg), field_name)
                }
            })
            .collect();

        if let Some(calculated_fields) = &self.calculated_fields {
            data_field_names.extend(calculated_fields.iter().map(|field| field.name.clone()));
        }

        let cache_field_names: Vec<String> = self.fields.iter().map(|f| f.name.clone()).collect();

        let row_field_indices: Vec<u32> = self
            .row_placements()
            .iter()
            .filter_map(|p| {
                self.fields
                    .iter()
                    .position(|f| f.id.as_str() == p.field_id().as_str())
                    .map(|i| i as u32)
            })
            .collect();

        let col_field_indices: Vec<u32> = self
            .column_placements()
            .iter()
            .filter_map(|p| {
                self.fields
                    .iter()
                    .position(|f| f.id.as_str() == p.field_id().as_str())
                    .map(|i| i as u32)
            })
            .collect();

        let end_row = if bounds.total_rows == 0 {
            start_row
        } else {
            start_row
                .saturating_add(bounds.total_rows)
                .saturating_sub(1)
        };
        let end_col = if bounds.total_cols == 0 {
            start_col
        } else {
            start_col
                .saturating_add(bounds.total_cols)
                .saturating_sub(1)
        };

        snapshot_types::PivotTableDef {
            grand_total_cells: Vec::new(),
            id: self.id.clone(),
            name: self.name.clone(),
            sheet: output_sheet_id.to_uuid_string(),
            start_row,
            start_col,
            end_row,
            end_col,
            rendered_rows: Some(bounds.total_rows),
            rendered_cols: Some(bounds.total_cols),
            first_data_row: bounds.first_data_row,
            first_data_col: bounds.first_data_col,
            data_field_names,
            cache_field_names,
            row_field_indices,
            col_field_indices,
            data_on_rows: false,
            style: self.style.clone(),
            show_row_grand_totals: self
                .layout
                .as_ref()
                .and_then(|layout| layout.show_row_grand_totals),
            show_column_grand_totals: self
                .layout
                .as_ref()
                .and_then(|layout| layout.show_column_grand_totals),
        }
    }
}

fn agg_label(agg: AggregateFunction) -> &'static str {
    match agg {
        AggregateFunction::Count | AggregateFunction::CountA | AggregateFunction::CountUnique => {
            "Count"
        }
        AggregateFunction::Average => "Average",
        AggregateFunction::Min => "Min",
        AggregateFunction::Max => "Max",
        AggregateFunction::Product => "Product",
        AggregateFunction::StdDev => "StdDev",
        AggregateFunction::StdDevP => "StdDevP",
        AggregateFunction::Var => "Var",
        AggregateFunction::VarP => "VarP",
        // Sum is default for unknown variants
        _ => "Sum",
    }
}
