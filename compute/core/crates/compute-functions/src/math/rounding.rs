//! Rounding functions: ROUND, ROUNDUP, ROUNDDOWN, TRUNC, MROUND, INT, EVEN, ODD,
//! CEILING, CEILING.MATH, CEILING.PRECISE, ISO.CEILING, FLOOR, FLOOR.MATH, FLOOR.PRECISE

use value_types::precision::{excel_round, snap_to_15_significant_digits as snap_to_15_digits};
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

one_num_fn!(FnInt, "INT", |n: f64| n.floor());

pub(super) struct FnRound;
impl PureFunction for FnRound {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ROUND"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let digits = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        match args[0].coerce_to_number() {
            Ok(n) => {
                let factor = 10f64.powi(digits);
                let scaled = snap_to_15_digits(n * factor);
                if scaled.is_infinite() {
                    // Number too large for rounding at this precision - return as-is
                    return CellValue::number(n);
                }
                let result = excel_round(scaled) / factor;
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("ROUND: result overflow for value {n} with {digits} digits"),
                    );
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnRoundUp;
impl PureFunction for FnRoundUp {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ROUNDUP"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let digits = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        match args[0].coerce_to_number() {
            Ok(n) => {
                let factor = 10f64.powi(digits);
                let scaled = n * factor;
                if scaled.is_infinite() {
                    // Number too large for rounding at this precision - return as-is
                    return CellValue::number(n);
                }
                let result = if n >= 0.0 {
                    scaled.ceil() / factor
                } else {
                    scaled.floor() / factor
                };
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("ROUNDUP: result overflow for value {n} with {digits} digits"),
                    );
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnRoundDown;
impl PureFunction for FnRoundDown {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ROUNDDOWN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let digits = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        match args[0].coerce_to_number() {
            Ok(n) => {
                let factor = 10f64.powi(digits);
                let scaled = n * factor;
                if scaled.is_infinite() {
                    // Number too large for rounding at this precision - return as-is
                    return CellValue::number(n);
                }
                let result = if n >= 0.0 {
                    scaled.floor() / factor
                } else {
                    scaled.ceil() / factor
                };
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("ROUNDDOWN: result overflow for value {n} with {digits} digits"),
                    );
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnTrunc;
impl PureFunction for FnTrunc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TRUNC"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let digits = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        match args[0].coerce_to_number() {
            Ok(n) => {
                let factor = 10f64.powi(digits);
                let scaled = n * factor;
                if scaled.is_infinite() {
                    // Number too large for rounding at this precision - return as-is
                    return CellValue::number(n);
                }
                let result = scaled.trunc() / factor;
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("TRUNC: result overflow for value {n} with {digits} digits"),
                    );
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnMround;
impl PureFunction for FnMround {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MROUND"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(_), Ok(0.0)) => CellValue::number(0.0),
            (Ok(n), Ok(multiple)) => {
                // Unlike FLOOR/CEILING, MROUND still requires same-sign
                // arguments in all Excel versions (including 365).
                if (n > 0.0 && multiple < 0.0) || (n < 0.0 && multiple > 0.0) {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "MROUND: number ({n}) and multiple ({multiple}) must have the same sign"
                        ),
                    );
                }
                let result = excel_round(snap_to_15_digits(n / multiple)) * multiple;
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MROUND: result overflow for value {n} with multiple {multiple}"),
                    );
                }
                CellValue::number(result)
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnEven;
impl PureFunction for FnEven {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "EVEN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n == 0.0 {
                    return CellValue::number(0.0);
                }
                let sign = if n > 0.0 { 1.0 } else { -1.0 };
                let abs_n = n.abs();
                let ceil = abs_n.ceil();
                let rounded = if ceil as i64 % 2 == 0 {
                    ceil
                } else {
                    ceil + 1.0
                };
                CellValue::number(sign * rounded)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnOdd;
impl PureFunction for FnOdd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ODD"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n == 0.0 {
                    return CellValue::number(1.0);
                }
                let sign = if n > 0.0 { 1.0 } else { -1.0 };
                let abs_n = n.abs();
                let ceil = abs_n.ceil();
                let rounded = if ceil as i64 % 2 == 1 {
                    ceil
                } else {
                    ceil + 1.0
                };
                CellValue::number(sign * rounded)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCeiling;
impl PureFunction for FnCeiling {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CEILING"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(_), Ok(0.0)) => CellValue::number(0.0),
            (Ok(n), Ok(sig)) => {
                // Excel 2010+ accepts negative number + positive significance
                // for CEILING (rounds toward zero). Only positive number +
                // negative significance still returns #NUM! in all versions.
                if n > 0.0 && sig < 0.0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "CEILING: positive number ({n}) cannot have negative significance ({sig})"
                        ),
                    );
                }
                let result = (n / sig).ceil() * sig;
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("CEILING: result overflow for value {n} with significance {sig}"),
                    );
                }
                CellValue::number(result)
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCeilingMath;
impl PureFunction for FnCeilingMath {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CEILING.MATH"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        if n == 0.0 {
            return CellValue::number(0.0);
        }

        let mut significance = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        // Excel 365: CEILING.MATH(n, 0) returns 0
        if significance == 0.0 {
            return CellValue::number(0.0);
        }

        let mode = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(m) => m,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };

        significance = significance.abs();

        // Guard against extreme magnitude mismatches between n and significance.
        // When n/significance overflows or is NaN, Excel returns #NUM!.
        // When n/significance underflows to subnormal, the result is effectively 0.
        let ratio = n / significance;
        if ratio.is_infinite() || ratio.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CEILING.MATH: magnitude mismatch between value {n} and significance {significance}"
                ),
            );
        }
        if !ratio.is_normal() {
            return CellValue::number(0.0);
        }

        let result = if n >= 0.0 {
            (n / significance).ceil() * significance
        } else if mode == 0.0 {
            // Round toward zero
            -(n.abs() / significance).floor() * significance
        } else {
            // Round away from zero
            -(n.abs() / significance).ceil() * significance
        };
        if result.is_infinite() || result.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CEILING.MATH: result overflow for value {n} with significance {significance}"
                ),
            );
        }
        CellValue::number(result)
    }
}

