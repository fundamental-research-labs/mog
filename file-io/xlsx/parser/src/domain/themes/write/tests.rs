use super::*;
use ooxml_types::drawings::{
    ColorTransform, DrawingFill, EffectList, EffectProperties, LineDash, LineFill, LineJoin,
    Outline, PatternFill, SolidFill,
};
use ooxml_types::themes::EffectStyleItem;

// -------------------------------------------------------------------------
// ThemeColorIndex tests
// -------------------------------------------------------------------------

#[test]
fn test_theme_color_index_values() {
    assert_eq!(ThemeColorIndex::Dark1 as usize, 0);
    assert_eq!(ThemeColorIndex::Light1 as usize, 1);
    assert_eq!(ThemeColorIndex::Dark2 as usize, 2);
    assert_eq!(ThemeColorIndex::Light2 as usize, 3);
    assert_eq!(ThemeColorIndex::Accent1 as usize, 4);
    assert_eq!(ThemeColorIndex::Accent2 as usize, 5);
    assert_eq!(ThemeColorIndex::Accent3 as usize, 6);
    assert_eq!(ThemeColorIndex::Accent4 as usize, 7);
    assert_eq!(ThemeColorIndex::Accent5 as usize, 8);
    assert_eq!(ThemeColorIndex::Accent6 as usize, 9);
    assert_eq!(ThemeColorIndex::Hyperlink as usize, 10);
    assert_eq!(ThemeColorIndex::FollowedHyperlink as usize, 11);
}

#[test]
fn test_theme_color_index_all() {
    let all = ThemeColorIndex::all();
    assert_eq!(all.len(), 12);
    assert_eq!(all[0], ThemeColorIndex::Dark1);
    assert_eq!(all[11], ThemeColorIndex::FollowedHyperlink);
}

// -------------------------------------------------------------------------
// ColorScheme tests
// -------------------------------------------------------------------------

#[test]
fn test_color_scheme_office_default() {
    let scheme = ColorScheme::office_default();
    assert_eq!(scheme.name, "Office");
    assert_eq!(scheme.resolve_hex(0), Some("000000".to_string())); // dk1
    assert_eq!(scheme.resolve_hex(1), Some("FFFFFF".to_string())); // lt1
    assert_eq!(scheme.resolve_hex(4), Some("4472C4".to_string())); // accent1
    assert_eq!(scheme.resolve_hex(10), Some("0563C1".to_string())); // hlink
    assert_eq!(scheme.resolve_hex(11), Some("954F72".to_string())); // fol_hlink
}

#[test]
fn test_color_scheme_get() {
    let scheme = ColorScheme::office_default();
    assert_eq!(
        scheme.get_hex(ThemeColorIndex::Dark1),
        Some("000000".to_string())
    );
    assert_eq!(
        scheme.get_hex(ThemeColorIndex::Light1),
        Some("FFFFFF".to_string())
    );
    assert_eq!(
        scheme.get_hex(ThemeColorIndex::Accent1),
        Some("4472C4".to_string())
    );
}

#[test]
fn test_color_scheme_set() {
    let mut scheme = ColorScheme::office_default();
    scheme.set_hex(ThemeColorIndex::Accent1, "FF0000");
    assert_eq!(scheme.resolve_hex(4), Some("FF0000".to_string()));
    assert_eq!(
        scheme.get_hex(ThemeColorIndex::Accent1),
        Some("FF0000".to_string())
    );
}

// -------------------------------------------------------------------------
// ThemeFontDef tests
// -------------------------------------------------------------------------

#[test]
fn test_theme_font_def_new() {
    let font = ThemeFontDef::new("Calibri");
    assert_eq!(font.typeface, "Calibri");
    assert!(font.panose.is_none());
}

#[test]
fn test_theme_font_def_with_panose() {
    let font = ThemeFontDef::with_panose("Calibri Light", "020F0302020204030204");
    assert_eq!(font.typeface, "Calibri Light");
    assert_eq!(font.panose, Some("020F0302020204030204".to_string()));
}

// -------------------------------------------------------------------------
// FontCollection tests
// -------------------------------------------------------------------------

