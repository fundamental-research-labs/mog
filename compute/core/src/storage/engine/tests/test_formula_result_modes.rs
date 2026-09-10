//! Imported formula modes are workbook state, not guesses from cached values.
//!
//! Authored OOXML contracts cover plain MINVERSE/MMULT, fixed CSE TREND,
//! and cm/XLDAPR INDEX and ROW declarations, including blocked spills.
//! Cached values intentionally contain zero: evaluation must follow source
//! metadata rather than infer a mode from a cached result or error.
use super::super::ComputeEngine;
use super::helpers::cell_value_at;
use cell_types::SheetPos;
use value_types::{CellError, CellValue};

fn workbook() -> Vec<u8> {
    let base = xlsx_parser::write::write_xlsx_from_parse_output(&domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Modes".into(),
            rows: 20,
            cols: 12,
            cells: vec![domain_types::CellData {
                value: CellValue::number(1.0),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    let sheet = r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:K14"/><sheetData>
<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="D1"><f>MINVERSE(A1:B2)</f><v>0</v></c><c r="J1" cm="1"><f t="array" ref="J1:K2">MINVERSE(A1:B2)</f><v>0</v></c></row>
<row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c><c r="D2"><v>99</v></c></row>
<row r="4"><c r="D4"><f>MMULT(A1:B2,A1:B2)</f><v>0</v></c></row>
<row r="5"><c r="J5"><f t="array" ref="J5:J5">MINVERSE(A1:B2)</f><v>0</v></c></row>
<row r="7"><c r="D7"><f t="array" ref="D7:E7">MINVERSE(A1:B2)</f><v>0</v></c><c r="G7"><f t="array" ref="G7:H9">MINVERSE(A1:B2)</f><v>0</v></c></row>
<row r="10"><c r="D10"><f t="array" ref="D10">MINVERSE(A1:B2)</f><v>0</v></c></row>
<row r="13"><c r="D13" cm="1"><f t="array" ref="D13">INDEX(A1:B2,0,1)</f><v>0</v></c><c r="G13" cm="1"><f t="array" ref="G13">ROW(A1:A2)</f><v>0</v></c></row>
<row r="14"><c r="D14"><v>99</v></c><c r="G14"><v>99</v></c></row>
</sheetData></worksheet>"#;
    let metadata = r#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#;
    let archive = xlsx_parser::XlsxArchive::new(&base).unwrap();
    let mut zip = xlsx_parser::write::ZipWriter::new();
    for entry in archive.entries() {
        let mut bytes = archive.read_file(&entry.name).unwrap();
        if entry.name == "xl/worksheets/sheet1.xml" {
            bytes = sheet.as_bytes().to_vec();
        }
        if entry.name == "xl/_rels/workbook.xml.rels" {
            bytes = String::from_utf8(bytes).unwrap().replace("</Relationships>", r#"<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>"#).into_bytes();
        }
        if entry.name == "[Content_Types].xml" {
            bytes = String::from_utf8(bytes).unwrap().replace("</Types>", r#"<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/></Types>"#).into_bytes();
        }
        zip.add_file(&entry.name, bytes);
    }
    zip.add_file("xl/metadata.xml", metadata.as_bytes().to_vec());
    zip.finish().unwrap()
}

fn assert_modes(engine: &ComputeEngine) {
    let sheet = engine.storage().sheet_order()[0];
    for (row, col, expected) in [
        (0, 3, -2.0),
        (3, 3, 7.0),
        (6, 3, -2.0),
        (6, 4, 1.0),
        (9, 3, -2.0),
        (4, 9, -2.0),
        (0, 9, -2.0),
        (0, 10, 1.0),
        (1, 9, 1.5),
        (1, 10, -0.5),
    ] {
        let actual = cell_value_at(engine, &sheet, row, col)
            .as_number()
            .expect("numeric result");
        assert!(
            (actual - expected).abs() < 1e-12,
            "r{row}c{col}: {actual}, expected {expected}"
        );
    }
    assert_eq!(
        cell_value_at(engine, &sheet, 7, 3),
        CellValue::Null,
        "CSE output cannot grow beyond its declared one-row extent"
    );
    assert_eq!(
        cell_value_at(engine, &sheet, 8, 6),
        CellValue::Error(CellError::Na, None),
        "larger CSE extent is padded"
    );
    assert_eq!(
        cell_value_at(engine, &sheet, 12, 3),
        CellValue::Error(CellError::Spill, None),
        "INDEX dynamic marker overrides scalar inference"
    );
    assert_eq!(
        cell_value_at(engine, &sheet, 12, 6),
        CellValue::Error(CellError::Spill, None),
        "ROW dynamic marker overrides scalar inference"
    );
}

#[test]
fn formula_result_modes_survive_import_recalc_xlsx_and_document_reload() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    assert_modes(&engine);
    let mut replay = super::helpers::rebuild_native_engine(&engine);
    replay.recalculate().unwrap();
    assert_modes(&replay);
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (mut reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    reloaded.recalculate().unwrap();
    assert_modes(&reloaded);
}

#[test]
fn formula_result_modes_reset_on_authored_edit_and_native_rebuild() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    let sheet = engine.storage().sheet_order()[0];
    let id = engine
        .cell_store()
        .resolve_cell_id(&sheet, SheetPos::new(0, 3))
        .unwrap();
    engine
        .set_cell(
            &sheet,
            id,
            0,
            3,
            crate::bridge_types::CellInput::Parse {
                text: "=TRANSPOSE(A1:B2)".into(),
            },
        )
        .unwrap();
    assert_eq!(
        cell_value_at(&engine, &sheet, 0, 3),
        CellValue::Error(CellError::Spill, None),
        "new authored array formula spills instead of inheriting legacy scalar mode"
    );
    let peer = super::helpers::rebuild_native_engine(&engine);
    assert_eq!(
        cell_value_at(&peer, &sheet, 0, 3),
        CellValue::Error(CellError::Spill, None)
    );
    let saved = engine.export_to_xlsx_bytes().unwrap();
    let (mut reloaded, _) = ComputeEngine::from_xlsx_bytes(&saved).unwrap();
    reloaded.recalculate().unwrap();
    let reloaded_sheet = reloaded.storage().sheet_order()[0];
    assert_eq!(
        cell_value_at(&reloaded, &reloaded_sheet, 0, 3),
        CellValue::Error(CellError::Spill, None)
    );
}

#[test]
fn formula_result_modes_reset_imported_dynamic_and_single_cell_cse_on_edit() {
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    let sheet = engine.storage().sheet_order()[0];
    // A single-cell CSE declaration must not constrain a newly authored formula.
    engine
        .set_cell_value_parsed(&sheet, 9, 3, "=TRANSPOSE(A1:B2)")
        .unwrap();
    assert_eq!(
        cell_value_at(&engine, &sheet, 10, 4),
        CellValue::number(4.0)
    );
    // A blocked imported dynamic source carries a one-cell array_ref as well.
    engine
        .set_cell_value_parsed(&sheet, 12, 3, "=TRANSPOSE(A1:B2)")
        .unwrap();
    assert_eq!(
        cell_value_at(&engine, &sheet, 12, 3),
        CellValue::Error(CellError::Spill, None)
    );
}

#[test]
fn formula_result_modes_author_dynamic_arrays_without_existing_metadata() {
    let initial = xlsx_parser::write::write_xlsx_from_parse_output(&domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Fresh".into(),
            rows: 10,
            cols: 10,
            cells: vec![domain_types::CellData {
                value: CellValue::number(1.0),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap();
    assert!(
        xlsx_parser::XlsxArchive::new(&initial)
            .unwrap()
            .read_file("xl/metadata.xml")
            .is_err()
    );
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&initial).unwrap();
    let sheet = engine.storage().sheet_order()[0];
    engine.set_cell_value_parsed(&sheet, 1, 0, "2").unwrap();
    engine.set_cell_value_parsed(&sheet, 1, 6, "99").unwrap();
    engine
        .set_cell_value_parsed(&sheet, 0, 3, "=A1:A2*2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet, 0, 6, "=A1:A2*2")
        .unwrap();
    assert_eq!(cell_value_at(&engine, &sheet, 1, 3), CellValue::number(4.0));
    assert_eq!(
        cell_value_at(&engine, &sheet, 0, 6),
        CellValue::Error(CellError::Spill, None)
    );
    let saved = engine.export_to_xlsx_bytes().unwrap();
    let (mut reloaded, _) = ComputeEngine::from_xlsx_bytes(&saved).unwrap();
    reloaded.recalculate().unwrap();
    let sheet = reloaded.storage().sheet_order()[0];
    assert_eq!(
        cell_value_at(&reloaded, &sheet, 1, 3),
        CellValue::number(4.0)
    );
    assert_eq!(
        cell_value_at(&reloaded, &sheet, 0, 6),
        CellValue::Error(CellError::Spill, None)
    );
}

#[test]
fn imported_formula_result_modes_survive_native_undo_redo() {
    use crate::cells::cell_metadata::FormulaResultMode;

    for (row, expected_mode) in [
        (0, FormulaResultMode::LegacyScalar),
        (9, FormulaResultMode::Cse),
        (12, FormulaResultMode::Dynamic),
    ] {
        let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
        engine.recalculate().unwrap();
        let sheet = engine.storage().sheet_order()[0];
        let id = engine
            .cell_store()
            .resolve_cell_id(&sheet, SheetPos::new(row, 3))
            .unwrap();
        let original = cell_value_at(&engine, &sheet, row, 3);
        assert_eq!(
            engine.cell_store().formula_result_mode(&id),
            Some(expected_mode)
        );

        engine.set_cell_value_parsed(&sheet, row, 3, "42").unwrap();
        assert_eq!(
            cell_value_at(&engine, &sheet, row, 3),
            CellValue::number(42.0)
        );
        assert_eq!(engine.cell_store().formula_result_mode(&id), None);

        for _ in 0..2 {
            engine.undo().unwrap();
            engine.recalculate().unwrap();
            assert_eq!(
                engine.cell_store().formula_result_mode(&id),
                Some(expected_mode)
            );
            assert_eq!(cell_value_at(&engine, &sheet, row, 3), original);
            engine.redo().unwrap();
            engine.recalculate().unwrap();
            assert_eq!(engine.cell_store().formula_result_mode(&id), None);
            assert_eq!(
                cell_value_at(&engine, &sheet, row, 3),
                CellValue::number(42.0)
            );
        }
    }
}

#[test]
fn authored_cse_replaces_imported_result_modes_before_evaluation() {
    use crate::cells::cell_metadata::FormulaResultMode;

    for (row, col) in [(0, 3), (0, 9)] {
        let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
        engine.recalculate().unwrap();
        let sheet = engine.storage().sheet_order()[0];
        engine
            .set_array_formula(&sheet, row, col, row, col + 1, "=TRANSPOSE(A1:B2)".into())
            .unwrap();
        let id = engine
            .cell_store()
            .resolve_cell_id(&sheet, SheetPos::new(row, col))
            .unwrap();
        assert_eq!(
            engine.cell_store().formula_result_mode(&id),
            Some(FormulaResultMode::Cse)
        );
        assert_eq!(
            cell_value_at(&engine, &sheet, row, col),
            CellValue::number(1.0)
        );
        assert_eq!(
            cell_value_at(&engine, &sheet, row, col + 1),
            CellValue::number(3.0)
        );

        let saved = engine.export_to_xlsx_bytes().unwrap();
        let (mut reloaded, _) = ComputeEngine::from_xlsx_bytes(&saved).unwrap();
        reloaded.recalculate().unwrap();
        let reloaded_sheet = reloaded.storage().sheet_order()[0];
        assert_eq!(
            cell_value_at(&reloaded, &reloaded_sheet, row, col),
            CellValue::number(1.0)
        );
        assert_eq!(
            cell_value_at(&reloaded, &reloaded_sheet, row, col + 1),
            CellValue::number(3.0)
        );
    }
}

#[test]
fn rejected_authored_cse_preserves_imported_declaration() {
    use crate::cells::cell_metadata::FormulaResultMode;

    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&workbook()).unwrap();
    engine.recalculate().unwrap();
    let sheet = engine.storage().sheet_order()[0];
    let id = engine
        .cell_store()
        .resolve_cell_id(&sheet, SheetPos::new(3, 3))
        .unwrap();
    let original_metadata = engine.storage().cell_metadata(&id).cloned();
    let original_value = cell_value_at(&engine, &sheet, 3, 3);
    // D4:E7 crosses the existing fixed array D7:E7.
    let error = engine
        .set_array_formula(&sheet, 3, 3, 6, 4, "=TRANSPOSE(A1:B2)".into())
        .unwrap_err();
    assert!(matches!(
        error,
        value_types::ComputeError::PartialArrayWrite { .. }
    ));
    assert_eq!(
        engine.storage().cell_metadata(&id),
        original_metadata.as_ref()
    );
    assert_eq!(
        engine.cell_store().formula_result_mode(&id),
        Some(FormulaResultMode::LegacyScalar)
    );
    engine.recalculate().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet, 3, 3), original_value);
}
