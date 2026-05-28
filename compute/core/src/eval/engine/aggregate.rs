//! Aggregation helpers — TaggedValue, flattening, and aggregate dispatch.

use cell_types::SheetId;
use compute_parser::RangeRef;
use compute_parser::{ASTNode, BinOp};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::functions::dense_aggregate::{
    AggregateOp, DenseAggregateResult, try_dense_aggregate, try_dense_aggregate_multi_column,
};

// ---------------------------------------------------------------------------
// ValueSource — provenance of a value inside an aggregate argument list
// ---------------------------------------------------------------------------

/// Provenance of a value inside an aggregate argument list.
///
/// Excel aggregate functions (SUM, AVERAGE, MIN, MAX, …) treat boolean
/// and null values differently depending on where they came from:
///
/// - **Range**: from cell references, range references, structured refs,
///   or arrays returned by range-producing functions (INDEX, FILTER, SORT).
///   Booleans and nulls are **skipped**.
///
/// - **Inline**: from direct scalar literals or omitted arguments.
///   Booleans are coerced to 1.0/0.0, nulls to 0.0.
///
/// - **InlineArray**: from elements of inline array constants like `{1,TRUE}`.
///   For SUM/AVERAGE/MIN/MAX booleans are coerced (same as Inline), but for
///   COUNT booleans are **skipped** (same as Range). This matches Excel
///   where `SUM({TRUE,1})` = 2 but `COUNT({TRUE,1})` = 1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::eval) enum ValueSource {
    Range,
    Inline,
    InlineArray,
}

// ---------------------------------------------------------------------------
// TaggedValue — tracks whether a value came from a cell reference or literal
// ---------------------------------------------------------------------------

