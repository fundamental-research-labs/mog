//! Public-engine chart lifecycle regressions.
//!
//! The fixture is a real XLSX package rather than a pre-hydrated chart object.
//! Each test imports it through `YrsComputeEngine`, performs the edit through
//! the public mutation API, and inspects the exported package.  The chart
//! owns style/color companions, a picture-fill media part, and an opaque
//! chart-space extension so source-cache refreshes cannot accidentally discard
//! package-owned metadata.

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use xlsx_parser::write::ZipWriter;

const CHART_IMAGE: &[u8] = b"\x89PNG\r\n\x1a\nchart-owned-picture-fill";
const FUTURE_CHART_EXTENSION: &str = "futureChartMetadata";

fn imported_engine() -> (YrsComputeEngine, SheetId, String) {
    imported_engine_from_xlsx(chart_fixture_xlsx())
}

fn imported_title_formula_engine() -> (YrsComputeEngine, SheetId, String) {
    imported_engine_from_xlsx(title_formula_chart_fixture_xlsx())
}

fn imported_engine_from_xlsx(xlsx: Vec<u8>) -> (YrsComputeEngine, SheetId, String) {
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx)
        .expect("chart lifecycle fixture should import through the public engine");
    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_all_sheet_ids()
            .first()
            .expect("fixture should contain a sheet"),
    )
    .expect("imported sheet id should be a UUID");
    let chart_id = engine
        .get_all_charts(&sheet_id)
        .first()
        .expect("fixture should contain an imported chart")
        .common
        .id
        .clone();
    (engine, sheet_id, chart_id)
}

fn archive_text(bytes: &[u8], path: &str) -> Option<String> {
    let archive = xlsx_parser::XlsxArchive::new(bytes).expect("XLSX archive should be readable");
    archive
        .read_file(path)
        .ok()
        .map(|data| String::from_utf8(data).expect("XML part should be UTF-8"))
}

fn archive_bytes(bytes: &[u8], path: &str) -> Option<Vec<u8>> {
    let archive = xlsx_parser::XlsxArchive::new(bytes).expect("XLSX archive should be readable");
    archive.read_file(path).ok()
}

