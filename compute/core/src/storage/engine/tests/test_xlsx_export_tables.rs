//! XLSX export regressions for runtime-created table metadata.

use super::super::*;
use super::helpers::*;
use cell_types::SheetPos;
use compute_document::schema::KEY_SLICERS;
use domain_types::{
    ParseOutput, SheetData, SheetDimensions,
    domain::{
        connections::{QueryTable, QueryTableField},
        slicer::SlicerSource,
        table::{
            FilterColumnSpec, FilterSpec, TableColumnSpec, TableSortCondition, TableSortState,
            TableSpec,
        },
    },
};
use formula_types::StructureChange;
use ooxml_types::slicers::{SlicerCacheDef, SlicerDef, SlicerSortOrder, TableSlicerCache};
use value_types::CellValue;
use yrs::{Map, Transact};

fn archive_entry_names(bytes: &[u8]) -> Vec<String> {
    xlsx_parser::zip::XlsxArchive::new(bytes)
        .expect("exported XLSX should be readable")
        .entries()
        .iter()
        .map(|entry| entry.name.clone())
        .collect()
}

#[test]
fn runtime_created_range_backed_table_exports_to_xlsx_package() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "Product".to_string()),
                (0, 1, "Q1".to_string()),
                (0, 2, "Q2".to_string()),
                (1, 0, "Widget".to_string()),
                (1, 1, "100".to_string()),
                (1, 2, "150".to_string()),
                (2, 0, "Gadget".to_string()),
                (2, 1, "200".to_string()),
                (2, 2, "180".to_string()),
            ],
        )
        .expect("seed table cells");
    engine
        .create_table_lifecycle(
            &sid,
            Some("SalesData".to_string()),
            0,
            0,
            2,
            2,
            Vec::new(),
            true,
            Some("TableStyleMedium2".to_string()),
        )
        .expect("create range-backed table");
    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (3, 0, "Service".to_string()),
                (3, 1, "50".to_string()),
                (3, 2, "75".to_string()),
            ],
        )
        .expect("seed appended row cells");
    engine
        .resize_table("SalesData", 0, 0, 3, 2)
        .expect("expand table range after append");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let table = exported.sheets[0]
        .tables
        .iter()
        .find(|table| table.name == "SalesData")
        .expect("runtime-created table should export as TableSpec");
    assert_eq!(table.display_name, "SalesData");
    assert_eq!(table.range_ref, "A1:C4");
    assert_eq!(
        table
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Product", "Q1", "Q2"]
    );
    assert_eq!(table.style_name.as_deref(), Some("TableStyleMedium2"));
    assert_eq!(table.auto_filter_ref.as_deref(), Some("A1:C4"));

    let bytes = engine
        .export_to_xlsx_bytes()
        .expect("runtime-created table should export to XLSX bytes");
    let entries = archive_entry_names(&bytes);
    assert!(entries.iter().any(|entry| entry == "xl/tables/table1.xml"));
    assert!(
        entries
            .iter()
            .any(|entry| entry == "xl/worksheets/_rels/sheet1.xml.rels")
    );

    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(table_xml.contains(r#"name="SalesData""#));
    assert!(table_xml.contains(r#"displayName="SalesData""#));
    assert!(table_xml.contains(r#"ref="A1:C4""#));
    assert!(table_xml.contains(r#"name="Product""#));
    assert!(table_xml.contains(r#"name="Q1""#));
    assert!(table_xml.contains(r#"name="Q2""#));
    assert!(sheet_xml.contains(r#"<tableParts count="1">"#));
    assert!(sheet_rels.contains(r#"Target="../tables/table1.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/tables/table1.xml""#));
}

#[test]
fn table_row_lifecycle_persists_structurally_shifted_range_for_xlsx_export() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "Market".to_string()),
                (0, 1, "Units".to_string()),
                (0, 2, "Revenue".to_string()),
                (1, 0, "West".to_string()),
                (1, 1, "5".to_string()),
                (1, 2, "100".to_string()),
                (2, 0, "East".to_string()),
                (2, 1, "3".to_string()),
                (2, 2, "90".to_string()),
                (3, 0, "EMEA".to_string()),
                (3, 1, "7".to_string()),
                (3, 2, "210".to_string()),
                (4, 0, "APAC".to_string()),
                (4, 1, "2".to_string()),
                (4, 2, "80".to_string()),
            ],
        )
        .expect("seed table cells");
    engine
        .create_table_lifecycle(
            &sid,
            Some("MutationSales".to_string()),
            0,
            0,
            4,
            2,
            Vec::new(),
            true,
            Some("TableStyleMedium6".to_string()),
        )
        .expect("create table");

    engine
        .add_table_data_row("MutationSales", Some(2))
        .expect("add table row metadata");
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertRows {
                at: 3,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert worksheet row");
    engine
        .remove_table_data_row("MutationSales", 0)
        .expect("remove table row metadata");
    engine
        .structure_change(
            &sid,
            &StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete worksheet row");

    let table = engine
        .get_table_by_name("MutationSales")
        .expect("table should exist");
    assert_eq!(table.range.start_row(), 0);
    assert_eq!(table.range.end_row(), 4);

    let bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();

    assert!(table_xml.contains(r#"ref="A1:C5""#));
    assert!(!table_xml.contains(r#"ref="A1:C6""#));
}

#[test]
fn table_column_add_materializes_header_cell_after_structural_insert() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "Account".to_string()),
                (0, 1, "Market".to_string()),
                (0, 2, "Revenue".to_string()),
                (1, 0, "Contoso".to_string()),
                (1, 1, "East".to_string()),
                (1, 2, "90".to_string()),
            ],
        )
        .expect("seed table cells");
    engine
        .create_table_lifecycle(
            &sid,
            Some("MutationSales".to_string()),
            0,
            0,
            1,
            2,
            Vec::new(),
            true,
            Some("TableStyleMedium6".to_string()),
        )
        .expect("create table");
    engine
        .structure_change(
            &sid,
            &StructureChange::InsertCols {
                at: 2,
                count: 1,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert worksheet column");
    engine
        .add_table_column("MutationSales", "Units", 2)
        .expect("add table column metadata and header");
    engine
        .resize_table("MutationSales", 0, 0, 1, 3)
        .expect("normalize table range");

    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&sid, SheetPos::new(0, 2))
            .cloned(),
        Some(CellValue::Text("Units".into()))
    );
}

#[test]
fn runtime_created_table_exports_totals_row_metadata_from_cells() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();

    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (0, 0, "Product".to_string()),
                (0, 1, "Units".to_string()),
                (0, 2, "Price".to_string()),
                (0, 3, "Revenue".to_string()),
                (1, 0, "Widget".to_string()),
                (1, 1, "5".to_string()),
                (1, 2, "20".to_string()),
                (1, 3, "=B2*C2".to_string()),
                (2, 0, "Gadget".to_string()),
                (2, 1, "9".to_string()),
                (2, 2, "25".to_string()),
                (2, 3, "=B3*C3".to_string()),
                (3, 0, "Addon".to_string()),
                (3, 1, "3".to_string()),
                (3, 2, "40".to_string()),
                (3, 3, "=B4*C4".to_string()),
                (4, 0, "Support".to_string()),
                (4, 1, "7".to_string()),
                (4, 2, "30".to_string()),
                (4, 3, "=B5*C5".to_string()),
            ],
        )
        .expect("seed table cells");
    engine
        .create_table_lifecycle(
            &sid,
            Some("AdvancedSales".to_string()),
            0,
            0,
            4,
            3,
            Vec::new(),
            true,
            Some("TableStyleMedium4".to_string()),
        )
        .expect("create table");
    engine
        .update_calculated_column("AdvancedSales", 3, "=[@Units]*[@Price]")
        .expect("set calculated column metadata");
    engine
        .toggle_totals_row("AdvancedSales")
        .expect("enable totals row");
    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (5, 0, "Total".to_string()),
                (5, 3, "=SUM(D2:D5)".to_string()),
            ],
        )
        .expect("seed totals row");

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let table = exported.sheets[0]
        .tables
        .iter()
        .find(|table| table.name == "AdvancedSales")
        .expect("runtime-created table should export as TableSpec");

    assert_eq!(table.range_ref, "A1:D6");
    assert!(table.has_totals);
    assert_eq!(table.totals_row_shown, Some(true));

    let product = table
        .columns
        .iter()
        .find(|column| column.name == "Product")
        .expect("Product column");
    let revenue = table
        .columns
        .iter()
        .find(|column| column.name == "Revenue")
        .expect("Revenue column");

    assert_eq!(product.totals_label.as_deref(), Some("Total"));
    assert_eq!(
        revenue
            .calculated_formula
            .as_deref()
            .map(|formula| formula.trim_start_matches('=')),
        Some("[@Units]*[@Price]")
    );
    assert_eq!(
        revenue
            .totals_row_formula
            .as_deref()
            .map(|formula| formula.trim_start_matches('=')),
        Some("SUM(D2:D5)")
    );

    let bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();

    assert!(table_xml.contains(r#"totalsRowCount="1""#));
    assert!(table_xml.contains(r#"totalsRowShown="1""#));
    assert!(table_xml.contains(r#"totalsRowLabel="Total""#));
    assert!(table_xml.contains("<totalsRowFormula>"));
    assert!(table_xml.contains("SUM(D2:D5)"));
}

#[test]
fn imported_table_filter_projection_preserves_catalog_sort_state() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 2,
            dimensions: SheetDimensions::default(),
            tables: vec![TableSpec {
                id: 7,
                name: "SalesData".to_string(),
                display_name: "SalesData".to_string(),
                range_ref: "A1:B3".to_string(),
                has_headers: true,
                has_totals: false,
                auto_filter_ref: Some("A1:B3".to_string()),
                columns: vec![
                    TableColumnSpec {
                        id: 1,
                        name: "Account".to_string(),
                        ..Default::default()
                    },
                    TableColumnSpec {
                        id: 2,
                        name: "Status".to_string(),
                        ..Default::default()
                    },
                ],
                filter_columns: vec![FilterColumnSpec {
                    col_id: 1,
                    hidden_button: false,
                    show_button: true,
                    filter: FilterSpec::Values {
                        blank: false,
                        values: vec!["Open".to_string()],
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    },
                    ext_lst_raw: None,
                }],
                sort_state: Some(TableSortState {
                    ref_range: "A2:B3".to_string(),
                    column_sort: false,
                    case_sensitive: false,
                    sort_method: domain_types::SortMethod::None,
                    conditions: vec![TableSortCondition {
                        ref_range: "B1:B3".to_string(),
                        descending: true,
                        sort_by: domain_types::SortConditionBy::Value,
                        custom_list: None,
                        dxf_id: None,
                        icon_set: None,
                        icon_id: None,
                    }],
                    ext_lst_raw: None,
                }),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let table = exported.sheets[0]
        .tables
        .iter()
        .find(|table| table.name == "SalesData")
        .expect("exported table");

    assert_eq!(table.filter_columns.len(), 1);
    let sort_state = table
        .sort_state
        .as_ref()
        .expect("table-level sort state should survive filter projection");
    assert_eq!(sort_state.ref_range, "A2:B3");
    assert_eq!(sort_state.conditions.len(), 1);
    assert_eq!(sort_state.conditions[0].ref_range, "B1:B3");
    assert!(sort_state.conditions[0].descending);
}

#[test]
fn imported_table_export_uses_one_projection_for_parts_slicers_and_query_tables() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 4,
            cols: 2,
            dimensions: SheetDimensions::default(),
            tables: vec![TableSpec {
                id: 7,
                name: "People".to_string(),
                display_name: "People".to_string(),
                range_ref: "A1:B4".to_string(),
                has_headers: true,
                has_totals: false,
                auto_filter_ref: Some("A1:B4".to_string()),
                table_type: Some("queryTable".to_string()),
                connection_id: Some(3),
                table_part_path_hint: Some("xl/tables/table9.xml".to_string()),
                worksheet_relationship_id_hint: Some("rIdPeopleTable".to_string()),
                query_table: Some(QueryTable {
                    connection_id: Some(3),
                    name: Some("PeopleQuery".to_string()),
                    relationship_id: Some("rIdPeopleQuery".to_string()),
                    path_hint: Some("xl/queryTables/queryTable9.xml".to_string()),
                    fields: vec![QueryTableField {
                        id: 11,
                        name: Some("Region".to_string()),
                        table_column_id: Some(2),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                columns: vec![
                    TableColumnSpec {
                        id: 1,
                        name: "Name".to_string(),
                        ..Default::default()
                    },
                    TableColumnSpec {
                        id: 2,
                        name: "Region".to_string(),
                        query_table_field_id: Some(11),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            slicers: vec![SlicerDef {
                name: "Region".to_string(),
                cache: "Slicer_Region".to_string(),
                caption: Some("Region".to_string()),
                show_caption: true,
                ..Default::default()
            }],
            ..Default::default()
        }],
        slicer_caches: vec![SlicerCacheDef {
            name: "Slicer_Region".to_string(),
            source_name: "Region".to_string(),
            table_slicer_cache: Some(TableSlicerCache {
                table_id: 7,
                column: 1,
                sort_order: SlicerSortOrder::Ascending,
                custom_list_sort: false,
                cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
                ext_lst: None,
            }),
            ..Default::default()
        }],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);
    let sheet_id =
        cell_types::SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("sheet id");
    let table = engine
        .get_all_tables_in_sheet(&sheet_id)
        .into_iter()
        .find(|table| table.name == "People")
        .expect("hydrated People table");
    let stable_table_id = table.id.clone();
    let stable_region_column_id = table.columns[1].id.clone();
    let stored_slicer = {
        let txn = engine.stores.storage.doc().transact();
        let slicers_map = match engine.stores.storage.workbook_map().get(&txn, KEY_SLICERS) {
            Some(yrs::Out::YMap(map)) => map,
            _ => panic!("slicers map should be hydrated"),
        };
        slicers_map
            .iter(&txn)
            .find_map(|(_, value)| {
                domain_types::yrs_schema::slicer::from_yrs_out(value.clone(), &txn)
            })
            .expect("stored table-backed slicer")
    };
    assert!(
        matches!(stored_slicer.source, SlicerSource::Table { ref table_id, ref column_cell_id }
            if table_id == &stable_table_id && column_cell_id == &stable_region_column_id)
    );

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    assert_eq!(exported.sheets[0].tables[0].id, 7);
    assert_eq!(
        exported.slicer_caches[0]
            .table_slicer_cache
            .as_ref()
            .expect("table slicer cache")
            .table_id,
        7
    );

    let bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let archive = xlsx_parser::zip::XlsxArchive::new(&bytes).expect("xlsx archive");
    let table_xml = String::from_utf8(
        archive
            .read_file("xl/tables/table9.xml")
            .expect("projected table part"),
    )
    .unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .expect("sheet rels"),
    )
    .unwrap();
    let table_rels = String::from_utf8(
        archive
            .read_file("xl/tables/_rels/table9.xml.rels")
            .expect("table rels"),
    )
    .unwrap();
    let query_table_xml = String::from_utf8(
        archive
            .read_file("xl/queryTables/queryTable9.xml")
            .expect("projected query table part"),
    )
    .unwrap();
    let slicer_cache_xml = String::from_utf8(
        archive
            .read_file("xl/slicerCaches/slicerCache1.xml")
            .expect("slicer cache part"),
    )
    .unwrap();

    assert!(
        table_xml.contains(r#"tableType="queryTable""#) && table_xml.contains(r#" id="7""#),
        "{table_xml}"
    );
    assert!(
        table_xml.contains(r#"connectionId="3""#)
            && table_xml.contains(r#"queryTableFieldId="11""#),
        "{table_xml}"
    );
    assert!(
        sheet_rels.contains(r#"Id="rIdPeopleTable""#)
            && sheet_rels.contains(r#"Target="../tables/table9.xml""#),
        "{sheet_rels}"
    );
    assert!(
        table_rels.contains(r#"Id="rIdPeopleQuery""#)
            && table_rels.contains(r#"Target="../queryTables/queryTable9.xml""#),
        "{table_rels}"
    );
    assert!(
        query_table_xml.contains(r#"tableColumnId="2""#),
        "{query_table_xml}"
    );
    assert!(
        slicer_cache_xml.contains(r#"sourceName="Region""#)
            && slicer_cache_xml.contains(r#"tableId="7""#)
            && slicer_cache_xml.contains(r#"column="1""#),
        "{slicer_cache_xml}"
    );
}
