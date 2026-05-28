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
