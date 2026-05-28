//! Shared statistical helpers used by multiple sub-modules.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::helpers::column_bitset::ColumnBitset;

/// Extract numbers from flattened values, treating booleans as 0/1 and text
/// that parses as number. Used by AVERAGEA, STDEVA, VARA, MAXA, MINA, etc.
pub(crate) fn extract_numbers_a(vals: &[CellValue]) -> Result<Vec<f64>, CellError> {
    let mut nums = Vec::new();
    for v in vals {
        match v {
            CellValue::Error(e, _) => return Err(*e),
            CellValue::Number(n) => nums.push(n.get()),
            CellValue::Boolean(b) => nums.push(if *b { 1.0 } else { 0.0 }),
            CellValue::Control(c) => nums.push(if c.value { 1.0 } else { 0.0 }),
            CellValue::Image(_) => {}
            CellValue::Text(s) => {
                if let Ok(n) = fast_float::parse::<f64, _>(s.trim()) {
                    nums.push(n);
                } else if !s.is_empty() {
                    nums.push(0.0);
                }
            }
            CellValue::Null => {}
            CellValue::Array(_) => {}
        }
    }
    Ok(nums)
}

/// Build a sorted copy for percentile/quartile operations.
pub(crate) fn sorted_numbers(vals: &[CellValue]) -> Result<Vec<f64>, CellError> {
    let mut nums = extract_numbers_strict(&flatten_values(vals))?;
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Ok(nums)
}

/// Linear interpolation for PERCENTILE.INC / QUARTILE.INC.
pub fn percentile_inc(sorted: &[f64], k: f64) -> f64 {
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let rank = k * (n - 1) as f64;
    let lo = rank.floor() as usize;
    let hi = lo + 1;
    let frac = rank - lo as f64;
    if hi >= n {
        sorted[lo]
    } else {
        sorted[lo] + frac * (sorted[hi] - sorted[lo])
    }
}

/// Linear interpolation for PERCENTILE.EXC / QUARTILE.EXC.
pub fn percentile_exc(sorted: &[f64], k: f64) -> Option<f64> {
    let n = sorted.len();
    let rank = k * (n + 1) as f64;
    if rank < 1.0 || rank > n as f64 {
        return None;
    }
    let lo = (rank.floor() as usize).saturating_sub(1);
    let frac = rank - rank.floor();
    if lo + 1 >= n {
        Some(sorted[lo])
    } else {
        Some(sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]))
    }
}

/// Helper to extract two parallel number arrays from two range arguments.
pub(crate) fn extract_paired_numbers(
    args: &[CellValue],
) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    let flat_x = flatten_values(&[args[0].clone()]);
    let flat_y = flatten_values(&[args[1].clone()]);
    let n = flat_x.len().min(flat_y.len());
    let mut xs = Vec::with_capacity(n);
    let mut ys = Vec::with_capacity(n);
    for i in 0..n {
        match (&flat_x[i], &flat_y[i]) {
            (CellValue::Error(e, None), _) | (_, CellValue::Error(e, None)) => return Err(*e),
            (CellValue::Number(x), CellValue::Number(y)) => {
                xs.push(x.get());
                ys.push(y.get());
            }
            _ => {} // skip pairs where either is non-numeric
        }
    }
    Ok((xs, ys))
}

