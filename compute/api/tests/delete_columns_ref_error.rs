//! Repro for the `=B1+C1` after `deleteColumns(1,1)` bug.
//!
//! Setup: A1 = "=B1+C1", B1 = 100, C1 = 200. Initial A1 = 300.
//! Action: delete column B (index 1).
//! Expected: A1 evaluates to `#REF!` because its B1 reference was deleted.
//! Pre-fix actual: A1 evaluates to "200" (the surviving C1 ref shifts into
//! position B1 and the deleted ref is silently dropped).

use compute_api::{SheetSnapshot, Workbook, WorkbookSnapshot};
use value_types::FiniteF64;

fn blank_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

#[test]
fn delete_column_breaks_ref_should_become_ref_error() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    // Setup: A1=B1+C1 FIRST (so refs are Positional), then B1=100, C1=200.
    // This matches the order the app-eval test types values: A1 first, then B1, C1.
    sheet.set_cell("A1", "=B1+C1").unwrap();
    sheet.set_cell("B1", "100").unwrap();
    let res = sheet.set_cell("C1", "200").unwrap();

    // Look at A1 in changed_cells of the C1 set (which should recalc A1 to 300).
    let a1_before = res.recalc.changed_cells.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == 0 && p.col == 0)
    });
    eprintln!("A1 before delete: {:?}", a1_before.map(|c| &c.value));

    // Action: delete column B (index 1).
    let res = sheet.structure().delete_columns(1, 1).unwrap();

    // After deletion, A1's formula contained a reference to B1 (deleted) and
    // C1 (now at column index 1 = B1 position). Excel parity: the reference
    // to the deleted column must surface as #REF!.
    let a1_after = res.recalc.changed_cells.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == 0 && p.col == 0)
    });
    eprintln!("A1 after delete: {:?}", a1_after.map(|c| &c.value));

    let a1_after = a1_after.expect("A1 should be in changed_cells after delete");
    eprintln!("A1 display_text after delete: {:?}", a1_after.display_text);
    eprintln!("A1 value after delete: {:?}", a1_after.value);

    use value_types::{CellError, CellValue};
    assert!(
        matches!(a1_after.value, CellValue::Error(CellError::Ref, _)),
        "A1 should evaluate to #REF! after deleting column B; got value={:?}",
        a1_after.value
    );
}

#[test]
fn delete_row_breaks_ref_should_become_ref_error() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    // Setup: A1=A2+A3 FIRST (Positional refs to ghosts), then A2=100, A3=200.
    // This matches the app-eval data-tools test order; if A2/A3 were set
    // first the refs would be `Resolved` and the `Resolved`-cleanup path
    // (mirror's `cell_to_sheet`) would already produce `#REF!` without
    // the AST shift fix.
    sheet.set_cell("A1", "=A2+A3").unwrap();
    sheet.set_cell("A2", "100").unwrap();
    sheet.set_cell("A3", "200").unwrap();

    // Action: delete row 2 (index 1).
    let res = sheet.structure().delete_rows(1, 1).unwrap();
    let a1_after = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 0 && p.col == 0)
        })
        .expect("A1 should be in changed_cells after delete row");
    eprintln!(
        "A1 display_text after delete row: {:?}",
        a1_after.display_text
    );
    eprintln!("A1 value after delete row: {:?}", a1_after.value);

    use value_types::{CellError, CellValue};
    assert!(
        matches!(a1_after.value, CellValue::Error(CellError::Ref, _)),
        "A1 should evaluate to #REF! after deleting row 2; got value={:?}",
        a1_after.value
    );
}

#[test]
fn delete_column_outside_ref_band_preserves_value() {
    // Sanity check: deleting a column the formula doesn't reference must
    // *not* produce #REF!. The fix must distinguish "ref points at deleted
    // column" from "ref points at a column unaffected by the delete".
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A1", "=B1+C1").unwrap(); // refs to ghost cells
    sheet.set_cell("B1", "10").unwrap();
    sheet.set_cell("C1", "20").unwrap();
    sheet.set_cell("E1", "999").unwrap();

    // Delete column E (index 4): formula at A1 doesn't reference E.
    let res = sheet.structure().delete_columns(4, 1).unwrap();
    let a1 = res.recalc.changed_cells.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == 0 && p.col == 0)
    });

    use value_types::{CellValue, FiniteF64};
    if let Some(a1) = a1 {
        assert_eq!(
            a1.value,
            CellValue::Number(FiniteF64::must(30.0)),
            "A1 should still evaluate to 30 (=B1+C1=10+20) after deleting unrelated column E"
        );
    }
    // (No mention of A1 in changed_cells is also fine — delete only forced
    // a recalc on cells that depended on E.)
}