pub(super) struct FnCeilingPrecise;
impl PureFunction for FnCeilingPrecise {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CEILING.PRECISE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        if n == 0.0 {
            return CellValue::number(0.0);
        }

        let mut significance = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if significance == 0.0 {
            return CellValue::number(0.0);
        }

        significance = significance.abs();
        let result = (n / significance).ceil() * significance;
        if result.is_infinite() || result.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "CEILING.PRECISE: result overflow for value {n} with significance {significance}"
                ),
            );
        }
        CellValue::number(result)
    }
}

pub(super) struct FnIsoCeiling;
impl PureFunction for FnIsoCeiling {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ISO.CEILING"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // ISO.CEILING is identical to CEILING.PRECISE
        FnCeilingPrecise.call(args)
    }
}

pub(super) struct FnFloor;
impl PureFunction for FnFloor {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FLOOR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(_), Ok(0.0)) => {
                CellValue::error_with_message(CellError::Div0, "FLOOR: significance cannot be zero")
            }
            (Ok(n), Ok(sig)) => {
                // Excel 2010+ accepts negative number + positive significance
                // (rounds toward -infinity). Only positive number + negative
                // significance still returns #NUM! across all Excel versions.
                // ECMA-376 1st ed. (Excel 2007) returned #NUM! for both mixed-
                // sign cases, but real-world .xlsx files target 2010+ behavior.
                if n > 0.0 && sig < 0.0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "FLOOR: positive number ({n}) cannot have negative significance ({sig})"
                        ),
                    );
                }
                let result = (n / sig).floor() * sig;
                if result.is_infinite() || result.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("FLOOR: result overflow for value {n} with significance {sig}"),
                    );
                }
                CellValue::number(result)
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnFloorMath;
impl PureFunction for FnFloorMath {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FLOOR.MATH"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        if n == 0.0 {
            return CellValue::number(0.0);
        }

        let mut significance = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        // Excel 365: FLOOR.MATH(n, 0) returns 0
        if significance == 0.0 {
            return CellValue::number(0.0);
        }

        let mode = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(m) => m,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };

        significance = significance.abs();

        // Guard against extreme magnitude mismatches between n and significance.
        // When n/significance overflows or is NaN, Excel returns #NUM!.
        // When n/significance underflows to subnormal, the result is effectively 0.
        let ratio = n / significance;
        if ratio.is_infinite() || ratio.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "FLOOR.MATH: magnitude mismatch between value {n} and significance {significance}"
                ),
            );
        }
        if !ratio.is_normal() {
            return CellValue::number(0.0);
        }

        let result = if n >= 0.0 {
            (n / significance).floor() * significance
        } else if mode == 0.0 {
            // Round away from zero
            -(n.abs() / significance).ceil() * significance
        } else {
            // Round toward zero
            -(n.abs() / significance).floor() * significance
        };
        if result.is_infinite() || result.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "FLOOR.MATH: result overflow for value {n} with significance {significance}"
                ),
            );
        }
        CellValue::number(result)
    }
}

pub(super) struct FnFloorPrecise;
impl PureFunction for FnFloorPrecise {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FLOOR.PRECISE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let n = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        if n == 0.0 {
            return CellValue::number(0.0);
        }

        let mut significance = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        if significance == 0.0 {
            return CellValue::number(0.0);
        }

        significance = significance.abs();
        let result = (n / significance).floor() * significance;
        if result.is_infinite() || result.is_nan() {
            return CellValue::error_with_message(
                CellError::Num,
                format!(
                    "FLOOR.PRECISE: result overflow for value {n} with significance {significance}"
                ),
            );
        }
        CellValue::number(result)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnInt));
    registry.register(Box::new(FnRound));
    registry.register(Box::new(FnRoundUp));
    registry.register(Box::new(FnRoundDown));
    registry.register(Box::new(FnTrunc));
    registry.register(Box::new(FnMround));
    registry.register(Box::new(FnEven));
    registry.register(Box::new(FnOdd));
    registry.register(Box::new(FnCeiling));
    registry.register(Box::new(FnCeilingMath));
    registry.register(Box::new(FnCeilingPrecise));
    registry.register(Box::new(FnIsoCeiling));
    registry.register(Box::new(FnFloor));
    registry.register(Box::new(FnFloorMath));
    registry.register(Box::new(FnFloorPrecise));
}
