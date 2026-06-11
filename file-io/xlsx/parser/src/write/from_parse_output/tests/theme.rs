use super::*;

fn output_with_theme(theme: domain_types::ThemeData) -> ParseOutput {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.theme = Some(theme);
    output
}

fn matching_theme() -> domain_types::ThemeData {
    domain_types::ThemeData {
        name: Some("Office Theme".to_string()),
        colors: Vec::new(),
        major_font: None,
        minor_font: None,
        ..Default::default()
    }
}

fn exported_theme_xml(output: &ParseOutput) -> String {
    let bytes = write_xlsx_from_parse_output(output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    String::from_utf8(archive.read_file("xl/theme/theme1.xml").unwrap()).unwrap()
}

#[test]
fn modeled_export_without_theme_emits_default_office_theme() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let theme_xml = String::from_utf8(archive.read_file("xl/theme/theme1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/theme/theme1.xml"));
    assert!(
        content_types.contains(
            r#"PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml""#
        ),
        "{content_types}"
    );
    assert!(
        workbook_rels.contains(
            r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme""#
        ),
        "{workbook_rels}"
    );
    assert!(theme_xml.contains(r#"<a:clrScheme name="Office">"#));
    assert!(theme_xml.contains(r#"<a:srgbClr val="4472C4"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn theme_roundtrip_context_does_not_preserve_raw_sidecars() {
    let output = output_with_theme(matching_theme());

    let theme_xml = exported_theme_xml(&output);

    assert!(!theme_xml.contains("vendor:objectDefaultsMarker"));
    assert!(!theme_xml.contains("vendor:extraColorMarker"));
    assert!(!theme_xml.contains("vendor:themeExtMarker"));
}

#[test]
fn mutated_modeled_theme_drops_raw_sidecars() {
    let mut theme = matching_theme();
    theme.major_font = Some("Aptos Display".to_string());
    let output = output_with_theme(theme);

    let theme_xml = exported_theme_xml(&output);

    assert!(theme_xml.contains("typeface=\"Aptos Display\""));
    assert!(!theme_xml.contains("vendor:objectDefaultsMarker"));
    assert!(!theme_xml.contains("vendor:extraColorMarker"));
    assert!(!theme_xml.contains("vendor:themeExtMarker"));
}
