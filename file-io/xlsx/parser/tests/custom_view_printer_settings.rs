use domain_types::ParseOutput;
use xlsx_parser::{parse_xlsx_to_output, write::write_xlsx_from_parse_output, zip::XlsxArchive};

fn source() -> ParseOutput {
    parse_xlsx_to_output(include_bytes!("data/custom-view-printer-settings.xlsx"))
        .unwrap()
        .0
}
fn xml(bytes: &[u8], sheet: usize) -> String {
    String::from_utf8(
        XlsxArchive::new(bytes)
            .unwrap()
            .read_file(&format!("xl/worksheets/sheet{sheet}.xml"))
            .unwrap(),
    )
    .unwrap()
}
fn assert_roundtrip(output: &ParseOutput) -> ParseOutput {
    let bytes = write_xlsx_from_parse_output(output).expect("custom views must export");
    parse_xlsx_to_output(&bytes).expect("output must reopen").0
}

#[test]
fn main_page_setup_is_not_taken_from_a_custom_view() {
    let parsed = source();
    let main = parsed.sheets[0].print_settings.as_ref().unwrap();
    assert_eq!(main.paper_size, Some(9));
    assert_eq!(main.orientation.as_deref(), Some("portrait"));
    assert_eq!(main.r_id.as_deref(), Some("rId3"));
    let reopened = assert_roundtrip(&parsed);
    assert_eq!(
        reopened.sheets[0].print_settings,
        parsed.sheets[0].print_settings
    );
    assert_eq!(
        reopened.sheets[0].worksheet_semantic_containers,
        parsed.sheets[0].worksheet_semantic_containers
    );
    let metadata = reopened.package_fidelity.as_ref().unwrap();
    for n in 1..=3 {
        let part = metadata
            .opaque_parts
            .iter()
            .find(|p| p.path == format!("xl/printerSettings/printerSettings{n}.bin"))
            .unwrap();
        assert_eq!(part.bytes, vec![n as u8; 220]);
    }
}

#[test]
fn main_printer_settings_roundtrip_without_custom_views() {
    let mut parsed = source();
    parsed.sheets[0]
        .worksheet_semantic_containers
        .custom_sheet_views = None;
    let reopened = assert_roundtrip(&parsed);
    assert_eq!(
        reopened.sheets[0].print_settings,
        parsed.sheets[0].print_settings
    );
    assert!(
        reopened.sheets[0]
            .worksheet_semantic_containers
            .custom_sheet_views
            .is_none()
    );
}

#[test]
fn custom_views_keep_their_printer_targets_after_sheet_reorder_and_copy() {
    let mut parsed = source();
    let copy = parsed.sheets[0].clone();
    parsed.sheets.swap(0, 1);
    let mut copy = copy;
    copy.name = "Copy".into();
    copy.sheet_id = None;
    parsed.sheets.push(copy);
    // Rebuild the workbook inventory for this deliberately changed sheet list.
    parsed.workbook_sheet_inventory.clear();
    parsed.parsed_workbook_sheet_indices.clear();
    let reopened = assert_roundtrip(&parsed);
    for index in [1, 2] {
        assert_eq!(
            reopened.sheets[index]
                .worksheet_semantic_containers
                .custom_sheet_view_printer_settings,
            parsed.sheets[index]
                .worksheet_semantic_containers
                .custom_sheet_view_printer_settings
        );
        assert_eq!(
            reopened.sheets[index]
                .print_settings
                .as_ref()
                .unwrap()
                .paper_size,
            Some(9)
        );
    }
}

#[test]
fn stale_main_printer_settings_do_not_remove_custom_view_attachments() {
    let mut parsed = source();
    parsed.sheets[0].print_settings.as_mut().unwrap().paper_size = Some(5);
    let reopened = assert_roundtrip(&parsed);
    assert_eq!(
        reopened.sheets[0]
            .print_settings
            .as_ref()
            .unwrap()
            .paper_size,
        Some(5)
    );
    assert!(
        reopened.sheets[0]
            .print_settings
            .as_ref()
            .unwrap()
            .r_id
            .is_none()
    );
    assert_eq!(
        reopened.sheets[0]
            .worksheet_semantic_containers
            .custom_sheet_view_printer_settings
            .len(),
        2
    );
}

#[test]
fn custom_views_work_without_main_page_setup() {
    let mut parsed = source();
    parsed.sheets[0].print_settings = None;
    let bytes = write_xlsx_from_parse_output(&parsed).unwrap();
    let reopened = parse_xlsx_to_output(&bytes).unwrap().0;
    assert!(
        reopened.sheets[0]
            .print_settings
            .as_ref()
            .is_none_or(|p| !p.has_page_setup)
    );
    assert_eq!(
        reopened.sheets[0]
            .worksheet_semantic_containers
            .custom_sheet_view_printer_settings
            .len(),
        2
    );
    assert_eq!(xml(&bytes, 1).matches("<pageSetup").count(), 2);
}

#[test]
fn missing_custom_view_payload_fails_instead_of_silently_dropping_views() {
    let mut parsed = source();
    parsed
        .package_fidelity
        .as_mut()
        .unwrap()
        .opaque_parts
        .retain(|p| p.path != "xl/printerSettings/printerSettings2.bin");
    let err = write_xlsx_from_parse_output(&parsed)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("custom sheet view") && err.contains("rId2"),
        "{err}"
    );
}

#[test]
fn shared_custom_view_printer_target_remaps_all_xml_references() {
    let mut parsed = source();
    parsed.sheets[0]
        .worksheet_semantic_containers
        .custom_sheet_view_printer_settings
        .insert(
            "rId2".into(),
            "xl/printerSettings/printerSettings1.bin".into(),
        );
    let reopened = assert_roundtrip(&parsed);
    let containers = &reopened.sheets[0].worksheet_semantic_containers;
    assert_eq!(containers.custom_sheet_view_printer_settings.len(), 1);
    assert!(
        containers
            .custom_sheet_view_printer_settings
            .values()
            .all(|p| p == "xl/printerSettings/printerSettings1.bin")
    );
    assert_eq!(
        reopened.sheets[0]
            .print_settings
            .as_ref()
            .unwrap()
            .paper_size,
        Some(9)
    );
}
