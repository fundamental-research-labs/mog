use crate::domain::styles::write::{
    CellStyleDef, ColorsDef, DxfDef, FontDef, StyleRootNamespaces, StylesWriter, TableStyleDef,
};

use super::fixtures::{assert_contains_all, assert_in_order, xml_string};

#[test]
fn test_ooxml_element_order() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_num_fmt("#,##0");
    writer.cell_styles = vec![CellStyleDef {
        name: Some("Normal".to_string()),
        xf_id: 0,
        builtin_id: Some(0),
        custom_builtin: None,
        i_level: None,
        hidden: None,
        ext_lst: None,
        xr_uid: None,
    }];
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            bold: Some(true),
            ..FontDef::default()
        }),
        ..DxfDef::default()
    }];
    writer.table_styles = vec![TableStyleDef {
        name: "T1".to_string(),
        pivot: Some(false),
        table: Some(true),
        count: Some(0),
        elements: vec![],
        ..Default::default()
    }];
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });

    let xml = xml_string(&writer);

    assert_in_order(
        &xml,
        &[
            "<numFmts",
            "<fonts",
            "<fills",
            "<borders",
            "<cellStyleXfs",
            "<cellXfs",
            "<cellStyles",
            "<dxfs",
            "<tableStyles",
            "<colors>",
        ],
    );
}

#[test]
fn stylesheet_root_declaration_namespace_and_attribute_order_are_stable() {
    let mut writer = StylesWriter::with_defaults();
    writer.root_namespaces = StyleRootNamespaces::from_attrs(vec![
        (
            "".to_string(),
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main".to_string(),
        ),
        ("xr".to_string(), "urn:xr".to_string()),
        ("foo".to_string(), "urn:foo".to_string()),
        (
            "mc".to_string(),
            "http://schemas.openxmlformats.org/markup-compatibility/2006".to_string(),
        ),
    ]);

    let xml = xml_string(&writer);
    assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
    assert_contains_all(
        &xml,
        &[
            "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"",
            "xmlns:xr=\"urn:xr\"",
            "xmlns:foo=\"urn:foo\"",
            "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\"",
            "mc:Ignorable=\"xr\"",
        ],
    );
    assert!(!xml.contains("mc:Ignorable=\"foo\""));
    assert!(!xml.contains("mc:Ignorable=\"xr foo\""));
    assert_in_order(
        &xml,
        &["xmlns:xr=\"urn:xr\"", "xmlns:foo=\"urn:foo\"", "xmlns:mc="],
    );
}

#[test]
fn known_fonts_suppresses_duplicate_x14ac_namespace_and_deduplicates_ignorable() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = true;
    writer.root_namespaces = StyleRootNamespaces::from_attrs(vec![(
        "x14ac".to_string(),
        "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac".to_string(),
    )]);

    let xml = xml_string(&writer);
    assert_eq!(xml.matches("xmlns:x14ac=").count(), 1);
    assert!(xml.contains("mc:Ignorable=\"x14ac\""));
    assert!(!xml.contains("mc:Ignorable=\"x14ac x14ac\""));
}

#[test]
fn unsupported_root_ext_lst_raw_is_not_replayed() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });
    writer.ext_lst_raw = Some(b"<extLst><ext uri=\"root\"/></extLst>".to_vec());

    let xml = xml_string(&writer);
    assert!(xml.contains("<colors>"));
    assert!(!xml.contains("<extLst>"));
}

#[test]
fn root_ext_lst_raw_with_relationship_attribute_is_filtered() {
    let mut writer = StylesWriter::with_defaults();
    writer.ext_lst_raw = Some(b"<extLst><ext r:id=\"rId1\"/></extLst>".to_vec());

    let xml = xml_string(&writer);
    assert!(!xml.contains("r:id=\"rId1\""));
}
