//! Random functions: RAND, RANDBETWEEN, RANDARRAY (volatile)

use rand::Rng;
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnRand;
impl PureFunction for FnRand {
    fn name(&self) -> &'static str {
        "RAND"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(0)
    }
    fn is_volatile(&self) -> bool {
        true
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        CellValue::number(rand::thread_rng().gen_range(0.0..1.0))
    }
}

pub(super) struct FnRandBetween;
impl PureFunction for FnRandBetween {
    fn name(&self) -> &'static str {
        "RANDBETWEEN"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_volatile(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(lo), Ok(hi)) => {
                let lo = lo.ceil() as i64;
                let hi = hi.floor() as i64;
                if lo > hi {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("RANDBETWEEN: bottom ({lo}) must be <= top ({hi})"),
                    )
                } else {
                    let result = rand::thread_rng().gen_range(lo..=hi);
                    CellValue::number(result as f64)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnRandArray;
impl PureFunction for FnRandArray {
    fn name(&self) -> &'static str {
        "RANDARRAY"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn is_volatile(&self) -> bool {
        true
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Check errors in provided args
        for arg in args {
            if let Some(e) = check_error(arg) {
                return e;
            }
        }

        let rows = if !args.is_empty() {
            match args[0].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let cols = if args.len() > 1 {
            match args[1].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let min = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0.0
        };
        let max = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1.0
        };
        let whole_number = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(n) => n != 0.0,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        if rows < 1 || cols < 1 {
            return CellValue::error_with_message(
                CellError::Value,
                format!("RANDARRAY: rows ({rows}) and cols ({cols}) must be >= 1"),
            );
        }
        if min > max {
            return CellValue::error_with_message(
                CellError::Value,
                format!("RANDARRAY: min ({min}) must be <= max ({max})"),
            );
        }
        if rows > 1048576 || cols > 16384 || rows * cols > 2_000_000 {
            return CellValue::error_with_message(
                CellError::Calc,
                format!("RANDARRAY: dimensions {rows}x{cols} too large"),
            );
        }

        let mut rng = rand::thread_rng();
        let rows_usize = rows as usize;
        let cols_usize = cols as usize;
        let mut data = Vec::with_capacity(rows_usize * cols_usize);
        for _ in 0..rows_usize {
            for _ in 0..cols_usize {
                if whole_number {
                    let lo = min.ceil() as i64;
                    let hi = max.floor() as i64;
                    if lo > hi {
                        data.push(CellValue::error_with_message(
                            CellError::Value,
                            format!("RANDARRAY: no integers between {min} and {max}"),
                        ));
                    } else {
                        data.push(CellValue::number(rng.gen_range(lo..=hi) as f64));
                    }
                } else {
                    data.push(CellValue::number(rng.gen_range(min..max)));
                }
            }
        }

        if rows_usize == 1 && cols_usize == 1 {
            match data.into_iter().next() {
                Some(v) => v,
                None => CellValue::Error(CellError::Num, None),
            }
        } else {
            CellValue::array(data, cols_usize)
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnRand));
    registry.register(Box::new(FnRandBetween));
    registry.register(Box::new(FnRandArray));
}
