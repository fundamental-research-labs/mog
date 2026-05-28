mod basic_functions;
mod dated_pairs;
mod xirr_convergence;
mod xirr_errors;
mod xirr_known_answers;
mod xirr_numerical;

use value_types::{CellError, CellValue};

use super::{FnIrr, FnMirr, FnNpv, FnXirr, FnXnpv};

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

pub(super) fn ymd(y: i32, m: i32, d: i32) -> f64 {
    crate::helpers::date_serial::ymd_to_serial(y, m, d)
}
