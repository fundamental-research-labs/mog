use super::helpers::{archive_text, engine_from_parse_output_normal};
use domain_types::{ParseOutput, SheetData};

const IMPORTED_CONNECTIONS_XML: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?><connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr16" xmlns:xr16="http://schemas.microsoft.com/office/spreadsheetml/2017/revision16"><connection id="1" xr16:uid="{CONNECTION-1}" name="test" type="5"><dbPr connection="Provider=ACE"/></connection></connections>"#;

#[test]
fn imported_connections_survive_yrs_hydration_and_xlsx_export() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        connections: xlsx_parser::domain::connections::parse_connections_xml(
            IMPORTED_CONNECTIONS_XML,
        ),
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&output);
    let exported = engine
        .export_to_parse_output()
        .expect("export parse output")
        .parse_output;
    assert_eq!(
        exported.connections.raw_xml.as_deref(),
        std::str::from_utf8(IMPORTED_CONNECTIONS_XML).ok()
    );

    let bytes = engine.export_to_xlsx_bytes().expect("export xlsx");
    assert_eq!(
        archive_text(&bytes, "xl/connections.xml").as_deref(),
        std::str::from_utf8(IMPORTED_CONNECTIONS_XML).ok()
    );
}
