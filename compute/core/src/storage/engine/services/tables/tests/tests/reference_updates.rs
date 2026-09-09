use super::*;

fn fixture() -> (ComputeEngine, SheetId, SheetId) {
    let mut snapshot = simple_snapshot();
    snapshot.sheets[0].name = "Source Data".into();
    let other = SheetId::from_raw(0x992);
    snapshot.sheets.push(SheetSnapshot {
        identities: Vec::new(),
        id: other.to_uuid_string(),
        name: "Results".into(),
        rows: 20,
        cols: 8,
        cells: vec![],
        ranges: vec![],
        row_axis: None,
        col_axis: None,
    });
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    let source = sheet_id();
    for (row, col, text) in [
        (0, 0, "Amount"),
        (0, 1, "Tax"),
        (1, 0, "10"),
        (2, 0, "20"),
        (1, 1, "1"),
        (2, 1, "2"),
    ] {
        engine
            .set_cell_value_parsed(&source, row, col, text)
            .unwrap();
    }
    engine
        .create_table(
            &source,
            "Sales".into(),
            0,
            0,
            2,
            1,
            vec!["Amount".into(), "Tax".into()],
            true,
        )
        .unwrap();
    engine
        .create_named_range(domain_types::DefinedNameInput {
            name: "TotalSales".into(),
            refers_to: "=SUM(Sales[Amount])".into(),
            scope: None,
            comment: None,
        })
        .unwrap();
    for (col, formula) in [
        (0, "=SUM(Sales[Amount])"),
        (1, "=SUM(Sales[Tax])"),
        (2, "=TotalSales+1"),
        (3, "=\"Sales[Amount]\""),
        (4, "=SUM(Sales[[Amount]:[Tax]])"),
    ] {
        engine
            .set_cell_value_parsed(&other, 0, col, formula)
            .unwrap();
    }
    (engine, source, other)
}

#[test]
fn native_table_references_rename_refreshes_source_names_and_incremental_dependencies() {
    let (mut engine, source, other) = fixture();
    assert_eq!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::from(30.0))
    );
    engine.rename_table("Sales", "Revenue").unwrap();
    engine.rename_table_column("Revenue", 0, "Net").unwrap();
    engine.set_cell_value_parsed(&source, 1, 0, "40").unwrap();
    assert_eq!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::from(60.0))
    );
    assert_eq!(
        cell_value(&engine, other, 0, 2),
        Some(CellValue::from(61.0))
    );
    assert_eq!(
        cell_value(&engine, other, 0, 3),
        Some(CellValue::Text("Sales[Amount]".into()))
    );
    let output = engine.build_parse_output();
    let results = output
        .sheets
        .iter()
        .find(|sheet| sheet.name == "Results")
        .unwrap();
    assert_eq!(
        results
            .cells
            .iter()
            .find(|cell| cell.col == 0)
            .unwrap()
            .formula
            .as_deref(),
        Some("SUM(Revenue[Net])")
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let result_sheet = *reloaded
        .cell_store()
        .sheet_ids()
        .find(|id| reloaded.cell_store().get_sheet(id).unwrap().name == "Results")
        .unwrap();
    assert_eq!(
        cell_value(&reloaded, result_sheet, 0, 2),
        Some(CellValue::from(61.0))
    );
}

#[test]
fn native_table_references_conversion_preserves_selected_cross_sheet_columns() {
    let (mut engine, source, other) = fixture();
    engine.convert_table_to_range("Sales").unwrap();
    assert_eq!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::from(30.0))
    );
    assert_eq!(cell_value(&engine, other, 0, 1), Some(CellValue::from(3.0)));
    assert_eq!(
        cell_value(&engine, other, 0, 4),
        Some(CellValue::from(33.0))
    );
    engine.set_cell_value_parsed(&source, 1, 0, "40").unwrap();
    assert_eq!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::from(60.0))
    );
    assert_eq!(
        cell_value(&engine, other, 0, 2),
        Some(CellValue::from(61.0))
    );
    let output = engine.build_parse_output();
    let results = output
        .sheets
        .iter()
        .find(|sheet| sheet.name == "Results")
        .unwrap();
    assert_eq!(
        results
            .cells
            .iter()
            .find(|cell| cell.col == 0)
            .unwrap()
            .formula
            .as_deref(),
        Some("SUM('Source Data'!$A$2:$A$3)")
    );
}

