use super::*;
use std::sync::Arc;
use yrs::{Any, MapPrelim};

fn table_catalog_table(
    engine: &YrsComputeEngine,
    name: &str,
) -> Option<domain_types::domain::table::Table> {
    let workbook = engine.stores.storage.workbook_map().clone();
    let doc = engine.stores.storage.doc().clone();
    let txn = doc.transact();
    match workbook.get(&txn, compute_document::schema::KEY_TABLES) {
        Some(Out::YMap(tables_map)) => match tables_map.get(&txn, name) {
            Some(Out::YMap(table_map)) => {
                domain_types::yrs_schema::table::from_yrs_map_to_table(&table_map, &txn)
            }
            _ => None,
        },
        _ => None,
    }
}

fn table_catalog_spec(
    engine: &YrsComputeEngine,
    name: &str,
) -> Option<domain_types::domain::table::TableSpec> {
    let workbook = engine.stores.storage.workbook_map().clone();
    let doc = engine.stores.storage.doc().clone();
    let txn = doc.transact();
    match workbook.get(&txn, compute_document::schema::KEY_TABLES) {
        Some(Out::YMap(tables_map)) => match tables_map.get(&txn, name) {
            Some(Out::YMap(table_map)) => {
                domain_types::yrs_schema::table::from_yrs_map(&table_map, &txn)
            }
            _ => None,
        },
        _ => None,
    }
}

fn replace_catalog_spec(
    engine: &mut YrsComputeEngine,
    spec: &domain_types::domain::table::TableSpec,
    sheet_id: SheetId,
) {
    let workbook = engine.stores.storage.workbook_map().clone();
    let mut txn = engine.stores.storage.doc().transact_mut();
    let tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );
    let mut entries = domain_types::yrs_schema::table::to_yrs_prelim(spec);
    entries.push((
        domain_types::yrs_schema::table::KEY_SHEET_ID,
        Any::String(Arc::from(sheet_id.to_uuid_string().as_str())),
    ));
    entries.push((
        domain_types::yrs_schema::table::KEY_START_ROW,
        Any::Number(0.0),
    ));
    entries.push((
        domain_types::yrs_schema::table::KEY_START_COL,
        Any::Number(0.0),
    ));
    entries.push((
        domain_types::yrs_schema::table::KEY_END_ROW,
        Any::Number(3.0),
    ));
    entries.push((
        domain_types::yrs_schema::table::KEY_END_COL,
        Any::Number(1.0),
    ));

    let table_prelim: MapPrelim = entries.into_iter().collect();
    tables_map.insert(&mut txn, spec.name.as_str(), table_prelim);
}

#[test]
fn runtime_table_mutations_keep_workbook_table_catalog_in_sync() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .create_table(
            &sid,
            "Sales".into(),
            0,
            0,
            3,
            1,
            vec!["Name".into(), "Amount".into()],
            true,
        )
        .expect("create_table");
    let created = table_catalog_table(&engine, "Sales").expect("catalog table after create");
    assert_eq!(created.name, "Sales");
    assert_eq!(created.sheet_id, sid.to_uuid_string());
    assert_eq!(created.range.end_col(), 1);

    engine
        .resize_table("Sales", 0, 0, 3, 2)
        .expect("resize_table");
    let resized = table_catalog_spec(&engine, "Sales").expect("catalog spec after resize");
    assert_eq!(resized.range_ref, "A1:C4");
    assert_eq!(resized.columns.len(), 3);

    engine.toggle_totals_row("Sales").expect("toggle_totals");
    let totals = table_catalog_spec(&engine, "Sales").expect("catalog spec after totals");
    assert!(totals.has_totals);

    engine
        .rename_table_column("Sales", 0, "Customer")
        .expect("rename_column");
    let renamed_column =
        table_catalog_spec(&engine, "Sales").expect("catalog spec after column rename");
    assert_eq!(renamed_column.columns[0].name, "Customer");

    engine
        .rename_table("Sales", "Revenue")
        .expect("rename_table");
    assert!(table_catalog_spec(&engine, "Sales").is_none());
    let renamed_table =
        table_catalog_table(&engine, "Revenue").expect("catalog table after rename");
    assert_eq!(renamed_table.name, "Revenue");
}

#[test]
fn deleting_table_removes_workbook_table_catalog_entry() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

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
    assert!(table_catalog_spec(&engine, "Table1").is_some());

    engine.delete_table("Table1").expect("delete_table");
    assert!(table_catalog_spec(&engine, "Table1").is_none());
}

#[test]
fn catalog_updates_preserve_imported_ooxml_metadata() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

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

    let imported_spec = domain_types::domain::table::TableSpec {
        id: 7,
        name: "Table1".to_string(),
        display_name: "Table1".to_string(),
        range_ref: "A1:B4".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("TableStyleMedium9".to_string()),
        row_stripes: true,
        col_stripes: false,
        first_col_highlight: false,
        last_col_highlight: false,
        auto_filter_ref: Some("A1:B4".to_string()),
        columns: vec![
            domain_types::domain::table::TableColumnSpec {
                id: 10,
                name: "A".to_string(),
                unique_name: Some("_xlnm.A".to_string()),
                data_dxf_id: Some(4),
                xr3_uid: Some("{column-1}".to_string()),
                ..Default::default()
            },
            domain_types::domain::table::TableColumnSpec {
                id: 11,
                name: "B".to_string(),
                unique_name: Some("_xlnm.B".to_string()),
                data_dxf_id: Some(5),
                xr3_uid: Some("{column-2}".to_string()),
                ..Default::default()
            },
        ],
        header_row_dxf_id: Some(2),
        table_type: Some("worksheet".to_string()),
        worksheet_relationship_id_hint: Some("rId7".to_string()),
        table_part_path_hint: Some("xl/tables/table7.xml".to_string()),
        worksheet_relationship_target_hint: Some("../tables/table7.xml".to_string()),
        ..Default::default()
    };
    replace_catalog_spec(&mut engine, &imported_spec, sid);

    engine.toggle_totals_row("Table1").expect("toggle_totals");

    let updated = table_catalog_spec(&engine, "Table1").expect("updated catalog spec");
    assert!(updated.has_totals);
    assert_eq!(updated.header_row_dxf_id, Some(2));
    assert_eq!(updated.table_type.as_deref(), Some("worksheet"));
    assert_eq!(
        updated.worksheet_relationship_id_hint.as_deref(),
        Some("rId7")
    );
    assert_eq!(
        updated.table_part_path_hint.as_deref(),
        Some("xl/tables/table7.xml")
    );
    assert_eq!(updated.columns[0].unique_name.as_deref(), Some("_xlnm.A"));
    assert_eq!(updated.columns[0].data_dxf_id, Some(4));
    assert_eq!(updated.columns[0].xr3_uid.as_deref(), Some("{column-1}"));
}
