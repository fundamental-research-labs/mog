//! Production import/store/save coverage for workbook membership beyond editable sheets.
use super::super::*;
use super::helpers::{engine_from_parse_output_normal, simple_snapshot};
use domain_types::WorkbookSheetKind;
use xlsx_parser::write::ZipWriter;

pub(super) fn inventory_workbook() -> Vec<u8> {
    let mut zip = ZipWriter::new();
    let parts = [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet7.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet9.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/chartsheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/><Override PartName="/xl/dialogsheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="7" r:id="data"/><sheet name="Chart" sheetId="2" r:id="chart"/><sheet name="More" sheetId="9" r:id="more"/><sheet name="Dialog" sheetId="3" state="hidden" r:id="dialog"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet7.xml"/><Relationship Id="chart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/><Relationship Id="more" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet9.xml"/><Relationship Id="dialog" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet" Target="dialogsheets/sheet1.xml"/></Relationships>"#,
        ),
        (
            "xl/worksheets/sheet7.xml",
            r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>"#,
        ),
        (
            "xl/worksheets/sheet9.xml",
            r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>"#,
        ),
        (
            "xl/chartsheets/sheet1.xml",
            r#"<chartsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews></chartsheet>"#,
        ),
        (
            "xl/dialogsheets/sheet1.xml",
            r#"<dialogsheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>"#,
        ),
    ];
    for (name, xml) in parts {
        zip.add_file(name, xml.as_bytes().to_vec());
    }
    zip.finish().unwrap()
}

fn imported_engine() -> YrsComputeEngine {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    engine
        .import_from_xlsx_bytes(&inventory_workbook(), false)
        .unwrap();
    engine
}

fn assert_membership(engine: &YrsComputeEngine, expected: &[(&str, u32)]) {
    let bytes = engine.export_to_xlsx_bytes().expect("production save");
    let (reopened, _) = xlsx_parser::parse_xlsx_to_output(&bytes).expect("reopen saved workbook");
    let inventory = &reopened.workbook_sheet_inventory;
    assert_eq!(
        inventory
            .iter()
            .map(|entry| (entry.name.as_str(), entry.sheet_id.unwrap()))
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(
        inventory
            .iter()
            .filter(|entry| entry.kind == WorkbookSheetKind::Chartsheet)
            .count(),
        1
    );
    assert_eq!(
        inventory
            .iter()
            .filter(|entry| entry.kind == WorkbookSheetKind::Dialogsheet)
            .count(),
        1
    );
    assert_eq!(
        inventory
            .iter()
            .find(|entry| entry.name == "Dialog")
            .unwrap()
            .visibility,
        domain_types::SheetState::Hidden
    );
    // Valid package closure is insufficient: reopen must resolve every tab to
    // its part and attach each editable payload to the correct tab.
    assert!(
        inventory
            .iter()
            .all(|entry| entry.normalized_part_path.is_some())
    );
    for sheet in &reopened.sheets {
        if sheet.name == "Data" || sheet.name == "Renamed" {
            assert_eq!(
                sheet.cells[0].value,
                value_types::CellValue::Number(value_types::FiniteF64::new(7.0).unwrap())
            );
        } else if sheet.name == "More" {
            assert_eq!(
                sheet.cells[0].value,
                value_types::CellValue::Number(value_types::FiniteF64::new(9.0).unwrap())
            );
        }
    }
}

#[test]
fn workbook_sheet_inventory_survives_production_save_and_yrs_replay() {
    let engine = imported_engine();
    let (parsed, _) = xlsx_parser::parse_xlsx_to_output(&inventory_workbook()).unwrap();
    let normal_hydration = engine_from_parse_output_normal(&parsed);
    assert_membership(
        &normal_hydration,
        &[("Data", 7), ("Chart", 2), ("More", 9), ("Dialog", 3)],
    );
    let output = engine.export_to_parse_output().unwrap().parse_output;
    assert_eq!(
        output.parsed_workbook_sheet_indices,
        parsed.parsed_workbook_sheet_indices
    );
    assert_eq!(
        output.workbook_sheet_inventory[2].editable_sheet_index,
        Some(1)
    );
    assert_membership(
        &engine,
        &[("Data", 7), ("Chart", 2), ("More", 9), ("Dialog", 3)],
    );
    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let update = engine.encode_diff(&replayed.encode_state_vector()).unwrap();
    replayed.apply_sync_update_legacy(&update).unwrap();
    assert_membership(
        &replayed,
        &[("Data", 7), ("Chart", 2), ("More", 9), ("Dialog", 3)],
    );
}

#[test]
fn workbook_sheet_inventory_tracks_editable_lifecycle() {
    let mut engine = imported_engine();
    let ids = engine.stores.storage.sheet_order();
    engine.rename_compute_sheet(&ids[0], "Renamed").unwrap();
    engine
        .reorder_sheets(vec![ids[1].to_uuid_string(), ids[0].to_uuid_string()])
        .unwrap();
    assert_membership(
        &engine,
        &[("More", 9), ("Chart", 2), ("Renamed", 7), ("Dialog", 3)],
    );
    engine.delete_sheet(&ids[1]).unwrap();
    engine.create_default_sheet("Added").unwrap();
    assert!(
        engine
            .export_to_parse_output()
            .unwrap()
            .parse_output
            .parsed_workbook_sheet_indices
            .is_empty()
    );
    assert_membership(
        &engine,
        &[("Renamed", 7), ("Chart", 2), ("Dialog", 3), ("Added", 1)],
    );
}

fn imported_engine_with_indexed_metadata(active_tab: u32) -> YrsComputeEngine {
    let (mut output, _) = xlsx_parser::parse_xlsx_to_output(&inventory_workbook()).unwrap();
    output.workbook_views = vec![
        domain_types::domain::workbook::WorkbookView {
            active_tab,
            first_sheet: 2,
            ..Default::default()
        },
        domain_types::domain::workbook::WorkbookView {
            active_tab: 3,
            first_sheet: 1,
            ..Default::default()
        },
    ];
    output.named_ranges = vec![
        domain_types::NamedRange {
            name: "LocalValue".into(),
            refers_to: "More!$A$1".into(),
            local_sheet_id: Some(2),
            ..Default::default()
        },
        domain_types::NamedRange {
            name: "LocalValue".into(),
            refers_to: "42".into(),
            local_sheet_id: Some(1),
            ..Default::default()
        },
        domain_types::NamedRange {
            name: "_xlnm.Print_Area".into(),
            refers_to: "More!$A$1:$B$3".into(),
            local_sheet_id: Some(2),
            ..Default::default()
        },
    ];
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap();
    YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap().0
}

fn reopened_output(engine: &YrsComputeEngine) -> domain_types::ParseOutput {
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    xlsx_parser::parse_xlsx_to_output(&bytes).unwrap().0
}

#[test]
fn workbook_sheet_inventory_maps_named_scopes_print_areas_and_all_views() {
    let mut engine = imported_engine_with_indexed_metadata(2);
    let ids = engine.stores.storage.sheet_order();
    let settings = crate::storage::workbook::settings::get_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
    );
    assert_eq!(
        settings.selected_sheet_ids,
        Some(vec![ids[1].to_uuid_string()])
    );
    assert!(
        crate::storage::sheet::print::get_print_area(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            &ids[0],
        )
        .is_none()
    );
    assert!(
        crate::storage::sheet::print::get_print_area(
            engine.stores.storage.doc(),
            engine.stores.storage.sheets(),
            &ids[1],
        )
        .is_some()
    );
    let before = reopened_output(&engine);
    assert_eq!(before.workbook_views[0].active_tab, 2);
    assert_eq!(before.workbook_views[0].first_sheet, 2);
    assert_eq!(before.workbook_views[1].active_tab, 3);
    assert_eq!(before.workbook_views[1].first_sheet, 1);
    assert!(
        before
            .named_ranges
            .iter()
            .any(|name| name.name == "LocalValue" && name.local_sheet_id == Some(2))
    );
    assert!(
        before
            .named_ranges
            .iter()
            .any(|name| name.name == "LocalValue"
                && name.local_sheet_id == Some(1)
                && name.refers_to == "42")
    );
    engine
        .reorder_sheets(vec![ids[1].to_uuid_string(), ids[0].to_uuid_string()])
        .unwrap();
    let reordered = reopened_output(&engine);
    assert_eq!(reordered.workbook_views[0].active_tab, 0);
    assert_eq!(reordered.workbook_views[0].first_sheet, 0);
    assert!(
        reordered
            .named_ranges
            .iter()
            .any(|name| name.name == "LocalValue" && name.local_sheet_id == Some(0))
    );
    assert!(
        reordered
            .named_ranges
            .iter()
            .any(|name| name.name == "_xlnm.Print_Area" && name.local_sheet_id == Some(0))
    );
    engine.delete_sheet(&ids[1]).unwrap();
    let deleted = reopened_output(&engine);
    assert_eq!(deleted.workbook_views[1].active_tab, 2);
    assert!(
        !deleted
            .named_ranges
            .iter()
            .any(|name| name.name == "LocalValue" && name.local_sheet_id != Some(1))
    );
    assert!(
        !deleted
            .named_ranges
            .iter()
            .any(|name| name.name == "_xlnm.Print_Area")
    );
}

