use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
use value_types::CellValue;

/// Compute the cutoff count for a top/bottom filter from sorted numeric values.
///
/// Modes:
/// - `Items`: take the first `count` entries
/// - `Percent`: take `count`% of the total item count (rounded up, at least 1)
/// - `Sum`: take entries until their absolute values reach `count`% of total absolute sum
pub(super) fn compute_top_bottom_cutoff(
    sorted_values: &[f64],
    count: usize,
    by: TopBottomBy,
) -> usize {
    let len = sorted_values.len();
    if len == 0 {
        return 0;
    }

    match by {
        TopBottomBy::Items => count.min(len),

        TopBottomBy::Percent => {
            let cutoff = ((count as f64 / 100.0) * len as f64).ceil() as usize;
            cutoff.max(1).min(len)
        }

        TopBottomBy::Sum => {
            let total_sum: f64 = sorted_values.iter().map(|v| v.abs()).sum();
            if total_sum == 0.0 {
                return len;
            }
            let target_sum = (count as f64 / 100.0) * total_sum;
            let mut running_sum = 0.0;
            let mut cutoff = 0;
            for v in sorted_values {
                running_sum += v.abs();
                cutoff += 1;
                if running_sum >= target_sum {
                    break;
                }
            }
            cutoff
        }
    }
}

/// Evaluate a TableTopBottomFilter directly to a bitmap using a value cutoff.
///
/// Excel's Top/Bottom filters include every row tied at the boundary value. The
/// cutoff is still computed from the requested item/percent/sum target, but the
/// final bitmap is selected by comparing values with that boundary rather than
/// by selecting arbitrary sorted indices.
pub fn evaluate_top_bottom_direct(
    spec: &TableTopBottomFilter,
    column_data: &[CellValue],
) -> Vec<u8> {
    let len = column_data.len();
    let mut bitmap = vec![0u8; len]; // all 0 (hidden)

    // Extract numeric values with their original row indices
    let mut numeric_entries: Vec<(f64, usize)> = Vec::new();
    for (i, v) in column_data.iter().enumerate() {
        if let CellValue::Number(n) = v {
            // FiniteF64 is always finite by construction, no guard needed.
            numeric_entries.push((n.get(), i));
        }
    }

    if numeric_entries.is_empty() {
        return bitmap;
    }

    // Sort: Top = descending, Bottom = ascending
    match spec.direction {
        TopBottomDirection::Top => {
            numeric_entries
                .sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        }
        TopBottomDirection::Bottom => {
            numeric_entries
                .sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        }
    }

    let sorted_values: Vec<f64> = numeric_entries.iter().map(|(v, _)| *v).collect();
    let count = if spec.count.is_finite() && spec.count >= 0.0 {
        spec.count as usize
    } else {
        0
    };
    let cutoff_count = compute_top_bottom_cutoff(&sorted_values, count, spec.by);

    if cutoff_count == 0 {
        return bitmap;
    }

    let boundary = numeric_entries[cutoff_count - 1].0;

    // Include every row tied at the cutoff, using ORIGINAL indices for the
    // output bitmap. Non-numeric cells were omitted from numeric_entries and
    // therefore remain hidden.
    for (value, original_index) in numeric_entries {
        let selected = match spec.direction {
            TopBottomDirection::Top => value >= boundary,
            TopBottomDirection::Bottom => value <= boundary,
        };
        if selected {
            bitmap[original_index] = 1;
        }
    }

    bitmap
}
