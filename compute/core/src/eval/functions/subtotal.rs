//! SUBTOTAL/AGGREGATE dispatch and filtered range collection.

use compute_parser::ASTNode;
use compute_parser::{CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::aggregate::flatten_value;
use crate::eval::engine::evaluator::Evaluator;

// ---------------------------------------------------------------------------
// AggregateFunc enum — exhaustive, replaces magic i64 func_nums
// ---------------------------------------------------------------------------

/// All AGGREGATE/SUBTOTAL function numbers as an exhaustive enum.
/// Parsed from i64 at the boundary — all downstream dispatch is exhaustive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::eval) enum AggregateFunc {
    Average,       // 1
    Count,         // 2
    CountA,        // 3
    Max,           // 4
    Min,           // 5
    Product,       // 6
    StdevS,        // 7
    StdevP,        // 8
    Sum,           // 9
    VarS,          // 10
    VarP,          // 11
    Median,        // 12  (AGGREGATE only)
    ModeSingle,    // 13  (AGGREGATE only)
    Large,         // 14  (AGGREGATE only, array form)
    Small,         // 15  (AGGREGATE only, array form)
    PercentileInc, // 16  (AGGREGATE only, array form)
    QuartileInc,   // 17  (AGGREGATE only, array form)
    PercentileExc, // 18  (AGGREGATE only, array form)
    QuartileExc,   // 19  (AGGREGATE only, array form)
}

impl AggregateFunc {
    /// Parse AGGREGATE func_num (1-19). Returns Err(CellError::Value) for invalid.
    pub fn from_aggregate_num(n: i64) -> Result<Self, CellError> {
        match n {
            1 => Ok(Self::Average),
            2 => Ok(Self::Count),
            3 => Ok(Self::CountA),
            4 => Ok(Self::Max),
            5 => Ok(Self::Min),
            6 => Ok(Self::Product),
            7 => Ok(Self::StdevS),
            8 => Ok(Self::StdevP),
            9 => Ok(Self::Sum),
            10 => Ok(Self::VarS),
            11 => Ok(Self::VarP),
            12 => Ok(Self::Median),
            13 => Ok(Self::ModeSingle),
            14 => Ok(Self::Large),
            15 => Ok(Self::Small),
            16 => Ok(Self::PercentileInc),
            17 => Ok(Self::QuartileInc),
            18 => Ok(Self::PercentileExc),
            19 => Ok(Self::QuartileExc),
            _ => Err(CellError::Value),
        }
    }

    /// Parse SUBTOTAL func_num (1-11, 101-111). Returns Err(CellError::Value) for invalid.
    pub fn from_subtotal_num(n: i64) -> Result<Self, CellError> {
        let base = if (101..=111).contains(&n) { n - 100 } else { n };
        match base {
            1 => Ok(Self::Average),
            2 => Ok(Self::Count),
            3 => Ok(Self::CountA),
            4 => Ok(Self::Max),
            5 => Ok(Self::Min),
            6 => Ok(Self::Product),
            7 => Ok(Self::StdevS),
            8 => Ok(Self::StdevP),
            9 => Ok(Self::Sum),
            10 => Ok(Self::VarS),
            11 => Ok(Self::VarP),
            _ => Err(CellError::Value),
        }
    }