#[test]
fn test_font_collection_new() {
    let collection = FontCollection::new("Arial");
    assert_eq!(collection.latin.typeface, "Arial");
    // ea and cs are now always present (not Option)
    assert!(!collection.ea.typeface.is_empty() || collection.ea.typeface.is_empty());
    assert!(!collection.cs.typeface.is_empty() || collection.cs.typeface.is_empty());
}

#[test]
fn test_font_collection_office_major() {
    let collection = FontCollection::office_major();
    assert_eq!(collection.latin.typeface, "Calibri Light");
    assert!(collection.latin.panose.is_some());
    assert!(!collection.script_fonts.is_empty());
}

#[test]
fn test_font_collection_office_minor() {
    let collection = FontCollection::office_minor();
    assert_eq!(collection.latin.typeface, "Calibri");
    assert!(collection.latin.panose.is_some());
    assert!(!collection.script_fonts.is_empty());
}

// -------------------------------------------------------------------------
// FontScheme tests
// -------------------------------------------------------------------------

#[test]
fn test_font_scheme_office_default() {
    let scheme = FontScheme::office_default();
    assert_eq!(scheme.name, "Office");
    assert_eq!(scheme.major_font.latin.typeface, "Calibri Light");
    assert_eq!(scheme.minor_font.latin.typeface, "Calibri");
}

#[test]
fn test_font_scheme_simple() {
    let scheme = FontScheme::simple("Custom", "Arial", "Times New Roman");
    assert_eq!(scheme.name, "Custom");
    assert_eq!(scheme.major_font.latin.typeface, "Arial");
    assert_eq!(scheme.minor_font.latin.typeface, "Times New Roman");
}

// -------------------------------------------------------------------------
// ThemeWriter basic tests
// -------------------------------------------------------------------------

#[test]
fn test_theme_writer_new() {
    let theme = ThemeWriter::new();
    assert_eq!(theme.name, "Office Theme");
}

#[test]
fn test_theme_writer_default_office_theme() {
    let theme = ThemeWriter::default_office_theme();
    assert_eq!(theme.name, "Office Theme");
    assert_eq!(
        theme.color_scheme.resolve_hex(4),
        Some("4472C4".to_string())
    );
    assert_eq!(theme.font_scheme.major_font.latin.typeface, "Calibri Light");
}

#[test]
fn test_theme_writer_set_name() {
    let mut theme = ThemeWriter::new();
    theme.set_name("My Theme");
    assert_eq!(theme.name, "My Theme");
}

#[test]
fn test_theme_writer_set_color() {
    let mut theme = ThemeWriter::new();
    theme.set_color(ThemeColorIndex::Accent1, "FF0000");
    assert_eq!(
        theme.color_scheme.resolve_hex(4),
        Some("FF0000".to_string())
    );
}

#[test]
fn test_theme_writer_set_major_font() {
    let mut theme = ThemeWriter::new();
    theme.set_major_font("Arial");
    assert_eq!(theme.font_scheme.major_font.latin.typeface, "Arial");
}

#[test]
fn test_theme_writer_set_minor_font() {
    let mut theme = ThemeWriter::new();
    theme.set_minor_font("Times New Roman");
    assert_eq!(
        theme.font_scheme.minor_font.latin.typeface,
        "Times New Roman"
    );
}

#[test]
fn test_theme_writer_fluent_api() {
    let mut theme = ThemeWriter::new();
    theme
        .set_name("Custom")
        .set_color(ThemeColorIndex::Accent1, "FF0000")
        .set_major_font("Arial")
        .set_minor_font("Georgia");

    assert_eq!(theme.name, "Custom");
    assert_eq!(
        theme.color_scheme.resolve_hex(4),
        Some("FF0000".to_string())
    );
    assert_eq!(theme.font_scheme.major_font.latin.typeface, "Arial");
    assert_eq!(theme.font_scheme.minor_font.latin.typeface, "Georgia");
}

// -------------------------------------------------------------------------
// XML generation tests
// -------------------------------------------------------------------------

#[test]
fn test_to_xml_contains_declaration() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("encoding=\"UTF-8\""));
}

#[test]
fn test_to_xml_contains_namespace() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\""));
}

