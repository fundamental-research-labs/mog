use super::ShowValuesAsTransform;
use crate::show_values_as::ShowValuesAsContext;
use crate::types::PivotRow;
use value_types::CellValue;

pub(super) struct Index {
    pub(super) grand_total: f64,
}

impl ShowValuesAsTransform for Index {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for &row_idx in groups.iter().flatten() {
            let Some(local_i) = ctx.local_index_for_row(row_idx) else {
                continue;
            };
            let rt = ctx.row_total(local_i, value_index);

            for c in 0..ctx.column_count {
                let val_idx = c * ctx.value_count + value_index;
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }

                let ct = ctx.column_total(c, value_index);

                rows[row_idx].values[val_idx] = match (&rows[row_idx].values[val_idx], rt, ct) {
                    (CellValue::Number(val), Some(r), Some(col)) => {
                        CellValue::number((val.get() * self.grand_total) / (r * col))
                    }
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
            let rt = ctx.compute_row_total(&rows[row_idx], value_index);

            for c in 0..ctx.column_count {
                let val_idx = c * ctx.value_count + value_index;
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }

                let ct = ctx.column_total(c, value_index);

                rows[row_idx].values[val_idx] = match (&rows[row_idx].values[val_idx], rt, ct) {
                    (CellValue::Number(val), Some(r), Some(col)) => {
                        CellValue::number((val.get() * self.grand_total) / (r * col))
                    }
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