/// A cell value tagged with its origin: literal (in-formula) vs cell reference.
///
/// Excel aggregate functions (SUM, AVERAGE, MIN, MAX) treat boolean values
/// differently depending on their source:
///   - Literal `TRUE`/`FALSE` in the formula → coerced to 1.0 / 0.0
///   - Boolean values from cell references or ranges → silently skipped
pub(in crate::eval) struct TaggedValue {
    pub(in crate::eval) value: CellValue,
    /// Provenance of this value — determines how booleans and nulls are treated.
    pub(in crate::eval) source: ValueSource,
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

/// Returns the `ValueSource` for an AST node: `Range` for cell references,
/// range references, structured references, identifiers (named ranges), and
/// reference intersections; `Inline` for everything else (literals, function
/// calls, etc.).
///
/// Named ranges (`Identifier`) are tagged as `Range` because Excel treats them
/// as range references for aggregate semantics (e.g., booleans and blanks in
/// named ranges are skipped by SUM, just like direct range references).
pub(in crate::eval) fn value_source_for_node(node: &ASTNode) -> ValueSource {
    match node {
        ASTNode::CellReference(..)
        | ASTNode::Range(..)
        | ASTNode::StructuredRef(_)
        | ASTNode::Identifier(_) => ValueSource::Range,
        ASTNode::BinaryOp {
            op: BinOp::Intersect,
            ..
        } => ValueSource::Range,
        ASTNode::SheetRef { inner, .. } | ASTNode::Paren(inner) => value_source_for_node(inner),
        _ => ValueSource::Inline,
    }
}

pub(in crate::eval) fn flatten_value(val: &CellValue, out: &mut Vec<CellValue>) {
    match val {
        CellValue::Array(arr) => {
            for v in arr.iter() {
                out.push(v.clone());
            }
        }
        other => out.push(other.clone()),
    }
}

pub(in crate::eval) fn flatten_tagged(
    val: &CellValue,
    source: ValueSource,
    out: &mut Vec<TaggedValue>,
) {
    match val {
        CellValue::Array(arr) => {
            for v in arr.iter() {
                // Nulls inside arrays always represent empty cells — treat as Range
                // so that aggregates skip them (even if the array came from INDEX/FILTER).
                let elem_source = if matches!(v, CellValue::Null) {
                    ValueSource::Range
                } else if source == ValueSource::Inline {
                    // Elements of inline array constants (e.g., `{1, TRUE}`) get
                    // InlineArray so SUM coerces booleans but COUNT skips them.
                    ValueSource::InlineArray
                } else {
                    source
                };
                out.push(TaggedValue {
                    value: v.clone(),
                    source: elem_source,
                });
            }
        }
        other => out.push(TaggedValue {
            value: other.clone(),
            source,
        }),
    }
}

/// Helper: extract a numeric value from a tagged value, respecting the
/// Excel rule that booleans and nulls from cell/range sources are skipped.
pub(in crate::eval) fn tagged_to_number(tv: &TaggedValue) -> Option<Result<f64, CellError>> {
    match &tv.value {
        CellValue::Error(e, _) => Some(Err(*e)),
        CellValue::Number(n) => Some(Ok(n.get())),
        CellValue::Boolean(b)
            if tv.source == ValueSource::Inline || tv.source == ValueSource::InlineArray =>
        {
            Some(Ok(if *b { 1.0 } else { 0.0 }))
        }
        // Omitted arguments (e.g., the trailing empty arg in `MIN(expr, )`) are
        // CellValue::Null with source=Inline.  Excel coerces these to 0.
        CellValue::Null
            if tv.source == ValueSource::Inline || tv.source == ValueSource::InlineArray =>
        {
            Some(Ok(0.0))
        }
        _ => None, // skip text, null-from-ranges, and booleans from cell references
    }
}

pub(in crate::eval) fn agg_sum(vals: &[TaggedValue]) -> CellValue {
    #[cfg(feature = "dd-precision")]
    {
        let mut acc = value_types::DdSum::new();
        for tv in vals {
            match &tv.value {
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                CellValue::Number(n) => acc.add_dd(n.to_f64x2()),
                CellValue::Boolean(b)
                    if tv.source == ValueSource::Inline
                        || tv.source == ValueSource::InlineArray =>
                {
                    acc.add(if *b { 1.0 } else { 0.0 });
                }
                CellValue::Null
                    if tv.source == ValueSource::Inline
                        || tv.source == ValueSource::InlineArray =>
                {
                    acc.add(0.0);
                }
                _ => {}
            }
        }
        let r = acc.total();
        CellValue::number_dd(r.hi(), r.lo())
    }
    #[cfg(not(feature = "dd-precision"))]
    {
        let mut acc = value_types::KahanSum::new();
        for tv in vals {
            match tagged_to_number(tv) {
                Some(Ok(n)) => acc.add(n),
                Some(Err(e)) => return CellValue::Error(e, None),
                None => {}
            }
        }
        CellValue::number(acc.total())
    }
}

pub(in crate::eval) fn agg_average(vals: &[TaggedValue]) -> CellValue {
    let mut acc = value_types::KahanSum::new();
    let mut count = 0u64;
    for tv in vals {
        match tagged_to_number(tv) {
            Some(Ok(n)) => {
                acc.add(n);
                count += 1;
            }
            Some(Err(e)) => return CellValue::Error(e, None),
            None => {}
        }
    }
    if count == 0 {
        CellValue::Error(CellError::Div0, None)
    } else {
        CellValue::number(acc.total() / count as f64)
    }
}

pub(in crate::eval) fn agg_count(vals: &[TaggedValue]) -> CellValue {
    let mut count = 0u64;
    for tv in vals {
        // COUNT counts numeric values unconditionally.
        // Inline (literal) booleans are also counted — Excel coerces them to
        // numbers — but booleans from cell/range references are skipped.
        match (&tv.value, tv.source) {
            (CellValue::Number(_), _) => count += 1,
            (CellValue::Boolean(_), ValueSource::Inline) => count += 1,
            _ => {}
        }
    }
    CellValue::number(count as f64)
}

pub(in crate::eval) fn agg_counta(vals: &[TaggedValue]) -> CellValue {
    let mut count = 0u64;
    for tv in vals {
        if !matches!(tv.value, CellValue::Null) {
            count += 1;
        }
    }
    CellValue::number(count as f64)
}

pub(in crate::eval) fn agg_countblank(vals: &[TaggedValue]) -> CellValue {
    let count = vals
        .iter()
        .filter(|tv| {
            matches!(tv.value, CellValue::Null)
                || matches!(&tv.value, CellValue::Text(s) if s.is_empty())
        })
        .count();
    CellValue::number(count as f64)
}

pub(in crate::eval) fn agg_min(vals: &[TaggedValue]) -> CellValue {
    let mut min: Option<f64> = None;
    for tv in vals {
        match tagged_to_number(tv) {
            Some(Ok(n)) => {
                min = Some(match min {
                    Some(m) => m.min(n),
                    None => n,
                });
            }
            Some(Err(e)) => return CellValue::Error(e, None),
            None => {}
        }
    }
    CellValue::number(min.unwrap_or(0.0))
}

pub(in crate::eval) fn agg_max(vals: &[TaggedValue]) -> CellValue {
    let mut max: Option<f64> = None;
    for tv in vals {
        match tagged_to_number(tv) {
            Some(Ok(n)) => {
                max = Some(match max {
                    Some(m) => m.max(n),
                    None => n,
                });
            }
            Some(Err(e)) => return CellValue::Error(e, None),
            None => {}
        }
    }
    CellValue::number(max.unwrap_or(0.0))
}

// ---------------------------------------------------------------------------
// Dense fast-path helpers
// ---------------------------------------------------------------------------

/// Map a concrete aggregate function pointer to the corresponding `AggregateOp`.
///
/// Returns `None` for unrecognised function pointers or any future aggregate
/// that doesn't have a dense fast path.
fn agg_fn_to_op(agg_fn: fn(&[TaggedValue]) -> CellValue) -> Option<AggregateOp> {
    let ptr = agg_fn as *const () as usize;
    if ptr == agg_sum as *const () as usize {
        Some(AggregateOp::Sum)
    } else if ptr == agg_average as *const () as usize {
        Some(AggregateOp::Average)
    } else if ptr == agg_count as *const () as usize {
        Some(AggregateOp::Count)
    } else if ptr == agg_counta as *const () as usize {
        Some(AggregateOp::CountA)
    } else if ptr == agg_countblank as *const () as usize {
        Some(AggregateOp::CountBlank)
    } else if ptr == agg_min as *const () as usize {
        Some(AggregateOp::Min)
    } else if ptr == agg_max as *const () as usize {
        Some(AggregateOp::Max)
    } else {
        None
    }
}

/// Resolve a `CellRef` to `(SheetId, row, col)` using evaluation metadata.
fn resolve_ref(cell_ref: &CellRef, meta: &dyn EvalMetadata) -> Option<(SheetId, u32, u32)> {
    match cell_ref {
        CellRef::Resolved(id) => meta.resolve_position(id),
        CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
    }
}

/// Try to extract `(sheet, col, start_row, end_row_inclusive)` from a
/// single-column range argument.
///
/// Returns `None` if `args` is not exactly one argument that is a single-column
/// `Range` (possibly wrapped in `SheetRef` or `Paren`).
fn try_extract_single_column_range(
    args: &[ASTNode],
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32)> {
    if args.len() != 1 {
        return None;
    }
    let arg = match &args[0] {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match arg {
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_ref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_ref(end, meta)?;
            if s_sheet != e_sheet || s_col != e_col {
                return None; // multi-column or cross-sheet
            }
            let min_row = s_row.min(e_row);
            let max_row = s_row.max(e_row);
            Some((s_sheet, s_col, min_row, max_row)) // end_row is inclusive
        }
        _ => None,
    }
}

/// Try to extract `(sheet, start_col, end_col, start_row, end_row_inclusive)` from a
/// multi-column range argument (single arg that spans multiple columns in one contiguous range).
///
/// Returns `None` if `args` is not exactly one argument that is a multi-column
/// `Range` (possibly wrapped in `SheetRef` or `Paren`), or if it's a single-column range
/// (which should be handled by the single-column fast path instead).
fn try_extract_multi_column_range(
    args: &[ASTNode],
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32, u32)> {
    if args.len() != 1 {
        return None;
    }
    let arg = match &args[0] {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match arg {
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_ref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_ref(end, meta)?;
            if s_sheet != e_sheet {
                return None; // cross-sheet
            }
            let min_col = s_col.min(e_col);
            let max_col = s_col.max(e_col);
            if min_col == max_col {
                return None; // single-column — handled by single-column fast path
            }
            let min_row = s_row.min(e_row);
            let max_row = s_row.max(e_row);
            Some((s_sheet, min_col, max_col, min_row, max_row))
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Evaluator methods for aggregation
// ---------------------------------------------------------------------------

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Evaluate args, flatten arrays into a single Vec<CellValue>.
    pub(in crate::eval) async fn eval_and_flatten(
        &mut self,
        args: &[ASTNode],
    ) -> Result<Vec<CellValue>, ComputeError> {
        let mut flat = Vec::new();
        for arg in args {
            let v = self.eval_node_cv(arg).await?;
            flatten_value(&v, &mut flat);
        }
        Ok(flat)
    }

    /// Evaluate an aggregate function (SUM, AVERAGE, MIN, MAX, COUNT, COUNTA).
    ///
    /// Tries the O(n) dense-column fast path first: when the argument is a
    /// single-column range and the column has a `DenseColumn` snapshot, the
    /// aggregate is computed directly from the packed `f64` vector without
    /// materialising individual `CellValue`s.
    ///
    /// Falls back to the original cell-by-cell path when:
    /// - the argument is not a single-column range,
    /// - the column has no dense snapshot, or
    /// - the `agg_fn` is not one of the recognised fast-path operations.
    pub(in crate::eval) async fn eval_aggregate(
        &mut self,
        args: &[ASTNode],
        agg_fn: fn(&[TaggedValue]) -> CellValue,
    ) -> Result<CellValue, ComputeError> {
        // Dense fast path: single-column range on a clean dense column
        if let Some(op) = agg_fn_to_op(agg_fn)
            && let Some((sheet, col, start_row, end_row)) =
                try_extract_single_column_range(args, self.meta)
        {
            let dense = self.meta.get_dense_column(&sheet, col);
            let bool_mask = self.meta.get_dense_bool_mask(&sheet, col);
            match try_dense_aggregate(op, dense, bool_mask, start_row, end_row) {
                DenseAggregateResult::Computed(val) => return Ok(val),
                DenseAggregateResult::Fallback => {} // fall through to cell-by-cell
            }
        }

        // Dense fast path: multi-column range — aggregate across all columns
        if let Some(op) = agg_fn_to_op(agg_fn)
            && let Some((sheet, start_col, end_col, start_row, end_row)) =
                try_extract_multi_column_range(args, self.meta)
        {
            let columns: Vec<_> = (start_col..=end_col)
                .map(|col| {
                    let dense = self.meta.get_dense_column(&sheet, col);
                    let mask = self.meta.get_dense_bool_mask(&sheet, col);
                    (dense, mask)
                })
                .collect();
            match try_dense_aggregate_multi_column(op, &columns, start_row, end_row) {
                DenseAggregateResult::Computed(val) => return Ok(val),
                DenseAggregateResult::Fallback => {} // fall through to cell-by-cell
            }
        }

        // Borrowed CellValue fast path: borrow column data directly from mirror
        if let Some((sheet, col, start_row, end_row)) =
            try_extract_single_column_range(args, self.meta)
            && let Some(col_values) = self.meta.get_column_values(&sheet, col)
        {
            let start = start_row as usize;
            let end = (end_row.saturating_add(1) as usize).min(col_values.len());
            if start < end {
                let slice = &col_values[start..end];
                let tagged: Vec<TaggedValue> = slice
                    .iter()
                    .map(|v| TaggedValue {
                        value: v.clone(),
                        source: ValueSource::Range,
                    })
                    .collect();
                return Ok(agg_fn(&tagged));
            }
            // Range entirely beyond column data — all nulls → agg_fn on empty
            return Ok(agg_fn(&[]));
        }

        // Existing cell-by-cell path
        let flat = self.eval_and_flatten_tagged(args).await?;
        Ok(agg_fn(&flat))
    }

    /// Evaluate args and flatten arrays, tagging each value with whether it
    /// originated from a cell/range reference or is a literal / function result.
    pub(in crate::eval) async fn eval_and_flatten_tagged(
        &mut self,
        args: &[ASTNode],
    ) -> Result<Vec<TaggedValue>, ComputeError> {
        let mut flat = Vec::new();
        for arg in args {
            let source = value_source_for_node(arg);
            let v = self.eval_node_cv(arg).await?;
            flatten_tagged(&v, source, &mut flat);
        }
        Ok(flat)
    }
}
