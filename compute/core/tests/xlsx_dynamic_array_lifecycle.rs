//! Production-path regression for imported dynamic-array state across a row insert.
//!
//! The imported spill cache is position keyed, while structural edits move the
//! source, projected values, and their formats.  Keep this fixture deliberately
//! small so the test checks the live ComputeEngine contract rather than a
//! private workbook or a test-only projection.

use compute_core::storage::engine::ComputeEngine;
use formula_types::StructureChange;
use ooxml_types::worksheet::CellFormulaType;
use value_types::CellValue;
use xlsx_parser::write::ZipWriter;

const DYNAMIC_METADATA: &str = r#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" cellMeta="1"/></metadataTypes><futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#;

fn dynamic_array_lifecycle_fixture() -> Vec<u8> {
    let content_types = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>
</Types>"#;
    let root_rels = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
    let workbook_rels = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>
</Relationships>"#;
    let workbook = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcMode="manual"/>
</workbook>"#;
    let styles = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font/><font><b/></font></fonts>
  <fills count="1"><fill/></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>"#;
    let worksheet = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C6"/>
  <sheetData>
    <row r="1"><c r="A1"><v>7</v></c></row>
    <row r="2">
      <c r="A2" cm="1"><f t="array" ref="A2:A4" aca="1" ca="1">_xlfn.SEQUENCE(3)</f><v>91</v></c>
      <c r="C2"><f>SUM(A2:A4)</f><v>999</v></c>
    </row>
    <row r="3"><c r="A3" s="1"><f ca="1"/><v>92</v></c></row>
    <row r="4"><c r="A4"><v>93</v></c></row>
  </sheetData>
</worksheet>"#;

    let mut zip = ZipWriter::new();
    zip.add_file("[Content_Types].xml", content_types.to_vec())
        .add_file("_rels/.rels", root_rels.to_vec())
        .add_file("xl/_rels/workbook.xml.rels", workbook_rels.to_vec())
        .add_file("xl/workbook.xml", workbook.to_vec())
        .add_file("xl/styles.xml", styles.to_vec())
        .add_file("xl/metadata.xml", DYNAMIC_METADATA.as_bytes().to_vec())
        .add_file("xl/worksheets/sheet1.xml", worksheet.to_vec());
    zip.finish().expect("write dynamic array lifecycle fixture")
}

