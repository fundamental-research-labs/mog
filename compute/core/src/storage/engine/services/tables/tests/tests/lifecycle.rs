use super::*;

/// pass 1 regression: creating a table via the production
/// `from_snapshot` engine path must push an entry onto the
/// undo stack and a subsequent `undo()` must remove it.
///
/// Pre-fix symptom: `persist_table_to_yrs` silently returns
/// when `KEY_TABLES` sub-map doesn't exist; the txn drops with
/// no changes, the undo manager has nothing to push, and
/// `can_undo()` stays false.
#[test]
fn create_table_pushes_undo_entry() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    assert!(
        !engine.can_undo(),
        "fresh engine must have empty undo stack"
    );

    engine
        .create_table(
            &sid,
            "Table1".into(),
            0,
            0,
            2,
            1,
            vec!["A".into(), "B".into()],
            true,
        )
        .expect("create_table");

    assert!(
        engine.can_undo(),
        "create_table must push an undo entry - pre-fix this fails because \
         persist_table_to_yrs silently returned"
    );

    engine.undo().expect("undo");
    assert!(
        engine.get_all_tables_in_sheet(&sid).is_empty(),
        "undo must remove the table"
    );
}

#[test]
fn create_table_persists_table_filter_in_rust() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let (_, result) = engine
        .create_table(
            &sid,
            "Table1".into(),
            0,
            0,
            2,
            1,
            vec!["A".into(), "B".into()],
            true,
        )
        .expect("create_table");

    let table_id = table_id_by_name(&engine, "Table1");
    let sheet_filters = engine.get_filters_in_sheet(&sid);
    let table_filter = sheet_filters
        .iter()
        .find(|filter| filter.table_id.as_deref() == Some(table_id.as_str()))
        .expect("table filter");
    assert_eq!(table_filter.filter_kind, filters::FilterKind::TableFilter);

    let change = result
        .filter_changes
        .iter()
        .find(|change| change.filter_id == table_filter.id)
        .expect("table filter creation receipt");
    assert_eq!(change.filter_kind.as_deref(), Some("tableFilter"));
    assert_eq!(change.action.as_deref(), Some("created"));
    assert_eq!(change.table_id.as_deref(), Some(table_id.as_str()));

    engine.delete_table("Table1").expect("delete_table");
    assert!(
        engine.get_filters_in_sheet(&sid).is_empty(),
        "deleting a table must remove its owned table filter"
    );
}

#[test]
fn create_table_lifecycle_with_style_undo_redo_is_atomic() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    set_people_data(&mut engine, sid);
    let before_depth = engine.get_undo_state().undo_depth;

    let (patches, result) = engine
        .create_table_lifecycle(
            &sid,
            Some("StyledPeople".into()),
            0,
            0,
            1,
            1,
            vec![],
            true,
            Some("TableStyleMedium4".into()),
        )
        .expect("create lifecycle");

    assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
    assert!(
        !patches.is_empty(),
        "creating a styled table over existing cells must emit viewport patches so table-owned formatting paints immediately"
    );
    assert!(
        result.table_changes.iter().any(|change| {
            change.name == "StyledPeople"
                && change.sheet_id == sid.to_uuid_string()
                && change.kind == ChangeKind::Set
        }),
        "table creation must report a table change so viewport formatting refreshes before repaint"
    );
    let table = engine
        .get_table_by_name("StyledPeople")
        .expect("styled table");
    assert_eq!(table.style, "TableStyleMedium4");
    let table_id = table.id.clone();
    assert!(
        engine
            .get_filters_in_sheet(&sid)
            .iter()
            .any(|filter| filter.table_id.as_deref() == Some(table_id.as_str())),
        "table filter should be created with the table"
    );

    engine.undo().expect("undo lifecycle");
    assert_eq!(engine.get_undo_state().undo_depth, before_depth);
    assert!(engine.get_table_by_name("StyledPeople").is_none());
    assert!(
        engine
            .get_filters_in_sheet(&sid)
            .iter()
            .all(|filter| filter.table_id.as_deref() != Some(table_id.as_str())),
        "one undo should remove the table-owned filter"
    );

    engine.redo().expect("redo lifecycle");
    let redone = engine
        .get_table_by_name("StyledPeople")
        .expect("redone table");
    assert_eq!(redone.style, "TableStyleMedium4");
    assert_eq!(redone.id, table_id);
    assert!(
        engine
            .get_filters_in_sheet(&sid)
            .iter()
            .any(|filter| filter.table_id.as_deref() == Some(table_id.as_str())),
        "redo should restore the table-owned filter"
    );
}

#[test]
fn create_table_lifecycle_without_headers_undo_redo_is_atomic() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    set_people_data(&mut engine, sid);
    let before_depth = engine.get_undo_state().undo_depth;

    engine
        .create_table_lifecycle(
            &sid,
            Some("GeneratedHeaders".into()),
            0,
            0,
            1,
            1,
            vec![],
            false,
            None,
        )
        .expect("create no-header lifecycle");

    assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
    assert_eq!(
        cell_value(&engine, sid, 0, 0),
        Some(CellValue::Text("Column1".into()))
    );
    assert_eq!(
        cell_value(&engine, sid, 1, 0),
        Some(CellValue::Text("Name".into()))
    );
    assert!(engine.get_table_by_name("GeneratedHeaders").is_some());

    engine.undo().expect("undo no-header lifecycle");
    assert_eq!(engine.get_undo_state().undo_depth, before_depth);
    assert!(engine.get_table_by_name("GeneratedHeaders").is_none());
    assert_eq!(
        cell_value(&engine, sid, 0, 0),
        Some(CellValue::Text("Name".into()))
    );
    assert_eq!(
        cell_value(&engine, sid, 1, 0),
        Some(CellValue::Text("Alice".into()))
    );
    assert_eq!(
        cell_value(&engine, sid, 1, 1),
        Some(CellValue::Number(FiniteF64::must(30.0)))
    );

    engine.redo().expect("redo no-header lifecycle");
    assert_eq!(
        cell_value(&engine, sid, 0, 0),
        Some(CellValue::Text("Column1".into()))
    );
    assert_eq!(
        cell_value(&engine, sid, 1, 0),
        Some(CellValue::Text("Name".into()))
    );
    assert!(engine.get_table_by_name("GeneratedHeaders").is_some());
}