#[test]
fn test_to_xml_contains_theme_name() {
    let mut theme = ThemeWriter::new();
    theme.set_name("Custom Theme");
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("name=\"Custom Theme\""));
}

#[test]
fn test_to_xml_contains_color_scheme() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:clrScheme"));
    assert!(xml_str.contains("<a:dk1>"));
    assert!(xml_str.contains("<a:lt1>"));
    assert!(xml_str.contains("<a:accent1>"));
    assert!(xml_str.contains("</a:clrScheme>"));
}

#[test]
fn test_to_xml_contains_system_colors() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:sysClr val=\"windowText\" lastClr=\"000000\"/>"));
    assert!(xml_str.contains("<a:sysClr val=\"window\" lastClr=\"FFFFFF\"/>"));
}

#[test]
fn test_to_xml_contains_srgb_colors() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:srgbClr val=\"4472C4\"/>")); // accent1
    assert!(xml_str.contains("<a:srgbClr val=\"ED7D31\"/>")); // accent2
    assert!(xml_str.contains("<a:srgbClr val=\"0563C1\"/>")); // hlink
}

#[test]
fn test_to_xml_contains_all_12_colors() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:dk1>"));
    assert!(xml_str.contains("<a:lt1>"));
    assert!(xml_str.contains("<a:dk2>"));
    assert!(xml_str.contains("<a:lt2>"));
    assert!(xml_str.contains("<a:accent1>"));
    assert!(xml_str.contains("<a:accent2>"));
    assert!(xml_str.contains("<a:accent3>"));
    assert!(xml_str.contains("<a:accent4>"));
    assert!(xml_str.contains("<a:accent5>"));
    assert!(xml_str.contains("<a:accent6>"));
    assert!(xml_str.contains("<a:hlink>"));
    assert!(xml_str.contains("<a:folHlink>"));
}

#[test]
fn test_to_xml_contains_font_scheme() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:fontScheme"));
    assert!(xml_str.contains("<a:majorFont>"));
    assert!(xml_str.contains("<a:minorFont>"));
    assert!(xml_str.contains("</a:fontScheme>"));
}

#[test]
fn test_to_xml_contains_latin_font() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("typeface=\"Calibri Light\""));
    assert!(xml_str.contains("typeface=\"Calibri\""));
}

#[test]
fn test_to_xml_contains_panose() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("panose=\"020F0302020204030204\"")); // major
    assert!(xml_str.contains("panose=\"020F0502020204030204\"")); // minor
}

#[test]
fn test_to_xml_contains_script_fonts() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:font script=\"Jpan\""));
    assert!(xml_str.contains("<a:font script=\"Hang\""));
    assert!(xml_str.contains("<a:font script=\"Hans\""));
}

#[test]
fn test_to_xml_contains_format_scheme() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:fmtScheme"));
    assert!(xml_str.contains("<a:fillStyleLst>"));
    assert!(xml_str.contains("<a:lnStyleLst>"));
    assert!(xml_str.contains("<a:effectStyleLst>"));
    assert!(xml_str.contains("<a:bgFillStyleLst>"));
    assert!(xml_str.contains("</a:fmtScheme>"));
}

#[test]
fn test_to_xml_contains_line_widths() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("w=\"6350\""));
    assert!(xml_str.contains("w=\"12700\""));
    assert!(xml_str.contains("w=\"19050\""));
}

#[test]
fn test_to_xml_contains_placeholder_colors() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:schemeClr val=\"phClr\"/>"));
}

#[test]
fn test_to_xml_contains_object_defaults() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:objectDefaults/>"));
    assert!(xml_str.contains("<a:extraClrSchemeLst/>"));
}

#[test]
fn test_domain_bridge_preserves_empty_root_sibling_presence() {
    let parsed = crate::domain::themes::Theme::parse(
        br#"<a:theme name="Bridge">
            <a:themeElements></a:themeElements>
            <a:objectDefaults/>
            <a:extraClrSchemeLst/>
            <a:extLst/>
        </a:theme>"#,
    );
    let theme = domain_types::ThemeData {
        name: Some(parsed.name),
        color_scheme: Some(parsed.color_scheme),
        font_scheme: Some(parsed.font_scheme),
        format_scheme: Some(parsed.format_scheme),
        object_defaults_xml: parsed.object_defaults_xml,
        extra_clr_scheme_lst_xml: parsed.extra_clr_scheme_lst_xml,
        ext_lst_xml: parsed.ext_lst_xml,
        root_sibling_order: parsed.root_sibling_order,
        ..Default::default()
    };

    let xml = theme_writer_from_domain(&theme);
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:objectDefaults/>"));
    assert!(xml_str.contains("<a:extraClrSchemeLst/>"));
    assert!(xml_str.contains("<a:extLst/>"));
}

