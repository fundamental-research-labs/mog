//! Binary/unary operators, comparison, and array broadcasting.

use compute_functions::helpers::power::try_negative_base_pow;
use compute_parser::{BinOp, UnaryOp};
use value_types::{CellArray, CellError, CellValue};

/// Extract the double-double error term from a CellValue.
/// For non-Number values (or when dd-precision is off), returns 0.0.
#[inline]
#[allow(dead_code)]
fn lo_of(val: &CellValue) -> f64 {
    match val {
        CellValue::Number(n) => n.lo(),
        _ => 0.0,
    }
}

pub(in crate::eval) fn eval_binary_op(op: BinOp, left: &CellValue, right: &CellValue) -> CellValue {
    // Array broadcasting
    if let (CellValue::Array(la), CellValue::Array(ra)) = (left, right) {
        return broadcast_array_array(op, la, ra);
    }
    if let CellValue::Array(arr) = left {
        return broadcast_array_scalar(op, arr, right, true);
    }
    if let CellValue::Array(arr) = right {
        return broadcast_array_scalar(op, arr, left, false);
    }

    // Error propagation — Excel uses left-to-right evaluation order.
    // For arithmetic/concat, coercion errors (e.g. #VALUE! from "" in numeric
    // context) take precedence over structural errors (e.g. #REF!) on the other
    // operand, because Excel short-circuits on the first operand that fails.
    // We defer error propagation to the per-op coercion below for arithmetic
    // and concat. For comparisons, propagate immediately (Excel does too).
    match op {
        BinOp::Eq
        | BinOp::Neq
        | BinOp::Lt
        | BinOp::Gt
        | BinOp::Lte
        | BinOp::Gte
        | BinOp::Intersect => {
            if let CellValue::Error(e, _) = left {
                return CellValue::Error(*e, None);
            }
            if let CellValue::Error(e, _) = right {
                return CellValue::Error(*e, None);
            }
        }
        _ => {}
    }

    match op {
        BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Pow => {
            // Coerce left first — if it fails (e.g. "" → #VALUE!), return
            // immediately without inspecting the right operand's error.
            let ln = match left.coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            let rn = match right.coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            match op {
                BinOp::Add => {
                    #[cfg(feature = "dd-precision")]
                    {
                        let r = value_types::F64x2::new(ln, lo_of(left))
                            + value_types::F64x2::new(rn, lo_of(right));
                        CellValue::number_dd(r.hi(), r.lo())
                    }
                    #[cfg(not(feature = "dd-precision"))]
                    CellValue::number(ln + rn)
                }
                BinOp::Sub => {
                    #[cfg(feature = "dd-precision")]
                    {
                        // Double-double subtraction preserves full precision —
                        // no need for the snap-to-15-digit cancellation heuristic.
                        let r = value_types::F64x2::new(ln, lo_of(left))
                            - value_types::F64x2::new(rn, lo_of(right));
                        CellValue::number_dd(r.hi(), r.lo())
                    }
                    #[cfg(not(feature = "dd-precision"))]
                    {
                        use value_types::precision::subtraction_cancels_at_15_digits;
                        let result = ln - rn;
                        // Catastrophic cancellation detection: if both operands agree
                        // to 15 significant digits (or differ by at most 1 ULP at the
                        // 15th digit), the difference is purely rounding noise.
                        // Return exact 0 to match Excel's behavior for check rows
                        // like Total_Assets - Total_Liabilities.
                        if result != 0.0 && subtraction_cancels_at_15_digits(ln, rn) {
                            return CellValue::number(0.0);
                        }
                        CellValue::number(result)
                    }
                }
                BinOp::Mul => {
                    #[cfg(feature = "dd-precision")]
                    {
                        let r = value_types::F64x2::new(ln, lo_of(left))
                            * value_types::F64x2::new(rn, lo_of(right));
                        CellValue::number_dd(r.hi(), r.lo())
                    }
                    #[cfg(not(feature = "dd-precision"))]
                    CellValue::number(ln * rn)
                }
                BinOp::Div => {
                    if rn == 0.0 {
                        CellValue::Error(CellError::Div0, None)
                    } else {
                        #[cfg(feature = "dd-precision")]
                        {
                            let r = value_types::F64x2::new(ln, lo_of(left))
                                / value_types::F64x2::new(rn, lo_of(right));
                            CellValue::number_dd(r.hi(), r.lo())
                        }
                        #[cfg(not(feature = "dd-precision"))]
                        CellValue::number(ln / rn)
                    }
                }
                BinOp::Pow => {
                    // 1. Handle base=0 cases
                    if ln == 0.0 {
                        if rn == 0.0 {
                            return CellValue::Error(CellError::Num, None); // Excel: 0^0 = #NUM!
                        } else if rn > 0.0 {
                            return CellValue::number(0.0);
                        } else {
                            return CellValue::Error(CellError::Div0, None); // 0^negative = #DIV/0!
                        }
                    }
                    // 2. Negative base with non-integer exponent: try real-valued
                    //    n-th root for rational exponents with odd denominator
                    //    (e.g., (-8)^(1/3) = -2), otherwise #NUM!.
                    if ln < 0.0 && rn != 0.0 && rn.is_finite() && rn != rn.floor() {
                        if let Some(result) = try_negative_base_pow(ln, rn) {
                            return result;
                        }
                        return CellValue::Error(CellError::Num, None);
                    }
                    // 3. 1^anything = 1
                    if ln == 1.0 {
                        return CellValue::number(1.0);
                    }
                    // 4. |exp| >= 1e308 -> #NUM! (except small positive base + huge negative exp -> 0)
                    if rn.abs() >= 1e308 {
                        if ln > 0.0 && rn < 0.0 {
                            // Any positive base with huge negative exp underflows to 0
                            // (ln=1 already handled above)
                            return CellValue::number(0.0);
                        }
                        return CellValue::Error(CellError::Num, None);
                    }
                    // 5. |exp| > 2^53 -> #NUM! (except positive base + huge negative exp -> 0)
                    const MAX_SAFE_INT: f64 = 9_007_199_254_740_992.0;
                    if rn.abs() > MAX_SAFE_INT {
                        if ln > 0.0 && rn < 0.0 {
                            return CellValue::number(0.0);
                        }
                        return CellValue::Error(CellError::Num, None);
                    }
                    // 6. Subnormal bases with negative exponent -> #DIV/0!
                    if ln.abs() < f64::MIN_POSITIVE && rn < 0.0 {
                        return CellValue::Error(CellError::Div0, None);
                    }
                    // 7. (-1)^n
                    if ln == -1.0 {
                        let is_even = rn % 2.0 == 0.0;
                        return CellValue::number(if is_even { 1.0 } else { -1.0 });
                    }
                    let r = ln.powf(rn);
                    if r.is_nan() || r.is_infinite() {
                        // Small positive base with negative exp overflows to inf
                        // → Excel returns #DIV/0! (conceptually 1/0)
                        if r.is_infinite() && ln > 0.0 && ln < 1.0 && rn < 0.0 {
                            CellValue::Error(CellError::Div0, None)
                        } else {
                            CellValue::Error(CellError::Num, None)
                        }
                    } else {
                        CellValue::number(r)
                    }
                }
                _ => unreachable!(),
            }
        }
        BinOp::Concat => {
            let ls = match left.coerce_to_string() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            };
            let rs = match right.coerce_to_string() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            };
            CellValue::Text(format!("{}{}", ls, rs).into())
        }
        BinOp::Eq => CellValue::Boolean(cell_value_cmp(left, right) == 0),
        BinOp::Neq => CellValue::Boolean(cell_value_cmp(left, right) != 0),
        BinOp::Lt => CellValue::Boolean(cell_value_cmp(left, right) < 0),
        BinOp::Gt => CellValue::Boolean(cell_value_cmp(left, right) > 0),
        BinOp::Lte => CellValue::Boolean(cell_value_cmp(left, right) <= 0),
        BinOp::Gte => CellValue::Boolean(cell_value_cmp(left, right) >= 0),
        // Value-level fallback only. Valid reference intersections are resolved
        // by the evaluator before their operands are materialized.
        BinOp::Intersect => CellValue::Error(CellError::Null, None),
    }
}

