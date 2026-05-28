use crate::support::{assert_number, build_snapshot, recalc_snapshot};
use value_types::CellValue;

#[test]
fn test_xlookup_text_column_indexed_path() {
    let n = 500_u32;
    let mut cells: Vec<(u32, u32, CellValue, Option<String>)> = Vec::new();

    for i in 0..n {
        cells.push((
            i,
            0,
            CellValue::Text(format!("Brand_{:04}", i).into()),
            None,
        ));
        cells.push((i, 1, CellValue::number(i as f64 * 10.0), None));
    }

    let targets = [0_u32, n / 4, n / 2, 3 * n / 4, n - 1];
    for (formula_idx, target_row) in targets.iter().enumerate() {
        let formula = format!("XLOOKUP(\"Brand_{:04}\",A1:A{},B1:B{})", target_row, n, n);
        cells.push((formula_idx as u32, 2, CellValue::Null, Some(formula)));
    }

    let snapshot = build_snapshot(vec![("Sheet1", n, 10, cells)], vec![]);
    let result = recalc_snapshot(snapshot);

    for (formula_idx, target_row) in targets.iter().enumerate() {
        assert_number(
            &result,
            0,
            formula_idx as u32,
            2,
            *target_row as f64 * 10.0,
            &format!(
                "repeated text-column XLOOKUP should return Brand_{:04} through the indexed correctness path",
                target_row
            ),
        );
    }
}

#[test]
fn test_xlookup_direct_fetch_single_col_return() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    for i in 0..20 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
        cells.push((i, 1, CellValue::number((i + 1) as f64 * 100.0), None));
    }

    cells.push((0, 2, CellValue::Null, Some("XLOOKUP(1,A1:A20,B1:B20)")));
    cells.push((1, 2, CellValue::Null, Some("XLOOKUP(10,A1:A20,B1:B20)")));
    cells.push((2, 2, CellValue::Null, Some("XLOOKUP(20,A1:A20,B1:B20)")));

    let snapshot = build_snapshot(vec![("Sheet1", 20, 10, cells)], vec![]);
    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        2,
        100.0,
        "direct single-column return fetch should handle the first hit",
    );
    assert_number(
        &result,
        0,
        1,
        2,
        1000.0,
        "direct single-column return fetch should handle a middle hit",
    );
    assert_number(
        &result,
        0,
        2,
        2,
        2000.0,
        "direct single-column return fetch should handle the last hit",
    );
}