fn sheet_id(engine: &ComputeEngine) -> cell_types::SheetId {
    *engine.mirror().sheet_ids().next().expect("sheet present")
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

fn assert_imported_cache_values(engine: &ComputeEngine, sheet: &cell_types::SheetId) {
    // from_xlsx_bytes intentionally hydrates imported caches without running
    // calculation, so these are the authored stale values.
    assert_number(engine, sheet, 1, 0, 91.0);
    assert_number(engine, sheet, 2, 0, 92.0);
    assert_number(engine, sheet, 3, 0, 93.0);
    assert_number(engine, sheet, 1, 2, 999.0);
}

fn assert_live_array_values(engine: &ComputeEngine, sheet: &cell_types::SheetId) {
    // The inserted row is before the old source and must not retain its old
    // source cache.  The live source and both projected values now begin one
    // row lower.
    assert_eq!(engine.get_cell_value(sheet, 1, 0), CellValue::Null);
    assert_number(engine, sheet, 2, 0, 1.0);
    assert_number(engine, sheet, 3, 0, 2.0);
    assert_number(engine, sheet, 4, 0, 3.0);
    assert_number(engine, sheet, 2, 2, 6.0);
}

fn assert_spill_child_bold(engine: &ComputeEngine, sheet: &cell_types::SheetId, row: u32) {
    assert_eq!(
        engine.get_resolved_format(sheet, row, 0).bold,
        Some(true),
        "the imported bold spill child at row {row} must move with the spill"
    );
}

fn assert_exported_values_and_formula(bytes: &[u8]) {
    let parsed = xlsx_api::parse(bytes).expect("parse exported lifecycle workbook");
    let sheet = &parsed.output.sheets[0];

    let cell = |row: u32, col: u32| {
        sheet
            .cells
            .iter()
            .find(|cell| (cell.row, cell.col) == (row, col))
            .unwrap_or_else(|| panic!("missing exported cell at row {row}, col {col}"))
    };

    // A3 is the moved source.  Its dynamic range and the dependent formula
    // both follow the inserted row.
    let source = cell(2, 0);
    assert_eq!(source.formula.as_deref(), Some("_xlfn.SEQUENCE(3)"));
    assert_eq!(source.array_ref.as_deref(), Some("A3:A5"));
    assert_eq!(source.value, CellValue::number(1.0));

    let marker = cell(3, 0);
    assert_eq!(marker.value, CellValue::number(2.0));
    assert!(marker.formula.is_none());
    assert!(marker.cell_formula.as_ref().is_some_and(|formula| {
        formula.t == CellFormulaType::Normal && formula.ca && formula.text.is_empty()
    }));

    let final_child = cell(4, 0);
    assert_eq!(final_child.value, CellValue::number(3.0));
    assert!(final_child.formula.is_none());

    let dependent = cell(2, 2);
    assert_eq!(dependent.formula.as_deref(), Some("SUM(A3:A5)"));
    assert_eq!(dependent.value, CellValue::number(6.0));

    // No stale source or follower may remain at the old A2 position.
    assert!(
        sheet
            .cells
            .iter()
            .find(|cell| (cell.row, cell.col) == (1, 0))
            .is_none_or(|cell| cell.value.is_null())
    );
}

fn assert_exported_marker_bold(bytes: &[u8]) {
    let parsed = xlsx_api::parse(bytes).expect("parse exported lifecycle workbook");
    let sheet = &parsed.output.sheets[0];
    let marker = sheet
        .cells
        .iter()
        .find(|cell| (cell.row, cell.col) == (3, 0))
        .expect("missing exported moved spill child");
    // Style IDs can be reindexed during export. Resolve the referenced font
    // through the exported palette and assert the semantic property.
    let marker_bold = marker
        .style_id
        .and_then(|style_id| parsed.output.style_palette.get(style_id as usize))
        .and_then(|style| style.font.as_ref())
        .and_then(|font| font.bold);
    assert_eq!(
        marker_bold,
        Some(true),
        "the moved spill child must retain a semantically bold font"
    );
}

#[test]
fn imported_dynamic_array_values_survive_row_insert_recalc_rebuild_and_xlsx_roundtrip() {
    let source = dynamic_array_lifecycle_fixture();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&source).expect("hydrate fixture");
    let sheet = sheet_id(&engine);

    assert_imported_cache_values(&engine, &sheet);

    engine
        .structure_change(
            &sheet,
            &StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert row before dynamic array");
    assert_live_array_values(&engine, &sheet);

    // A later ordinary edit dirties the workbook and makes this an explicit
    // production recalc boundary after the structural operation.
    engine
        .set_cell_value_parsed(&sheet, 0, 0, "11")
        .expect("edit unrelated cell after row insert");
    engine.recalculate().expect("recalculate after row insert");
    assert_live_array_values(&engine, &sheet);

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("export after row insert and recalc");
    assert_exported_values_and_formula(&exported);

    let (mut reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&exported).expect("reimport exported lifecycle workbook");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_live_array_values(&reloaded, &reloaded_sheet);

    // Rebuilding from the engine's own current state crosses the cache
    // reconstruction boundary where absolute imported positions used to
    // resurrect the pre-insert values.
    reloaded
        .rebuild_compute_core()
        .expect("rebuild after dynamic array reimport");
    assert_live_array_values(&reloaded, &reloaded_sheet);

    let rebuilt_export = reloaded
        .export_to_xlsx_bytes()
        .expect("export rebuilt lifecycle workbook");
    assert_exported_values_and_formula(&rebuilt_export);
    let (final_engine, _) =
        ComputeEngine::from_xlsx_bytes(&rebuilt_export).expect("reimport rebuilt workbook");
    let final_sheet = sheet_id(&final_engine);
    assert_live_array_values(&final_engine, &final_sheet);
}

#[test]
fn imported_dynamic_array_child_format_survives_eager_and_deferred_hydration() {
    let source = dynamic_array_lifecycle_fixture();
    let (mut eager, _) = ComputeEngine::from_xlsx_bytes(&source).expect("hydrate fixture");
    let eager_sheet = sheet_id(&eager);

    assert_spill_child_bold(&eager, &eager_sheet, 2);

    eager
        .structure_change(
            &eager_sheet,
            &StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .expect("insert row before dynamic array");
    assert_spill_child_bold(&eager, &eager_sheet, 3);

    eager
        .set_cell_value_parsed(&eager_sheet, 0, 0, "11")
        .expect("edit unrelated cell after row insert");
    eager.recalculate().expect("recalculate after row insert");
    assert_spill_child_bold(&eager, &eager_sheet, 3);

    let exported = eager
        .export_to_xlsx_bytes()
        .expect("export after row insert and recalc");
    assert_exported_marker_bold(&exported);

    let (mut reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&exported).expect("reimport exported lifecycle workbook");
    let reloaded_sheet = sheet_id(&reloaded);
    assert_spill_child_bold(&reloaded, &reloaded_sheet, 3);

    reloaded
        .rebuild_compute_core()
        .expect("rebuild after dynamic array reimport");
    assert_spill_child_bold(&reloaded, &reloaded_sheet, 3);

    let rebuilt_export = reloaded
        .export_to_xlsx_bytes()
        .expect("export rebuilt dynamic array workbook");
    assert_exported_marker_bold(&rebuilt_export);
    let (final_engine, _) =
        ComputeEngine::from_xlsx_bytes(&rebuilt_export).expect("reimport rebuilt workbook");
    let final_sheet = sheet_id(&final_engine);
    assert_spill_child_bold(&final_engine, &final_sheet, 3);

    // The deferred path stages the active sheet before completion. Check
    // native spill style resolution at both production hydration boundaries.
    let (mut deferred, _) =
        ComputeEngine::from_snapshot(snapshot_types::WorkbookSnapshot::default())
            .expect("create empty engine for deferred import");
    deferred
        .import_from_xlsx_bytes_deferred(&source)
        .expect("deferred import lifecycle fixture");
    let deferred_sheet = sheet_id(&deferred);
    assert_spill_child_bold(&deferred, &deferred_sheet, 2);
    deferred
        .complete_deferred_hydration()
        .expect("complete deferred import lifecycle fixture");
    assert_spill_child_bold(&deferred, &deferred_sheet, 2);
}