pub(in crate::eval) fn eval_unary_op(op: UnaryOp, val: &CellValue) -> CellValue {
    // Implicit-intersection (`@`) collapses arrays/ranges to a single scalar.
    // The position-aware row/column-aligned variant is dispatched in the
    // evaluator (which has access to the calling cell). When that special
    // dispatch is unavailable (e.g. `@` applied to an already-evaluated array
    // value during constant-folded paths), fall back to the top-left scalar
    // — Excel's behaviour when no row/col alignment can be computed.
    if op == UnaryOp::ImplicitIntersection {
        return match val {
            CellValue::Array(arr) => arr.get(0, 0).cloned().unwrap_or(CellValue::Null),
            other => other.clone(),
        };
    }

    // Array broadcasting for unary operators.
    // Critical for SUMPRODUCT patterns like --(boolean_array) which use
    // double unary minus to coerce boolean arrays to numeric arrays (0/1).
    if let CellValue::Array(arr) = val {
        let result: Vec<CellValue> = arr.iter().map(|v| eval_unary_op(op, v)).collect();
        return CellValue::array(result, arr.cols());
    }

    if let CellValue::Error(e, _) = val {
        return CellValue::Error(*e, None);
    }
    match op {
        UnaryOp::Plus => {
            // Excel semantics: unary plus coerces booleans and numeric-looking text
            // to number, but passes through non-numeric text unchanged (including "").
            // +"2019" → 2019, +TRUE → 1, +"hello" → "hello", +"" → ""
            // This matches Lotus 1-2-3 compatibility: +expr is identity for text values.
            match val {
                CellValue::Text(_) => match val.coerce_to_number() {
                    Ok(n) => CellValue::number(n),
                    Err(_) => val.clone(),
                },
                CellValue::Null => CellValue::number(0.0),
                _ => match val.coerce_to_number() {
                    Ok(n) => CellValue::number(n),
                    Err(e) => CellValue::Error(e, None),
                },
            }
        }
        UnaryOp::Minus => match val.coerce_to_number() {
            Ok(n) => {
                #[cfg(feature = "dd-precision")]
                {
                    CellValue::number_dd(-n, -lo_of(val))
                }
                #[cfg(not(feature = "dd-precision"))]
                CellValue::number(-n)
            }
            Err(e) => CellValue::Error(e, None),
        },
        UnaryOp::Percent => match val.coerce_to_number() {
            Ok(n) => {
                #[cfg(feature = "dd-precision")]
                {
                    let r =
                        value_types::F64x2::new(n, lo_of(val)) / value_types::F64x2::from(100.0);
                    CellValue::number_dd(r.hi(), r.lo())
                }
                #[cfg(not(feature = "dd-precision"))]
                CellValue::number(n / 100.0)
            }
            Err(e) => CellValue::Error(e, None),
        },
        // Already short-circuited above (top of fn). Reaching this arm means
        // a caller bypassed the early return — fall back to identity, which
        // is the correct value-level semantics for `@<scalar>`.
        UnaryOp::ImplicitIntersection => val.clone(),
    }
}

