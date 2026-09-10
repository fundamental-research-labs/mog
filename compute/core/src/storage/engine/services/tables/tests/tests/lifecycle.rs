use super::*;

#[test]
fn create_table_persists_table_filter_in_rust() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let result = engine
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
