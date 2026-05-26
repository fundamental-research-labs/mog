//! Aggregation functions: SUMSQ, SUMX2MY2, SUMX2PY2, SUMXMY2, SERIESSUM

use value_types::{CellError, CellValue, KahanSum};

use crate::helpers::coercion::{check_error, flatten_values_ref};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnPercentOf;
impl PureFunction for FnPercentOf {
    fn name(&self) -> &'static str {
        "PERCENTOF"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let subset = match excel_sum_for_percentof(&args[0]) {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let all = match excel_sum_for_percentof(&args[1]) {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        if all == 0.0 {
            return CellValue::Error(CellError::Div0, None);
        }
        CellValue::number(subset / all)
    }
}

fn excel_sum_for_percentof(value: &CellValue) -> Result<f64, CellError> {
    let mut sum = KahanSum::new();
    for v in flatten_values_ref(value) {
        match v {
            CellValue::Error(e, _) => return Err(*e),
            CellValue::Number(n) => sum.add(n.get()),
            _ => {}
        }
    }
    Ok(sum.total())
}

pub(super) struct FnSumsq;
impl PureFunction for FnSumsq {
    fn name(&self) -> &'static str {
        "SUMSQ"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mut sum = KahanSum::new();
        for arg in args {
            for v in flatten_values_ref(arg) {
                match v {
                    CellValue::Error(e, _) => return CellValue::Error(*e, None),
                    CellValue::Number(n) => sum.add(n.get() * n.get()),
                    _ => {}
                }
            }
        }
        CellValue::number(sum.total())
    }
}

pub(super) struct FnSumx2my2;
impl PureFunction for FnSumx2my2 {
    fn name(&self) -> &'static str {
        "SUMX2MY2"
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
        let xs = flatten_values_ref(&args[0]);
        let ys = flatten_values_ref(&args[1]);
        if xs.len() != ys.len() {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "SUMX2MY2: arrays must be same size, got {} and {}",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        let mut sum = KahanSum::new();
        for i in 0..xs.len() {
            let x = match xs[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            let y = match ys[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            sum.add(x * x - y * y);
        }
        CellValue::number(sum.total())
    }
}

pub(super) struct FnSumx2py2;
impl PureFunction for FnSumx2py2 {
    fn name(&self) -> &'static str {
        "SUMX2PY2"
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
        let xs = flatten_values_ref(&args[0]);
        let ys = flatten_values_ref(&args[1]);
        if xs.len() != ys.len() {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "SUMX2PY2: arrays must be same size, got {} and {}",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        let mut sum = KahanSum::new();
        for i in 0..xs.len() {
            let x = match xs[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            let y = match ys[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            sum.add(x * x + y * y);
        }
        CellValue::number(sum.total())
    }
}

pub(super) struct FnSumxmy2;
impl PureFunction for FnSumxmy2 {
    fn name(&self) -> &'static str {
        "SUMXMY2"
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
        let xs = flatten_values_ref(&args[0]);
        let ys = flatten_values_ref(&args[1]);
        if xs.len() != ys.len() {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "SUMXMY2: arrays must be same size, got {} and {}",
                    xs.len(),
                    ys.len()
                ),
            );
        }
        let mut sum = KahanSum::new();
        for i in 0..xs.len() {
            let x = match xs[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            let y = match ys[i].coerce_to_number() {
                Ok(n) => n,
                Err(e) => return CellValue::Error(e, None),
            };
            let diff = x - y;
            sum.add(diff * diff);
        }
        CellValue::number(sum.total())
    }
}

pub(super) struct FnSeriesSum;
impl PureFunction for FnSeriesSum {
    fn name(&self) -> &'static str {
        "SERIESSUM"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        // Don't check_error on args[3] since it's an array
        let x = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let n = match args[1].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let m = match args[2].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        let coefficients = flatten_values_ref(&args[3]);
        let mut sum = KahanSum::new();
        let mut power = n;
        for coef_val in coefficients {
            match coef_val {
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                _ => {
                    let c = match coef_val.coerce_to_number() {
                        Ok(n) => n,
                        Err(e) => return CellValue::Error(e, None),
                    };
                    sum.add(c * x.powf(power));
                    power += m;
                }
            }
        }
        CellValue::number(sum.total())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnPercentOf));
    registry.register(Box::new(FnSumsq));
    registry.register(Box::new(FnSumx2my2));
    registry.register(Box::new(FnSumx2py2));
    registry.register(Box::new(FnSumxmy2));
    registry.register(Box::new(FnSeriesSum));
}
