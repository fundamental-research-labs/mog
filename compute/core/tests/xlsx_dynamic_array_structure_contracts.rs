//! Structural edits for imported dynamic-array caches.
//!
//! The package cells below deliberately contain a correct source cache and
//! stale spill-member caches.  The source formula is the value contract; the
//! member values make a cache keyed only by its old coordinates observable.
//! Ordinary values in column B (and the 2-D fixture's column E) prove that
//! authored neighbors move with the sheet operation.

use compute_core::storage::engine::ComputeEngine;
use formula_types::StructureChange;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

const DYNAMIC_METADATA: &str = r#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#;

fn xlsx_fixture(worksheet: &str) -> Vec<u8> {
    let content_types = br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>
</Types>"#;
    let root_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
    let workbook_rels = br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>
</Relationships>"#;
    let workbook = br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcMode="manual"/>
</workbook>"#;
    let styles = br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font/><font><b/></font></fonts>
  <fills count="1"><fill/></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>"#;

    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", content_types.to_vec())
        .add_file("_rels/.rels", root_rels.to_vec())
        .add_file("xl/_rels/workbook.xml.rels", workbook_rels.to_vec())
        .add_file("xl/workbook.xml", workbook.to_vec())
        .add_file("xl/styles.xml", styles.to_vec())
        .add_file("xl/metadata.xml", DYNAMIC_METADATA.as_bytes().to_vec())
        .add_file("xl/worksheets/sheet1.xml", worksheet.as_bytes().to_vec());
    zip.finish().expect("write dynamic-array structure fixture")
}

fn one_dimensional_fixture() -> Vec<u8> {
    xlsx_fixture(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B6"/><sheetData>
    <row r="1"><c r="A1"><v>17</v></c><c r="B1"><v>101</v></c></row>
    <row r="2"><c r="A2" cm="1"><f t="array" ref="A2:A4" aca="1" ca="1">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B2"><v>201</v></c></row>
    <row r="3"><c r="A3" s="1"><f ca="1"/><v>902</v></c><c r="B3"><v>301</v></c></row>
    <row r="4"><c r="A4"><v>903</v></c><c r="B4"><v>401</v></c></row>
    <row r="5"><c r="B5"><v>501</v></c></row>
  </sheetData>
</worksheet>"#,
    )
}

fn two_dimensional_fixture() -> Vec<u8> {
    xlsx_fixture(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="B1:F5"/><sheetData>
    <row r="1"><c r="B1"><v>11</v></c><c r="F1"><v>61</v></c></row>
    <row r="2"><c r="B2"><v>21</v></c><c r="C2" cm="1"><f t="array" ref="C2:D3" aca="1" ca="1">_xlfn.SEQUENCE(2,2)</f><v>1</v></c><c r="D2" s="1"><f ca="1"/><v>702</v></c><c r="E2"><v>51</v></c></row>
    <row r="3"><c r="B3"><v>31</v></c><c r="C3"><f ca="1"/><v>703</v></c><c r="D3"><v>704</v></c><c r="E3"><v>52</v></c></row>
    <row r="4"><c r="B4"><v>41</v></c><c r="F4"><v>71</v></c></row>
  </sheetData>
</worksheet>"#,
    )
}

fn sheet_id(engine: &ComputeEngine) -> cell_types::SheetId {
    *engine
        .cell_store()
        .sheet_ids()
        .next()
        .expect("sheet present")
}

fn assert_number(
    engine: &ComputeEngine,
    sheet: &cell_types::SheetId,
    row: u32,
    col: u32,
    expected: f64,
) {
    assert_eq!(
        engine.get_cell_value(sheet, row, col),
        CellValue::number(expected),
        "cell at row {row}, col {col}"
    );
}

fn assert_null(engine: &ComputeEngine, sheet: &cell_types::SheetId, row: u32, col: u32) {
    assert_eq!(
        engine.get_cell_value(sheet, row, col),
        CellValue::Null,
        "cell at row {row}, col {col} should be empty"
    );
}

