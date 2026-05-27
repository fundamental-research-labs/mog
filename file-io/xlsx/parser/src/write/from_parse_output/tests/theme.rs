use super::*;

fn output_with_theme(theme: domain_types::ThemeData) -> ParseOutput {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.theme = Some(theme);
    output
}

fn theme_round_trip_context() -> domain_types::RoundTripContext {
    domain_types::RoundTripContext {
        theme_name: Some("Office Theme".to_string()),
        theme_object_defaults_xml: Some(b"<vendor:objectDefaultsMarker/>".to_vec()),
        theme_extra_clr_scheme_lst_xml: Some(b"<vendor:extraColorMarker/>".to_vec()),
        theme_ext_lst_xml: Some(
            br#"<a:extLst><a:ext uri="{vendor-theme}"><vendor:themeExtMarker/></a:ext></a:extLst>"#
                .to_vec(),
        ),
        ..Default::default()
    }
}

fn matching_theme() -> domain_types::ThemeData {
    domain_types::ThemeData {
        name: Some("Office Theme".to_string()),
        colors: Vec::new(),
        major_font: None,
        minor_font: None,
    }
}

fn exported_theme_xml(output: &ParseOutput, ctx: &domain_types::RoundTripContext) -> String {
    let bytes = write_xlsx_from_parse_output(output, Some(ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    String::from_utf8(archive.read_file("xl/theme/theme1.xml").unwrap()).unwrap()
}

#[test]
fn clean_imported_theme_preserves_raw_sidecars() {
    let ctx = theme_round_trip_context();
    let output = output_with_theme(matching_theme());

    let theme_xml = exported_theme_xml(&output, &ctx);

    assert!(theme_xml.contains("vendor:objectDefaultsMarker"));
    assert!(theme_xml.contains("vendor:extraColorMarker"));
    assert!(theme_xml.contains("vendor:themeExtMarker"));
}

#[test]
fn mutated_modeled_theme_drops_raw_sidecars() {
    let ctx = theme_round_trip_context();
    let mut theme = matching_theme();
    theme.major_font = Some("Aptos Display".to_string());
    let output = output_with_theme(theme);

    let theme_xml = exported_theme_xml(&output, &ctx);

    assert!(theme_xml.contains("typeface=\"Aptos Display\""));
    assert!(!theme_xml.contains("vendor:objectDefaultsMarker"));
    assert!(!theme_xml.contains("vendor:extraColorMarker"));
    assert!(!theme_xml.contains("vendor:themeExtMarker"));
}