    /// True for func_nums 14-19 which use the array calling convention (data, k).
    pub fn is_array_form(&self) -> bool {
        matches!(
            self,
            Self::Large
                | Self::Small
                | Self::PercentileInc
                | Self::QuartileInc
                | Self::PercentileExc
                | Self::QuartileExc
        )
    }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

/// Dispatch a SUBTOTAL base function (1-11) to the appropriate aggregate.
pub(in crate::eval) fn subtotal_dispatch(func: AggregateFunc, flat: &[CellValue]) -> CellValue {
    match func {
        AggregateFunc::Average => {
            let mut sum = 0.0;
            let mut count = 0u64;
            for v in flat {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => {
                        sum += n.get();
                        count += 1;
                    }
                    _ => {}
                }
            }
            if count == 0 {
                CellValue::Error(CellError::Div0, None)
            } else {
                CellValue::number(sum / count as f64)
            }
        }
        AggregateFunc::Count => {
            let count = flat
                .iter()
                .filter(|v| matches!(v, CellValue::Number(_)))
                .count();
            CellValue::number(count as f64)
        }
        AggregateFunc::CountA => {
            let count = flat
                .iter()
                .filter(|v| !matches!(v, CellValue::Null))
                .count();
            CellValue::number(count as f64)
        }
        AggregateFunc::Max => {
            let mut max_val: Option<f64> = None;
            for v in flat {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => {
                        max_val = Some(match max_val {
                            Some(m) => m.max(n.get()),
                            None => n.get(),
                        });
                    }
                    _ => {}
                }
            }
            CellValue::number(max_val.unwrap_or(0.0))
        }
        AggregateFunc::Min => {
            let mut min_val: Option<f64> = None;
            for v in flat {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => {
                        min_val = Some(match min_val {
                            Some(m) => m.min(n.get()),
                            None => n.get(),
                        });
                    }
                    _ => {}
                }
            }
            CellValue::number(min_val.unwrap_or(0.0))
        }
        AggregateFunc::Product => {
            let mut product = 1.0;
            let mut found = false;
            for v in flat {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => {
                        product *= n.get();
                        found = true;
                    }
                    _ => {}
                }
            }
            if found {
                CellValue::number(product)
            } else {
                CellValue::number(0.0)
            }
        }
        AggregateFunc::StdevS => subtotal_stdev(flat, true),
        AggregateFunc::StdevP => subtotal_stdev(flat, false),
        AggregateFunc::Sum => {
            let mut sum = 0.0;
            for v in flat {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => sum += n.get(),
                    _ => {}
                }
            }
            CellValue::number(sum)
        }
        AggregateFunc::VarS => subtotal_variance(flat, true),
        AggregateFunc::VarP => subtotal_variance(flat, false),
        // 12-19 are AGGREGATE-only; unreachable from SUBTOTAL.
        AggregateFunc::Median
        | AggregateFunc::ModeSingle
        | AggregateFunc::Large
        | AggregateFunc::Small
        | AggregateFunc::PercentileInc
        | AggregateFunc::QuartileInc
        | AggregateFunc::PercentileExc
        | AggregateFunc::QuartileExc => CellValue::Error(CellError::Value, None),
    }
}

/// Compute variance for SUBTOTAL (mirrors subtotal.rs::compute_variance).
pub(in crate::eval) fn subtotal_variance(flat: &[CellValue], sample: bool) -> CellValue {
    let mut nums: Vec<f64> = Vec::new();
    for v in flat {
        match v {
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            CellValue::Number(n) => nums.push(n.get()),
            _ => {}
        }
    }
    if nums.is_empty() {
        return CellValue::Error(CellError::Div0, None);
    }
    if sample && nums.len() == 1 {
        return CellValue::Error(CellError::Div0, None);
    }
    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    let sum_sq: f64 = nums.iter().map(|x| (x - mean).powi(2)).sum();
    let divisor = if sample { nums.len() - 1 } else { nums.len() };
    CellValue::number(sum_sq / divisor as f64)
}

/// Compute standard deviation for SUBTOTAL.
pub(in crate::eval) fn subtotal_stdev(flat: &[CellValue], sample: bool) -> CellValue {
    match subtotal_variance(flat, sample) {
        CellValue::Number(v) => CellValue::number(v.get().sqrt()),
        other => other,
    }
}