fn assert_imported_chart_closure(bytes: &[u8]) {
    let archive = xlsx_parser::XlsxArchive::new(bytes).expect("XLSX archive should be readable");
    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(archive.contains("xl/charts/_rels/chart1.xml.rels"));

    let chart_xml = archive_text(bytes, "xl/charts/chart1.xml").expect("chart XML");
    assert!(chart_xml.contains(FUTURE_CHART_EXTENSION), "{chart_xml}");
    assert_chart_axis_topology(&chart_xml);

    let chart_rels =
        archive_text(bytes, "xl/charts/_rels/chart1.xml.rels").expect("chart relationship XML");
    let chart_rels = xlsx_parser::domain::workbook::read::parse_all_rels(chart_rels.as_bytes());
    let source_bytes = chart_fixture_xlsx();
    let source_archive =
        xlsx_parser::XlsxArchive::new(&source_bytes).expect("source fixture should be readable");
    let source_rels_xml =
        archive_text(&source_bytes, "xl/charts/_rels/chart1.xml.rels").expect("source chart rels");
    let source_rels =
        xlsx_parser::domain::workbook::read::parse_all_rels(source_rels_xml.as_bytes());
    let mut expected_owned_paths = vec![
        "xl/charts/chart1.xml".to_string(),
        "xl/charts/_rels/chart1.xml.rels".to_string(),
    ];

    for relationship_type in [
        xlsx_parser::infra::opc::REL_CHART_STYLE,
        xlsx_parser::infra::opc::REL_CHART_COLOR_STYLE,
    ] {
        let emitted = chart_rels
            .iter()
            .find(|relationship| relationship.rel_type == relationship_type)
            .unwrap_or_else(|| panic!("missing chart relationship type {relationship_type}"));
        assert!(
            emitted.target_mode.is_none(),
            "chart auxiliary relationship unexpectedly external: {emitted:?}"
        );
        let emitted_path = xlsx_parser::infra::opc::resolve_relationship_target(
            Some("xl/charts/chart1.xml"),
            &emitted.target,
        )
        .expect("emitted chart auxiliary target should resolve");
        expected_owned_paths.push(emitted_path.clone());
        assert!(
            archive.contains(&emitted_path),
            "chart relationship target was not emitted: {emitted:?} -> {emitted_path}"
        );

        let source = source_rels
            .iter()
            .find(|relationship| relationship.rel_type == relationship_type)
            .unwrap_or_else(|| {
                panic!("source fixture lacks chart relationship type {relationship_type}")
            });
        let source_path = xlsx_parser::infra::opc::resolve_relationship_target(
            Some("xl/charts/chart1.xml"),
            &source.target,
        )
        .expect("source chart auxiliary target should resolve");
        assert_eq!(
            archive_bytes(bytes, &emitted_path),
            source_archive.read_file(&source_path).ok(),
            "chart auxiliary bytes changed for relationship type {relationship_type}: {emitted_path}"
        );
    }

    let image = chart_rels
        .iter()
        .find(|relationship| relationship.rel_type == xlsx_parser::infra::opc::REL_IMAGE)
        .expect("chart picture-fill image relationship should be present");
    let image_path = xlsx_parser::infra::opc::resolve_relationship_target(
        Some("xl/charts/chart1.xml"),
        &image.target,
    )
    .expect("emitted chart image target should resolve");
    expected_owned_paths.push(image_path.clone());
    assert!(archive.contains(&image_path), "{image:?} -> {image_path}");
    assert_eq!(
        archive_bytes(bytes, &image_path).as_deref(),
        Some(CHART_IMAGE),
        "chart picture-fill media bytes changed at {image_path}"
    );
    assert!(
        chart_xml.contains(&format!(r#"r:embed="{}""#, image.id)),
        "chart XML does not reference the emitted image relationship {image:?}: {chart_xml}"
    );
    for entry in archive.entries() {
        if entry.name.starts_with("xl/charts/") || entry.name.starts_with("xl/media/") {
            assert!(
                expected_owned_paths.iter().any(|path| path == &entry.name),
                "unexpected unowned chart/media part remained in the exported closure: {}",
                entry.name
            );
        }
    }
}

fn assert_chart_axis_topology(chart_xml: &str) {
    use std::collections::HashSet;

    let chart = xlsx_parser::domain::charts::Chart::parse(chart_xml.as_bytes());
    let defined_axis_ids: HashSet<u32> = chart
        .plot_area
        .axes_ordered
        .iter()
        .map(|axis| axis.ax_id)
        .collect();
    assert!(
        !defined_axis_ids.is_empty(),
        "chart should define at least one typed axis: {chart_xml}"
    );

    let mut group_reference_count = 0;
    if chart.chart_groups.is_empty() {
        for axis_id in &chart.chart_type_ax_ids {
            group_reference_count += 1;
            assert!(
                defined_axis_ids.contains(axis_id),
                "chart group axId {axis_id} has no matching axis definition: {chart_xml}"
            );
        }
    } else {
        for (group_index, group) in chart.chart_groups.iter().enumerate() {
            for axis_id in &group.ax_id {
                group_reference_count += 1;
                assert!(
                    defined_axis_ids.contains(axis_id),
                    "chart group {group_index} axId {axis_id} has no matching axis definition: {chart_xml}"
                );
            }
        }
    }
    assert!(
        group_reference_count > 0,
        "chart should contain typed group axId references: {chart_xml}"
    );

    for (axis_index, axis) in chart.plot_area.axes_ordered.iter().enumerate() {
        assert!(
            defined_axis_ids.contains(&axis.cross_ax),
            "axis {axis_index} crossAx {} has no matching axis definition: {chart_xml}",
            axis.cross_ax
        );
    }
}

#[test]
fn imported_chart_source_edit_refreshes_cache_and_keeps_owned_closure() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_imported_chart_source_edit_refreshes_cache_and_keeps_owned_closure)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_imported_chart_source_edit_refreshes_cache_and_keeps_owned_closure() {
    let (mut engine, sheet_id, _chart_id) = imported_engine();

    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "275")
        .expect("referenced source cell should be editable through the engine");
    engine
        .recalculate()
        .expect("edited workbook should recalculate");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("edited chart workbook should export");
    let chart_xml = archive_text(&exported, "xl/charts/chart1.xml").expect("chart XML");
    assert!(chart_xml.contains("<c:f>Data!B2:B4</c:f>"), "{chart_xml}");
    assert!(
        chart_xml.contains("<c:v>275</c:v>"),
        "source cache should contain the edited B2 value: {chart_xml}"
    );
    assert!(
        !chart_xml.contains("<c:v>100</c:v>"),
        "stale source cache: {chart_xml}"
    );
    assert_imported_chart_closure(&exported);

    let (reparsed, _) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("reparse edited chart workbook");
    let series = &reparsed.sheets[0].charts[0].series[0];
    let values = series
        .value_cache
        .as_ref()
        .expect("edited chart should carry a refreshed value cache")
        .points
        .iter()
        .map(|point| point.value.as_str())
        .collect::<Vec<_>>();
    assert_eq!(values, vec!["275", "125", "140"]);
}

