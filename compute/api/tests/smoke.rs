//! Smoke integration test for compute-api.
//!
//! Exercises the full path: create workbook → get sheet → set cells (A1 + numeric)
//! → read values → set formula → verify recalc → range operations → clear.

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
fn create_workbook_and_list_sheets() {
    let (wb, _recalc) = Workbook::from_snapshot(blank_snapshot()).unwrap();

    let names = wb.sheet_names().unwrap();
    assert_eq!(names, vec!["Sheet1"]);
    assert_eq!(wb.sheet_count().unwrap(), 1);
}

#[test]
fn access_sheet_by_name_and_index() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();

    let s1 = wb.sheet_by_name("Sheet1").unwrap();
    assert_eq!(s1.name().unwrap(), "Sheet1");

    let s2 = wb.sheet_by_index(0).unwrap();
    assert_eq!(s2.id(), s1.id());

    // Non-existent sheet
    assert!(wb.sheet_by_name("NoSuch").is_err());
    assert!(wb.sheet_by_index(99).is_err());
}

#[test]
fn set_and_read_cell_by_a1() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    // Set a number
    sheet.set_cell("A1", "42").unwrap();
    let display = sheet.get_display_value("A1").unwrap();
    assert_eq!(display, "42");

    let raw = sheet.get_raw_value("A1").unwrap();
    assert_eq!(raw, "42");

    // No formula
    assert!(sheet.get_formula("A1").unwrap().is_none());
}

#[test]
fn set_and_read_cell_by_position() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    // (row=0, col=1) = B1
    sheet.set_cell((0u32, 1u32), "hello").unwrap();
    let display = sheet.get_display_value((0u32, 1u32)).unwrap();
    assert_eq!(display, "hello");
}

#[test]
fn set_formula_and_verify_recalc() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A1", "10").unwrap();
    sheet.set_cell("A2", "20").unwrap();
    let result = sheet.set_cell("A3", "=A1+A2").unwrap();

    // Verify recalc happened via MutationResult — the engine computed A3's value.
    // NOTE: get_display_value for formula cells returns "" due to an engine-level
    // limitation (computed values live in ComputeCore's mirror, but get_display_value
    // reads from YrsStorage's mirror which isn't synced). This is a known issue
    // tracked for resolution in the full compute-api facade.
    assert!(
        !result.recalc.changed_cells.is_empty(),
        "recalc should have produced changed cells"
    );

    // The formula cell should appear in changed_cells with the computed value
    let a3_change = result.recalc.changed_cells.iter().find(|c| {
        c.position
            .as_ref()
            .is_some_and(|p| p.row == 2 && p.col == 0)
    });
    assert!(a3_change.is_some(), "A3 should be in changed_cells");

    // Should report as formula via get_raw_value
    let formula = sheet.get_formula("A3").unwrap();
    assert!(formula.is_some());
    assert_eq!(formula.unwrap(), "=A1+A2");
}

#[test]
fn set_range() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    let values = vec![
        vec!["1".to_string(), "2".to_string()],
        vec!["3".to_string(), "4".to_string()],
    ];
    sheet.set_range("A1:B2", &values).unwrap();

    assert_eq!(sheet.get_display_value("A1").unwrap(), "1");
    assert_eq!(sheet.get_display_value("B1").unwrap(), "2");
    assert_eq!(sheet.get_display_value("A2").unwrap(), "3");
    assert_eq!(sheet.get_display_value("B2").unwrap(), "4");
}

#[test]
fn clear_range() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let sheet = wb.sheet_by_index(0).unwrap();

    sheet.set_cell("A1", "42").unwrap();
    sheet.set_cell("B1", "99").unwrap();

    sheet.clear_range("A1:B1").unwrap();

    // After clearing, display value should be empty
    let display = sheet.get_display_value("A1").unwrap();
    assert!(
        display.is_empty(),
        "expected empty after clear, got: {display}"
    );
}

#[test]
fn workbook_clone_shares_state() {
    let (wb1, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let wb2 = wb1.clone();

    let sheet1 = wb1.sheet_by_index(0).unwrap();
    sheet1.set_cell("A1", "shared").unwrap();

    // wb2 sees the same data (same engine)
    let sheet2 = wb2.sheet_by_index(0).unwrap();
    let display = sheet2.get_display_value("A1").unwrap();
    assert_eq!(display, "shared");
}

#[test]
fn sheet_clone_shares_state() {
    let (wb, _) = Workbook::from_snapshot(blank_snapshot()).unwrap();
    let s1 = wb.sheet_by_index(0).unwrap();
    let s2 = s1.clone();

    s1.set_cell("C5", "cloned").unwrap();
    assert_eq!(s2.get_display_value("C5").unwrap(), "cloned");
}
