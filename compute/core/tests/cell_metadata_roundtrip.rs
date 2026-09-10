use compute_core::storage::engine::ComputeEngine;
use domain_types::{
    AlignmentFormat, CellData, CellFormat, ColDimension, DocumentFormat, ParseOutput,
    ProtectionFormat, SheetData, SheetDimensions,
};
use value_types::CellValue;

fn workbook() -> Vec<u8> {
    let formulas = [
        "CELL(\"format\",A1)",
        "CELL(\"color\",A1)",
        "CELL(\"parentheses\",A1)",
        "CELL(\"protect\",A1)",
        "CELL(\"prefix\",A1)",
        "INDEX(CELL(\"width\",A1),1,1)",
        "INDEX(CELL(\"width\",A1),1,2)",
        "CELL(\"format\",A20)",
        "CELL(\"format\",INDIRECT(\"A1\"))",
        "CELL(\"width\",A1)",
    ];
    let mut cells = vec![CellData {
        row: 0,
        col: 0,
        value: CellValue::Text("label".into()),
        style_id: Some(1),
        ..Default::default()
    }];
    cells.extend(formulas.iter().enumerate().map(|(row, formula)| CellData {
        row: row as u32,
        col: 1,
        formula: Some((*formula).into()),
        ..Default::default()
    }));
    cells.last_mut().unwrap().array_ref = Some("B10:C10".into());
    cells.last_mut().unwrap().cell_metadata_index = Some(1);
    cells.last_mut().unwrap().cell_formula = Some(ooxml_types::worksheet::CellFormula {
        text: "CELL(\"width\",A1)".into(),
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("B10:C10".into()),
        ..Default::default()
    });
    xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        metadata: Some(domain_types::WorkbookMetadata {
            metadata_types: vec![domain_types::MetadataType { name: "XLDAPR".into(), cell_meta: true, ..Default::default() }],
            future_metadata: vec![domain_types::FutureMetadataGroup { name: "XLDAPR".into(), blocks: vec![domain_types::FutureMetadataBlock { raw_xml: "<extLst><ext uri=\"{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}\"><xda:dynamicArrayProperties fDynamic=\"1\" fCollapsed=\"0\"/></ext></extLst>".into() }] }],
            cell_metadata: vec![domain_types::CellMetadataBlock { records: vec![domain_types::CellMetadataRecord { t: 1, v: 0 }] }],
            ..Default::default()
        }),
        style_palette: vec![
            DocumentFormat {
                number_format: Some("#,##0.00".into()),
                ..Default::default()
            },
            DocumentFormat {
                number_format: Some("(0.000);[Red](0.000)".into()),
                protection: Some(ProtectionFormat {
                    locked: Some(false),
                    hidden: None,
                }),
                alignment: Some(AlignmentFormat {
                    horizontal: Some("center".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![SheetData {
            name: "Metadata".into(),
            rows: 20,
            cols: 3,
            cells,
            dimensions: SheetDimensions {
                default_col_width: Some(9.0),
                row_heights: vec![domain_types::RowDimension {
                    row: 19, height: 15.0, custom_height: true, ..Default::default()
                }],
                col_widths: vec![ColDimension {
                    col: 0,
                    width: 20.83203125,
                    custom_width: true,
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap()
}

fn check(engine: &ComputeEngine, expected: &[CellValue]) {
    let sheet = *engine.cell_store().sheet_ids().next().unwrap();
    for (row, expected) in expected.iter().enumerate() {
        assert_eq!(
            engine.get_cell_value(&sheet, row as u32, 1),
            *expected,
            "B{}",
            row + 1
        );
    }
    assert_eq!(
        engine.get_cell_value(&sheet, 9, 2),
        CellValue::Boolean(false)
    );
}

#[test]
fn cell_reads_imported_metadata_then_live_edits_and_reload() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    check(
        &engine,
        &[
            CellValue::Text("F3-()".into()),
            CellValue::number(1.0),
            CellValue::number(1.0),
            CellValue::number(0.0),
            CellValue::Text("^".into()),
            CellValue::number(20.0),
            CellValue::Boolean(false),
            CellValue::Text(",2".into()),
            CellValue::Text("F3-()".into()),
            CellValue::number(20.0),
        ],
    );
    let sheet = *engine.cell_store().sheet_ids().next().unwrap();
    let cell = engine
        .cell_store()
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(0, 0))
        .unwrap();
    engine
        .set_cell_format(
            &sheet,
            &cell,
            &CellFormat {
                number_format: Some("0.00%".into()),
                locked: Some(true),
                horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Right),
                ..Default::default()
            },
        )
        .unwrap();
    engine.set_col_width_chars(&sheet, 0, 24.7).unwrap();
    engine
        .set_col_format(
            &sheet,
            0,
            CellFormat {
                number_format: Some("0.0%".into()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_row_format(
            &sheet,
            19,
            CellFormat {
                number_format: Some("0.0000".into()),
                ..Default::default()
            },
        )
        .unwrap();
    // A real calculate request must observe format-only edits, even when no
    // value edit dirtied the formula graph.
    engine.recalculate().unwrap();
    let expected = [
        CellValue::Text("P2".into()),
        CellValue::number(0.0),
        CellValue::number(0.0),
        CellValue::number(1.0),
        CellValue::Text("\"".into()),
        CellValue::number(24.0),
        CellValue::Boolean(false),
        CellValue::Text("F4".into()),
        CellValue::Text("P2".into()),
        CellValue::number(24.0),
    ];
    check(&engine, &expected);
    engine
        .set_cell_value_as_text(&sheet, 0, 0, "live label")
        .unwrap();
    check(&engine, &expected);
    // Formula-generated strings are values, not labels with a prefix.
    for formula in ["=\"\"", "=\"A\"&\"B\""] {
        engine.set_cell_value_parsed(&sheet, 0, 0, formula).unwrap();
        assert_eq!(
            engine.get_cell_value(&sheet, 4, 1),
            CellValue::Text("".into())
        );
    }
    engine
        .set_cell_value_as_text(&sheet, 0, 0, "live label")
        .unwrap();
    check(&engine, &expected);
    engine.hide_columns(&sheet, &[0]).unwrap();
    engine.recalculate().unwrap();
    assert_eq!(engine.get_cell_value(&sheet, 5, 1), CellValue::number(0.0));
    engine.unhide_columns(&sheet, &[0]).unwrap();
    engine.recalculate().unwrap();
    check(&engine, &expected);
    let exported = engine.export_to_xlsx_bytes().unwrap();
    let (mut reloaded, _) = ComputeEngine::from_xlsx_bytes(&exported).unwrap();
    reloaded.recalculate().unwrap();
    check(&reloaded, &expected);
    // Removing a live direct layer must reveal the inherited row layer.
    let sheet = *reloaded.cell_store().sheet_ids().next().unwrap();
    reloaded
        .set_cell_value_as_text(&sheet, 19, 0, "row label")
        .unwrap();
    let cell = reloaded
        .cell_store()
        .resolve_cell_id(&sheet, cell_types::SheetPos::new(19, 0))
        .unwrap();
    reloaded
        .set_cell_format(
            &sheet,
            &cell,
            &CellFormat {
                number_format: Some("0.00000".into()),
                ..Default::default()
            },
        )
        .unwrap();
    reloaded.recalculate().unwrap();
    assert_eq!(
        reloaded.get_cell_value(&sheet, 7, 1),
        CellValue::Text("F5".into())
    );
    reloaded.clear_cell_format(&sheet, &cell).unwrap();
    reloaded.recalculate().unwrap();
    assert_eq!(
        reloaded.get_cell_value(&sheet, 7, 1),
        CellValue::Text("F4".into())
    );
}

#[test]
fn cell_width_uses_supplied_metrics_after_document_reload_and_rebuild() {
    let (mut source, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    let sheet = *source.cell_store().sheet_ids().next().unwrap();
    source.set_col_width_chars(&sheet, 0, 8.95).unwrap();
    let bytes = source.export_to_xlsx_bytes().unwrap();
    for (mdw, expected) in [(7.0, 8.0), (14.0, 9.0)] {
        let metrics = domain_types::units::LayoutMetrics::from_column_width_mdw(mdw).unwrap();
        let (mut engine, _) = ComputeEngine::from_snapshot_with_layout_metrics(
            snapshot_types::WorkbookSnapshot::default(),
            metrics,
        )
        .unwrap();
        // Reload through public XLSX import so column metadata is hydrated
        // alongside formulas using the engine's supplied layout metrics.
        engine.import_from_xlsx_bytes(&bytes, true).unwrap();
        let sheet = *engine.cell_store().sheet_ids().next().unwrap();
        assert_eq!(
            engine.get_cell_value(&sheet, 5, 1),
            CellValue::number(expected),
            "MDW {mdw}"
        );
        engine.rebuild_compute_core().unwrap();
        assert_eq!(
            engine.get_cell_value(&sheet, 5, 1),
            CellValue::number(expected),
            "rebuilt MDW {mdw}"
        );
        // The specification's 8-character example is a live width edit too.
        engine.set_col_width_chars(&sheet, 0, 8.7109375).unwrap();
        engine.recalculate().unwrap();
        assert_eq!(engine.get_cell_value(&sheet, 5, 1), CellValue::number(8.0));
        assert_eq!(
            engine.get_cell_value(&sheet, 6, 1),
            CellValue::Boolean(false)
        );
    }
}
