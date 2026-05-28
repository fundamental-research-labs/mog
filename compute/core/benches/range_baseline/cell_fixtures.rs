use super::support::build_snapshot;
use snapshot_types::WorkbookSnapshot;
use value_types::CellValue;

pub(crate) fn numeric_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

#[allow(dead_code)]
pub(crate) fn two_column_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(2 * rows as usize);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::number(((row + 1) * 10) as f64), None));
    }
    build_snapshot(vec![("Sheet1", rows, 3, c)])
}

pub(crate) fn sum_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    c.push((0, 1, CellValue::Null, Some(format!("SUM(A1:A{})", rows))));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

pub(crate) fn match_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("MATCH({},A1:A{},0)", rows, rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

pub(crate) fn index_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
    }
    let midpoint = rows / 2;
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("INDEX(A1:A{},{})", rows, midpoint)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

pub(crate) fn vlookup_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> =
        Vec::with_capacity(2 * rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row + 1) as f64), None));
        c.push((row, 1, CellValue::number(((row + 1) * 10) as f64), None));
    }
    c.push((
        0,
        2,
        CellValue::Null,
        Some(format!("VLOOKUP({},A1:B{},2,FALSE)", rows, rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 3, c)])
}

pub(crate) fn countifs_snapshot(rows: u32) -> WorkbookSnapshot {
    let mut c: Vec<(u32, u32, CellValue, Option<String>)> = Vec::with_capacity(rows as usize + 1);
    for row in 0..rows {
        c.push((row, 0, CellValue::number((row as f64) % 100.0), None));
    }
    c.push((
        0,
        1,
        CellValue::Null,
        Some(format!("COUNTIFS(A1:A{},\">50\")", rows)),
    ));
    build_snapshot(vec![("Sheet1", rows, 2, c)])
}

pub(crate) fn small_snapshot() -> WorkbookSnapshot {
    let c = vec![(0u32, 0u32, CellValue::number(1.0), None)];
    build_snapshot(vec![("Sheet1", 100, 2, c)])
}