#[test]
fn imported_literal_source_edit_refreshes_cache_without_recalculate() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_imported_literal_source_edit_refreshes_cache_without_recalculate)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_imported_literal_source_edit_refreshes_cache_without_recalculate() {
    let (mut engine, sheet_id, _chart_id) = imported_engine();

    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "315")
        .expect("referenced literal source cell should be editable through the engine");
    // The export itself must observe the source-cell mutation. There is no
    // explicit recalculate call in this lifecycle: the literal edit is the
    // only event between import and export.
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("edited chart workbook should export without an explicit recalc");
    let chart_xml = archive_text(&exported, "xl/charts/chart1.xml").expect("chart XML");
    assert!(chart_xml.contains("<c:f>Data!B2:B4</c:f>"), "{chart_xml}");
    assert!(
        chart_xml.contains("<c:v>315</c:v>"),
        "source cache should contain the edited B2 value: {chart_xml}"
    );
    assert!(
        !chart_xml.contains("<c:v>100</c:v>"),
        "stale source cache survived direct export: {chart_xml}"
    );
    assert_imported_chart_closure(&exported);

    let (reparsed, _) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("reparse edited chart workbook");
    let values = reparsed.sheets[0].charts[0].series[0]
        .value_cache
        .as_ref()
        .expect("direct export should carry a refreshed value cache")
        .points
        .iter()
        .map(|point| point.value.as_str())
        .collect::<Vec<_>>();
    assert_eq!(values, vec!["315", "125", "140"]);
}

#[test]
fn unrelated_edit_preserves_authored_broken_ref_chart_cache() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_unrelated_edit_preserves_authored_broken_ref_chart_cache)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_unrelated_edit_preserves_authored_broken_ref_chart_cache() {
    let (mut engine, sheet_id, _chart_id) =
        imported_engine_from_xlsx(broken_ref_chart_fixture_xlsx());

    engine
        .set_cell_value_parsed(&sheet_id, 0, 3, "unrelated edit")
        .expect("unrelated cell should be editable through the engine");
    // This fixture mirrors the manual-calculation/imported-cache case: no
    // recalc follows the unrelated edit, and the broken source has no
    // resolvable dependency that could justify rebuilding its authored cache.
    let exported = engine
        .export_to_xlsx_bytes()
        .expect("unrelated edit should export without recalculation");
    let workbook_xml = archive_text(&exported, "xl/workbook.xml").expect("workbook XML");
    assert!(
        workbook_xml.contains(r#"calcMode="manual""#),
        "{workbook_xml}"
    );

    let chart_xml = archive_text(&exported, "xl/charts/chart1.xml").expect("chart XML");
    assert!(chart_xml.contains("<c:f>Data!#REF!</c:f>"), "{chart_xml}");
    assert!(
        chart_xml.contains(
            r#"<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache>"#
        ),
        "authored broken-reference cache was dropped or rewritten: {chart_xml}"
    );
    assert_imported_chart_closure(&exported);
}

#[test]
fn edited_chart_title_and_series_preserve_metadata_and_media() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_edited_chart_title_and_series_preserve_metadata_and_media)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

