use crate::domain::styles::write::{
    AlignmentDef, BorderDef, DxfDef, FillDef, FontDef, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, ProtectionDef, StylesWriter, UnderlineStyle, VerticalAlignRun,
};

use super::fixtures::{assert_contains_all, assert_in_order, solid_fill, thin_side, xml_string};

#[test]
fn test_write_dxfs_font_only() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            bold: Some(true),
            ..FontDef::default()
        }),
        ..DxfDef::default()
    }];
    let xml = xml_string(&writer);
    assert_contains_all(&xml, &["<dxfs count=\"1\">", "<dxf>", "<b/>"]);
}

#[test]
fn test_write_dxfs_num_fmt() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        num_fmt: Some(NumberFormatDef {
            id: 164,
            format_code: "#,##0".to_string(),
        }),
        ..DxfDef::default()
    }];
    let xml = xml_string(&writer);
    assert_contains_all(&xml, &["numFmtId=\"164\"", "formatCode=\"#,##0\""]);
}

#[test]
fn test_write_dxfs_alignment_protection() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            ..Default::default()
        }),
        protection: Some(ProtectionDef {
            locked: Some(true),
            hidden: None,
        }),
        ..DxfDef::default()
    }];
    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &["horizontal=\"center\"", "<protection", "locked=\"1\""],
    );
}

#[test]
fn dxf_empty_section_is_self_closing() {
    let writer = StylesWriter::with_defaults();
    let xml = xml_string(&writer);
    assert!(xml.contains("<dxfs count=\"0\"/>"));
}

#[test]
fn dxf_fill_border_and_child_order_are_stable() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            bold: Some(true),
            ..Default::default()
        }),
        num_fmt: Some(NumberFormatDef {
            id: 165,
            format_code: "0%".to_string(),
        }),
        fill: Some(solid_fill("FFFFFF00")),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Right),
            ..Default::default()
        }),
        border: Some(BorderDef {
            left: Some(thin_side(None)),
            ..Default::default()
        }),
        protection: Some(ProtectionDef {
            locked: Some(false),
            hidden: Some(true),
        }),
        ..Default::default()
    }];

    let xml = xml_string(&writer);
    assert_in_order(
        &xml,
        &[
            "<font>",
            "<numFmt numFmtId=\"165\" formatCode=\"0%\"/>",
            "<fill>",
            "<alignment horizontal=\"right\"/>",
            "<border>",
            "<protection locked=\"0\" hidden=\"1\"/>",
        ],
    );
}

#[test]
fn dxf_preserves_explicit_default_font_and_alignment_values() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            underline: Some(UnderlineStyle::None),
            vert_align: Some(VerticalAlignRun::Baseline),
            ..Default::default()
        }),
        alignment: Some(AlignmentDef {
            wrap_text: Some(false),
            justify_last_line: Some(false),
            shrink_to_fit: Some(false),
            auto_indent: Some(false),
            ..Default::default()
        }),
        ..Default::default()
    }];

    let xml = xml_string(&writer);
    assert_contains_all(
        &xml,
        &[
            "<u val=\"none\"/>",
            "<vertAlign val=\"baseline\"/>",
            "wrapText=\"0\"",
            "justifyLastLine=\"0\"",
            "shrinkToFit=\"0\"",
            "autoIndent=\"0\"",
        ],
    );
}

#[test]
fn dxf_ext_lst_is_written_last_and_relationships_are_filtered() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![
        DxfDef {
            protection: Some(ProtectionDef {
                locked: Some(false),
                hidden: None,
            }),
            ext_lst: Some(ooxml_types::ExtensionList {
                raw_xml: Some("<extLst><ext uri=\"dxf\"/></extLst>".to_string()),
            }),
            ..Default::default()
        },
        DxfDef {
            ext_lst: Some(ooxml_types::ExtensionList {
                raw_xml: Some("<extLst><ext r:id=\"rId1\"/></extLst>".to_string()),
            }),
            ..Default::default()
        },
    ];

    let xml = xml_string(&writer);
    assert_in_order(
        &xml,
        &[
            "<protection locked=\"0\"/>",
            "<extLst><ext uri=\"dxf\"/></extLst>",
            "</dxf>",
        ],
    );
    assert!(!xml.contains("r:id=\"rId1\""));
}

#[test]
fn dxf_gradient_fill_is_written_as_gradient_fill() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        fill: Some(FillDef::Gradient {
            gradient_type: GradientType::Linear,
            degree: Some(45.0),
            stops: vec![
                GradientStop {
                    position: 0.0,
                    color: super::fixtures::rgb("FF000000"),
                },
                GradientStop {
                    position: 1.0,
                    color: super::fixtures::rgb("FFFFFFFF"),
                },
            ],
            left: None,
            right: None,
            top: None,
            bottom: None,
        }),
        ..Default::default()
    }];

    let xml = xml_string(&writer);
    assert_contains_all(&xml, &["<gradientFill", "degree=\"45\""]);
    let dxf_xml = xml
        .split_once("<dxfs count=\"1\">")
        .and_then(|(_, rest)| rest.split_once("</dxfs>").map(|(body, _)| body))
        .expect("dxfs xml");
    assert!(!dxf_xml.contains("<patternFill patternType=\"none\"/>"));
}