#[test]
fn delete_column_shifts_surviving_ref() {
    // A1=C1. Deleting column B (index 1) shifts C1 left to position B1.
    // A1's formula should re-render as `=B1` and still resolve to C1's value.
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A1", "=C1").unwrap(); // C1 is a ghost ref (no value yet)
    sheet.set_cell("C1", "42").unwrap();

    let res = sheet.structure().delete_columns(1, 1).unwrap();

    let a1 = res.recalc.changed_cells.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == 0 && p.col == 0)
    });

    use value_types::{CellValue, FiniteF64};
    if let Some(a1) = a1 {
        assert_eq!(
            a1.value,
            CellValue::Number(FiniteF64::must(42.0)),
            "A1 should still resolve to old-C1's value (now at column B = 1) after deleting column B"
        );
    }
    // Note: A1 may not appear in changed_cells if its value didn't change
    // (deleting an unrelated middle column doesn't change a `=C1` result —
    // C1 just shifts). The point is the test passes either way without #REF!.
}

#[test]
fn delete_column_retargets_shifted_formula_to_previous_column() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("K14", "100").unwrap();
    sheet.set_cell("L14", "200").unwrap();
    sheet.set_cell("M35", "0.25").unwrap();
    sheet.set_cell("M14", "=L14*(1+M35)").unwrap();

    let res = sheet.structure().delete_columns(11, 1).unwrap();

    let l14 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 13 && p.col == 11)
        })
        .expect("L14 should be recalculated after deleting column L");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        l14.value,
        CellValue::Number(FiniteF64::must(125.0)),
        "shifted formula should recalculate from the previous surviving column"
    );
}

#[test]
fn delete_column_retargets_shifted_absolute_formula_to_previous_column() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("K14", "100").unwrap();
    sheet.set_cell("L14", "200").unwrap();
    sheet.set_cell("M35", "0.25").unwrap();
    sheet.set_cell("M14", "=$L14*(1+$M$35)").unwrap();

    let res = sheet.structure().delete_columns(11, 1).unwrap();

    let l14 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 13 && p.col == 11)
        })
        .expect("L14 should be recalculated after deleting column L");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        l14.value,
        CellValue::Number(FiniteF64::must(125.0)),
        "absolute shifted formula should recalculate from the previous surviving column"
    );
}

#[test]
fn delete_column_retargets_shifted_formula_to_empty_previous_column() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("L14", "200").unwrap();
    sheet.set_cell("M35", "0.25").unwrap();
    sheet.set_cell("M14", "=L14*(1+M35)").unwrap();

    let res = sheet.structure().delete_columns(11, 1).unwrap();

    let l14 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 13 && p.col == 11)
        })
        .expect("L14 should be recalculated after deleting column L");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        l14.value,
        CellValue::Number(FiniteF64::must(0.0)),
        "shifted formula should reference the empty previous surviving column"
    );
}

#[test]
fn delete_row_retargets_shifted_formula_to_previous_row() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A10", "100").unwrap();
    sheet.set_cell("A11", "200").unwrap();
    sheet.set_cell("B12", "0.25").unwrap();
    sheet.set_cell("A12", "=A11*(1+B12)").unwrap();

    let res = sheet.structure().delete_rows(10, 1).unwrap();

    let a11 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 10 && p.col == 0)
        })
        .expect("A11 should be recalculated after deleting row 11");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        a11.value,
        CellValue::Number(FiniteF64::must(125.0)),
        "shifted formula should recalculate from the previous surviving row"
    );
}

#[test]
fn delete_row_retargets_shifted_absolute_formula_to_previous_row() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A10", "100").unwrap();
    sheet.set_cell("A11", "200").unwrap();
    sheet.set_cell("B12", "0.25").unwrap();
    sheet.set_cell("A12", "=$A$11*(1+$B$12)").unwrap();

    let res = sheet.structure().delete_rows(10, 1).unwrap();

    let a11 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 10 && p.col == 0)
        })
        .expect("A11 should be recalculated after deleting row 11");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        a11.value,
        CellValue::Number(FiniteF64::must(125.0)),
        "absolute shifted formula should recalculate from the previous surviving row"
    );
}

#[test]
fn delete_row_retargets_shifted_formula_to_empty_previous_row() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A11", "200").unwrap();
    sheet.set_cell("B12", "0.25").unwrap();
    sheet.set_cell("A12", "=A11*(1+B12)").unwrap();

    let res = sheet.structure().delete_rows(10, 1).unwrap();

    let a11 = res
        .recalc
        .changed_cells
        .iter()
        .find(|c| {
            c.position
                .as_ref()
                .map_or(false, |p| p.row == 10 && p.col == 0)
        })
        .expect("A11 should be recalculated after deleting row 11");

    use value_types::{CellValue, FiniteF64};
    assert_eq!(
        a11.value,
        CellValue::Number(FiniteF64::must(0.0)),
        "shifted formula should reference the empty previous surviving row"
    );
}
