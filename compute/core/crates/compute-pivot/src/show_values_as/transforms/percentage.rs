use super::ShowValuesAsTransform;
use crate::show_values_as::ShowValuesAsContext;
use crate::types::PivotRow;
use crate::values::kahan_sum;
use value_types::CellValue;

pub(super) struct PercentOfRowTotal;

impl ShowValuesAsTransform for PercentOfRowTotal {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        // Flat iteration — groups are received but we iterate all data rows
        for &row_idx in groups.iter().flatten() {
            let Some(local_i) = ctx.local_index_for_row(row_idx) else {
                continue;
            };
            let row_total = ctx.row_total(local_i, value_index);

            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], row_total) {
                    (CellValue::Number(val), Some(rt)) => CellValue::number(val.get() / rt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_subtotal_peers(
        &self,
        rows: &mut [PivotRow],
        _depth: usize,
        peers: &[usize],
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for &row_idx in peers {
            let row_total = ctx.compute_row_total(&rows[row_idx], value_index);
            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], row_total) {
                    (CellValue::Number(val), Some(rt)) => CellValue::number(val.get() / rt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_grand_total(
        &self,
        rows: &mut [PivotRow],
        row_idx: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        let row_total = ctx.compute_row_total(&rows[row_idx], value_index);
        for c in 0..ctx.column_count {
            let idx = c * ctx.value_count + value_index;
            if idx >= rows[row_idx].values.len() {
                continue;
            }
            rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], row_total) {
                (CellValue::Number(val), Some(rt)) => CellValue::number(val.get() / rt),
                _ => CellValue::Null,
            };
        }
    }
}

pub(super) struct PercentOfParentRowTotal;

impl ShowValuesAsTransform for PercentOfParentRowTotal {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for &row_idx in groups.iter().flatten() {
            let parent_total = Self::find_parent_total(rows, row_idx, value_index, ctx);

            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], parent_total) {
                    (CellValue::Number(val), Some(pt)) => CellValue::number(val.get() / pt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_subtotal_peers(
        &self,
        rows: &mut [PivotRow],
        _depth: usize,
        peers: &[usize],
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for &row_idx in peers {
            let subtotal_depth = rows[row_idx].depth;
            let sub_parent_depth = if subtotal_depth > 0 {
                Some(subtotal_depth - 1)
            } else {
                None
            };

            let parent_total = if let Some(pd) = sub_parent_depth {
                ctx.hierarchy
                    .subtotal_at_depth(row_idx, pd)
                    .and_then(|sub_idx| {
                        let values_iter = (0..ctx.column_count).filter_map(|c| {
                            let idx = c * ctx.value_count + value_index;
                            rows.get(sub_idx)
                                .and_then(|r| r.values.get(idx))
                                .and_then(value_types::CellValue::as_number)
                        });
                        let total = kahan_sum(values_iter);
                        if total == 0.0 { None } else { Some(total) }
                    })
            } else {
                ctx.grand_total_for_value(value_index)
            };

            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], parent_total) {
                    (CellValue::Number(val), Some(pt)) => CellValue::number(val.get() / pt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_grand_total(
        &self,
        rows: &mut [PivotRow],
        row_idx: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        ShowValuesAsContext::set_row_values_to(
            rows,
            row_idx,
            value_index,
            1.0,
            ctx.column_count,
            ctx.value_count,
        );
    }
}

impl PercentOfParentRowTotal {
    fn find_parent_total(
        rows: &[PivotRow],
        row_idx: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) -> Option<f64> {
        let row_depth = rows.get(row_idx)?.depth;
        if row_depth == 0 {
            return ctx.grand_total_for_value(value_index);
        }

        let parent_depth = row_depth - 1;
        if let Some(total) = ctx
            .hierarchy
            .subtotal_at_depth(row_idx, parent_depth)
            .and_then(|sub_idx| {
                let values_iter = (0..ctx.column_count).filter_map(|c| {
                    let idx = c * ctx.value_count + value_index;
                    rows.get(sub_idx)
                        .and_then(|r| r.values.get(idx))
                        .and_then(value_types::CellValue::as_number)
                });
                let total = kahan_sum(values_iter);
                if total == 0.0 { None } else { Some(total) }
            })
        {
            return Some(total);
        }

        ctx.parent_row_total(row_idx, row_depth, value_index)
    }
}

pub(super) struct PercentOfParentColumnTotal;

impl ShowValuesAsTransform for PercentOfParentColumnTotal {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        let parent_depth = if depth > 0 { Some(depth - 1) } else { None };

        for &row_idx in groups.iter().flatten() {
            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                let parent_col_total =
                    Self::find_parent_col_total(rows, row_idx, c, parent_depth, value_index, ctx);
                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], parent_col_total) {
                    (CellValue::Number(val), Some(pt)) => CellValue::number(val.get() / pt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_subtotal_peers(
        &self,
        rows: &mut [PivotRow],
        _depth: usize,
        peers: &[usize],
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for &row_idx in peers {
            let subtotal_depth = rows[row_idx].depth;
            let sub_parent_depth = if subtotal_depth > 0 {
                Some(subtotal_depth - 1)
            } else {
                None
            };

            for c in 0..ctx.column_count {
                let idx = c * ctx.value_count + value_index;
                if idx >= rows[row_idx].values.len() {
                    continue;
                }
                let parent_col_total = if let Some(pd) = sub_parent_depth {
                    ctx.hierarchy
                        .subtotal_at_depth(row_idx, pd)
                        .and_then(|sub_idx| {
                            rows.get(sub_idx)
                                .and_then(|r| r.values.get(idx))
                                .and_then(value_types::CellValue::as_number)
                        })
                        .filter(|n| *n != 0.0)
                } else {
                    ctx.column_total(c, value_index)
                };

                rows[row_idx].values[idx] = match (&rows[row_idx].values[idx], parent_col_total) {
                    (CellValue::Number(val), Some(pt)) => CellValue::number(val.get() / pt),
                    _ => CellValue::Null,
                };
            }
        }
    }

    fn transform_grand_total(
        &self,
        rows: &mut [PivotRow],
        row_idx: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        ShowValuesAsContext::set_row_values_to(
            rows,
            row_idx,
            value_index,
            1.0,
            ctx.column_count,
            ctx.value_count,
        );
    }
}

impl PercentOfParentColumnTotal {
    fn find_parent_col_total(
        rows: &[PivotRow],
        row_idx: usize,
        c: usize,
        parent_depth: Option<usize>,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) -> Option<f64> {
        let idx = c * ctx.value_count + value_index;
        if let Some(pd) = parent_depth {
            ctx.hierarchy
                .subtotal_at_depth(row_idx, pd)
                .and_then(|sub_idx| {
                    rows.get(sub_idx)
                        .and_then(|r| r.values.get(idx))
                        .and_then(value_types::CellValue::as_number)
                })
                .filter(|n| *n != 0.0)
        } else {
            ctx.column_total(c, value_index)
        }
    }
}
