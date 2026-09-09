//! Resolve overall-total cells from authored OOXML axis items, never cell labels.
use domain_types::domain::pivot::{PivotItemType, PivotRowColItem, PivotTableConfig};
use snapshot_types::PivotGrandTotalCell;

pub(crate) fn imported_grand_total_cells(config: &PivotTableConfig) -> Vec<PivotGrandTotalCell> {
    let measures = config.value_placements().len();
    let on_rows = config.data_on_rows.unwrap_or(false);
    let row_groups = !config.row_placements().is_empty();
    let col_groups = !config.column_placements().is_empty();
    let (Some(first_row), Some(first_col)) = (config.first_data_row, config.first_data_col) else {
        return Vec::new();
    };
    (0..measures)
        .filter_map(|measure| {
            let row = axis_total_offset(
                &config.row_items,
                row_groups,
                on_rows,
                measure as u32,
                measures,
            )?;
            let col = axis_total_offset(
                &config.col_items,
                col_groups,
                !on_rows,
                measure as u32,
                measures,
            )?;
            Some(PivotGrandTotalCell {
                data_field_index: measure as u32,
                row: config
                    .output_location
                    .row
                    .checked_add(first_row)?
                    .checked_add(row)?,
                col: config
                    .output_location
                    .col
                    .checked_add(first_col)?
                    .checked_add(col)?,
            })
        })
        .collect()
}

fn axis_total_offset(
    items: &[PivotRowColItem],
    grouped: bool,
    measure_axis: bool,
    measure: u32,
    measures: usize,
) -> Option<u32> {
    if items.is_empty() {
        // A scalar axis has one data position; grouped/expanded axes require
        // explicit item records to prove the total actually exists.
        return (!grouped && (!measure_axis || measures == 1)).then_some(0);
    }
    let mut positions = items
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            let total = if grouped {
                item.item_type == Some(PivotItemType::Grand)
            } else {
                matches!(
                    item.item_type,
                    None | Some(PivotItemType::Data | PivotItemType::Grand)
                )
            };
            total && (!measure_axis || item.data_field_index == measure)
        })
        .map(|(index, _)| index as u32);
    let first = positions.next()?;
    positions.next().is_none().then_some(first)
}
