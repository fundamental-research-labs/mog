use crate::registered_function::RegisteredFunction;
use value_types::{CellError, CellValue};

/// Auto-broadcast Scalar-role array arguments element-wise.
///
/// When multiple arguments are arrays, broadcasts them together (zipped, not
/// cross-product). Single-array cases keep the existing fast path.
pub(crate) fn try_array_lift(
    function: &RegisteredFunction,
    args: &[CellValue],
) -> Option<CellValue> {
    let lift_indices: Vec<usize> = args
        .iter()
        .enumerate()
        .filter(|(i, arg)| matches!(arg, CellValue::Array(_)) && function.is_liftable_arg(*i))
        .map(|(i, _)| i)
        .collect();

    if lift_indices.is_empty() {
        return None;
    }

    if lift_indices.len() == 1 {
        let lift_idx = lift_indices[0];
        let arr = match &args[lift_idx] {
            CellValue::Array(a) => a,
            _ => unreachable!(),
        };
        let cols = arr.cols();

        if args.len() == 2 {
            let other_idx = 1 - lift_idx;
            let other = &args[other_idx];
            let result: Vec<CellValue> = arr
                .iter()
                .map(|elem| {
                    if lift_idx == 0 {
                        function.call(&[elem.clone(), other.clone()])
                    } else {
                        function.call(&[other.clone(), elem.clone()])
                    }
                })
                .collect();
            return Some(CellValue::array(result, cols));
        }

        let result: Vec<CellValue> = arr
            .iter()
            .map(|elem| {
                let mut lifted_args = args.to_vec();
                lifted_args[lift_idx] = elem.clone();
                function.call(&lifted_args)
            })
            .collect();
        return Some(CellValue::array(result, cols));
    }

    let mut max_rows: usize = 1;
    let mut max_cols: usize = 1;
    for &idx in &lift_indices {
        if let CellValue::Array(a) = &args[idx] {
            let ar = a.rows();
            let ac = a.cols();
            if ar > 1 {
                if max_rows == 1 {
                    max_rows = ar;
                } else if ar != max_rows {
                    return Some(CellValue::Error(CellError::Value, None));
                }
            }
            if ac > 1 {
                if max_cols == 1 {
                    max_cols = ac;
                } else if ac != max_cols {
                    return Some(CellValue::Error(CellError::Value, None));
                }
            }
        }
    }

    let mut result = Vec::with_capacity(max_rows * max_cols);
    for r in 0..max_rows {
        for c in 0..max_cols {
            let mut lifted_args = args.to_vec();
            for &idx in &lift_indices {
                if let CellValue::Array(a) = &args[idx] {
                    let ri = if a.rows() == 1 { 0 } else { r };
                    let ci = if a.cols() == 1 { 0 } else { c };
                    lifted_args[idx] = a
                        .get(ri, ci)
                        .cloned()
                        .unwrap_or(CellValue::Error(CellError::Na, None));
                }
            }
            result.push(function.call_inner(&lifted_args));
        }
    }
    Some(CellValue::array(result, max_cols))
}