#[test]
fn explicit_chart_title_edit_clears_imported_title_formula() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_explicit_chart_title_edit_clears_imported_title_formula)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_explicit_chart_title_edit_clears_imported_title_formula() {
    let (mut engine, sheet_id, chart_id) = imported_title_formula_engine();

    let imported = engine
        .export_to_xlsx_bytes()
        .expect("untouched formula-title chart should export");
    let imported_title = chart_title_xml(&imported).expect("imported chart should have a title");
    assert!(
        imported_title.contains("<c:f>Data!B1</c:f>"),
        "{imported_title}"
    );

    engine
        .update_chart(
            &sheet_id,
            &chart_id,
            &serde_json::json!({ "title": "Edited Revenue" }),
        )
        .expect("literal chart title should be editable through the engine");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("edited formula-title chart should export");
    let title_xml = chart_title_xml(&exported).expect("edited chart should have a title");
    assert!(title_xml.contains("Edited Revenue"), "{title_xml}");
    assert!(
        !title_xml.contains("<c:f>"),
        "literal title edit retained an imported title formula: {title_xml}"
    );
    assert_imported_chart_closure(&exported);
}

#[test]
fn explicit_chart_title_clear_clears_imported_title_formula() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_explicit_chart_title_clear_clears_imported_title_formula)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_explicit_chart_title_clear_clears_imported_title_formula() {
    let (mut engine, sheet_id, chart_id) = imported_title_formula_engine();
    engine
        .update_chart(&sheet_id, &chart_id, &serde_json::json!({ "title": null }))
        .expect("chart title should be clearable through the engine");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("cleared formula-title chart should export");
    if let Some(title_xml) = chart_title_xml(&exported) {
        assert!(
            !title_xml.contains("<c:f>"),
            "title clear retained an imported title formula: {title_xml}"
        );
    }
    assert_imported_chart_closure(&exported);
}

#[test]
fn explicit_chart_title_formula_update_preserves_caller_formula() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_explicit_chart_title_formula_update_preserves_caller_formula)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_explicit_chart_title_formula_update_preserves_caller_formula() {
    let (mut engine, sheet_id, chart_id) = imported_title_formula_engine();
    engine
        .update_chart(
            &sheet_id,
            &chart_id,
            &serde_json::json!({
                "title": "Profit",
                "titleFormula": "Data!C1"
            }),
        )
        .expect("explicit chart title formula should be accepted by the engine");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("explicit formula-title chart should export");
    let title_xml = chart_title_xml(&exported).expect("formula-title chart should have a title");
    assert!(title_xml.contains("<c:f>Data!C1</c:f>"), "{title_xml}");
    assert_imported_chart_closure(&exported);
}

