use crate::domain::styles::write::{
    AlignmentDef, CellXfDef, HorizontalAlign, ProtectionDef, StylesWriter, VerticalAlign,
};
use ooxml_types::ExtensionList;

use super::fixtures::{assert_contains_all, assert_in_order, xml_string};

#[test]
fn test_add_cell_xf() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        ..Default::default()
    };

    let id = writer.add_cell_xf(xf);
    assert_eq!(id, 1);
}

#[test]
fn test_to_xml_with_alignment() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            vertical: Some(VerticalAlign::Center),
            wrap_text: Some(true),
            ..Default::default()
        }),
        apply_alignment: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "applyAlignment=\"1\"",
            "<alignment",
            "horizontal=\"center\"",
            "vertical=\"center\"",
            "wrapText=\"1\"",
        ],
    );
}

#[test]
fn test_to_xml_with_protection() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        protection: Some(ProtectionDef {
            locked: Some(true),
            hidden: Some(true),
        }),
        apply_protection: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "applyProtection=\"1\"",
            "<protection",
            "locked=\"1\"",
            "hidden=\"1\"",
        ],
    );
}

#[test]
fn test_horizontal_align_values() {
    assert_eq!(HorizontalAlign::General.to_ooxml(), "general");
    assert_eq!(HorizontalAlign::Left.to_ooxml(), "left");
    assert_eq!(HorizontalAlign::Center.to_ooxml(), "center");
    assert_eq!(HorizontalAlign::Right.to_ooxml(), "right");
    assert_eq!(HorizontalAlign::Fill.to_ooxml(), "fill");
    assert_eq!(HorizontalAlign::Justify.to_ooxml(), "justify");
    assert_eq!(
        HorizontalAlign::CenterContinuous.to_ooxml(),
        "centerContinuous"
    );
    assert_eq!(HorizontalAlign::Distributed.to_ooxml(), "distributed");
}

#[test]
fn test_vertical_align_values() {
    assert_eq!(VerticalAlign::Top.to_ooxml(), "top");
    assert_eq!(VerticalAlign::Center.to_ooxml(), "center");
    assert_eq!(VerticalAlign::Bottom.to_ooxml(), "bottom");
    assert_eq!(VerticalAlign::Justify.to_ooxml(), "justify");
    assert_eq!(VerticalAlign::Distributed.to_ooxml(), "distributed");
}

#[test]
fn xf_apply_false_quote_prefix_pivot_button_and_child_order() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_cell_xf(CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        quote_prefix: true,
        pivot_button: true,
        apply_number_format: Some(false),
        apply_font: Some(false),
        apply_fill: Some(false),
        apply_border: Some(false),
        apply_alignment: Some(false),
        apply_protection: Some(false),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Right),
            ..Default::default()
        }),
        protection: Some(ProtectionDef {
            locked: Some(false),
            hidden: Some(false),
        }),
        ext_lst: Some(ExtensionList {
            raw_xml: Some("<extLst><ext uri=\"xf\"/></extLst>".to_string()),
        }),
    });

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "quotePrefix=\"1\"",
            "pivotButton=\"1\"",
            "applyNumberFormat=\"0\"",
            "applyFont=\"0\"",
            "applyFill=\"0\"",
            "applyBorder=\"0\"",
            "applyAlignment=\"0\"",
            "applyProtection=\"0\"",
            "locked=\"0\"",
            "hidden=\"0\"",
        ],
    );
    assert_in_order(
        &xml,
        &[
            "<alignment horizontal=\"right\"/>",
            "<protection locked=\"0\" hidden=\"0\"/>",
            "<extLst><ext uri=\"xf\"/></extLst>",
        ],
    );
}

#[test]
fn xf_raw_ext_lst_with_relationship_attribute_is_filtered() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_cell_xf(CellXfDef {
        ext_lst: Some(ExtensionList {
            raw_xml: Some("<extLst><ext r:id=\"rId1\"/></extLst>".to_string()),
        }),
        ..Default::default()
    });

    let xml = xml_string(&writer);
    assert!(!xml.contains("r:id=\"rId1\""));
}