fn assert_bold(engine: &ComputeEngine, sheet: &cell_types::SheetId, row: u32, col: u32) {
    assert_eq!(
        engine.get_resolved_format(sheet, row, col).bold,
        Some(true),
        "cell at row {row}, col {col} should retain its semantic bold format"
    );
}

fn assert_row_insert_state(engine: &ComputeEngine, sheet: &cell_types::SheetId, neighbor: f64) {
    // SEQUENCE(3) remains anchored at A2.  The inserted row is now part of
    // the live projection, while the old final child must not remain at A5.
    assert_number(engine, sheet, 1, 0, 1.0);
    assert_number(engine, sheet, 2, 0, 2.0);
    assert_number(engine, sheet, 3, 0, 3.0);
    assert_null(engine, sheet, 4, 0);

    // Authored neighbors moved with the inserted row independently of spill
    // materialization.
    assert_number(engine, sheet, 0, 0, 17.0);
    assert_number(engine, sheet, 0, 1, neighbor);
    assert_number(engine, sheet, 3, 1, 301.0);
    assert_number(engine, sheet, 4, 1, 401.0);
    assert_number(engine, sheet, 5, 1, 501.0);
}

fn assert_source_deleted_state(engine: &ComputeEngine, sheet: &cell_types::SheetId) {
    // Deleting A2 removes the source.  Its cached members are package data
    // and therefore cannot become ordinary values at the shifted A2:A3.
    assert_null(engine, sheet, 1, 0);
    assert_null(engine, sheet, 2, 0);
    assert_number(engine, sheet, 0, 0, 17.0);
    assert_number(engine, sheet, 1, 1, 301.0);
    assert_number(engine, sheet, 2, 1, 401.0);
    assert_number(engine, sheet, 3, 1, 501.0);
}

fn assert_child_deleted_state(engine: &ComputeEngine, sheet: &cell_types::SheetId) {
    // Deleting A3 removes one cached member, but the constant SEQUENCE(3)
    // source still owns the complete A2:A4 projection after recalc.
    assert_number(engine, sheet, 1, 0, 1.0);
    assert_number(engine, sheet, 2, 0, 2.0);
    assert_number(engine, sheet, 3, 0, 3.0);
    assert_null(engine, sheet, 4, 0);
    assert_number(engine, sheet, 2, 1, 401.0);
    assert_number(engine, sheet, 3, 1, 501.0);
}

fn assert_column_insert_state(engine: &ComputeEngine, sheet: &cell_types::SheetId, neighbor: f64) {
    // SEQUENCE(2,2) remains anchored at C2.  Its live result occupies C2:D3;
    // the old right-hand child cache must not survive at E2:E3.
    assert_number(engine, sheet, 1, 2, 1.0);
    assert_number(engine, sheet, 1, 3, 2.0);
    assert_number(engine, sheet, 2, 2, 3.0);
    assert_number(engine, sheet, 2, 3, 4.0);
    assert_null(engine, sheet, 1, 4);
    assert_null(engine, sheet, 2, 4);

    // Authored neighbors in the former E column shifted to F.
    assert_number(engine, sheet, 0, 1, neighbor);
    assert_number(engine, sheet, 1, 1, 21.0);
    assert_number(engine, sheet, 2, 1, 31.0);
    assert_number(engine, sheet, 1, 5, 51.0);
    assert_number(engine, sheet, 2, 5, 52.0);
}

