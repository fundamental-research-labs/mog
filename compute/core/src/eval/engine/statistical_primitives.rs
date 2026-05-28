use std::sync::Arc;

use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::lookup::range_geometry::try_extract_single_col_range;
use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    fn get_sorted_for_range(
        &self,
        range_ast: &ASTNode,
        flat: &[CellValue],
    ) -> Result<Arc<Vec<f64>>, CellError> {
        // Try persistent WorkbookCache first if we can extract range coordinates.
        if let Some((sheet, col, row_start, row_end)) =
            try_extract_single_col_range(range_ast, self.meta)
            && let Some(sorted) = self
                .meta
                .get_or_build_sorted_for_range(&sheet, col, row_start, row_end, flat)
        {
            return Ok(sorted);
        }

        // Fallback: thread-local sorted cache.
        compute_functions::helpers::sorted_cache::get_or_sort_asc(flat)
    }
    pub(in crate::eval) async fn eval_percentile_inc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let k_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = k_val {
            return Ok(CellValue::Error(e, None));
        }
        let k = match k_val.coerce_to_number() {
            Ok(k) if !(0.0..=1.0).contains(&k) => {
                return Ok(CellValue::Error(CellError::Num, None));
            }
            Ok(k) => k,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => Ok(CellValue::number(compute_functions::percentile_inc(
                &sorted, k,
            ))),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_percentile_exc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let k_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = k_val {
            return Ok(CellValue::Error(e, None));
        }
        let k = match k_val.coerce_to_number() {
            Ok(k) if k <= 0.0 || k >= 1.0 => {
                return Ok(CellValue::Error(CellError::Num, None));
            }
            Ok(k) => k,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => match compute_functions::percentile_exc(&sorted, k) {
                Some(v) => Ok(CellValue::number(v)),
                None => Ok(CellValue::Error(CellError::Num, None)),
            },
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_quartile_inc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let quart_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = quart_val {
            return Ok(CellValue::Error(e, None));
        }
        let quart = match quart_val.coerce_to_number() {
            Ok(q) if !(0.0..=4.0).contains(&q) => {
                return Ok(CellValue::Error(CellError::Num, None));
            }
            Ok(q) => q as i32,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => Ok(CellValue::number(compute_functions::percentile_inc(
                &sorted,
                quart as f64 * 0.25,
            ))),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_quartile_exc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let quart_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = quart_val {
            return Ok(CellValue::Error(e, None));
        }
        let quart = match quart_val.coerce_to_number() {
            Ok(q) if !(1.0..=3.0).contains(&q) => {
                return Ok(CellValue::Error(CellError::Num, None));
            }
            Ok(q) => q as i32,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => match compute_functions::percentile_exc(&sorted, quart as f64 * 0.25) {
                Some(v) => Ok(CellValue::number(v)),
                None => Ok(CellValue::Error(CellError::Num, None)),
            },
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_percentrank_inc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let x_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = x_val {
            return Ok(CellValue::Error(e, None));
        }
        let x = match x_val.coerce_to_number() {
            Ok(v) => v,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let significance = if args.len() > 2 {
            let sig_val = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = sig_val {
                return Ok(CellValue::Error(e, None));
            }
            match sig_val.coerce_to_number() {
                Ok(s) if s < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                Ok(s) => s as u32,
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        } else {
            3
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => {
                if x < sorted[0] || x > sorted[sorted.len() - 1] {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                let n = sorted.len();
                if n == 1 {
                    return Ok(CellValue::number(0.0));
                }
                let pos = sorted.partition_point(|&v| v < x);
                let rank = if pos < n && (sorted[pos] - x).abs() < 1e-15 {
                    pos as f64 / (n - 1) as f64
                } else if pos > 0 && pos < n {
                    let i = pos - 1;
                    (i as f64 + (x - sorted[i]) / (sorted[i + 1] - sorted[i])) / (n - 1) as f64
                } else {
                    0.0
                };
                let factor = 10f64.powi(significance as i32);
                Ok(CellValue::number((rank * factor).floor() / factor))
            }
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_percentrank_exc(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let array_val = self.eval_node_cv(&args[0]).await?;
        let x_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = x_val {
            return Ok(CellValue::Error(e, None));
        }
        let x = match x_val.coerce_to_number() {
            Ok(v) => v,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let significance = if args.len() > 2 {
            let sig_val = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = sig_val {
                return Ok(CellValue::Error(e, None));
            }
            match sig_val.coerce_to_number() {
                Ok(s) if s < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                Ok(s) => s as u32,
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        } else {
            3
        };
        let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => {
                if x < sorted[0] || x > sorted[sorted.len() - 1] {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                let n = sorted.len();
                let pos = sorted.partition_point(|&v| v < x);
                let rank = if pos < n && (sorted[pos] - x).abs() < 1e-15 {
                    (pos + 1) as f64 / (n + 1) as f64
                } else if pos > 0 && pos < n {
                    let i = pos - 1;
                    ((i + 1) as f64 + (x - sorted[i]) / (sorted[i + 1] - sorted[i]))
                        / (n + 1) as f64
                } else {
                    0.0
                };
                let factor = 10f64.powi(significance as i32);
                Ok(CellValue::number((rank * factor).floor() / factor))
            }
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_median(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let flat = self.eval_and_flatten(args).await?;
        // For single-arg MEDIAN, try persistent cache on the range AST.
        let sorted_result = if args.len() == 1 {
            self.get_sorted_for_range(&args[0], &flat)
        } else {
            compute_functions::helpers::sorted_cache::get_or_sort_asc(&flat)
        };
        match sorted_result {
            Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
            Ok(sorted) => {
                let mid = sorted.len() / 2;
                if sorted.len() % 2 == 0 {
                    Ok(CellValue::number((sorted[mid - 1] + sorted[mid]) / 2.0))
                } else {
                    Ok(CellValue::number(sorted[mid]))
                }
            }
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_mode_sngl(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // Evaluate all arguments and flatten to a single CellValue slice.
        let mut evaluated_args = Vec::with_capacity(args.len());
        for arg in args {
            evaluated_args.push(self.eval_node_cv(arg).await?);
        }
        let flat = compute_functions::helpers::coercion::flatten_values(&evaluated_args);

        // Extract numerics (strict: only Number variants, errors propagate).
        let nums = match compute_functions::helpers::coercion::extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                return Ok(CellValue::Error(CellError::Na, None));
            }
            Ok(nums) => nums,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Build a local frequency map: value -> (count, first_occurrence_index).
        // Using FxHashMap with u64 bit keys for exact f64 matching (MODE uses
        // bitwise equality, not tolerance-based NormalizedKey matching).
        let mut counts: rustc_hash::FxHashMap<u64, (usize, usize)> =
            rustc_hash::FxHashMap::default();
        for (i, &n) in nums.iter().enumerate() {
            let bits = n.to_bits();
            counts
                .entry(bits)
                .and_modify(|(count, _)| *count += 1)
                .or_insert((1, i));
        }

        // Find the maximum count.
        let max_count = counts.values().map(|(c, _)| *c).max().unwrap_or(0);

        // MODE returns #N/A if no value appears more than once.
        if max_count <= 1 {
            return Ok(CellValue::Error(CellError::Na, None));
        }

        // Return the first value (in original input order) with the max count.
        // This matches Excel behavior: among tied modes, the earliest wins.
        let mut best_idx = usize::MAX;
        let mut best_val = 0.0;
        for (&bits, &(count, first_idx)) in &counts {
            if count == max_count && first_idx < best_idx {
                best_idx = first_idx;
                best_val = f64::from_bits(bits);
            }
        }

        Ok(CellValue::number(best_val))
    }
    pub(in crate::eval) async fn eval_small(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // SMALL(array, k) — k-th smallest value
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let range_val = self.eval_node_cv(&args[0]).await?;
        let k_val = self.eval_node_cv(&args[1]).await?;
        let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
        let k = match k_val.coerce_to_number() {
            Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
            Ok(n) => n as usize,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() || k > sorted.len() => {
                Ok(CellValue::Error(CellError::Num, None))
            }
            Ok(sorted) => Ok(CellValue::number(sorted[k - 1])),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_large(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // LARGE(array, k) — k-th largest value
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let range_val = self.eval_node_cv(&args[0]).await?;
        let k_val = self.eval_node_cv(&args[1]).await?;
        let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
        let k = match k_val.coerce_to_number() {
            Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
            Ok(n) => n as usize,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        match self.get_sorted_for_range(&args[0], &flat) {
            Ok(sorted) if sorted.is_empty() || k > sorted.len() => {
                Ok(CellValue::Error(CellError::Num, None))
            }
            Ok(sorted) => {
                // k-th largest = sorted_asc[len - k]
                Ok(CellValue::number(sorted[sorted.len() - k]))
            }
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_rank_eq(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // RANK(number, ref, [order]) — rank of number in array
        // RANK.EQ is identical to RANK
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let number_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = number_val {
            return Ok(CellValue::Error(e, None));
        }
        let number = match number_val.coerce_to_number() {
            Ok(n) => n,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let range_val = self.eval_node_cv(&args[1]).await?;
        let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
        let order = if args.len() > 2 {
            match self.eval_node_cv(&args[2]).await? {
                CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                v => match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                },
            }
        } else {
            0
        };
        match self.get_sorted_for_range(&args[1], &flat) {
            Ok(sorted) => match rank_components_inline(&sorted, number, order) {
                Some((less, _equal)) => Ok(CellValue::number((less + 1) as f64)),
                None => Ok(CellValue::Error(CellError::Na, None)),
            },
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
    pub(in crate::eval) async fn eval_rank_avg(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // RANK.AVG(number, ref, [order]) — average rank for ties
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let number_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = number_val {
            return Ok(CellValue::Error(e, None));
        }
        let number = match number_val.coerce_to_number() {
            Ok(n) => n,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let range_val = self.eval_node_cv(&args[1]).await?;
        let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
        let order = if args.len() > 2 {
            match self.eval_node_cv(&args[2]).await? {
                CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                v => match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                },
            }
        } else {
            0
        };
        match self.get_sorted_for_range(&args[1], &flat) {
            Ok(sorted) => match rank_components_inline(&sorted, number, order) {
                Some((less, equal)) => {
                    let rank = less as f64 + 1.0 + (equal as f64 - 1.0) / 2.0;
                    Ok(CellValue::number(rank))
                }
                None => Ok(CellValue::Error(CellError::Na, None)),
            },
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
}

/// Epsilon tolerance for "number exists in array" checks (matches Excel behavior).
const RANK_EPS: f64 = 1e-10;

fn rank_components_inline(sorted_asc: &[f64], number: f64, order: i32) -> Option<(usize, usize)> {
    // Find the range of elements approximately equal to `number`
    let first_ge = sorted_asc.partition_point(|&x| x < number - RANK_EPS);
    let first_gt = sorted_asc.partition_point(|&x| x <= number + RANK_EPS);
    let equal_count = first_gt - first_ge;

    if equal_count == 0 {
        return None; // number not found in array
    }

    if order == 0 {
        // Descending: count how many are strictly greater
        let greater_count = sorted_asc.len() - first_gt;
        Some((greater_count, equal_count))
    } else {
        // Ascending: count how many are strictly less
        Some((first_ge, equal_count))
    }
}