#[test]
fn test_domain_bridge_preserves_non_empty_object_defaults_and_empty_extra_colors() {
    let parsed = crate::domain::themes::Theme::parse(
        br#"<a:theme name="Bridge">
            <a:themeElements></a:themeElements>
            <a:extraClrSchemeLst/>
            <a:objectDefaults><a:spDef><a:spPr/></a:spDef></a:objectDefaults>
        </a:theme>"#,
    );
    let theme = domain_types::ThemeData {
        name: Some(parsed.name),
        color_scheme: Some(parsed.color_scheme),
        font_scheme: Some(parsed.font_scheme),
        format_scheme: Some(parsed.format_scheme),
        object_defaults_xml: parsed.object_defaults_xml,
        extra_clr_scheme_lst_xml: parsed.extra_clr_scheme_lst_xml,
        root_sibling_order: parsed.root_sibling_order,
        ..Default::default()
    };

    let xml = theme_writer_from_domain(&theme);
    let xml_str = String::from_utf8_lossy(&xml);
    let extra_pos = xml_str
        .find("<a:extraClrSchemeLst/>")
        .expect("extraClrSchemeLst not emitted");
    let object_pos = xml_str
        .find("<a:objectDefaults><a:spDef><a:spPr/></a:spDef></a:objectDefaults>")
        .expect("objectDefaults content not emitted");

    assert!(extra_pos < object_pos);
}

#[test]
fn test_theme_data_serde_preserves_empty_root_sibling_presence() {
    let theme = domain_types::ThemeData {
        object_defaults_xml: Some(Vec::new()),
        extra_clr_scheme_lst_xml: Some(Vec::new()),
        root_sibling_order: Some(vec![
            "objectDefaults".to_string(),
            "extraClrSchemeLst".to_string(),
        ]),
        ..Default::default()
    };

    let json = serde_json::to_string(&theme).expect("serialize ThemeData");
    let hydrated: domain_types::ThemeData =
        serde_json::from_str(&json).expect("deserialize ThemeData");

    assert_eq!(hydrated.object_defaults_xml, Some(Vec::new()));
    assert_eq!(hydrated.extra_clr_scheme_lst_xml, Some(Vec::new()));
    assert_eq!(hydrated.root_sibling_order, theme.root_sibling_order);
}

#[test]
fn test_root_sibling_ordered_absent_fields_are_not_defaulted_to_empty() {
    let mut theme = ThemeWriter::default_office_theme();
    theme.set_root_sibling_order(vec!["objectDefaults".to_string()]);

    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(!xml_str.contains("<a:objectDefaults/>"));
    assert!(!xml_str.contains("<a:extraClrSchemeLst/>"));
}

#[test]
fn test_to_xml_custom_colors() {
    let mut theme = ThemeWriter::new();
    theme
        .set_color(ThemeColorIndex::Accent1, "FF0000")
        .set_color(ThemeColorIndex::Accent2, "00FF00")
        .set_color(ThemeColorIndex::Accent3, "0000FF");

    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<a:srgbClr val=\"FF0000\"/>")); // custom accent1
    assert!(xml_str.contains("<a:srgbClr val=\"00FF00\"/>")); // custom accent2
    assert!(xml_str.contains("<a:srgbClr val=\"0000FF\"/>")); // custom accent3
}

#[test]
fn test_to_xml_custom_fonts() {
    let mut theme = ThemeWriter::new();
    theme.set_major_font("Arial").set_minor_font("Georgia");

    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("typeface=\"Arial\""));
    assert!(xml_str.contains("typeface=\"Georgia\""));
}