fn assert_edited_chart_title_and_series_preserve_metadata_and_media() {
    let (mut engine, sheet_id, chart_id) = imported_engine();

    engine
        .update_chart(
            &sheet_id,
            &chart_id,
            &serde_json::json!({
                "title": "Edited Revenue",
                "series": [{
                    "name": "Profit",
                    "nameRef": "Data!C1",
                    "values": "Data!C2:C4",
                    "categories": "Data!A2:A4"
                }]
            }),
        )
        .expect("chart title and series should be editable through the engine");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("edited chart should export");
    let chart_xml = archive_text(&exported, "xl/charts/chart1.xml").expect("chart XML");
    assert!(chart_xml.contains("Edited Revenue"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!C2:C4</c:f>"), "{chart_xml}");
    assert_imported_chart_closure(&exported);

    let (reparsed, _) =
        xlsx_parser::parse_xlsx_to_output(&exported).expect("reparse edited chart workbook");
    let chart = &reparsed.sheets[0].charts[0];
    assert_eq!(chart.title.as_deref(), Some("Edited Revenue"));
    assert_eq!(chart.series.len(), 1);
    assert_eq!(chart.series[0].values.as_deref(), Some("C2:C4"));
}

#[test]
fn deleting_imported_chart_removes_its_owned_package_closure() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_deleting_imported_chart_removes_its_owned_package_closure)
        .expect("spawn chart lifecycle test")
        .join()
        .expect("chart lifecycle test");
}

fn assert_deleting_imported_chart_removes_its_owned_package_closure() {
    let (mut engine, sheet_id, chart_id) = imported_engine();
    engine
        .delete_chart(&sheet_id, &chart_id)
        .expect("imported chart should be deletable through the engine");
    assert!(engine.get_all_charts(&sheet_id).is_empty());

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("workbook after chart deletion should export");
    let archive =
        xlsx_parser::XlsxArchive::new(&exported).expect("XLSX archive should be readable");
    for path in [
        "xl/charts/chart1.xml",
        "xl/charts/_rels/chart1.xml.rels",
        "xl/drawings/drawing1.xml",
        "xl/drawings/_rels/drawing1.xml.rels",
    ] {
        assert!(
            !archive.contains(path),
            "deleted chart left owned part {path}"
        );
    }
    for entry in archive.entries() {
        assert!(
            !entry.name.starts_with("xl/charts/"),
            "deleted chart left chart-owned auxiliary part {}",
            entry.name
        );
        if entry.name.starts_with("xl/media/") {
            assert_ne!(
                archive.read_file(&entry.name).ok().as_deref(),
                Some(CHART_IMAGE),
                "deleted chart left its owned picture-fill media {}",
                entry.name
            );
        }
    }
}

fn chart_fixture_xlsx() -> Vec<u8> {
    chart_fixture_xlsx_with_chart_xml(chart_xml(), false)
}

fn title_formula_chart_fixture_xlsx() -> Vec<u8> {
    chart_fixture_xlsx_with_chart_xml(title_formula_chart_xml(), false)
}

fn broken_ref_chart_fixture_xlsx() -> Vec<u8> {
    chart_fixture_xlsx_with_chart_xml(broken_ref_chart_xml(), true)
}

