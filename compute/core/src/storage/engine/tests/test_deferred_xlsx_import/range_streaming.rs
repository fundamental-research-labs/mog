use super::*;
use cell_types::PayloadEncoding;
use value_types::{CellError, CellValue};

fn mixed_deferred_value(row: u32, col: u32) -> CellValue {
    match (row + col) % 3 {
        0 => CellValue::Text(format!("mixed-{col}-{row}").into()),
        1 => CellValue::Boolean(row % 2 == 0),
        _ => CellValue::from(CellError::Ref),
    }
}

fn assert_mixed_grid_visible(engine: &YrsComputeEngine, sheet_id: &SheetId, rows: u32, cols: u32) {
    for &(row, col) in &[
        (0, 0),
        (1, 0),
        (2, 0),
        (3, 0),
        (rows - 1, 0),
        (rows - 2, 0),
        (rows - 3, 1),
        (rows - 4, cols - 1),
    ] {
        assert_eq!(
            engine.get_cell_value(sheet_id, row, col),
            mixed_deferred_value(row, col),
            "mismatched deferred mixed value at row={row}, col={col}",
        );
    }
}

fn assert_mixed_cbor_ranges(engine: &YrsComputeEngine, sheet_id: &SheetId, rows: u32, cols: u32) {
    let sheet = engine
        .mirror()
        .get_sheet(sheet_id)
        .expect("mixed-cbor sheet should exist in mirror");
    let mixed_ranges: Vec<_> = sheet
        .iter_ranges()
        .map(|(_, range)| range)
        .filter(|range| range.encoding == PayloadEncoding::MixedCbor)
        .collect();

    assert_eq!(
        mixed_ranges.len(),
        cols as usize,
        "column-oriented classifier should promote one MixedCbor range per long mixed column",
    );
    for range in mixed_ranges {
        assert_eq!(range.num_rows(), rows);
        assert_eq!(range.num_cols(), 1);
    }
}

fn assert_mixed_counta_formula(engine: &mut YrsComputeEngine, sheet_id: &SheetId, rows: u32) {
    let col_len = engine
        .mirror()
        .get_sheet(sheet_id)
        .and_then(|sheet| sheet.get_column_slice(0))
        .map(|col| col.len())
        .unwrap_or(0);
    assert_eq!(
        col_len, rows as usize,
        "MixedCbor column data must be fully materialized for formula range aggregation",
    );

    let formula_cell_id = CellId::from_uuid_str("f2000000-0000-4000-8000-000000000044").unwrap();
    engine
        .set_cell(
            sheet_id,
            formula_cell_id,
            0,
            3,
            crate::bridge_types::CellInput::Parse {
                text: format!("=COUNTA(A1:A{rows})"),
            },
        )
        .expect("COUNTA formula over MixedCbor import column should be accepted");

    assert_eq!(
        engine.get_cell_value(sheet_id, 0, 3),
        CellValue::number(rows as f64),
        "COUNTA must aggregate every MixedCbor range cell, not just the first materialized row",
    );
}

fn mixed_cbor_deferred_import_fixture_xlsx(rows: u32, cols: u32) -> Vec<u8> {
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for row in 0..rows {
        for col in 0..cols {
            cells.push(domain_types::CellData {
                row,
                col,
                value: mixed_deferred_value(row, col),
                ..Default::default()
            });
        }
    }
    let output = domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Mixed".to_string(),
            rows,
            cols,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("mixed-cbor fixture should be writable")
}

fn second_sheet_range_backed_date_fixture_xlsx() -> Vec<u8> {
    let mut range_backed_cells = Vec::with_capacity(3823);
    for row in 0..3822 {
        range_backed_cells.push(domain_types::CellData {
            row,
            col: 16,
            value: CellValue::number(34532.0 + row as f64),
            ..Default::default()
        });
    }
    range_backed_cells.push(domain_types::CellData {
        row: 3821,
        col: 29,
        value: CellValue::number(2005.0),
        formula: Some(r#"IF(Q3822="","",YEAR(Q3822))"#.to_string()),
        ..Default::default()
    });

    let output = domain_types::ParseOutput {
        sheets: vec![
            domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 2,
                cells: vec![
                    domain_types::CellData {
                        row: 0,
                        col: 0,
                        value: CellValue::number(1.0),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 1,
                        col: 0,
                        value: CellValue::Text("visible".into()),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            domain_types::SheetData {
                name: "RangeBacked".to_string(),
                rows: 3822,
                cols: 30,
                cells: range_backed_cells,
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("second-sheet range-backed date fixture should be writable")
}

#[test]
fn deferred_xlsx_import_streams_long_mixed_cbor_ranges() {
    let rows = 1024;
    let cols = 3;
    let bytes = mixed_cbor_deferred_import_fixture_xlsx(rows, cols);

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred mixed-cbor XLSX import should succeed");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .first()
        .cloned()
        .expect("imported mixed-cbor workbook should have a first sheet");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();

    assert_mixed_grid_visible(&engine, &sheet_id, rows, cols);

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should stream MixedCbor ranges");

    assert_mixed_grid_visible(&engine, &sheet_id, rows, cols);
    assert_mixed_counta_formula(&mut engine, &sheet_id, rows);
    assert_mixed_cbor_ranges(&engine, &sheet_id, rows, cols);
}

#[test]
fn deferred_xlsx_import_materializes_range_data_on_non_critical_sheet() {
    let bytes = second_sheet_range_backed_date_fixture_xlsx();

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");

    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should materialize second-sheet ranges");

    let sheet_id_hex = engine
        .get_all_sheet_ids()
        .into_iter()
        .find(|sheet_id| {
            let sheet_id = SheetId::from_uuid_str(sheet_id).expect("sheet id");
            engine.get_sheet_name(&sheet_id).as_deref() == Some("RangeBacked")
        })
        .expect("RangeBacked sheet should exist");
    let sheet_id = SheetId::from_uuid_str(&sheet_id_hex).unwrap();
    let sheet = engine
        .mirror()
        .get_sheet(&sheet_id)
        .expect("RangeBacked mirror sheet should exist");

    assert_eq!(
        engine.get_cell_value(&sheet_id, 3821, 16),
        CellValue::number(38353.0),
        "RangeBacked!Q3822 must read through the production engine path",
    );
    assert_eq!(
        engine.get_cell_value(&sheet_id, 3821, 29),
        CellValue::number(2005.0),
        "RangeBacked!AD3822 formula cache should remain visible",
    );

    let range_count = sheet.iter_ranges().count();
    assert!(
        range_count > 0,
        "RangeBacked date column should be imported as RangeData",
    );
    let q_col = sheet
        .get_column_slice(16)
        .expect("RangeBacked!Q should be materialized into dense col_data");
    assert_eq!(q_col.get(3821), Some(&CellValue::number(38353.0)));
}