/// Simple linear regression: returns (slope, intercept).
pub(crate) fn linear_regression(xs: &[f64], ys: &[f64]) -> Option<(f64, f64)> {
    let n = xs.len();
    if n < 2 {
        return None;
    }
    let nf = n as f64;
    let sum_x: f64 = xs.iter().sum();
    let sum_y: f64 = ys.iter().sum();
    let sum_xy: f64 = xs.iter().zip(ys.iter()).map(|(x, y)| x * y).sum();
    let sum_x2: f64 = xs.iter().map(|x| x * x).sum();
    let denom = nf * sum_x2 - sum_x * sum_x;
    if denom.abs() < 1e-15 {
        return None;
    }
    let slope = (nf * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / nf;
    Some((slope, intercept))
}

/// Build a bitmask of which cells match ALL criteria pairs.
///
/// Uses the bitmask cache to avoid redundant flatten + parse + scan
/// operations when multiple formula cells test the same criterion.
///
/// The matches vector length is the maximum of all criteria range lengths
/// and the sum/max/min range length (args\[0\] for SUMIFS/MAXIFS/MINIFS).
/// This ensures no rows are missed when ranges have different lengths
/// (e.g., full-column references clamped to different extents).
pub(crate) fn evaluate_multi_criteria(
    args: &[CellValue],
    criteria_start: usize,
) -> Option<ColumnBitset> {
    use crate::helpers::bitmask_cache;
    use crate::helpers::column_index;
    use crate::helpers::frequency_cache::is_exact_match_criteria;

    let criteria_count = (args.len() - criteria_start) / 2;
    if criteria_count == 0 {
        return None;
    }

    // Compute max range length without allocating Vec — use CellArray::len() directly.
    #[inline]
    fn cell_value_flat_len(v: &CellValue) -> usize {
        match v {
            CellValue::Array(arr) => arr.len(),
            _ => 1,
        }
    }

    let mut len = 0usize;
    if criteria_start > 0 {
        len = len.max(cell_value_flat_len(&args[0]));
    }
    for c in 0..criteria_count {
        let range_idx = criteria_start + c * 2;
        len = len.max(cell_value_flat_len(&args[range_idx]));
    }
    let mut matches = ColumnBitset::new_all_true(len as u32);

    let _span = tracing::info_span!(
        "eval_multi_criteria",
        criteria_count = criteria_count,
        range_len = len
    )
    .entered();

    for c in 0..criteria_count {
        let range_idx = criteria_start + c * 2;
        let crit_idx = criteria_start + c * 2 + 1;

        // Fast path: column index for exact-match criteria on Array ranges
        if is_exact_match_criteria(&args[crit_idx])
            && let Some(index) = column_index::get_or_build(&args[range_idx])
        {
            let bitmap = index.query_exact(&args[crit_idx]);
            if bitmap.len() == matches.len() {
                matches.and_assign(&bitmap);
            } else {
                let mut padded = ColumnBitset::new_all_false(matches.len());
                let copy_len = matches.len().min(bitmap.len());
                for idx in bitmap.ones() {
                    if idx < copy_len {
                        padded.set(idx, true);
                    }
                }
                matches.and_assign(&padded);
            }
            continue;
        }

        // Fallback: existing bitmask cache path
        bitmask_cache::apply_criterion(&mut matches, &args[range_idx], &args[crit_idx]);
    }

    Some(matches)
}

/// Like [`evaluate_multi_criteria`], but when any criteria arg is a multi-element
/// array, returns one match vector per criteria element — enabling COUNTIFS/SUMIFS
/// to return arrays from array criteria (Excel's element-wise semantics).
///
/// Returns `(match_vectors, nrows, ncols)` where `nrows × ncols` is the output
/// array shape. When all criteria are scalar, returns `(vec![matches], 1, 1)`.
pub(crate) fn evaluate_multi_criteria_array(
    args: &[CellValue],
    criteria_start: usize,
) -> Option<(Vec<ColumnBitset>, usize, usize)> {
    use crate::helpers::bitmask_cache;
    use crate::helpers::column_index;
    use crate::helpers::criteria::extract_criteria_elements;
    use crate::helpers::frequency_cache::is_exact_match_criteria;

    let criteria_count = (args.len() - criteria_start) / 2;
    if criteria_count == 0 {
        return None;
    }

    // 1. Determine if any criteria is an array and find the output shape.
    let mut out_shape: Option<(usize, usize)> = None;
    for c in 0..criteria_count {
        let crit_idx = criteria_start + c * 2 + 1;
        if let Some((_elems, nrows, ncols)) = extract_criteria_elements(&args[crit_idx])
            && out_shape.is_none()
        {
            out_shape = Some((nrows, ncols));
        }
    }

    let (out_nrows, out_ncols) = match out_shape {
        None => {
            // All criteria are scalar: fast path via existing function.
            let matches = evaluate_multi_criteria(args, criteria_start)?;
            return Some((vec![matches], 1, 1));
        }
        Some(shape) => shape,
    };
    let k = out_nrows * out_ncols;

    let _span = tracing::info_span!("eval_multi_criteria_array", criteria_count, k).entered();

    // Compute max range length without allocating Vec.
    #[inline]
    fn cell_value_flat_len(v: &CellValue) -> usize {
        match v {
            CellValue::Array(arr) => arr.len(),
            _ => 1,
        }
    }

    let mut len = 0usize;
    if criteria_start > 0 {
        len = len.max(cell_value_flat_len(&args[0]));
    }
    for c in 0..criteria_count {
        let range_idx = criteria_start + c * 2;
        len = len.max(cell_value_flat_len(&args[range_idx]));
    }

    // 3. Pre-extract criteria elements (or replicate scalar k times).
    let criteria_elems: Vec<Vec<&CellValue>> = (0..criteria_count)
        .map(|c| {
            let crit_idx = criteria_start + c * 2 + 1;
            match extract_criteria_elements(&args[crit_idx]) {
                Some((elems, _, _)) => elems,
                None => vec![&args[crit_idx]; k],
            }
        })
        .collect();

    // 4. For each criteria element index, build a match vector using bitmask cache.
    let mut results = Vec::with_capacity(k);
    for ki in 0..k {
        let mut matches = ColumnBitset::new_all_true(len as u32);
        for c in 0..criteria_count {
            let crit_elem = criteria_elems[c]
                .get(ki)
                .copied()
                .unwrap_or(&CellValue::Null);

            // Fast path: column index for exact-match criteria on Array ranges
            if is_exact_match_criteria(crit_elem)
                && let Some(index) = column_index::get_or_build(&args[criteria_start + c * 2])
            {
                let bitmap = index.query_exact(crit_elem);
                if bitmap.len() == matches.len() {
                    matches.and_assign(&bitmap);
                } else {
                    let mut padded = ColumnBitset::new_all_false(matches.len());
                    let copy_len = matches.len().min(bitmap.len());
                    for idx in bitmap.ones() {
                        if idx < copy_len {
                            padded.set(idx, true);
                        }
                    }
                    matches.and_assign(&padded);
                }
                continue;
            }

            // Fallback: existing bitmask cache path
            bitmask_cache::apply_criterion(&mut matches, &args[criteria_start + c * 2], crit_elem);
        }
        results.push(matches);
    }

    Some((results, out_nrows, out_ncols))
}