#[test]
fn workbook_sheet_inventory_keeps_inert_active_tab_and_names_through_yrs_replay() {
    let engine = imported_engine_with_indexed_metadata(1);
    assert_eq!(reopened_output(&engine).workbook_views[0].active_tab, 1);
    let (mut replayed, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).unwrap();
    let update = engine.encode_diff(&replayed.encode_state_vector()).unwrap();
    replayed.apply_sync_update_legacy(&update).unwrap();
    let output = reopened_output(&replayed);
    assert_eq!(output.workbook_views[0].active_tab, 1);
    assert!(
        output
            .named_ranges
            .iter()
            .any(|name| name.name == "LocalValue"
                && name.local_sheet_id == Some(1)
                && name.refers_to == "42")
    );
}

#[test]
fn workbook_sheet_inventory_preserves_compact_selected_parse_mapping() {
    let bytes = inventory_workbook();
    let metadata = xlsx_parser::parse_deferred_workbook_metadata(&bytes).unwrap();
    let (selected, _) =
        xlsx_parser::parse_xlsx_to_output_selected_workbook_sheets(&bytes, &[2], &metadata)
            .unwrap();
    assert_eq!(selected.sheets.len(), 1);
    assert_eq!(selected.sheets[0].name, "More");
    let engine = engine_from_parse_output_normal(&selected);
    let output = engine.export_to_parse_output().unwrap().parse_output;
    assert_eq!(
        output.parsed_workbook_sheet_indices,
        [2].into_iter().collect()
    );
    assert_eq!(output.workbook_sheet_inventory.len(), 4);
    assert_eq!(
        output.workbook_sheet_inventory[0].editable_sheet_index,
        None
    );
    assert_eq!(
        output.workbook_sheet_inventory[2].editable_sheet_index,
        Some(0)
    );
    assert_eq!(output.sheets[0].name, "More");
}