#[test]
fn imported_dynamic_array_row_insert_inside_spill_keeps_source() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&one_dimensional_fixture())
        .expect("hydrate one-dimensional fixture");
    let sheet = sheet_id(&engine);

    // The source cache is already correct, but its children intentionally are
    // not. This makes a stale coordinate at the new tail observable.
    assert_number(&engine, &sheet, 1, 0, 1.0);
    assert_number(&engine, &sheet, 2, 0, 902.0);
    assert_number(&engine, &sheet, 3, 0, 903.0);

    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertRows {
                at: 2,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert row inside dynamic-array spill");
    assert_row_insert_state(&engine, &sheet, 101.0);
    assert_bold(&engine, &sheet, 3, 0);

    // Exercise a later ordinary recalc boundary while the source value stays
    // equal to its SEQUENCE result.
    engine
        .set_cell_value_parsed(&sheet, 0, 1, "111")
        .expect("edit authored neighbor");
    engine.recalculate().expect("recalculate after row insert");
    assert_row_insert_state(&engine, &sheet, 111.0);
    assert_number(&engine, &sheet, 0, 1, 111.0);

    engine
        .rebuild_compute_core()
        .expect("rebuild after row insert");
    assert_row_insert_state(&engine, &sheet, 111.0);
    assert_bold(&engine, &sheet, 3, 0);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export after row insert");
    let (reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&exported).expect("reimport after row insert");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_row_insert_state(&reloaded, &reloaded_sheet, 111.0);
}

#[test]
fn imported_dynamic_array_delete_source_row_does_not_orphan_children() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&one_dimensional_fixture())
        .expect("hydrate one-dimensional fixture");
    let sheet = sheet_id(&engine);

    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete dynamic-array source row");
    assert_source_deleted_state(&engine, &sheet);

    engine
        .rebuild_compute_core()
        .expect("rebuild after deleting dynamic-array source");
    assert_source_deleted_state(&engine, &sheet);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export after deleting dynamic-array source");
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&exported)
        .expect("reimport after deleting dynamic-array source");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_source_deleted_state(&reloaded, &reloaded_sheet);
}

#[test]
fn imported_dynamic_array_delete_child_recalculates_and_roundtrips() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&one_dimensional_fixture())
        .expect("hydrate one-dimensional fixture");
    let sheet = sheet_id(&engine);

    engine
        .structure_change(
            &sheet,
            &StructureChange::DeleteRows {
                at: 2,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .expect("delete dynamic-array child row");
    assert_child_deleted_state(&engine, &sheet);

    // Dirties the workbook after the structural operation so this test crosses
    // the same explicit recalc boundary used by a caller after row deletion.
    engine
        .set_cell_value_parsed(&sheet, 0, 1, "111")
        .expect("edit authored neighbor");
    engine
        .recalculate()
        .expect("recalculate after child deletion");
    assert_child_deleted_state(&engine, &sheet);

    engine
        .rebuild_compute_core()
        .expect("rebuild after child deletion");
    assert_child_deleted_state(&engine, &sheet);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export after child deletion");
    let (reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&exported).expect("reimport after child deletion");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_child_deleted_state(&reloaded, &reloaded_sheet);
}

#[test]
fn imported_two_dimensional_array_column_insert_inside_spill_keeps_source() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&two_dimensional_fixture())
        .expect("hydrate two-dimensional fixture");
    let sheet = sheet_id(&engine);

    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertCols {
                at: 3,
                count: 1,
                new_col_ids: Vec::new(),
            },
        )
        .expect("insert column inside two-dimensional spill");
    assert_column_insert_state(&engine, &sheet, 11.0);
    assert_bold(&engine, &sheet, 1, 4);

    engine
        .set_cell_value_parsed(&sheet, 0, 1, "111")
        .expect("edit authored neighbor");
    engine
        .recalculate()
        .expect("recalculate after column insertion");
    assert_column_insert_state(&engine, &sheet, 111.0);
    assert_number(&engine, &sheet, 0, 1, 111.0);

    engine
        .rebuild_compute_core()
        .expect("rebuild after column insertion");
    assert_column_insert_state(&engine, &sheet, 111.0);
    assert_bold(&engine, &sheet, 1, 4);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export after column insertion");
    let (reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&exported).expect("reimport after column insertion");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_column_insert_state(&reloaded, &reloaded_sheet, 111.0);
}
