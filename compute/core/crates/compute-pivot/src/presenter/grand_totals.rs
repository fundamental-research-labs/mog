use std::collections::HashMap;

use compute_relational::QueryGrandTotals;
use value_types::CellValue;

use crate::calc_field::CalcFieldExpr;
use crate::engine::SUBTOTAL_SUFFIX;
use crate::resolved::ResolvedPivotConfig;
use crate::types::{PivotField, PivotGrandTotals, PivotRow};

/// Build `PivotGrandTotals` from `QueryGrandTotals`.
pub(super) fn build_grand_totals(
    query_gt: &QueryGrandTotals,
    pivot_rows: &[PivotRow],
    config: &ResolvedPivotConfig,
    _measure_count: usize,
    num_column_leaves: usize,
) -> PivotGrandTotals {
    let resolved_calc_fields = config.calculated_fields();
    let has_calc_fields = !resolved_calc_fields.is_empty();
    let num_values = config.value_placements().len();

    let field_map_for_names: HashMap<&str, &PivotField> =
        config.fields().iter().map(|f| (f.id.as_ref(), f)).collect();

    let value_field_names: Vec<String> = if has_calc_fields {
        config
            .value_placements()
            .iter()
            .map(|vp| {
                field_map_for_names
                    .get(vp.field_id().as_ref())
                    .map(|f| f.name.clone())
                    .unwrap_or_default()
            })
            .collect()
    } else {
        vec![]
    };

    let parsed_refs: Vec<Option<&CalcFieldExpr>> = if has_calc_fields {
        resolved_calc_fields
            .iter()
            .map(|cf| Some(cf.parsed_expr()))
            .collect()
    } else {
        vec![]
    };

    let mut row = query_gt.row.clone();
    if has_calc_fields && let Some(ref row_gt) = row {
        row = Some(crate::engine::row_computation::apply_calc_fields_to_values(
            row_gt,
            num_column_leaves,
            num_values,
            &parsed_refs,
            &value_field_names,
        ));
    }
    if row.is_none()
        && config.layout().show_row_grand_totals()
        && !config.row_placements().is_empty()
    {
        row = Some(Vec::new());
    }

    let mut column: Option<Vec<Vec<CellValue>>> = query_gt.column.as_ref().map(|col_map| {
        pivot_rows
            .iter()
            .map(|pr| {
                let lookup_key = if pr.is_subtotal {
                    pr.key.strip_suffix(SUBTOTAL_SUFFIX).unwrap_or(&pr.key)
                } else {
                    &pr.key
                };
                col_map.get(lookup_key).cloned().unwrap_or_default()
            })
            .collect()
    });

    if has_calc_fields && let Some(ref col_gt) = column {
        let new_col_gt: Vec<Vec<CellValue>> = col_gt
            .iter()
            .map(|row_values| {
                crate::engine::row_computation::apply_calc_fields_to_values(
                    row_values,
                    1,
                    num_values,
                    &parsed_refs,
                    &value_field_names,
                )
            })
            .collect();
        column = Some(new_col_gt);
    }
    if column.is_none()
        && config.layout().show_column_grand_totals()
        && !config.column_placements().is_empty()
    {
        column = Some(vec![Vec::new(); pivot_rows.len()]);
    }

    let mut grand = query_gt.corner.clone();
    if has_calc_fields && let Some(ref grand_gt) = grand {
        grand = Some(crate::engine::row_computation::apply_calc_fields_to_values(
            grand_gt,
            1,
            num_values,
            &parsed_refs,
            &value_field_names,
        ));
    }
    if grand.is_none()
        && config.layout().show_row_grand_totals()
        && config.layout().show_column_grand_totals()
        && !config.row_placements().is_empty()
        && !config.column_placements().is_empty()
    {
        grand = Some(Vec::new());
    }

    let row_label = Some(
        config
            .layout()
            .grand_total_caption()
            .unwrap_or("Grand Total")
            .to_string(),
    );

    PivotGrandTotals {
        row,
        column,
        grand,
        row_label,
    }
}
