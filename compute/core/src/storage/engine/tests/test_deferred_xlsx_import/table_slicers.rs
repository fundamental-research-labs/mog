//! A deferred sheet can own a slicer targeting a table already loaded elsewhere.
use super::*;
use domain_types::domain::slicer::SlicerSource;
use domain_types::domain::table::{FilterColumnSpec, FilterSpec, TableColumnSpec, TableSpec};
use domain_types::{CellData, ParseOutput, SheetData};
use ooxml_types::slicers::{SlicerAnchor, SlicerCacheDef, SlicerDef, TableSlicerCache};
use std::sync::Arc;
use value_types::CellValue;

fn table_slicer_workbook() -> Vec<u8> {
    let mut cells: Vec<_> = (0..512)
        .map(|row| CellData {
            row,
            col: 3,
            value: CellValue::number(row as f64),
            ..Default::default()
        })
        .collect();
    for (row, values) in [
        ["Name", "Region"],
        ["Alex", "East"],
        ["Beth", "West"],
        ["Chris", "East"],
    ]
    .into_iter()
    .enumerate()
    {
        cells.extend(values.into_iter().enumerate().map(|(col, value)| CellData {
            row: row as u32,
            col: col as u32,
            value: CellValue::from(value),
            ..Default::default()
        }));
    }
    let output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".into(),
                rows: 512,
                cols: 4,
                cells,
                tables: vec![TableSpec {
                    id: 7,
                    name: "People".into(),
                    display_name: "People".into(),
                    range_ref: "A1:B4".into(),
                    has_headers: true,
                    auto_filter_ref: Some("A1:B4".into()),
                    columns: vec![
                        TableColumnSpec {
                            id: 11,
                            name: "Name".into(),
                            ..Default::default()
                        },
                        TableColumnSpec {
                            id: 23,
                            name: "Region".into(),
                            ..Default::default()
                        },
                    ],
                    filter_columns: vec![FilterColumnSpec {
                        col_id: 1,
                        hidden_button: false,
                        show_button: true,
                        ext_lst_raw: None,
                        filter: FilterSpec::Values {
                            values: vec!["East".into()],
                            blank: false,
                            calendar_type: None,
                            date_group_items: vec![],
                        },
                    }],
                    ..Default::default()
                }],
                ..Default::default()
            },
            SheetData {
                name: "Dashboard".into(),
                rows: 14,
                cols: 7,
                slicers: vec![SlicerDef {
                    name: "Region".into(),
                    cache: "Slicer_Region".into(),
                    caption: Some("Region".into()),
                    show_caption: true,
                    ..Default::default()
                }],
                slicer_anchors: vec![SlicerAnchor {
                    slicer_name: "Region".into(),
                    object_id: Some(501),
                    from: ooxml_types::drawings::CellAnchor {
                        row: 1,
                        col: 1,
                        ..Default::default()
                    },
                    to: ooxml_types::drawings::CellAnchor {
                        row: 12,
                        col: 5,
                        ..Default::default()
                    },
                    anchor_mode: None,
                    extent: None,
                    macro_name: None,
                    nv_ext_lst: None,
                    drawing: Default::default(),
                }],
                ..Default::default()
            },
        ],
        slicer_caches: vec![SlicerCacheDef {
            name: "Slicer_Region".into(),
            source_name: "Region".into(),
            table_slicer_cache: Some(TableSlicerCache {
                table_id: 7,
                column: 1,
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };
    xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap()
}

fn assert_slicer_targets_current_table(engine: &ComputeEngine) {
    let data = engine.mirror().sheet_by_name("Data").unwrap();
    let dashboard = engine.mirror().sheet_by_name("Dashboard").unwrap();
    let tables = engine.get_all_tables_in_sheet(&data);
    assert_eq!(tables.len(), 1);
    let slicers = engine.get_all_slicers(&dashboard);
    assert_eq!(slicers.len(), 1);
    assert!(
        matches!(&slicers[0].source, SlicerSource::Table { table_id, column_cell_id }
        if table_id == &tables[0].id && column_cell_id == &tables[0].columns[1].id)
    );
    assert_eq!(slicers[0].selected_values, vec![CellValue::from("East")]);
    assert_eq!(engine.get_raw_value(&data, 2, 1), "North");
}

#[test]
fn remaining_sheet_slicer_uses_loaded_table_ids_and_filter_selection() {
    let bytes = table_slicer_workbook();
    let (mut engine, _) = ComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    engine.import_from_xlsx_bytes_deferred(&bytes).unwrap();
    let data = engine.mirror().sheet_by_name("Data").unwrap();
    let dashboard = engine.mirror().sheet_by_name("Dashboard").unwrap();
    assert!(engine.get_all_slicers(&dashboard).is_empty());
    let original_table = engine.get_all_tables_in_sheet(&data).remove(0);
    let payload = engine
        .mirror()
        .get_sheet(&data)
        .unwrap()
        .iter_ranges()
        .next()
        .unwrap()
        .1
        .values
        .clone();
    engine.complete_deferred_hydration().unwrap();
    assert_eq!(
        engine.get_all_tables_in_sheet(&data)[0].id,
        original_table.id
    );
    assert_eq!(
        engine.get_all_tables_in_sheet(&data)[0].columns[1].id,
        original_table.columns[1].id
    );
    assert!(Arc::ptr_eq(
        &payload,
        &engine
            .mirror()
            .get_sheet(&data)
            .unwrap()
            .iter_ranges()
            .next()
            .unwrap()
            .1
            .values
    ));
    engine.set_cell_value_parsed(&data, 2, 1, "North").unwrap();
    assert_slicer_targets_current_table(&engine);

    let exported = engine.export_to_xlsx_bytes().unwrap();
    let parsed = xlsx_api::parse(&exported).unwrap().output;
    let table = &parsed
        .sheets
        .iter()
        .find(|sheet| sheet.name == "Data")
        .unwrap()
        .tables[0];
    assert_eq!(table.id, 7);
    assert_eq!(
        table
            .columns
            .iter()
            .map(|column| column.id)
            .collect::<Vec<_>>(),
        vec![11, 23]
    );
    let cache = parsed
        .slicer_caches
        .iter()
        .find(|cache| cache.name == "Slicer_Region")
        .unwrap();
    assert_eq!(cache.source_name, "Region");
    assert_eq!(
        cache.table_slicer_cache.as_ref().unwrap().table_id,
        table.id
    );
    assert_eq!(cache.table_slicer_cache.as_ref().unwrap().column, 1);
    let dashboard = parsed
        .sheets
        .iter()
        .find(|sheet| sheet.name == "Dashboard")
        .unwrap();
    assert_eq!(dashboard.slicers.len(), 1);
    assert_eq!(dashboard.slicer_anchors[0].from.row, 1);
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&exported).unwrap();
    assert_slicer_targets_current_table(&reloaded);
}