fn chart_fixture_xlsx_with_chart_xml(chart_xml: String, manual_calculation: bool) -> Vec<u8> {
    let workbook_xml = if manual_calculation {
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <calcPr calcId="191029" calcMode="manual"/>
  <sheets><sheet name="Data" sheetId="1" r:id="rIdSheet1"/></sheets>
</workbook>"#
            .to_vec()
    } else {
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rIdSheet1"/></sheets>
</workbook>"#
            .to_vec()
    };
    let mut zip = ZipWriter::new();
    zip.add_file(
        "[Content_Types].xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/xl/charts/style1.xml" ContentType="application/vnd.ms-office.chartstyle+xml"/>
  <Override PartName="/xl/charts/colors1.xml" ContentType="application/vnd.ms-office.chartcolorstyle+xml"/>
</Types>"#
            .to_vec(),
    )
    .add_file(
        "_rels/.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/workbook.xml",
        workbook_xml,
    )
    .add_file(
        "xl/_rels/workbook.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdSheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/worksheets/sheet1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:C4"/>
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Quarter</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Revenue</t></is></c>
      <c r="C1" t="inlineStr"><is><t>Profit</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Q1</t></is></c><c r="B2"><v>100</v></c><c r="C2"><v>25</v></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Q2</t></is></c><c r="B3"><v>125</v></c><c r="C3"><v>35</v></c>
    </row>
    <row r="4">
      <c r="A4" t="inlineStr"><is><t>Q3</t></is></c><c r="B4"><v>140</v></c><c r="C4"><v>44</v></c>
    </row>
  </sheetData>
  <drawing r:id="rIdDrawing"/>
</worksheet>"#
            .to_vec(),
    )
    .add_file(
        "xl/worksheets/_rels/sheet1.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/drawings/drawing1.xml",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart"/></a:graphicData></a:graphic></xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>"#
            .to_vec(),
    )
    .add_file(
        "xl/drawings/_rels/drawing1.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file("xl/charts/chart1.xml", chart_xml.into_bytes())
    .add_file(
        "xl/charts/_rels/chart1.xml.rels",
        br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyle" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/>
  <Relationship Id="rIdColors" Type="http://schemas.microsoft.com/office/2011/relationships/chartColorStyle" Target="colors1.xml"/>
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart-fill.png"/>
</Relationships>"#
            .to_vec(),
    )
    .add_file(
        "xl/charts/style1.xml",
        br#"<cs:styleSheet xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><cs:styleEntry/></cs:styleSheet>"#
            .to_vec(),
    )
    .add_file(
        "xl/charts/colors1.xml",
        br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle"><a:schemeClr val="accent1"/><cs:variation/></cs:colorStyle>"#
            .to_vec(),
    )
    .add_file("xl/media/chart-fill.png", CHART_IMAGE.to_vec());
    zip.finish().expect("chart fixture ZIP should be writable")
}

fn chart_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Imported Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:tx><c:strRef><c:f>Data!B1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Data!A2:A4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q3</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Data!B2:B4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>100</c:v></c:pt><c:pt idx="1"><c:v>125</c:v></c:pt><c:pt idx="2"><c:v>140</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:ser>
          <c:idx val="1"/><c:order val="1"/>
          <c:tx><c:strRef><c:f>Data!C1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Profit</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Data!A2:A4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt><c:pt idx="2"><c:v>Q3</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Data!C2:C4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>25</c:v></c:pt><c:pt idx="1"><c:v>35</c:v></c:pt><c:pt idx="2"><c:v>44</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:axId val="10"/><c:axId val="20"/>
      </c:barChart>
      <c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
      <c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
    <c:extLst><c:ext uri="{7C5C7A8B-4F57-4C5A-A1A1-CHARTFUTURE}"><futureChartMetadata xmlns="urn:mog:future-chart" token="keep-me"/></c:ext></c:extLst>
  </c:chart>
  <c:spPr><a:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></c:spPr>
</c:chartSpace>"#
        .to_string()
}

fn title_formula_chart_xml() -> String {
    let mut xml = chart_xml();
    let title_start = xml
        .find("<c:title>")
        .expect("chart fixture should contain a title");
    let title_end = title_start
        + xml[title_start..]
            .find("</c:title>")
            .expect("chart fixture title should be closed")
        + "</c:title>".len();
    xml.replace_range(
        title_start..title_end,
        r#"<c:title><c:tx><c:strRef><c:f>Data!B1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx></c:title>"#,
    );
    xml
}

fn chart_title_xml(bytes: &[u8]) -> Option<String> {
    let chart_xml = archive_text(bytes, "xl/charts/chart1.xml").expect("chart XML");
    let title_start = chart_xml.find("<c:title>")?;
    let title_end = title_start + chart_xml[title_start..].find("</c:title>")? + "</c:title>".len();
    Some(chart_xml[title_start..title_end].to_string())
}

fn broken_ref_chart_xml() -> String {
    chart_xml().replace(
        r#"<c:f>Data!C2:C4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>25</c:v></c:pt><c:pt idx="1"><c:v>35</c:v></c:pt><c:pt idx="2"><c:v>44</c:v></c:pt></c:numCache>"#,
        r#"<c:f>Data!#REF!</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache>"#,
    )
}
