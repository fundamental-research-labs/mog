mod accrual;
mod coupons;
mod duration;
mod price_yield;

use value_types::CellValue;

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
    match a {
        CellValue::Number(n) => (n.get() - expected).abs() < tol,
        _ => false,
    }
}

fn ymd_to_serial(year: i32, month: u32, day: u32) -> f64 {
    super::super::helpers::ymd_to_serial(year, month as i32, day as i32)
}