/// Excel comparison ordering: Null < Number < Text < Boolean.
/// Same type: compare naturally (text case-insensitive).
///
/// Excel coerces blank cells to the peer type's zero value for comparisons:
///   Null vs Number  → Number(0.0) vs Number
///   Null vs Text    → Text("") vs Text
///   Null vs Boolean → Boolean(false) vs Boolean
/// Non-null cross-type comparisons keep the type-rank ordering (Number < Text < Boolean).
pub(in crate::eval) fn cell_value_cmp(a: &CellValue, b: &CellValue) -> i32 {
    // Handle Null coercion inline without creating temporaries.
    // Excel coerces blank cells to the peer type's zero value:
    //   Null vs Number  → 0.0 vs Number
    //   Null vs Text    → "" vs Text
    //   Null vs Boolean → false vs Boolean
    match (a, b) {
        // Both null
        (CellValue::Null, CellValue::Null) => 0,

        // Null vs Number → compare 0.0 vs number
        (CellValue::Null, CellValue::Number(y)) => {
            use value_types::precision::cmp_15_significant_digits;
            cmp_15_significant_digits(0.0, y.get()).map_or(0, |o| o as i32)
        }
        (CellValue::Number(x), CellValue::Null) => {
            use value_types::precision::cmp_15_significant_digits;
            cmp_15_significant_digits(x.get(), 0.0).map_or(0, |o| o as i32)
        }

        // Null vs Text → compare "" vs text
        (CellValue::Null, CellValue::Text(y)) => ascii_case_insensitive_cmp("", y),
        (CellValue::Text(x), CellValue::Null) => ascii_case_insensitive_cmp(x, ""),

        // Null vs Boolean → compare false vs bool
        (CellValue::Null, CellValue::Boolean(y)) => 0i32 - (*y as u8 as i32),
        (CellValue::Boolean(x), CellValue::Null) => *x as u8 as i32,

        // Same-type comparisons
        (CellValue::Number(x), CellValue::Number(y)) => {
            use value_types::precision::cmp_15_significant_digits;
            cmp_15_significant_digits(x.get(), y.get()).map_or(0, |o| o as i32)
        }
        (CellValue::Text(x), CellValue::Text(y)) => ascii_case_insensitive_cmp(x, y),
        (CellValue::Boolean(x), CellValue::Boolean(y)) => (*x as u8 as i32) - (*y as u8 as i32),

        // Cross-type: use type rank ordering (Number < Text < Boolean)
        _ => {
            fn type_rank(v: &CellValue) -> u8 {
                match v {
                    CellValue::Null => 0,
                    CellValue::Number(_) => 1,
                    CellValue::Text(_) => 2,
                    CellValue::Boolean(_) => 3,
                    CellValue::Error(..) => 4,
                    CellValue::Array(_) => 5,
                    CellValue::Control(_) => 3, // coerces to Boolean
                    CellValue::Image(_) => 5,
                }
            }
            (type_rank(a) as i32) - (type_rank(b) as i32)
        }
    }
}

