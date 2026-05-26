use super::ShowValuesAsTransform;
use crate::show_values_as::ShowValuesAsContext;
use crate::types::PivotRow;
use value_types::CellValue;

pub(super) struct RunningTotal;

impl ShowValuesAsTransform for RunningTotal {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for group in groups {
            for c in 0..ctx.column_count {
                let val_idx = c * ctx.value_count + value_index;
                let mut sum = 0.0_f64;
                let mut compensation = 0.0_f64;

                for &row_idx in group {
                    if val_idx >= rows[row_idx].values.len() {
                        continue;
                    }
                    if let CellValue::Number(n) = &rows[row_idx].values[val_idx] {
                        let y = n.get() - compensation;
                        let t = sum + y;
                        compensation = (t - sum) - y;
                        sum = t;
                    }
                    rows[row_idx].values[val_idx] = CellValue::number(sum);
                }
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
        for c in 0..ctx.column_count {
            let val_idx = c * ctx.value_count + value_index;
            let mut sum = 0.0_f64;
            let mut compensation = 0.0_f64;

            for &row_idx in peers {
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }
                if let CellValue::Number(n) = &rows[row_idx].values[val_idx] {
                    let y = n.get() - compensation;
                    let t = sum + y;
                    compensation = (t - sum) - y;
                    sum = t;
                }
                rows[row_idx].values[val_idx] = CellValue::number(sum);
            }
        }
    }

    fn transform_grand_total(
        &self,
        _rows: &mut [PivotRow],
        _row_idx: usize,
        _value_index: usize,
        _ctx: &ShowValuesAsContext,
    ) {
        // Grand total = final accumulated value, unchanged.
    }
}

pub(super) struct PercentRunningTotal {
    pub(super) divisor: f64,
}

impl ShowValuesAsTransform for PercentRunningTotal {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for group in groups {
            for c in 0..ctx.column_count {
                let val_idx = c * ctx.value_count + value_index;
                let mut sum = 0.0_f64;
                let mut compensation = 0.0_f64;

                for &row_idx in group {
                    if val_idx >= rows[row_idx].values.len() {
                        continue;
                    }
                    if let CellValue::Number(n) = &rows[row_idx].values[val_idx] {
                        let y = n.get() - compensation;
                        let t = sum + y;
                        compensation = (t - sum) - y;
                        sum = t;
                    }
                    rows[row_idx].values[val_idx] = CellValue::number(sum / self.divisor);
                }
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
        for c in 0..ctx.column_count {
            let val_idx = c * ctx.value_count + value_index;
            let mut sum = 0.0_f64;
            let mut compensation = 0.0_f64;

            for &row_idx in peers {
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }
                if let CellValue::Number(n) = &rows[row_idx].values[val_idx] {
                    let y = n.get() - compensation;
                    let t = sum + y;
                    compensation = (t - sum) - y;
                    sum = t;
                }
                rows[row_idx].values[val_idx] = CellValue::number(sum / self.divisor);
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