#[test]
fn native_table_references_deletion_invalidates_only_selected_table_and_column() {
    let (mut engine, _, other) = fixture();
    engine.remove_table_column("Sales", 1).unwrap();
    assert_eq!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::from(30.0))
    );
    assert!(matches!(
        cell_value(&engine, other, 0, 1),
        Some(CellValue::Error(value_types::CellError::Ref, _))
    ));
    engine.delete_table("Sales").unwrap();
    assert!(matches!(
        cell_value(&engine, other, 0, 0),
        Some(CellValue::Error(value_types::CellError::Ref, _))
    ));
    assert!(matches!(
        cell_value(&engine, other, 0, 2),
        Some(CellValue::Error(value_types::CellError::Ref, _))
    ));
    assert_eq!(
        cell_value(&engine, other, 0, 3),
        Some(CellValue::Text("Sales[Amount]".into()))
    );
}

#[test]
fn native_table_catalog_copy_snapshot_and_xlsx_preserve_authored_metadata() {
    let (mut engine, source, _) = fixture();
    let mut table = engine.get_table_by_name("Sales").unwrap();
    table.style = "TableStyleMedium9".into();
    table.comment = Some("Authored table metadata".into());
    table.published = true;
    table.columns[0].unique_name = Some("source_amount".into());
    table.columns[1].totals_row_formula = Some("SUM(Sales[Tax])".into());
    table.ooxml_table_id = Some(17);
    table.worksheet_relationship_id_hint = Some("rId17".into());
    table.table_part_path_hint = Some("xl/tables/table17.xml".into());
    engine
        .stores
        .compute
        .set_table(&mut engine.cell_store, table.clone());
    engine
        .set_cell_value_parsed(&source, 5, 0, "=SUM(Sales[Amount])")
        .unwrap();

    crate::storage::engine::construction::materialize_table_auto_filters_for_sheets(
        &mut engine.stores,
        &mut engine.cell_store,
        &[source],
    );
    let (copy_id, _) = engine.copy_sheet(&source, "Copied Data").unwrap();
    let copy_id = SheetId::from_uuid_str(&copy_id).unwrap();
    let copied = engine.get_table_by_name("Sales_2").unwrap();
    assert_ne!(copied.id, table.id);
    assert_eq!(copied.sheet_id, copy_id.to_uuid_string());
    assert_ne!(copied.columns[0].id, table.columns[0].id);
    assert_eq!(copied.style, table.style);
    assert_eq!(copied.comment, table.comment);
    assert_eq!(copied.columns[0].unique_name, table.columns[0].unique_name);
    assert_eq!(
        copied.columns[1].totals_row_formula.as_deref(),
        Some("SUM(Sales_2[Tax])")
    );
    assert!(copied.published);
    assert!(copied.ooxml_table_id.is_none());
    assert!(copied.table_part_path_hint.is_none());
    let copied_filter = filters::get_table_filter(&engine.stores.storage, &copy_id, &copied.id)
        .expect("copied filter follows copied table identity");
    assert_eq!(copied_filter.table_id.as_deref(), Some(copied.id.as_str()));
    let binding =
        filters::get_filter_metadata_binding(&engine.stores.storage, &copy_id, &copied_filter.id)
            .unwrap();
    assert_eq!(binding.table_id.as_deref(), Some(copied.id.as_str()));
    assert_eq!(
        binding.owner_path,
        filters::FilterMetadataOwnerPath::TableAutoFilter {
            sheet_id: copy_id.to_uuid_string(),
            table_id: copied.id.clone()
        }
    );
    assert!(
        matches!(binding.source_key, filters::FilterMetadataSourceKey::TableAutoFilter { table_name, table_id, .. } if table_name == "Sales_2" && table_id == copied.id)
    );
    assert_eq!(
        binding.table_column_id_to_header_cell_id.len(),
        copied.columns.len()
    );
    for column in &copied.columns {
        assert!(
            binding
                .table_column_id_to_header_cell_id
                .contains_key(&column.id)
        );
    }

    engine.set_cell_value_parsed(&copy_id, 1, 0, "50").unwrap();
    assert_eq!(
        cell_value(&engine, copy_id, 5, 0),
        Some(CellValue::from(70.0))
    );
    assert_eq!(
        cell_value(&engine, source, 5, 0),
        Some(CellValue::from(30.0))
    );

    reload_native_snapshot(&mut engine);
    assert_eq!(engine.get_table_by_name("Sales").unwrap(), table);
    assert_eq!(engine.get_table_by_name("Sales_2").unwrap(), copied);
    assert_eq!(
        cell_value(&engine, copy_id, 5, 0),
        Some(CellValue::from(70.0))
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    for name in ["Sales", "Sales_2"] {
        let table = reloaded.get_table_by_name(name).unwrap();
        assert_eq!(table.style, "TableStyleMedium9");
        assert_eq!(table.comment.as_deref(), Some("Authored table metadata"));
        assert!(table.published);
        assert_eq!(
            table.columns[0].unique_name.as_deref(),
            Some("source_amount")
        );
        assert_eq!(
            table.columns[1].totals_row_formula,
            Some(format!("SUM({name}[Tax])"))
        );
    }
}

#[test]
fn native_table_catalog_selected_sheet_import_preserves_metadata_and_renames_collisions() {
    let (mut engine, source, _) = fixture();
    let mut table = engine.get_table_by_name("Sales").unwrap();
    table.comment = Some("Selected sheet metadata".into());
    table.columns[0].unique_name = Some("amount_identity".into());
    engine
        .stores
        .compute
        .set_table(&mut engine.cell_store, table);
    engine
        .set_cell_value_parsed(&source, 5, 0, "=SUM(Sales[Amount])")
        .unwrap();
    let mut style = domain_types::domain::custom_table_style::CustomTableStyleConfig {
        id: "custom-brand".into(),
        name: "BrandStyle".into(),
        created_at: 0.0,
        updated_at: 0.0,
        header_row: Default::default(),
        total_row: Default::default(),
        first_column: Default::default(),
        last_column: Default::default(),
        row_stripes: Default::default(),
        column_stripes: Default::default(),
        whole_table: Default::default(),
    };
    style.header_row.fill = Some("#FF0000".into());
    engine.create_custom_table_style(style.clone()).unwrap();
    engine.set_table_style("Sales", "BrandStyle").unwrap();
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    style.header_row.fill = Some("#0000FF".into());
    engine
        .update_custom_table_style("BrandStyle", style)
        .unwrap();
    let source_table_id = engine.get_table_by_name("Sales").unwrap().id;
    let mut original_filter =
        filters::get_table_filter(&engine.stores.storage, &source, &source_table_id).unwrap();
    let header_id = original_filter.header_start_cell_id.clone();
    original_filter.column_filters.insert(
        header_id,
        domain_types::domain::filter::ColumnFilter::Values {
            values: vec![serde_json::json!("10")],
            include_blanks: false,
        },
    );
    filters::upsert_filter_state(&mut engine.stores.storage, &source, &original_filter).unwrap();
    let names = engine
        .import_sheets_from_xlsx(&bytes, vec!["Source Data".into()], None)
        .unwrap();
    assert_eq!(names, vec!["Source Data (2)"]);
    let retained_filter =
        filters::get_table_filter(&engine.stores.storage, &source, &source_table_id).unwrap();
    assert_eq!(
        retained_filter.column_filters,
        original_filter.column_filters
    );
    let imported = engine.get_table_by_name("Sales_2").unwrap();
    let imported_sid = SheetId::from_uuid_str(&imported.sheet_id).unwrap();
    assert_eq!(imported.style, "BrandStyle_2");
    assert_eq!(
        engine.stores.storage.metadata.custom_table_styles["BrandStyle"]
            .header_row
            .fill
            .as_deref(),
        Some("#0000FF")
    );
    assert_eq!(
        engine.stores.storage.metadata.custom_table_styles["BrandStyle_2"]
            .header_row
            .fill
            .as_deref(),
        Some("#FF0000")
    );
    assert_eq!(imported.comment.as_deref(), Some("Selected sheet metadata"));
    assert_eq!(
        imported.columns[0].unique_name.as_deref(),
        Some("amount_identity")
    );
    assert_eq!(
        cell_value(&engine, imported_sid, 5, 0),
        Some(CellValue::from(30.0))
    );
    engine
        .set_cell_value_parsed(&imported_sid, 1, 0, "60")
        .unwrap();
    assert_eq!(
        cell_value(&engine, imported_sid, 5, 0),
        Some(CellValue::from(80.0))
    );
    assert_eq!(
        cell_value(&engine, source, 5, 0),
        Some(CellValue::from(30.0))
    );
    let original_id = engine
        .cell_store
        .get_sheet(&source)
        .unwrap()
        .cell_id_at(SheetPos::new(1, 0))
        .unwrap();
    let imported_id = engine
        .cell_store
        .get_sheet(&imported_sid)
        .unwrap()
        .cell_id_at(SheetPos::new(1, 0))
        .unwrap();
    assert_ne!(original_id, imported_id);
    let (reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    assert_eq!(
        reloaded.stores.storage.metadata.custom_table_styles["BrandStyle"]
            .header_row
            .fill
            .as_deref(),
        Some("#0000FF")
    );
    assert_eq!(
        reloaded.stores.storage.metadata.custom_table_styles["BrandStyle_2"]
            .header_row
            .fill
            .as_deref(),
        Some("#FF0000")
    );
    reload_native_snapshot(&mut engine);
    let restored_filter =
        filters::get_table_filter(&engine.stores.storage, &source, &source_table_id).unwrap();
    assert_eq!(
        restored_filter.column_filters,
        original_filter.column_filters
    );
}
