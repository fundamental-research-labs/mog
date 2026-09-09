use compute_api::{CellValue, Workbook};

fn assert_depths(workbook: &Workbook, undo: usize, redo: usize) {
    let history = workbook.history();
    let state = history.get_undo_state().unwrap();
    assert_eq!((state.undo_depth, state.redo_depth), (undo, redo));
    assert_eq!(state.can_undo, undo != 0);
    assert_eq!(state.can_redo, redo != 0);
    assert_eq!(history.can_undo().unwrap(), state.can_undo);
    assert_eq!(history.can_redo().unwrap(), state.can_redo);
}

#[test]
fn history_state_and_mutation_payloads_survive_dispatch() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    let history = workbook.history();
    assert_depths(&workbook, 0, 0);
    assert!(history.undo().unwrap().recalc.changed_cells.is_empty());
    assert!(history.redo().unwrap().recalc.changed_cells.is_empty());
    assert_eq!(
        serde_json::to_value(history.get_undo_state().unwrap()).unwrap(),
        serde_json::json!({
            "canUndo": false, "canRedo": false, "undoDepth": 0, "redoDepth": 0
        })
    );

    sheet.set_cell("A1", "42").unwrap();
    assert_depths(&workbook, 1, 0);
    assert!(!history.undo().unwrap().recalc.changed_cells.is_empty());
    assert_eq!(sheet.get_cell_value("A1").unwrap(), CellValue::Null);
    assert_depths(&workbook, 0, 1);

    assert!(!history.redo().unwrap().recalc.changed_cells.is_empty());
    assert_eq!(sheet.get_cell_value("A1").unwrap().as_number(), Some(42.0));
    assert_depths(&workbook, 1, 0);

    history.undo().unwrap();
    sheet.set_cell("A1", "7").unwrap();
    assert_depths(&workbook, 1, 0);
    history.redo().unwrap();
    assert_eq!(sheet.get_cell_value("A1").unwrap().as_number(), Some(7.0));
}

#[test]
fn nested_groups_restore_values_and_formula_together() {
    let (workbook, _) = Workbook::blank().unwrap();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    let history = workbook.history();
    history.end_undo_group().unwrap();
    history.begin_undo_group().unwrap();
    history.end_undo_group().unwrap();
    assert_depths(&workbook, 0, 0);

    history.begin_undo_group().unwrap();
    sheet.set_cell("A1", "10").unwrap();
    history.begin_undo_group().unwrap();
    sheet.set_cell("A2", "=A1*2").unwrap();
    history.end_undo_group().unwrap();
    sheet.set_cell("B1", "3").unwrap();
    history.end_undo_group().unwrap();
    assert_depths(&workbook, 1, 0);

    history.undo().unwrap();
    for address in ["A1", "A2", "B1"] {
        assert_eq!(sheet.get_cell_value(address).unwrap(), CellValue::Null);
    }
    assert!(sheet.get_formula("A2").unwrap().is_none());
    assert_depths(&workbook, 0, 1);

    history.redo().unwrap();
    assert_eq!(sheet.get_cell_value("A2").unwrap().as_number(), Some(20.0));
    assert_eq!(sheet.get_formula("A2").unwrap().as_deref(), Some("=A1*2"));
    assert_eq!(sheet.get_cell_value("B1").unwrap().as_number(), Some(3.0));
    assert_depths(&workbook, 1, 0);
}

#[test]
fn bulk_write_is_one_action_shared_by_cloned_workbooks() {
    let (workbook, _) = Workbook::blank().unwrap();
    let other_handle = workbook.clone();
    let sheet = workbook.sheet_by_name("Sheet1").unwrap();
    sheet
        .set_range(
            "A1:C2",
            &[
                vec!["10".into(), "TRUE".into(), "日本語 🦀".into()],
                vec!["=A1*2".into(), "4".into(), "5".into()],
            ],
        )
        .unwrap();
    assert_depths(&other_handle, 1, 0);
    other_handle.history().undo().unwrap();
    for row in sheet.get_range_values_2d("A1:C2").unwrap() {
        assert!(row.into_iter().all(|value| value == CellValue::Null));
    }
    assert_depths(&workbook, 0, 1);
    workbook.history().redo().unwrap();
    assert_eq!(sheet.get_cell_value("A2").unwrap().as_number(), Some(20.0));
    assert_eq!(sheet.get_display_value("C1").unwrap(), "日本語 🦀");
    assert_depths(&other_handle, 1, 0);
}