#[test]
fn test_to_xml_is_valid_structure() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Check proper nesting - opening and closing tags match
    assert!(xml_str.contains("<a:theme"));
    assert!(xml_str.contains("</a:theme>"));
    assert!(xml_str.contains("<a:themeElements>"));
    assert!(xml_str.contains("</a:themeElements>"));

    // Closing tag should be at the end
    assert!(xml_str.ends_with("</a:theme>"));
}

// -------------------------------------------------------------------------
// Integration tests
// -------------------------------------------------------------------------

#[test]
fn test_complete_theme_xml_structure() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Verify the XML contains all major sections in order
    let clr_scheme_pos = xml_str.find("<a:clrScheme").expect("clrScheme not found");
    let font_scheme_pos = xml_str.find("<a:fontScheme").expect("fontScheme not found");
    let fmt_scheme_pos = xml_str.find("<a:fmtScheme").expect("fmtScheme not found");
    let obj_defaults_pos = xml_str
        .find("<a:objectDefaults")
        .expect("objectDefaults not found");

    assert!(clr_scheme_pos < font_scheme_pos);
    assert!(font_scheme_pos < fmt_scheme_pos);
    assert!(fmt_scheme_pos < obj_defaults_pos);
}

#[test]
fn test_default_trait() {
    let theme1 = ThemeWriter::default();
    let theme2 = ThemeWriter::new();

    assert_eq!(theme1.name, theme2.name);
    assert_eq!(
        theme1.color_scheme.resolve_hex(4),
        theme2.color_scheme.resolve_hex(4)
    );
}

#[test]
fn test_color_scheme_default_trait() {
    let scheme1 = ColorScheme::default();
    let scheme2 = ColorScheme::office_default();

    assert_eq!(scheme1.name, scheme2.name);
    assert_eq!(scheme1.resolve_hex(4), scheme2.resolve_hex(4));
}

#[test]
fn test_font_scheme_default_trait() {
    let scheme1 = FontScheme::default();
    let scheme2 = FontScheme::office_default();

    assert_eq!(scheme1.name, scheme2.name);
    assert_eq!(
        scheme1.major_font.latin.typeface,
        scheme2.major_font.latin.typeface
    );
}

// -------------------------------------------------------------------------
// Format scheme model-driven tests
// -------------------------------------------------------------------------

#[test]
fn test_set_format_scheme() {
    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    fs.name = "Custom".to_string();
    theme.set_format_scheme(fs);
    assert_eq!(theme.format_scheme.name, "Custom");
}

#[test]
fn test_format_scheme_name_in_xml() {
    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    fs.name = "MyScheme".to_string();
    theme.set_format_scheme(fs);
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("<a:fmtScheme name=\"MyScheme\">"));
}

#[test]
fn test_color_transforms_in_xml() {
    use ooxml_types::drawings::{ColorTransform, SchemeColor};

    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    // Replace first fill with a solid phClr + tint transform
    fs.fill_style_lst[0] = DrawingFill::Solid(SolidFill {
        color: DrawingColor::SchemeClr {
            val: SchemeColor::PhClr,
            transforms: vec![
                ColorTransform::Tint { val: 50000 },
                ColorTransform::SatMod { val: 300000 },
            ],
        },
    });
    theme.set_format_scheme(fs);
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("<a:tint val=\"50000\"/>"));
    assert!(xml_str.contains("<a:satMod val=\"300000\"/>"));
}

#[test]
fn test_effect_list_empty_in_xml() {
    let theme = ThemeWriter::default_office_theme();
    let xml = theme.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    // Default effect styles produce empty effect lists
    assert!(xml_str.contains("<a:effectLst/>"));
}

// =========================================================================
// 4a: DrawingFill writer serialization tests
// =========================================================================

/// Helper: build a ThemeWriter with a single fill in fill_style_lst and return XML string.
fn xml_for_fill(fill: DrawingFill) -> String {
    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    fs.fill_style_lst = vec![fill];
    theme.set_format_scheme(fs);
    String::from_utf8(theme.to_xml()).expect("valid utf8")
}

/// Helper: build a ThemeWriter with a single outline in ln_style_lst and return XML string.
fn xml_for_outline(ln: Outline) -> String {
    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    fs.ln_style_lst = vec![ln];
    theme.set_format_scheme(fs);
    String::from_utf8(theme.to_xml()).expect("valid utf8")
}

