use super::*;
use cell_types::{CellId, SheetId};
use formula_types::StructureChange;
use value_types::{CellError, CellValue};
use xlsx_parser::write::ZipWriter;

const ROWS: u32 = 220;

fn col_name(mut col: u32) -> String {
    let mut chars = Vec::new();
    loop {
        let rem = col % 26;
        chars.push((b'A' + rem as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    chars.iter().rev().collect()
}

fn cell_ref(row: u32, col: u32) -> String {
    format!("{}{}", col_name(col), row + 1)
}

fn value_cell(row: u32, col: u32, value: f64) -> String {
    format!(r#"<c r="{}"><v>{value}</v></c>"#, cell_ref(row, col))
}

fn shared_master(row: u32, col: u32, end_col: u32, si: u32, formula: String, value: f64) -> String {
    format!(
        r#"<c r="{cell}" t="n"><f t="shared" ref="{cell}:{end}" si="{si}">{formula}</f><v>{value}</v></c>"#,
        cell = cell_ref(row, col),
        end = cell_ref(row, end_col),
    )
}

fn shared_follower(row: u32, col: u32, si: u32, value: f64) -> String {
    format!(
        r#"<c r="{}" t="n"><f t="shared" si="{si}"/><v>{value}</v></c>"#,
        cell_ref(row, col)
    )
}

fn formula_cell(row: u32, col: u32, formula: &str, value: f64) -> String {
    format!(
        r#"<c r="{}" t="n"><f>{formula}</f><v>{value}</v></c>"#,
        cell_ref(row, col)
    )
}

fn shared_formula_delete_fixture_xlsx() -> Vec<u8> {
    let mut sheet_data = String::new();
    sheet_data.push_str("<sheetData>");

    for row in 0..ROWS {
        sheet_data.push_str(&format!(r#"<row r="{}">"#, row + 1));

        // C:G mirrors an across-row percentage formula band. F is a shared
        // follower whose expanded formula references E in the previous row.
        if row == 0 {
            for col in 2..=6 {
                sheet_data.push_str(&value_cell(row, col, 10.0 * (col as f64 + 1.0)));
            }
        } else {
            let si = row;
            let prev = row;
            sheet_data.push_str(&value_cell(row, 2, 10.0 + row as f64));
            sheet_data.push_str(&shared_master(
                row,
                3,
                6,
                si,
                format!("D{prev}/C{prev}-1"),
                0.10,
            ));
            sheet_data.push_str(&shared_follower(row, 4, si, 0.20));
            sheet_data.push_str(&shared_follower(row, 5, si, 0.30));
            sheet_data.push_str(&shared_follower(row, 6, si, 0.40));
        }

        // P:AP mirrors a wide row formula band. AA/AB/AJ are shared followers
        // whose expanded formulas reference row 21 when row 22 shifts upward.
        if row == 0 {
            for col in 15..=41 {
                sheet_data.push_str(&value_cell(row, col, 100.0 + col as f64));
            }
        } else {
            let si = 10_000 + row;
            let prev = row;
            for col in 15..=18 {
                sheet_data.push_str(&value_cell(row, col, 100.0 + row as f64 + col as f64));
            }
            sheet_data.push_str(&shared_master(
                row,
                19,
                41,
                si,
                format!("T{prev}/P{prev}-1"),
                0.10,
            ));
            for col in 20..=41 {
                if col == 26 && matches!(row, 50 | 153) {
                    sheet_data.push_str(&formula_cell(row, col, "AA22+1", 0.50));
                } else {
                    sheet_data.push_str(&shared_follower(row, col, si, 0.10 + col as f64 / 100.0));
                }
            }
        }

        sheet_data.push_str("</row>");
    }

    sheet_data.push_str("</sheetData>");

    let sheet = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:AP{ROWS}"/>
  {sheet_data}
</worksheet>"#
    );

    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
            .to_vec(),
    )
    .add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/workbook.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#
            .to_vec(),
    )
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/worksheets/sheet1.xml", sheet.into_bytes());

    zip.finish()
        .expect("shared formula structural fixture should be writable")
}

fn import_deferred() -> (YrsComputeEngine, SheetId) {
    let bytes = shared_formula_delete_fixture_xlsx();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes_deferred(&bytes)
        .expect("deferred XLSX import should succeed");
    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_all_sheet_ids()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .expect("sheet id should parse");
    (engine, sheet_id)
}

fn import_deferred_then_complete() -> (YrsComputeEngine, SheetId) {
    let (mut engine, sheet_id) = import_deferred();
    engine
        .complete_deferred_hydration()
        .expect("full deferred hydration should succeed");
    (engine, sheet_id)
}

fn assert_ref_error(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) {
    assert!(
        matches!(
            engine.get_cell_value(sheet_id, row, col),
            CellValue::Error(CellError::Ref, _)
        ),
        "cell {row},{col} should evaluate to #REF!"
    );

    let queried = engine.query_range(sheet_id, row, col, row, col);
    let cell = queried
        .cells
        .iter()
        .find(|cell| cell.row == row && cell.col == col)
        .unwrap_or_else(|| panic!("query_range should return #REF! cell {row},{col}"));
    assert!(
        matches!(&cell.value, CellValue::Error(CellError::Ref, _)),
        "query_range cell {row},{col} should carry #REF!, got {:?}",
        cell.value
    );
    assert_eq!(
        cell.formatted.as_deref(),
        Some("#REF!"),
        "query_range cell {row},{col} should display #REF!"
    );
}

fn assert_direct_ref_error(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) {
    assert_ref_error(engine, sheet_id, row, col);
    let cell_id = CellId::from_uuid_str(
        &engine
            .get_cell_id_at(sheet_id, row, col)
            .expect("shifted formula cell should stay materialized"),
    )
    .expect("cell id should parse");
    let formula = engine
        .get_formula(&cell_id)
        .expect("shifted formula should keep formula text");
    assert!(
        formula.contains("#REF!"),
        "shifted formula should contain #REF!, got {formula}"
    );
}

#[test]
fn delete_column_invalidates_shifted_imported_shared_formula_followers() {
    let (mut engine, sheet_id) = import_deferred_then_complete();

    engine
        .structure_change(
            &sheet_id,
            &StructureChange::DeleteCols {
                at: 4,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete column should succeed");

    for row in [9, 19, 99, 195] {
        assert_direct_ref_error(&engine, &sheet_id, row, 4);
    }
}

#[test]
fn delete_column_completes_deferred_hydration_before_invalidating_shared_formula_followers() {
    let (mut engine, sheet_id) = import_deferred();

    engine
        .structure_change(
            &sheet_id,
            &StructureChange::DeleteCols {
                at: 4,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete column should complete hydration and succeed");

    for row in [9, 19, 99, 195] {
        assert_direct_ref_error(&engine, &sheet_id, row, 4);
    }
}

#[test]
fn delete_row_invalidates_shifted_imported_shared_formula_followers() {
    let (mut engine, sheet_id) = import_deferred_then_complete();

    engine
        .structure_change(
            &sheet_id,
            &StructureChange::DeleteRows {
                at: 20,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete row should succeed");

    for col in [26, 27, 35] {
        assert_direct_ref_error(&engine, &sheet_id, 20, col);
    }
    assert_ref_error(&engine, &sheet_id, 49, 26);
    assert_ref_error(&engine, &sheet_id, 152, 26);
}

#[test]
fn delete_row_completes_deferred_hydration_before_invalidating_shared_formula_followers() {
    let (mut engine, sheet_id) = import_deferred();

    engine
        .structure_change(
            &sheet_id,
            &StructureChange::DeleteRows {
                at: 20,
                count: 1,
                deleted_cell_ids: vec![],
            },
        )
        .expect("delete row should complete hydration and succeed");

    for col in [26, 27, 35] {
        assert_direct_ref_error(&engine, &sheet_id, 20, col);
    }
    assert_ref_error(&engine, &sheet_id, 49, 26);
    assert_ref_error(&engine, &sheet_id, 152, 26);
}
