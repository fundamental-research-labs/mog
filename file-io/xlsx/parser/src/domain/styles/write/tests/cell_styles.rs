use crate::domain::styles::write::{CellStyleDef, StylesWriter};

use super::fixtures::{assert_contains_all, xml_string};

#[test]
fn test_write_cell_styles() {
    let mut writer = StylesWriter::with_defaults();
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
    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "<cellStyles count=\"1\">",
            "name=\"Normal\"",
            "xfId=\"0\"",
            "builtinId=\"0\"",
        ],
    );
}

#[test]
fn test_write_cell_styles_custom_builtin() {
    let mut writer = StylesWriter::with_defaults();
    writer.cell_styles = vec![CellStyleDef {
        name: Some("MyCustom".to_string()),
        xf_id: 1,
        builtin_id: None,
        custom_builtin: Some(true),
        i_level: None,
        hidden: None,
        ext_lst: None,
        xr_uid: None,
    }];
    let xml = xml_string(&writer);
    assert!(xml.contains("customBuiltin=\"1\""));
    assert!(!xml.contains("builtinId"));
}

#[test]
fn cell_style_optional_attributes_and_false_custom_builtin() {
    let mut writer = StylesWriter::with_defaults();
    writer.cell_styles = vec![CellStyleDef {
        name: Some("Outline".to_string()),
        xf_id: 2,
        builtin_id: Some(3),
        custom_builtin: Some(false),
        i_level: Some(1),
        hidden: Some(true),
        ext_lst: None,
        xr_uid: Some("{uid}".to_string()),
    }];

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "name=\"Outline\"",
            "xfId=\"2\"",
            "builtinId=\"3\"",
            "iLevel=\"1\"",
            "hidden=\"1\"",
            "xr:uid=\"{uid}\"",
        ],
    );
    assert!(!xml.contains("customBuiltin=\"0\""));
}

#[test]
fn default_normal_cell_style_is_synthesized_when_empty() {
    let writer = StylesWriter::with_defaults();
    let xml = xml_string(&writer);

    assert!(xml.contains("<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>"));
}