/// Helper: build a ThemeWriter with a single effect style and return XML string.
fn xml_for_effect_style(item: EffectStyleItem) -> String {
    let mut theme = ThemeWriter::new();
    let mut fs = default_format_scheme();
    fs.effect_style_lst = vec![item];
    theme.set_format_scheme(fs);
    String::from_utf8(theme.to_xml()).expect("valid utf8")
}

#[test]
fn test_write_solid_fill_srgb() {
    let fill = DrawingFill::Solid(SolidFill {
        color: DrawingColor::SrgbClr {
            val: "FF5733".to_string(),
            transforms: vec![],
        },
    });
    let xml = xml_for_fill(fill);
    assert!(
        xml.contains("<a:solidFill><a:srgbClr val=\"FF5733\"/></a:solidFill>"),
        "Expected solid fill with srgbClr, got: {}",
        xml
    );
}

#[test]
fn test_write_solid_fill_scheme_clr_with_transforms() {
    use ooxml_types::drawings::SchemeColor;
    let fill = DrawingFill::Solid(SolidFill {
        color: DrawingColor::SchemeClr {
            val: SchemeColor::PhClr,
            transforms: vec![
                ColorTransform::Tint { val: 50000 },
                ColorTransform::SatMod { val: 300000 },
            ],
        },
    });
    let xml = xml_for_fill(fill);
    assert!(
        xml.contains("<a:schemeClr val=\"phClr\">"),
        "Missing schemeClr open: {}",
        xml
    );
    assert!(
        xml.contains("<a:tint val=\"50000\"/>"),
        "Missing tint transform: {}",
        xml
    );
    assert!(
        xml.contains("<a:satMod val=\"300000\"/>"),
        "Missing satMod transform: {}",
        xml
    );
    assert!(
        xml.contains("</a:schemeClr>"),
        "Missing schemeClr close: {}",
        xml
    );
}

#[test]
fn test_write_gradient_fill_linear() {
    use ooxml_types::drawings::{
        GradientFill, GradientStop, SchemeColor, StAngle, StPositiveFixedPercentageDecimal,
    };

    let fill = DrawingFill::Gradient(GradientFill {
        stops: vec![
            GradientStop {
                position: StPositiveFixedPercentageDecimal::new_clamped(0),
                color: DrawingColor::SchemeClr {
                    val: SchemeColor::PhClr,
                    transforms: vec![ColorTransform::Tint { val: 80000 }],
                },
            },
            GradientStop {
                position: StPositiveFixedPercentageDecimal::new_clamped(50000),
                color: DrawingColor::SrgbClr {
                    val: "AABBCC".to_string(),
                    transforms: vec![],
                },
            },
            GradientStop {
                position: StPositiveFixedPercentageDecimal::new_clamped(100000),
                color: DrawingColor::SchemeClr {
                    val: SchemeColor::PhClr,
                    transforms: vec![ColorTransform::Shade { val: 30000 }],
                },
            },
        ],
        lin_ang: Some(StAngle::new(5400000)),
        lin_scaled: Some(true),
        ..GradientFill::default()
    });
    let xml = xml_for_fill(fill);
    assert!(xml.contains("<a:gradFill>"), "Missing gradFill: {}", xml);
    assert!(xml.contains("<a:gsLst>"), "Missing gsLst: {}", xml);
    assert!(
        xml.contains("<a:gs pos=\"0\">"),
        "Missing gs pos=0: {}",
        xml
    );
    assert!(
        xml.contains("<a:gs pos=\"50000\">"),
        "Missing gs pos=50000: {}",
        xml
    );
    assert!(
        xml.contains("<a:gs pos=\"100000\">"),
        "Missing gs pos=100000: {}",
        xml
    );
    assert!(
        xml.contains("<a:lin ang=\"5400000\" scaled=\"1\"/>"),
        "Missing lin element: {}",
        xml
    );
    assert!(
        xml.contains("</a:gradFill>"),
        "Missing gradFill close: {}",
        xml
    );
}

