use value_types::{CellError, CellValue};

pub(super) fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

/// Build a database array:
/// | Name  | Age | Salary |
/// | Alice | 30  | 50000  |
/// | Bob   | 25  | 40000  |
/// | Carol | 30  | 60000  |
/// | Dave  | 35  | 70000  |
pub(super) fn sample_db() -> CellValue {
    CellValue::from_rows(vec![
        vec![text("Name"), text("Age"), text("Salary")],
        vec![text("Alice"), num(30.0), num(50000.0)],
        vec![text("Bob"), num(25.0), num(40000.0)],
        vec![text("Carol"), num(30.0), num(60000.0)],
        vec![text("Dave"), num(35.0), num(70000.0)],
    ])
}

/// Criteria: Age = 30
pub(super) fn criteria_age_30() -> CellValue {
    CellValue::from_rows(vec![vec![text("Age")], vec![num(30.0)]])
}

/// Criteria: Age > 25
pub(super) fn criteria_age_gt_25() -> CellValue {
    CellValue::from_rows(vec![vec![text("Age")], vec![text(">25")]])
}

/// Criteria: match all (just headers, no conditions)
pub(super) fn criteria_all() -> CellValue {
    CellValue::from_rows(vec![vec![text("Age")]])
}
