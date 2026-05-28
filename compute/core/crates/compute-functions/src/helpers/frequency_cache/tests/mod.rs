use value_types::CellValue;

mod cache;
mod count_map;
mod exact;
mod incremental;
mod key;
mod sum_map;

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}