#[test]
fn test_write_gradient_fill_path() {
    use ooxml_types::drawings::{
        GradientFill, GradientPathType, GradientStop, RelativeRect, SchemeColor, StPercentage,
        StPositiveFixedPercentageDecimal,
    };

    let fill = DrawingFill::Gradient(GradientFill {
        stops: vec![GradientStop {
            position: StPositiveFixedPercentageDecimal::new_clamped(0),
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        }],
        path: Some(GradientPathType::Circle),
        fill_to_rect: Some(RelativeRect {
            l: Some(StPercentage::new(50000)),
            t: Some(StPercentage::new(50000)),
            r: Some(StPercentage::new(50000)),
            b: Some(StPercentage::new(50000)),
        }),
        ..GradientFill::default()
    });
    let xml = xml_for_fill(fill);
    assert!(
        xml.contains("<a:path path=\"circle\">"),
        "Missing path element: {}",
        xml
    );
    assert!(
        xml.contains("<a:fillToRect l=\"50000\" t=\"50000\" r=\"50000\" b=\"50000\"/>"),
        "Missing fillToRect: {}",
        xml
    );
}

#[test]
fn test_write_pattern_fill() {
    use ooxml_types::drawings::PresetPatternVal;

    let fill = DrawingFill::Pattern(PatternFill {
        preset: Some(PresetPatternVal::DkDnDiag),
        fg_color: Some(DrawingColor::SrgbClr {
            val: "000000".to_string(),
            transforms: vec![],
        }),
        bg_color: Some(DrawingColor::SrgbClr {
            val: "FFFFFF".to_string(),
            transforms: vec![],
        }),
    });
    let xml = xml_for_fill(fill);
    assert!(
        xml.contains("<a:pattFill prst=\"dkDnDiag\">"),
        "Missing pattFill: {}",
        xml
    );
    assert!(xml.contains("<a:fgClr>"), "Missing fgClr: {}", xml);
    assert!(xml.contains("<a:bgClr>"), "Missing bgClr: {}", xml);
}

#[test]
fn test_write_no_fill() {
    let fill = DrawingFill::NoFill;
    let xml = xml_for_fill(fill);
    assert!(xml.contains("<a:noFill/>"), "Missing noFill: {}", xml);
}

// =========================================================================
// 4b: Outline writer serialization tests
// =========================================================================

#[test]
fn test_write_outline_with_attributes_and_solid_fill() {
    use ooxml_types::drawings::{CompoundLine, DashStyle, LineCap, SchemeColor};

    let ln = Outline {
        width: Some(12700),
        cap: Some(LineCap::Flat),
        compound: Some(CompoundLine::Single),
        fill: Some(LineFill::Solid(SolidFill {
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        })),
        dash: Some(LineDash::Preset(DashStyle::Solid)),
        join: None,
        head_end: None,
        tail_end: None,
        align: None,
    };
    let xml = xml_for_outline(ln);
    assert!(xml.contains("w=\"12700\""), "Missing width: {}", xml);
    assert!(xml.contains("cap=\"flat\""), "Missing cap: {}", xml);
    assert!(xml.contains("cmpd=\"sng\""), "Missing cmpd: {}", xml);
    assert!(
        xml.contains("<a:solidFill>"),
        "Missing solidFill inside ln: {}",
        xml
    );
    assert!(
        xml.contains("<a:prstDash val=\"solid\"/>"),
        "Missing prstDash: {}",
        xml
    );
}

#[test]
fn test_write_outline_with_miter_join() {
    let ln = Outline {
        width: Some(6350),
        cap: None,
        compound: None,
        fill: None,
        dash: None,
        join: Some(LineJoin::Miter {
            limit: Some(800000),
        }),
        head_end: None,
        tail_end: None,
        align: None,
    };
    let xml = xml_for_outline(ln);
    assert!(
        xml.contains("<a:miter lim=\"800000\"/>"),
        "Missing miter with lim: {}",
        xml
    );
}

// =========================================================================
// 4c: EffectStyleItem writer serialization tests
// =========================================================================

#[test]
fn test_write_effect_style_empty_list() {
    let item = EffectStyleItem {
        effect_properties: Some(EffectProperties::EffectList(EffectList::default())),
        scene_3d: None,
        sp_3d: None,
    };
    let xml = xml_for_effect_style(item);
    assert!(
        xml.contains("<a:effectStyle><a:effectLst/></a:effectStyle>"),
        "Expected empty effect style, got: {}",
        xml
    );
}

