use super::*;

#[test]
fn rename_column_updates_backing_header_cell_and_viewport() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 3, 1)
        .expect("register viewport");

    engine
        .create_table(
            &sid,
            "Table1".into(),
            0,
            0,
            3,
            1,
            vec!["A".into(), "B".into()],
            true,
        )
        .expect("create_table");

    let (patches, result) = engine
        .rename_table_column("Table1", 0, "Alpha")
        .expect("rename_column");

    assert_ne!(
        patches,
        compute_wire::mutation::serialize_multi_viewport_patches(&[]),
        "renaming a visible table header must emit a viewport patch"
    );
    assert_eq!(
        cell_value(&engine, sid, 0, 0),
        Some(CellValue::Text("Alpha".into())),
        "renaming a table column must update the backing header cell"
    );
    assert!(
        result.recalc.changed_cells.iter().any(|change| {
            change
                .position
                .as_ref()
                .is_some_and(|position| position.row == 0 && position.col == 0)
                && matches!(&change.value, CellValue::Text(text) if text.as_ref() == "Alpha")
        }),
        "renaming a table column must report the changed header cell"
    );
}
