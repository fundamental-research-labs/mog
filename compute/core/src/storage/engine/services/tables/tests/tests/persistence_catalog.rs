use super::*;

fn table_catalog_table_by_key(
    engine: &ComputeEngine,
    key: &str,
) -> Option<domain_types::domain::table::Table> {
    engine
        .mirror
        .all_tables()
        .iter()
        .find(|table| table.id == key)
        .cloned()
}

fn table_catalog_spec_by_key(
    engine: &ComputeEngine,
    key: &str,
) -> Option<domain_types::domain::table::TableSpec> {
    table_catalog_table_by_key(engine, key)
        .map(|table| domain_types::domain::table::catalog_entry_to_xlsx_table_spec(&table, None))
}

fn replace_catalog_spec(
    engine: &mut ComputeEngine,
    spec: &domain_types::domain::table::TableSpec,
    sheet_id: SheetId,
    table_id: String,
    column_ids: Vec<String>,
) -> domain_types::domain::table::Table {
    let table = domain_types::domain::table::xlsx_table_spec_to_catalog_entry_with_ids(
        spec,
        &sheet_id.to_uuid_string(),
        table_id,
        column_ids,
    );

    engine
        .stores
        .compute
        .set_table(&mut engine.mirror, table.clone());
    table
}

fn insert_catalog_table(engine: &mut ComputeEngine, table: &domain_types::domain::table::Table) {
    engine
        .stores
        .compute
        .set_table(&mut engine.mirror, table.clone());
}

#[test]
fn runtime_table_mutations_update_native_table_catalog() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
    let table_id = table_id_by_name(&engine, "Sales");
    assert!(table_catalog_table_by_key(&engine, "Sales").is_none());
    let created =
        table_catalog_table_by_key(&engine, &table_id).expect("catalog table after create");
    assert_eq!(created.name, "Sales");
    assert_eq!(created.sheet_id, sid.to_uuid_string());
    assert_eq!(created.range.end_col(), 1);

    engine
        .resize_table("Sales", 0, 0, 3, 2)
        .expect("resize_table");
    let resized = table_catalog_spec_by_key(&engine, &table_id).expect("catalog spec after resize");
    assert_eq!(resized.range_ref, "A1:C4");
    assert_eq!(resized.columns.len(), 3);

    engine.toggle_totals_row("Sales").expect("toggle_totals");
    let totals = table_catalog_spec_by_key(&engine, &table_id).expect("catalog spec after totals");
    assert!(totals.has_totals);

    engine
        .rename_table_column("Sales", 0, "Customer")
        .expect("rename_column");
    let renamed_column =
        table_catalog_spec_by_key(&engine, &table_id).expect("catalog spec after column rename");
    assert_eq!(renamed_column.columns[0].name, "Customer");

    engine
        .rename_table("Sales", "Revenue")
        .expect("rename_table");
    assert!(table_catalog_spec_by_key(&engine, "Sales").is_none());
    assert!(table_catalog_spec_by_key(&engine, "Revenue").is_none());
    let renamed_table =
        table_catalog_table_by_key(&engine, &table_id).expect("catalog table after rename");
    assert_eq!(renamed_table.name, "Revenue");
}

#[test]
fn deleting_table_removes_workbook_table_catalog_entry() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
    let table_id = table_id_by_name(&engine, "Table1");
    assert!(table_catalog_spec_by_key(&engine, "Table1").is_none());
    assert!(table_catalog_spec_by_key(&engine, &table_id).is_some());

    engine.delete_table("Table1").expect("delete_table");
    assert!(table_catalog_spec_by_key(&engine, "Table1").is_none());
    assert!(table_catalog_spec_by_key(&engine, &table_id).is_none());
}

#[test]
fn native_snapshot_preserves_imported_custom_style_options() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    let imported_spec = domain_types::domain::table::TableSpec {
        id: 7,
        name: "StyledSales".to_string(),
        display_name: "StyledSales".to_string(),
        range_ref: "A1:D5".to_string(),
        has_headers: true,
        has_totals: false,
        style_name: Some("MogBrandExportStyle".to_string()),
        row_stripes: true,
        col_stripes: true,
        first_col_highlight: true,
        last_col_highlight: true,
        auto_filter_ref: None,
        columns: vec![
            domain_types::domain::table::TableColumnSpec {
                id: 1,
                name: "Region".to_string(),
                ..Default::default()
            },
            domain_types::domain::table::TableColumnSpec {
                id: 2,
                name: "Product".to_string(),
                ..Default::default()
            },
            domain_types::domain::table::TableColumnSpec {
                id: 3,
                name: "Units".to_string(),
                ..Default::default()
            },
            domain_types::domain::table::TableColumnSpec {
                id: 4,
                name: "Revenue".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let imported_table = domain_types::domain::table::xlsx_table_spec_to_catalog_entry_with_ids(
        &imported_spec,
        &sid.to_uuid_string(),
        "tbl-imported".to_string(),
        ["col-region", "col-product", "col-units", "col-revenue"]
            .into_iter()
            .map(str::to_string),
    );
    insert_catalog_table(&mut engine, &imported_table);

    reload_native_snapshot(&mut engine);

    let restored = engine
        .get_table_by_name("StyledSales")
        .expect("imported table should survive native snapshot reload");
    assert_eq!(restored.ooxml_table_id, Some(7));
    assert_eq!(restored.display_name, "StyledSales");
    assert_eq!(restored.style, "MogBrandExportStyle");
    assert!(restored.banded_rows);
    assert!(restored.banded_columns);
    assert!(restored.emphasize_first_column);
    assert!(restored.emphasize_last_column);
    assert!(!restored.show_filter_buttons);
    assert!(restored.auto_filter_ref.is_none());
}

#[test]
fn catalog_updates_preserve_imported_ooxml_metadata() {
    let (mut engine, _) = ComputeEngine::from_snapshot(simple_snapshot()).unwrap();
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
    let runtime_table = table_catalog_table_by_key(&engine, &table_id_by_name(&engine, "Table1"))
        .expect("runtime catalog table");

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
    let imported_table = replace_catalog_spec(
        &mut engine,
        &imported_spec,
        sid,
        runtime_table.id.clone(),
        runtime_table
            .columns
            .iter()
            .map(|column| column.id.clone())
            .collect(),
    );
    assert_eq!(imported_table.ooxml_table_id, Some(7));

    engine.toggle_totals_row("Table1").expect("toggle_totals");

    let updated =
        table_catalog_spec_by_key(&engine, &runtime_table.id).expect("updated catalog spec");
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