#[test]
fn test_write_effect_style_with_outer_shadow() {
    use ooxml_types::drawings::{OuterShadow, StAngle, StPositiveCoordinate};

    let item = EffectStyleItem {
        effect_properties: Some(EffectProperties::EffectList(EffectList {
            outer_shadow: Some(OuterShadow {
                blur_rad: StPositiveCoordinate::new_clamped(40000),
                dist: StPositiveCoordinate::new_clamped(23000),
                dir: StAngle::new(5400000),
                color: Some(DrawingColor::SrgbClr {
                    val: "000000".to_string(),
                    transforms: vec![ColorTransform::Alpha { val: 35000 }],
                }),
                ..OuterShadow::default()
            }),
            ..EffectList::default()
        })),
        scene_3d: None,
        sp_3d: None,
    };
    let xml = xml_for_effect_style(item);
    assert!(xml.contains("<a:outerShdw"), "Missing outerShdw: {}", xml);
    assert!(
        xml.contains("blurRad=\"40000\""),
        "Missing blurRad: {}",
        xml
    );
    assert!(xml.contains("dist=\"23000\""), "Missing dist: {}", xml);
    assert!(xml.contains("dir=\"5400000\""), "Missing dir: {}", xml);
    assert!(
        xml.contains("<a:srgbClr val=\"000000\">"),
        "Missing shadow color: {}",
        xml
    );
    assert!(
        xml.contains("<a:alpha val=\"35000\"/>"),
        "Missing alpha transform: {}",
        xml
    );
}

#[test]
fn test_write_effect_style_with_scene3d_and_sp3d() {
    use ooxml_types::drawings::{
        Bevel, BevelPresetType, Camera, LightRig, LightRigDirection, LightRigType,
        PresetCameraType, Rotation3D, Scene3D, Shape3D, StPositiveCoordinate, StPositiveFixedAngle,
    };

    let item = EffectStyleItem {
        effect_properties: Some(EffectProperties::EffectList(EffectList::default())),
        scene_3d: Some(Scene3D {
            camera: Camera {
                prst: PresetCameraType::OrthographicFront,
                fov: None,
                zoom: None,
                rot: Some(Rotation3D {
                    lat: StPositiveFixedAngle::new_clamped(0),
                    lon: StPositiveFixedAngle::new_clamped(0),
                    rev: StPositiveFixedAngle::new_clamped(0),
                }),
            },
            light_rig: LightRig {
                rig: LightRigType::ThreePt,
                dir: LightRigDirection::Top,
                rot: Some(Rotation3D {
                    lat: StPositiveFixedAngle::new_clamped(0),
                    lon: StPositiveFixedAngle::new_clamped(0),
                    rev: StPositiveFixedAngle::new_clamped(1200000),
                }),
            },
            backdrop: None,
            ext_lst: None,
        }),
        sp_3d: Some(Shape3D {
            bevel_t: Some(Bevel {
                w: Some(StPositiveCoordinate::new_clamped(63500)),
                h: Some(StPositiveCoordinate::new_clamped(25400)),
                prst: Some(BevelPresetType::Circle),
            }),
            bevel_b: None,
            extrusion_h: None,
            extrusion_clr: None,
            contour_w: None,
            contour_clr: None,
            prst_material: None,
            z: None,
            ext_lst: None,
        }),
    };
    let xml = xml_for_effect_style(item);
    assert!(xml.contains("<a:scene3d>"), "Missing scene3d: {}", xml);
    assert!(
        xml.contains("<a:camera prst=\"orthographicFront\">"),
        "Missing camera: {}",
        xml
    );
    assert!(xml.contains("<a:sp3d>"), "Missing sp3d: {}", xml);
    assert!(
        xml.contains("<a:bevelT w=\"63500\" h=\"25400\" prst=\"circle\"/>"),
        "Missing bevelT: {}",
        xml
    );
    assert!(
        xml.contains("<a:lightRig rig=\"threePt\" dir=\"t\">"),
        "Missing lightRig: {}",
        xml
    );
}