/// Dispatch an AGGREGATE reference-form function (1-13) to the appropriate aggregate.
pub(in crate::eval) fn aggregate_dispatch(
    func: AggregateFunc,
    filtered: &[CellValue],
) -> CellValue {
    match func {
        AggregateFunc::Average => subtotal_dispatch(AggregateFunc::Average, filtered),
        AggregateFunc::Count => subtotal_dispatch(AggregateFunc::Count, filtered),
        AggregateFunc::CountA => subtotal_dispatch(AggregateFunc::CountA, filtered),
        AggregateFunc::Max => subtotal_dispatch(AggregateFunc::Max, filtered),
        AggregateFunc::Min => subtotal_dispatch(AggregateFunc::Min, filtered),
        AggregateFunc::Product => subtotal_dispatch(AggregateFunc::Product, filtered),
        AggregateFunc::StdevS => subtotal_dispatch(AggregateFunc::StdevS, filtered),
        AggregateFunc::StdevP => subtotal_dispatch(AggregateFunc::StdevP, filtered),
        AggregateFunc::Sum => subtotal_dispatch(AggregateFunc::Sum, filtered),
        AggregateFunc::VarS => subtotal_dispatch(AggregateFunc::VarS, filtered),
        AggregateFunc::VarP => subtotal_dispatch(AggregateFunc::VarP, filtered),
        AggregateFunc::Median => {
            let mut nums: Vec<f64> = filtered
                .iter()
                .filter_map(|v| {
                    if let CellValue::Number(n) = v {
                        Some(n.get())
                    } else {
                        None
                    }
                })
                .collect();
            if nums.is_empty() {
                return CellValue::Error(CellError::Num, None);
            }
            nums.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let mid = nums.len() / 2;
            if nums.len().is_multiple_of(2) {
                CellValue::number((nums[mid - 1] + nums[mid]) / 2.0)
            } else {
                CellValue::number(nums[mid])
            }
        }
        AggregateFunc::ModeSingle => {
            let nums: Vec<f64> = filtered
                .iter()
                .filter_map(|v| {
                    if let CellValue::Number(n) = v {
                        Some(n.get())
                    } else {
                        None
                    }
                })
                .collect();
            if nums.is_empty() {
                return CellValue::Error(CellError::Na, None);
            }
            let mut counts = std::collections::HashMap::new();
            let mut max_count = 0u64;
            let mut mode_val = 0.0_f64;
            for &n in &nums {
                let bits = n.to_bits();
                let count = counts.entry(bits).or_insert(0u64);
                *count += 1;
                if *count > max_count {
                    max_count = *count;
                    mode_val = n;
                }
            }
            if max_count < 2 {
                CellValue::Error(CellError::Na, None)
            } else {
                CellValue::number(mode_val)
            }
        }
        // Array-form functions (14-19) should never reach reference-form dispatch.
        AggregateFunc::Large
        | AggregateFunc::Small
        | AggregateFunc::PercentileInc
        | AggregateFunc::QuartileInc
        | AggregateFunc::PercentileExc
        | AggregateFunc::QuartileExc => CellValue::Error(CellError::Value, None),
    }
}

/// Dispatch an AGGREGATE array-form function (14-19).
/// `filtered` contains collected data values (errors already filtered if option says so).
/// `k` is the raw k parameter from the formula.
fn aggregate_array_dispatch(func: AggregateFunc, filtered: &[CellValue], k: f64) -> CellValue {
    // Extract and sort numbers from filtered values.
    let mut nums: Vec<f64> = filtered
        .iter()
        .filter_map(|v| {
            if let CellValue::Number(n) = v {
                Some(n.get())
            } else {
                None
            }
        })
        .collect();

    if nums.is_empty() {
        return CellValue::Error(CellError::Num, None);
    }
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    match func {
        AggregateFunc::Large => {
            let ki = k.trunc() as i64;
            if ki < 1 || ki as usize > nums.len() {
                return CellValue::Error(CellError::Num, None);
            }
            // nums sorted ascending — k-th largest is at len - ki
            CellValue::number(nums[nums.len() - ki as usize])
        }
        AggregateFunc::Small => {
            let ki = k.trunc() as i64;
            if ki < 1 || ki as usize > nums.len() {
                return CellValue::Error(CellError::Num, None);
            }
            CellValue::number(nums[ki as usize - 1])
        }
        AggregateFunc::PercentileInc => {
            if !(0.0..=1.0).contains(&k) {
                return CellValue::Error(CellError::Num, None);
            }
            CellValue::number(compute_functions::percentile_inc(&nums, k))
        }
        AggregateFunc::QuartileInc => {
            let qi = k.trunc() as i64;
            if !(0..=4).contains(&qi) {
                return CellValue::Error(CellError::Num, None);
            }
            CellValue::number(compute_functions::percentile_inc(&nums, qi as f64 * 0.25))
        }
        AggregateFunc::PercentileExc => {
            if k <= 0.0 || k >= 1.0 {
                return CellValue::Error(CellError::Num, None);
            }
            match compute_functions::percentile_exc(&nums, k) {
                Some(v) => CellValue::number(v),
                None => CellValue::Error(CellError::Num, None),
            }
        }
        AggregateFunc::QuartileExc => {
            let qi = k.trunc() as i64;
            if !(1..=3).contains(&qi) {
                return CellValue::Error(CellError::Num, None);
            }
            match compute_functions::percentile_exc(&nums, qi as f64 * 0.25) {
                Some(v) => CellValue::number(v),
                None => CellValue::Error(CellError::Num, None),
            }
        }
        // Reference-form variants — unreachable from array-form dispatch.
        AggregateFunc::Average
        | AggregateFunc::Count
        | AggregateFunc::CountA
        | AggregateFunc::Max
        | AggregateFunc::Min
        | AggregateFunc::Product
        | AggregateFunc::StdevS
        | AggregateFunc::StdevP
        | AggregateFunc::Sum
        | AggregateFunc::VarS
        | AggregateFunc::VarP
        | AggregateFunc::Median
        | AggregateFunc::ModeSingle => CellValue::Error(CellError::Value, None),
    }
}

