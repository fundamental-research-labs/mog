use crate::domain::styles::write::{
    StylesWriter, TableStyleDef, TableStyleElementDef, TableStyleType,
};

use super::fixtures::{assert_contains_all, assert_in_order, xml_string};

#[test]
fn test_write_table_styles() {
    let mut writer = StylesWriter::with_defaults();
    writer.default_table_style = Some("TableStyleMedium2".to_string());
    writer.table_styles = vec![TableStyleDef {
        name: "Custom".to_string(),
        pivot: Some(false),
        table: Some(true),
        count: Some(1),
        elements: vec![TableStyleElementDef {
            style_type: TableStyleType::WholeTable,
            dxf_id: Some(0),
            size: None,
        }],
        ..Default::default()
    }];
    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "defaultTableStyle=\"TableStyleMedium2\"",
            "<tableStyle name=\"Custom\"",
            "type=\"wholeTable\"",
        ],
    );
}

#[test]
fn test_write_table_styles_with_pivot_and_size() {
    let mut writer = StylesWriter::with_defaults();
    writer.default_pivot_style = Some("PivotStyleLight16".to_string());
    writer.table_styles = vec![TableStyleDef {
        name: "PivotStyle".to_string(),
        pivot: Some(true),
        table: Some(true),
        count: Some(2),
        elements: vec![
            TableStyleElementDef {
                style_type: TableStyleType::HeaderRow,
                dxf_id: Some(0),
                size: None,
            },
            TableStyleElementDef {
                style_type: TableStyleType::FirstRowStripe,
                dxf_id: Some(1),
                size: Some(2),
            },
        ],
        ..Default::default()
    }];
    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "defaultPivotStyle=\"PivotStyleLight16\"",
            "pivot=\"1\"",
            "type=\"headerRow\"",
            "size=\"2\"",
        ],
    );
}

#[test]
fn default_table_styles_is_self_closing_with_default_names() {
    let writer = StylesWriter::with_defaults();
    let xml = xml_string(&writer);

    assert!(xml.contains("<tableStyles count=\"0\" defaultTableStyle=\"TableStyleMedium2\" defaultPivotStyle=\"PivotStyleLight16\"/>"));
}

#[test]
fn table_style_attributes_and_element_order_are_stable() {
    let mut writer = StylesWriter::with_defaults();
    writer.table_styles = vec![TableStyleDef {
        name: "Custom".to_string(),
        pivot: Some(false),
        table: Some(false),
        count: Some(2),
        xr_uid: Some("{table-uid}".to_string()),
        elements: vec![
            TableStyleElementDef {
                style_type: TableStyleType::WholeTable,
                dxf_id: Some(3),
                size: None,
            },
            TableStyleElementDef {
                style_type: TableStyleType::LastColumn,
                dxf_id: Some(4),
                size: Some(5),
            },
        ],
    }];

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "table=\"0\"",
            "count=\"2\"",
            "xr9:uid=\"{table-uid}\"",
            "type=\"wholeTable\" dxfId=\"3\"",
            "type=\"lastColumn\" dxfId=\"4\" size=\"5\"",
        ],
    );
    assert_in_order(
        &xml,
        &[
            "<tableStyle name=\"Custom\"",
            "type=\"wholeTable\"",
            "type=\"lastColumn\"",
        ],
    );
}
