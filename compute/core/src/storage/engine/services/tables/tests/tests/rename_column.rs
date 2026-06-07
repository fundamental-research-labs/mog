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

#[test]
fn rename_column_rewrites_same_row_structured_ref_formulas() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    0,
                    CellInput::Parse {
                        text: "Price".into(),
                    },
                ),
                (sid, 0, 1, CellInput::Parse { text: "Qty".into() }),
                (sid, 1, 0, CellInput::Parse { text: "10".into() }),
                (sid, 1, 1, CellInput::Parse { text: "5".into() }),
            ],
            false,
        )
        .expect("seed table data");

    engine
        .create_table(
            &sid,
            "Data".into(),
            0,
            0,
            1,
            1,
            vec!["Price".into(), "Qty".into()],
            true,
        )
        .expect("create table");

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    2,
                    CellInput::Parse {
                        text: "Total".into(),
                    },
                ),
                (
                    sid,
                    1,
                    2,
                    CellInput::Parse {
                        text: "=[@Price]*[@Qty]".into(),
                    },
                ),
            ],
            false,
        )
        .expect("set calculated column formula");
    engine
        .resize_table("Data", 0, 0, 1, 2)
        .expect("include calculated column in table");

    assert_eq!(
        cell_value(&engine, sid, 1, 2),
        Some(CellValue::Number(FiniteF64::must(50.0))),
        "same-row structured ref formula should evaluate before rename"
    );

    engine
        .rename_table_column("Data", 0, "UnitPrice")
        .expect("rename column");

    assert_eq!(
        cell_value(&engine, sid, 1, 2),
        Some(CellValue::Number(FiniteF64::must(50.0))),
        "same-row structured ref formula should keep evaluating after header rename"
    );
}
