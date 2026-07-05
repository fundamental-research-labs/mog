use std::fs;
use std::path::Path;

use domain_types::domain::floating_object::FloatingObjectData;
use xlsx_parser::domain::workbook::read::parse_all_rels;
use xlsx_parser::infra::opc::{REL_CTRL_PROP, REL_VML_DRAWING};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

const CONTROL_FIXTURES: &[&str] = &[
    "control-button.xlsx",
    "control-checkbox.xlsx",
    "control-dropdown.xlsx",
    "control-listbox.xlsx",
    "control-radio.xlsx",
    "control-spinner.xlsx",
];

#[test]
fn imported_vml_form_control_fixtures_export_modeled_package_closure() {
    for fixture_name in CONTROL_FIXTURES {
        assert_imported_form_control_fixture_exports_modeled_package_closure(fixture_name);
    }
}

#[test]
fn scrollbar_parity_fixture_without_control_parts_exports_cleanly() {
    let fixture_name = "control-scrollbar.xlsx";
    let fixture_bytes = read_control_fixture(fixture_name);
    let (parsed, _diagnostics) =
        parse_xlsx_to_output(&fixture_bytes).expect("scrollbar fixture should parse");
    assert_eq!(
        form_control_count(&parsed),
        0,
        "{fixture_name} is a conditional-formatting approximation, not a form-control package fixture"
    );

    let exported = write_xlsx_from_parse_output(&parsed)
        .expect("non-control scrollbar approximation should still export");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn assert_imported_form_control_fixture_exports_modeled_package_closure(fixture_name: &str) {
    let fixture_bytes = read_control_fixture(fixture_name);
    let (parsed, diagnostics) =
        parse_xlsx_to_output(&fixture_bytes).expect("control fixture should parse to ParseOutput");
    let imported_count = form_control_count(&parsed);
    assert!(
        imported_count > 0,
        "{fixture_name} should import at least one modeled form control"
    );
    assert_no_form_control_drop_diagnostics(fixture_name, &diagnostics);

    let exported =
        write_xlsx_from_parse_output(&parsed).expect("control fixture export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");

    let worksheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    assert!(
        worksheet_xml.contains("<controls"),
        "{fixture_name} should export worksheet controls XML: {worksheet_xml}"
    );
    assert_eq!(
        ctrl_prop_part_count(&archive),
        imported_count,
        "{fixture_name} should emit one ctrlProp part per modeled form control"
    );

    let worksheet_rels = parse_all_rels(
        &archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    );
    assert!(
        worksheet_rels
            .iter()
            .filter(|rel| rel.rel_type == REL_CTRL_PROP)
            .count()
            >= imported_count,
        "{fixture_name} should export worksheet ctrlProp relationships: {worksheet_rels:?}"
    );
    assert!(
        worksheet_rels
            .iter()
            .any(|rel| rel.rel_type == REL_VML_DRAWING),
        "{fixture_name} should export a VML drawing relationship for legacy form-control rendering: {worksheet_rels:?}"
    );

    let (roundtripped, roundtrip_diagnostics) =
        parse_xlsx_to_output(&exported).expect("exported control XLSX should parse back");
    assert_eq!(
        form_control_count(&roundtripped),
        imported_count,
        "{fixture_name} should preserve modeled form-control count through parse-export-parse"
    );
    assert_no_form_control_drop_diagnostics(fixture_name, &roundtrip_diagnostics);
}

fn read_control_fixture(fixture_name: &str) -> Vec<u8> {
    let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("test-corpus/parity/controls")
        .join(fixture_name);
    fs::read(&fixture_path).unwrap_or_else(|err| {
        panic!(
            "fixture {} should be readable: {err}",
            fixture_path.display()
        )
    })
}

fn form_control_count(output: &domain_types::ParseOutput) -> usize {
    output
        .sheets
        .iter()
        .flat_map(|sheet| &sheet.floating_objects)
        .filter(|object| matches!(object.data, FloatingObjectData::FormControl(_)))
        .count()
}

fn ctrl_prop_part_count(archive: &XlsxArchive<'_>) -> usize {
    archive
        .entries()
        .iter()
        .filter(|entry| {
            entry.name.starts_with("xl/ctrlProps/ctrlProp") && entry.name.ends_with(".xml")
        })
        .count()
}

fn assert_no_form_control_drop_diagnostics(
    fixture_name: &str,
    diagnostics: &domain_types::ParseDiagnostics,
) {
    assert!(
        diagnostics.errors.iter().all(|error| {
            !(error.message.contains("Dropped XLSX import data")
                && error.message.contains("form-control"))
        }),
        "{fixture_name} must not report modeled form-control VML as dropped: {:?}",
        diagnostics.errors
    );
}