/// Case-insensitive ASCII byte ordering. Zero allocation — folds case
/// lazily via iterator and short-circuits on first difference.
#[inline]
fn ascii_case_insensitive_cmp(x: &str, y: &str) -> i32 {
    x.bytes()
        .map(|b| b.to_ascii_lowercase())
        .cmp(y.bytes().map(|b| b.to_ascii_lowercase())) as i32
}

pub(in crate::eval) fn cell_value_eq(a: &CellValue, b: &CellValue) -> bool {
    cell_value_cmp(a, b) == 0
}

/// Strict equality for lookup exact-match (XLOOKUP, VLOOKUP, HLOOKUP).
/// Unlike `cell_value_eq`, Null only matches Null — it is NOT coerced to
/// the peer type's zero value (0, "", false).  Excel's lookup functions
/// treat empty cells as distinct from formula-produced "" or 0.
pub(in crate::eval) fn cell_value_eq_lookup(a: &CellValue, b: &CellValue) -> bool {
    if a.is_null() || b.is_null() {
        return a.is_null() && b.is_null();
    }
    cell_value_eq(a, b)
}

/// Compare for approximate match lookup (HLOOKUP/VLOOKUP/MATCH).
/// Returns None if types differ (caller should skip the value).
pub(in crate::eval) fn cell_value_cmp_for_lookup(a: &CellValue, b: &CellValue) -> Option<i32> {
    // Treat empty text as Null
    let a = match a {
        CellValue::Text(s) if s.is_empty() => &CellValue::Null,
        _ => a,
    };
    let b = match b {
        CellValue::Text(s) if s.is_empty() => &CellValue::Null,
        _ => b,
    };

    fn type_rank(v: &CellValue) -> u8 {
        match v {
            CellValue::Null => 0,
            CellValue::Number(_) => 1,
            CellValue::Text(_) => 2,
            CellValue::Boolean(_) => 3,
            CellValue::Error(..) => 4,
            CellValue::Array(_) => 5,
            CellValue::Control(_) => 3, // coerces to Boolean
            CellValue::Image(_) => 5,
        }
    }

    let ra = type_rank(a);
    let rb = type_rank(b);

    if ra != rb {
        return None; // Different types: skip in approximate match
    }

    Some(match (a, b) {
        (CellValue::Null, CellValue::Null) => 0,
        (CellValue::Number(x), CellValue::Number(y)) => {
            use value_types::precision::snap_to_15_significant_digits as snap15;
            snap15(x.get())
                .partial_cmp(&snap15(y.get()))
                .map_or(0, |o| o as i32)
        }
        (CellValue::Text(x), CellValue::Text(y)) => ascii_case_insensitive_cmp(x, y),
        (CellValue::Boolean(x), CellValue::Boolean(y)) => (*x as u8 as i32) - (*y as u8 as i32),
        _ => 0,
    })
}

