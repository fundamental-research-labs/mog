use super::ShowValuesAsTransform;
use crate::show_values_as::ShowValuesAsContext;
use crate::types::{PivotRow, RelativePosition, ShowValuesAsBaseItem};
use value_types::CellValue;

/// Whether to compute absolute or percent difference.
#[derive(Clone, Copy)]
pub(super) enum DifferenceMode {
    Absolute,
    Percent,
}

pub(super) struct Difference {
    pub(super) mode: DifferenceMode,
    pub(super) base_item: ShowValuesAsBaseItem,
}

impl ShowValuesAsTransform for Difference {
    #[allow(clippy::needless_range_loop)]
    fn transform_leaves(
        &self,
        rows: &mut [PivotRow],
        groups: &[Vec<usize>],
        depth: usize,
        value_index: usize,
        ctx: &ShowValuesAsContext,
    ) {
        // Store original values for ALL data rows before any modification.
        let original: Vec<(usize, Vec<Option<f64>>)> = groups
            .iter()
            .flatten()
            .map(|&row_idx| {
                let vals: Vec<Option<f64>> = (0..ctx.column_count)
                    .map(|c| ctx.extract_value(rows, row_idx, c, value_index))
                    .collect();
                (row_idx, vals)
            })
            .collect();

        let original_lookup: std::collections::HashMap<usize, usize> = original
            .iter()
            .enumerate()
            .map(|(i, (row_idx, _))| (*row_idx, i))
            .collect();

        for (row_idx, col_values) in &original {
            let row_idx = *row_idx;
            let base_row_idx = Self::find_base_row(row_idx, depth, &self.base_item, ctx, rows);
            let base_orig_i = base_row_idx.and_then(|bri| original_lookup.get(&bri).copied());

            for c in 0..ctx.column_count {
                let val_idx = c * ctx.value_count + value_index;
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }

                let current = col_values[c];
                let base = base_orig_i.and_then(|bi| original[bi].1[c]);

                rows[row_idx].values[val_idx] = match (current, base, &self.mode) {
                    (Some(v), Some(b), DifferenceMode::Absolute) => CellValue::number(v - b),
                    (Some(v), Some(b), DifferenceMode::Percent) if b != 0.0 => {
                        CellValue::number((v - b) / b)
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
        // Store originals for these subtotals
        let sub_original: Vec<(usize, Vec<Option<f64>>)> = peers
            .iter()
            .map(|&row_idx| {
                let vals: Vec<Option<f64>> = (0..ctx.column_count)
                    .map(|c| ctx.extract_value(rows, row_idx, c, value_index))
                    .collect();
                (row_idx, vals)
            })
            .collect();

        for (i, (row_idx, col_values)) in sub_original.iter().enumerate() {
            let row_idx = *row_idx;
            let base_i = match &self.base_item {
                ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Previous,
                } => {
                    if i > 0 {
                        Some(i - 1)
                    } else {
                        None
                    }
                }
                ShowValuesAsBaseItem::Relative {
                    position: RelativePosition::Next,
                } => {
                    if i + 1 < sub_original.len() {
                        Some(i + 1)
                    } else {
                        None
                    }
                }
                _ => None,
            };

            for (c, &current) in col_values.iter().enumerate().take(ctx.column_count) {
                let val_idx = c * ctx.value_count + value_index;
                if val_idx >= rows[row_idx].values.len() {
                    continue;
                }
                let base = base_i.and_then(|bi| sub_original[bi].1[c]);

                rows[row_idx].values[val_idx] = match (current, base, &self.mode) {
                    (Some(v), Some(b), DifferenceMode::Absolute) => CellValue::number(v - b),
                    (Some(v), Some(b), DifferenceMode::Percent) if b != 0.0 => {
                        CellValue::number((v - b) / b)
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
        for c in 0..ctx.column_count {
            let val_idx = c * ctx.value_count + value_index;
            if val_idx < rows[row_idx].values.len() {
                rows[row_idx].values[val_idx] = CellValue::Null;
            }
        }
    }
}

impl Difference {
    /// Find the base row for Difference/PercentDifference navigation.
    fn find_base_row(
        row_idx: usize,
        depth: usize,
        base_item: &ShowValuesAsBaseItem,
        ctx: &ShowValuesAsContext,
        rows: &[PivotRow],
    ) -> Option<usize> {
        match base_item {
            ShowValuesAsBaseItem::Relative {
                position: RelativePosition::Previous,
            } => ctx.hierarchy.previous_sibling(row_idx, depth),
            ShowValuesAsBaseItem::Relative {
                position: RelativePosition::Next,
            } => ctx.hierarchy.next_sibling(row_idx, depth),
            ShowValuesAsBaseItem::Specific { value } => ctx
                .hierarchy
                .find_sibling_by_value(row_idx, depth, rows, value),
            ShowValuesAsBaseItem::Relative { .. } => None,
        }
    }
}
