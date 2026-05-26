use super::ShowValuesAsTransform;
use crate::show_values_as::ShowValuesAsContext;
use crate::types::PivotRow;
use crate::values::cell_value_eq;
use value_types::CellValue;

pub(super) struct Rank {
    pub(super) ascending: bool,
}

impl ShowValuesAsTransform for Rank {
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        _depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        for group in groups {
            Self::rank_group(rows, group, value_index, ctx, self.ascending);
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
        Self::rank_group(rows, peers, value_index, ctx, self.ascending);
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

impl Rank {
    /// Assign ranks to a group of row indices for a specific column/value.
    #[allow(clippy::cast_precision_loss)]
    fn rank_group(
        rows: &mut [PivotRow],
        group: &[usize],
        value_index: usize,
        ctx: &ShowValuesAsContext,
        ascending: bool,
    ) {
        for c in 0..ctx.column_count {
            let val_idx = c * ctx.value_count + value_index;

            let mut entries: Vec<(usize, f64)> = Vec::new();
            let mut null_positions: Vec<usize> = Vec::new();

            for (pos, &row_idx) in group.iter().enumerate() {
                if val_idx < rows[row_idx].values.len() {
                    if let CellValue::Number(n) = &rows[row_idx].values[val_idx] {
                        entries.push((pos, n.get()));
                    } else {
                        null_positions.push(pos);
                    }
                }
            }

            if ascending {
                entries.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            } else {
                entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            }

            let mut ranks: Vec<(usize, usize)> = Vec::with_capacity(entries.len());
            let mut current_rank = 1_usize;

            for i in 0..entries.len() {
                let (pos, value) = entries[i];
                if i > 0 {
                    let (_, prev_value) = entries[i - 1];
                    if cell_value_eq(&CellValue::number(prev_value), &CellValue::number(value)) {
                        let prev_rank = ranks[i - 1].1;
                        ranks.push((pos, prev_rank));
                    } else {
                        ranks.push((pos, current_rank));
                    }
                } else {
                    ranks.push((pos, current_rank));
                }
                current_rank += 1;
            }

            for (pos, rank) in &ranks {
                let row_idx = group[*pos];
                if val_idx < rows[row_idx].values.len() {
                    rows[row_idx].values[val_idx] = CellValue::number(*rank as f64);
                }
            }

            for pos in &null_positions {
                let row_idx = group[*pos];
                if val_idx < rows[row_idx].values.len() {
                    rows[row_idx].values[val_idx] = CellValue::Null;
                }
            }
        }
    }
}