// ---------------------------------------------------------------------------
// Array broadcasting
// ---------------------------------------------------------------------------

pub(in crate::eval) fn broadcast_array_scalar(
    op: BinOp,
    arr: &CellArray,
    scalar: &CellValue,
    arr_is_left: bool,
) -> CellValue {
    let result: Vec<CellValue> = arr
        .iter()
        .map(|v| {
            if arr_is_left {
                eval_binary_op(op, v, scalar)
            } else {
                eval_binary_op(op, scalar, v)
            }
        })
        .collect();
    CellValue::array(result, arr.cols())
}

pub(in crate::eval) fn broadcast_array_array(
    op: BinOp,
    left: &CellArray,
    right: &CellArray,
) -> CellValue {
    let lr = left.rows();
    let rr = right.rows();
    let lc = left.cols();
    let rc = right.cols();

    let out_rows = lr.max(rr);
    let out_cols = lc.max(rc);

    // If dimensions don't match and neither is 1, error
    if lr != rr && lr != 1 && rr != 1 {
        return CellValue::Error(CellError::Value, None);
    }
    if lc != rc && lc != 1 && rc != 1 {
        return CellValue::Error(CellError::Value, None);
    }

    let mut data = Vec::with_capacity(out_rows * out_cols);
    for r in 0..out_rows {
        for c in 0..out_cols {
            let li = if lr == 1 { 0 } else { r };
            let lj = if lc == 1 { 0 } else { c };
            let ri = if rr == 1 { 0 } else { r };
            let rj = if rc == 1 { 0 } else { c };
            let lv = left
                .get(li, lj)
                .cloned()
                .unwrap_or(CellValue::Error(CellError::Na, None));
            let rv = right
                .get(ri, rj)
                .cloned()
                .unwrap_or(CellValue::Error(CellError::Na, None));
            data.push(eval_binary_op(op, &lv, &rv));
        }
    }
    CellValue::array(data, out_cols)
}

/// Apply a scalar function element-wise over an array.
/// If the input is a scalar, apply directly.
pub(in crate::eval) fn broadcast_unary<F>(val: CellValue, f: F) -> CellValue
where
    F: Fn(&CellValue) -> CellValue,
{
    match val {
        CellValue::Array(arr) => {
            let data: Vec<CellValue> = arr.iter().map(&f).collect();
            CellValue::array(data, arr.cols())
        }
        scalar => f(&scalar),
    }
}