// ---------------------------------------------------------------------------
// Evaluator methods for SUBTOTAL/AGGREGATE
// ---------------------------------------------------------------------------

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Evaluate `SUBTOTAL(func_num, ref1, [ref2, ...])`.
    ///
    /// Excel's SUBTOTAL skips cells whose own formula is SUBTOTAL or AGGREGATE,
    /// preventing double-counting when a grand total SUBTOTAL includes cells that
    /// are themselves subtotals. We handle this at the evaluator level because we
    /// need access to both the AST (to enumerate range cells) and the
    /// EvaluationContext (to check formula metadata).
    pub(in crate::eval) async fn eval_subtotal(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate func_num
        let func_num_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = func_num_val {
            return Ok(CellValue::Error(e, None));
        }
        let func_num = match func_num_val.coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Detect whether hidden rows should be ignored (func codes 101-111)
        let ignore_hidden = (101..=111).contains(&func_num);

        // Parse into enum (handles 1-11 and 101-111 normalization)
        let func = match AggregateFunc::from_subtotal_num(func_num) {
            Ok(f) => f,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Collect values from range args, excluding cells with SUBTOTAL/AGGREGATE formulas
        // and optionally skipping hidden rows
        let flat = self
            .collect_subtotal_filtered_values(&args[1..], ignore_hidden)
            .await?;

        // Dispatch to the appropriate aggregate
        Ok(subtotal_dispatch(func, &flat))
    }

    /// Evaluate `AGGREGATE(func_num, options, ref1, [ref2, ...])` or
    /// `AGGREGATE(func_num, options, array, k)` for array-form functions.
    ///
    /// AGGREGATE is similar to SUBTOTAL but supports more functions and options.
    /// Options 4-7 include "ignore nested SUBTOTAL/AGGREGATE" behavior.
    ///
    /// Two calling conventions:
    /// - Reference form (1-13): `AGGREGATE(fn, opts, ref1, ref2, ...)` — all args are data
    /// - Array form (14-19): `AGGREGATE(fn, opts, array, k)` — last arg is k parameter
    pub(in crate::eval) async fn eval_aggregate_function(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate func_num
        let func_num_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = func_num_val {
            return Ok(CellValue::Error(e, None));
        }
        let func_num = match func_num_val.coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Parse into enum
        let func = match AggregateFunc::from_aggregate_num(func_num) {
            Ok(f) => f,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Evaluate options
        let options_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = options_val {
            return Ok(CellValue::Error(e, None));
        }
        let options = match options_val.coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };

        // Options: 0=none, 1=ignore hidden, 2=ignore errors, 3=both,
        //          4=ignore nested, 5=1+4, 6=2+4, 7=all
        let ignore_hidden_agg = options == 1 || options == 3 || options == 5 || options == 7;
        let ignore_errors = options == 2 || options == 3 || options == 6 || options == 7;
        let ignore_nested = options >= 4;

        if func.is_array_form() {
            // Array form: AGGREGATE(fn, opts, array, k)
            // Last arg is k, everything between options and k is data.
            if args.len() < 4 {
                return Ok(CellValue::Error(CellError::Value, None));
            }

            // Evaluate k (last argument)
            let k_val = self.eval_node_cv(&args[args.len() - 1]).await?;
            if let CellValue::Error(e, _) = k_val {
                return Ok(CellValue::Error(e, None));
            }
            let k = match k_val.coerce_to_number() {
                Ok(n) => n,
                Err(e) => return Ok(CellValue::Error(e, None)),
            };

            // Data args are between options and k
            let data_args = &args[2..args.len() - 1];

            let flat = if ignore_nested {
                self.collect_subtotal_filtered_values(data_args, ignore_hidden_agg)
                    .await?
            } else {
                self.eval_and_flatten(data_args).await?
            };

            // Optionally filter errors
            let filtered: Vec<CellValue> = if ignore_errors {
                flat.into_iter()
                    .filter(|v| !matches!(v, CellValue::Error(..)))
                    .collect()
            } else {
                for v in &flat {
                    if let CellValue::Error(e, _) = v {
                        return Ok(CellValue::Error(*e, None));
                    }
                }
                flat
            };

            Ok(aggregate_array_dispatch(func, &filtered, k))
        } else {
            // Reference form: AGGREGATE(fn, opts, ref1, ref2, ...)
            let rest_args = &args[2..];

            let flat = if ignore_nested {
                self.collect_subtotal_filtered_values(rest_args, ignore_hidden_agg)
                    .await?
            } else {
                self.eval_and_flatten(rest_args).await?
            };

            // Optionally filter errors
            let filtered: Vec<CellValue> = if ignore_errors {
                flat.into_iter()
                    .filter(|v| !matches!(v, CellValue::Error(..)))
                    .collect()
            } else {
                for v in &flat {
                    if let CellValue::Error(e, _) = v {
                        return Ok(CellValue::Error(*e, None));
                    }
                }
                flat
            };

            Ok(aggregate_dispatch(func, &filtered))
        }
    }

    /// Collect cell values from range/ref arguments, excluding cells whose formula
    /// is a SUBTOTAL or AGGREGATE call.
    ///
    /// When `ignore_hidden` is true (SUBTOTAL 101-111, AGGREGATE options 1/3/5/7),
    /// rows hidden by autofilter or manual hide are also skipped.
    ///
    /// For range arguments (A1:B10), individual cells are enumerated and checked.
    /// For single cell references, the cell is checked.
    /// For other argument types (expressions, named ranges, etc.), values are
    /// included without filtering (we can't easily determine source cell identity).
    pub(in crate::eval) async fn collect_subtotal_filtered_values(
        &mut self,
        args: &[ASTNode],
        ignore_hidden: bool,
    ) -> Result<Vec<CellValue>, ComputeError> {
        let mut flat = Vec::new();
        for arg in args {
            self.collect_subtotal_filtered_arg(arg, &mut flat, ignore_hidden)
                .await?;
        }
        Ok(flat)
    }

    /// Process a single argument for SUBTOTAL, filtering out SUBTOTAL/AGGREGATE cells.
    pub(in crate::eval) fn collect_subtotal_filtered_arg<'b>(
        &'b mut self,
        arg: &'b ASTNode,
        out: &'b mut Vec<CellValue>,
        ignore_hidden: bool,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), ComputeError>> + 'b>> {
        Box::pin(async move {
            self.tick()?;
            match arg {
                ASTNode::Range(RangeRef {
                    start,
                    end,
                    range_type,
                    ..
                }) => {
                    self.collect_filtered_range(start, end, range_type, out, ignore_hidden)
                        .await
                }
                ASTNode::CellReference(CellRefNode { reference, .. }) => {
                    self.collect_filtered_cell_ref(reference, out, ignore_hidden)
                        .await
                }
                ASTNode::SheetRef { inner, .. } => {
                    self.collect_subtotal_filtered_arg(inner, out, ignore_hidden)
                        .await
                }
                ASTNode::StructuredRef(ref_) => {
                    self.collect_filtered_structured_ref(ref_, out).await
                }
                // For other arg types (named ranges, expressions, etc.),
                // evaluate normally and include all values (no filtering possible).
                other => {
                    let v = self.eval_node_cv(other).await?;
                    flatten_value(&v, out);
                    Ok(())
                }
            }
        })
    }

    /// Collect values from a range, skipping SUBTOTAL/AGGREGATE cells
    /// and optionally hidden rows.
    pub(in crate::eval) async fn collect_filtered_range(
        &mut self,
        start: &CellRef,
        end: &CellRef,
        _range_type: &RangeType,
        out: &mut Vec<CellValue>,
        ignore_hidden: bool,
    ) -> Result<(), ComputeError> {
        let s_pos = match start {
            CellRef::Resolved(id) => self.meta.resolve_position(id),
            CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        };
        let (s_sheet, s_row, s_col) = match s_pos {
            Some(pos) => pos,
            None => {
                out.push(CellValue::Error(CellError::Ref, None));
                return Ok(());
            }
        };
        let e_pos = match end {
            CellRef::Resolved(id) => self.meta.resolve_position(id),
            CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        };
        let (e_sheet, e_row, e_col) = match e_pos {
            Some(pos) => pos,
            None => {
                out.push(CellValue::Error(CellError::Ref, None));
                return Ok(());
            }
        };
        if s_sheet != e_sheet {
            out.push(CellValue::Error(CellError::Ref, None));
            return Ok(());
        }

        let min_row = s_row.min(e_row);
        let max_row = s_row.max(e_row);
        let min_col = s_col.min(e_col);
        let max_col = s_col.max(e_col);

        for r in min_row..=max_row {
            if ignore_hidden && self.meta.is_row_hidden(&s_sheet, r) {
                continue; // Skip hidden rows for func codes 101-111
            }
            for c in min_col..=max_col {
                if self.meta.cell_has_subtotal_formula(&s_sheet, r, c) {
                    continue; // Skip nested SUBTOTAL/AGGREGATE cells
                }
                let val = match self.meta.resolve_cell_id(&s_sheet, r, c) {
                    Some(cell_id) => self.data.get_cell_value(&cell_id).await,
                    None => CellValue::Null,
                };
                out.push(val);
            }
        }
        Ok(())
    }

    /// Collect value from a single cell reference, skipping if it's SUBTOTAL/AGGREGATE
    /// or if the row is hidden and `ignore_hidden` is set.
    pub(in crate::eval) async fn collect_filtered_cell_ref(
        &mut self,
        reference: &CellRef,
        out: &mut Vec<CellValue>,
        ignore_hidden: bool,
    ) -> Result<(), ComputeError> {
        match reference {
            CellRef::Resolved(id) => {
                if let Some((sheet, row, col)) = self.meta.resolve_position(id) {
                    if self.meta.cell_has_subtotal_formula(&sheet, row, col) {
                        return Ok(()); // Skip
                    }
                    if ignore_hidden && self.meta.is_row_hidden(&sheet, row) {
                        return Ok(()); // Skip hidden row
                    }
                }
                out.push(self.data.get_cell_value(id).await);
            }
            CellRef::Positional { sheet, row, col } => {
                if self.meta.cell_has_subtotal_formula(sheet, *row, *col) {
                    return Ok(()); // Skip
                }
                if ignore_hidden && self.meta.is_row_hidden(sheet, *row) {
                    return Ok(()); // Skip hidden row
                }
                match self.meta.resolve_cell_id(sheet, *row, *col) {
                    Some(cell_id) => out.push(self.data.get_cell_value(&cell_id).await),
                    None => out.push(CellValue::Null),
                }
            }
        }
        Ok(())
    }

    /// Collect values from a structured ref, filtering out SUBTOTAL/AGGREGATE cells.
    pub(in crate::eval) async fn collect_filtered_structured_ref(
        &mut self,
        ref_: &crate::table::types::StructuredRef,
        out: &mut Vec<CellValue>,
    ) -> Result<(), ComputeError> {
        // For structured refs, get the resolved ranges and filter cell by cell.
        // Fall back to normal evaluation if we can't resolve.
        match self.meta.resolve_structured_ref(ref_) {
            Ok(resolved) => {
                let rows = self.fetch_structured_ref_values(&resolved).await;
                // We got the values but don't have position info.
                // Structured refs are rare in SUBTOTAL contexts; include all values.
                for row in &rows {
                    for v in row {
                        out.push(v.clone());
                    }
                }
            }
            Err(e) => {
                out.push(CellValue::Error(e, None));
            }
        }
        Ok(())
    }
}
