use super::*;
use crate::drawings::{DrawingColor, SystemColorVal};

#[test]
fn test_theme_facade_exports_representative_types() {
    use crate::themes::*;

    let _: Option<ColorScheme> = None;
    let _: Option<ColorSchemeIndex> = None;
    let _: Option<ThemeColorIndex> = None;
    let _: Option<FontScheme> = None;
    let _: Option<FontCollection> = None;
    let _: Option<ThemeFontDef> = None;
    let _: Option<ScriptFont> = None;
    let _: Option<FormatScheme> = None;
    let _: Option<EffectStyleItem> = None;
    let _: Option<BaseStyles> = None;
    let _: Option<ColorMapping> = None;
    let _: Option<ColorMappingOverride> = None;
    let _: Option<OfficeStyleSheet> = None;
    let _: Option<ClipboardStyleSheet> = None;
}

// -----------------------------------------------------------------------
// ColorScheme tests
// -----------------------------------------------------------------------

#[test]
fn test_color_scheme_office_default() {
    let scheme = ColorScheme::office_default();
    assert_eq!(scheme.name, "Office");
    // dk1 is a system color
    assert!(matches!(
        &scheme.dk1,
        DrawingColor::SysClr {
            val: SystemColorVal::WindowText,
            ..
        }
    ));
    // lt1 is a system color
    assert!(matches!(
        &scheme.lt1,
        DrawingColor::SysClr {
            val: SystemColorVal::Window,
            ..
        }
    ));
    // accent1 is sRGB
    assert!(matches!(&scheme.accent1, DrawingColor::SrgbClr { val, .. } if val == "4472C4"));
    // hlink is sRGB
    assert!(matches!(&scheme.hlink, DrawingColor::SrgbClr { val, .. } if val == "0563C1"));
    // fol_hlink is sRGB
    assert!(matches!(&scheme.fol_hlink, DrawingColor::SrgbClr { val, .. } if val == "954F72"));
}

#[test]
fn test_color_scheme_get_by_index() {
    let scheme = ColorScheme::office_default();
    // dk1 at index 0
    assert!(scheme.get_by_index(0).is_some());
    assert!(matches!(
        scheme.get_by_index(0).unwrap(),
        DrawingColor::SysClr {
            val: SystemColorVal::WindowText,
            ..
        }
    ));
    // lt1 at index 1
    assert!(matches!(
        scheme.get_by_index(1).unwrap(),
        DrawingColor::SysClr {
            val: SystemColorVal::Window,
            ..
        }
    ));
    // accent1 at index 4
    assert!(
        matches!(scheme.get_by_index(4).unwrap(), DrawingColor::SrgbClr { val, .. } if val == "4472C4")
    );
    // out of range
    assert_eq!(scheme.get_by_index(12), None);
}

#[test]
fn test_color_scheme_set_by_index() {
    let mut scheme = ColorScheme::office_default();
    let red = DrawingColor::SrgbClr {
        val: "FF0000".to_string(),
        transforms: vec![],
    };
    scheme.set_by_index(4, red.clone());
    assert_eq!(scheme.accent1, red);
}

#[test]
fn test_color_scheme_set_by_index_out_of_range_noop() {
    let mut scheme = ColorScheme::office_default();
    let before = scheme.clone();
    scheme.set_by_index(
        12,
        DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        },
    );
    assert_eq!(scheme, before);
}

#[test]
fn test_color_scheme_resolve_hex_srgb() {
    let scheme = ColorScheme::office_default();
    // accent1 (index 4) is SrgbClr "4472C4"
    assert_eq!(scheme.resolve_hex(4), Some("4472C4".to_string()));
    // accent2 (index 5)
    assert_eq!(scheme.resolve_hex(5), Some("ED7D31".to_string()));
}

#[test]
fn test_color_scheme_resolve_hex_sysclr() {
    let scheme = ColorScheme::office_default();
    // dk1 (index 0) is SysClr with last_clr "000000"
    assert_eq!(scheme.resolve_hex(0), Some("000000".to_string()));
    // lt1 (index 1) is SysClr with last_clr "FFFFFF"
    assert_eq!(scheme.resolve_hex(1), Some("FFFFFF".to_string()));
}

#[test]
fn test_color_scheme_resolve_hex_out_of_range() {
    let scheme = ColorScheme::office_default();
    assert_eq!(scheme.resolve_hex(12), None);
}

#[test]
fn test_color_scheme_resolve_hex_unsupported_variant() {
    let mut scheme = ColorScheme::office_default();
    scheme.set_by_index(
        4,
        DrawingColor::HslClr {
            hue: 0,
            sat: 0,
            lum: 0,
            transforms: vec![],
        },
    );
    assert_eq!(scheme.resolve_hex(4), None);
}

#[test]
fn test_color_scheme_default_is_office() {
    let s1 = ColorScheme::default();
    let s2 = ColorScheme::office_default();
    assert_eq!(s1, s2);
}

// -----------------------------------------------------------------------
// ColorSchemeIndex tests
// -----------------------------------------------------------------------

#[test]
fn test_color_scheme_index_from_ooxml() {
    assert_eq!(
        ColorSchemeIndex::from_ooxml("dk1"),
        Some(ColorSchemeIndex::Dk1)
    );
    assert_eq!(
        ColorSchemeIndex::from_ooxml("lt1"),
        Some(ColorSchemeIndex::Lt1)
    );
    assert_eq!(
        ColorSchemeIndex::from_ooxml("accent1"),
        Some(ColorSchemeIndex::Accent1)
    );
    assert_eq!(
        ColorSchemeIndex::from_ooxml("folHlink"),
        Some(ColorSchemeIndex::FolHlink)
    );
    assert_eq!(ColorSchemeIndex::from_ooxml("invalid"), None);
}

#[test]
fn test_color_scheme_index_rejects_case_variants_and_unknown_tokens() {
    assert_eq!(ColorSchemeIndex::from_ooxml("folhlink"), None);
    assert_eq!(ColorSchemeIndex::from_ooxml("accent7"), None);
    assert_eq!(ColorSchemeIndex::from_ooxml("Accent1"), None);
}

#[test]
fn test_color_scheme_index_to_ooxml() {
    assert_eq!(ColorSchemeIndex::Dk1.to_ooxml(), "dk1");
    assert_eq!(ColorSchemeIndex::Lt1.to_ooxml(), "lt1");
    assert_eq!(ColorSchemeIndex::Accent1.to_ooxml(), "accent1");
    assert_eq!(ColorSchemeIndex::FolHlink.to_ooxml(), "folHlink");
}

#[test]
fn test_color_scheme_index_roundtrip() {
    let all = [
        ColorSchemeIndex::Dk1,
        ColorSchemeIndex::Lt1,
        ColorSchemeIndex::Dk2,
        ColorSchemeIndex::Lt2,
        ColorSchemeIndex::Accent1,
        ColorSchemeIndex::Accent2,
        ColorSchemeIndex::Accent3,
        ColorSchemeIndex::Accent4,
        ColorSchemeIndex::Accent5,
        ColorSchemeIndex::Accent6,
        ColorSchemeIndex::Hlink,
        ColorSchemeIndex::FolHlink,
    ];
    for idx in &all {
        let s = idx.to_ooxml();
        let parsed = ColorSchemeIndex::from_ooxml(s).unwrap();
        assert_eq!(*idx, parsed);
    }
}

// -----------------------------------------------------------------------
// FontScheme tests
// -----------------------------------------------------------------------

#[test]
fn test_font_scheme_office_default() {
    let scheme = FontScheme::office_default();
    assert_eq!(scheme.name, "Office");
    assert_eq!(scheme.major_font.latin.typeface, "Calibri Light");
    assert_eq!(scheme.minor_font.latin.typeface, "Calibri");
    assert!(scheme.ext_lst.is_none());
}

#[test]
fn test_font_scheme_simple() {
    let scheme = FontScheme::simple("Custom", "Arial", "Times New Roman");
    assert_eq!(scheme.name, "Custom");
    assert_eq!(scheme.major_font.latin.typeface, "Arial");
    assert_eq!(scheme.minor_font.latin.typeface, "Times New Roman");
}

#[test]
fn test_font_scheme_default_is_office() {
    let s1 = FontScheme::default();
    let s2 = FontScheme::office_default();
    assert_eq!(s1, s2);
}

// -----------------------------------------------------------------------
// FontCollection tests
// -----------------------------------------------------------------------

#[test]
fn test_font_collection_office_major() {
    let collection = FontCollection::office_major();
    assert_eq!(collection.latin.typeface, "Calibri Light");
    assert!(collection.latin.panose.is_some());
    assert_eq!(collection.ea.typeface, "");
    assert_eq!(collection.cs.typeface, "");
    assert!(!collection.script_fonts.is_empty());
}

#[test]
fn test_font_collection_office_major_script_fonts_order() {
    let collection = FontCollection::office_major();
    let scripts: Vec<_> = collection
        .script_fonts
        .iter()
        .map(|font| (font.script.as_str(), font.typeface.as_str()))
        .collect();
    assert_eq!(
        scripts,
        vec![
            ("Jpan", "Yu Gothic Light"),
            ("Hang", "Malgun Gothic"),
            ("Hans", "DengXian Light"),
            ("Hant", "Microsoft JhengHei Light"),
            ("Arab", "Times New Roman"),
            ("Hebr", "Times New Roman"),
            ("Thai", "Angsana New"),
            ("Ethi", "Nyala"),
            ("Beng", "Vrinda"),
            ("Gujr", "Shruti"),
            ("Khmr", "MoolBoran"),
            ("Knda", "Tunga"),
        ]
    );
}

#[test]
fn test_font_collection_office_minor() {
    let collection = FontCollection::office_minor();
    assert_eq!(collection.latin.typeface, "Calibri");
    assert!(collection.latin.panose.is_some());
    assert_eq!(collection.ea.typeface, "");
    assert_eq!(collection.cs.typeface, "");
    assert!(!collection.script_fonts.is_empty());
}

#[test]
fn test_font_collection_office_minor_script_fonts_order() {
    let collection = FontCollection::office_minor();
    let scripts: Vec<_> = collection
        .script_fonts
        .iter()
        .map(|font| (font.script.as_str(), font.typeface.as_str()))
        .collect();
    assert_eq!(
        scripts,
        vec![
            ("Jpan", "Yu Gothic"),
            ("Hang", "Malgun Gothic"),
            ("Hans", "DengXian"),
            ("Hant", "Microsoft JhengHei"),
            ("Arab", "Arial"),
            ("Hebr", "Arial"),
            ("Thai", "Cordia New"),
            ("Ethi", "Nyala"),
            ("Beng", "Vrinda"),
            ("Gujr", "Shruti"),
            ("Khmr", "DaunPenh"),
            ("Knda", "Tunga"),
        ]
    );
}

#[test]
fn test_font_collection_ea_cs_required() {
    // ea and cs are now required (not Option)
    let collection = FontCollection::new("Arial");
    let _ea: &ThemeFontDef = &collection.ea;
    let _cs: &ThemeFontDef = &collection.cs;
    assert_eq!(collection.ea.typeface, "");
    assert_eq!(collection.cs.typeface, "");
}

// -----------------------------------------------------------------------
// ThemeFontDef tests
// -----------------------------------------------------------------------

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

#[test]
fn test_theme_font_def_constants() {
    assert_eq!(ThemeFontDef::DEFAULT_PITCH_FAMILY, 0i8);
    assert_eq!(ThemeFontDef::DEFAULT_CHARSET, 1i8);
}

// -----------------------------------------------------------------------
// ScriptFont tests
// -----------------------------------------------------------------------

#[test]
fn test_script_font_new() {
    let sf = ScriptFont::new("Jpan", "Yu Gothic");
    assert_eq!(sf.script, "Jpan");
    assert_eq!(sf.typeface, "Yu Gothic");
}

// -----------------------------------------------------------------------
// ThemeColorIndex tests
// -----------------------------------------------------------------------

#[test]
fn test_theme_color_index_all() {
    let all = ThemeColorIndex::all();
    assert_eq!(all.len(), 12);
    assert_eq!(all[0], ThemeColorIndex::Dark1);
    assert_eq!(all[1], ThemeColorIndex::Light1);
    assert_eq!(all[2], ThemeColorIndex::Dark2);
    assert_eq!(all[3], ThemeColorIndex::Light2);
    assert_eq!(all[11], ThemeColorIndex::FollowedHyperlink);
}

#[test]
fn test_theme_color_index_all_matches_discriminants() {
    for (expected, idx) in ThemeColorIndex::all().iter().enumerate() {
        assert_eq!(idx.as_index(), expected as u8);
    }
}

#[test]
fn test_theme_color_index_as_index() {
    assert_eq!(ThemeColorIndex::Dark1.as_index(), 0);
    assert_eq!(ThemeColorIndex::Light1.as_index(), 1);
    assert_eq!(ThemeColorIndex::Dark2.as_index(), 2);
    assert_eq!(ThemeColorIndex::Light2.as_index(), 3);
    assert_eq!(ThemeColorIndex::Accent1.as_index(), 4);
    assert_eq!(ThemeColorIndex::FollowedHyperlink.as_index(), 11);
}

#[test]
fn test_theme_color_index_from_index() {
    assert_eq!(ThemeColorIndex::from_index(0), Some(ThemeColorIndex::Dark1));
    assert_eq!(
        ThemeColorIndex::from_index(1),
        Some(ThemeColorIndex::Light1)
    );
    assert_eq!(
        ThemeColorIndex::from_index(4),
        Some(ThemeColorIndex::Accent1)
    );
    assert_eq!(
        ThemeColorIndex::from_index(11),
        Some(ThemeColorIndex::FollowedHyperlink)
    );
    assert_eq!(ThemeColorIndex::from_index(12), None);
}

#[test]
fn test_theme_color_index_roundtrip() {
    for i in 0..12u8 {
        let idx = ThemeColorIndex::from_index(i).unwrap();
        assert_eq!(idx.as_index(), i);
    }
}

// -----------------------------------------------------------------------
// ColorMapping tests
// -----------------------------------------------------------------------

#[test]
fn test_color_mapping_identity() {
    let mapping = ColorMapping::identity();
    assert_eq!(mapping.bg1, ColorSchemeIndex::Lt1);
    assert_eq!(mapping.tx1, ColorSchemeIndex::Dk1);
    assert_eq!(mapping.bg2, ColorSchemeIndex::Lt2);
    assert_eq!(mapping.tx2, ColorSchemeIndex::Dk2);
    assert_eq!(mapping.accent1, ColorSchemeIndex::Accent1);
    assert_eq!(mapping.accent2, ColorSchemeIndex::Accent2);
    assert_eq!(mapping.accent3, ColorSchemeIndex::Accent3);
    assert_eq!(mapping.accent4, ColorSchemeIndex::Accent4);
    assert_eq!(mapping.accent5, ColorSchemeIndex::Accent5);
    assert_eq!(mapping.accent6, ColorSchemeIndex::Accent6);
    assert_eq!(mapping.hlink, ColorSchemeIndex::Hlink);
    assert_eq!(mapping.fol_hlink, ColorSchemeIndex::FolHlink);
    assert!(mapping.ext_lst.is_none());
}

#[test]
fn test_color_mapping_default_is_identity() {
    let m1 = ColorMapping::default();
    let m2 = ColorMapping::identity();
    assert_eq!(m1, m2);
}

// -----------------------------------------------------------------------
// ColorMappingOverride tests
// -----------------------------------------------------------------------

#[test]
fn test_color_mapping_override_default() {
    let o = ColorMappingOverride::default();
    assert!(matches!(o, ColorMappingOverride::MasterClrMapping));
}

#[test]
fn test_color_mapping_override_with_mapping() {
    let mapping = ColorMapping::identity();
    let o = ColorMappingOverride::OverrideClrMapping(mapping);
    assert!(matches!(o, ColorMappingOverride::OverrideClrMapping(_)));
}

// -----------------------------------------------------------------------
// FormatScheme tests
// -----------------------------------------------------------------------

#[test]
fn test_format_scheme_default() {
    let fs = FormatScheme::default();
    assert_eq!(fs.name, "");
    assert!(fs.fill_style_lst.is_empty());
    assert!(fs.ln_style_lst.is_empty());
    assert!(fs.effect_style_lst.is_empty());
    assert!(fs.bg_fill_style_lst.is_empty());
}

// -----------------------------------------------------------------------
// EffectStyleItem tests
// -----------------------------------------------------------------------

#[test]
fn test_effect_style_item_default() {
    let item = EffectStyleItem::default();
    assert!(item.effect_properties.is_none());
    assert!(item.scene_3d.is_none());
    assert!(item.sp_3d.is_none());
}

// -----------------------------------------------------------------------
// BaseStyles tests
// -----------------------------------------------------------------------

#[test]
fn test_base_styles_default() {
    let bs = BaseStyles::default();
    assert_eq!(bs.clr_scheme, ColorScheme::default());
    assert_eq!(bs.font_scheme, FontScheme::default());
    assert_eq!(bs.fmt_scheme, FormatScheme::default());
    assert!(bs.ext_lst.is_none());
}

// -----------------------------------------------------------------------
// BaseStylesOverride tests
// -----------------------------------------------------------------------

#[test]
fn test_base_styles_override_default() {
    let bso = BaseStylesOverride::default();
    assert!(bso.clr_scheme.is_none());
    assert!(bso.font_scheme.is_none());
    assert!(bso.fmt_scheme.is_none());
}

// -----------------------------------------------------------------------
// OfficeStyleSheet tests
// -----------------------------------------------------------------------

#[test]
fn test_office_style_sheet_default() {
    let sheet = OfficeStyleSheet::default();
    assert_eq!(sheet.name, "");
    assert_eq!(sheet.theme_elements, BaseStyles::default());
    assert!(sheet.object_defaults.is_none());
    assert!(sheet.extra_clr_scheme_lst.is_none());
    assert!(sheet.cust_clr_lst.is_none());
    assert!(sheet.ext_lst.is_none());
}

// -----------------------------------------------------------------------
// CustomColor / CustomColorList tests
// -----------------------------------------------------------------------

#[test]
fn test_custom_color_construction() {
    let cc = CustomColor {
        name: Some("My Red".to_string()),
        color: DrawingColor::SrgbClr {
            val: "FF0000".to_string(),
            transforms: vec![],
        },
    };
    assert_eq!(cc.name, Some("My Red".to_string()));
}

#[test]
fn test_custom_color_list_default() {
    let ccl = CustomColorList::default();
    assert!(ccl.cust_clr.is_empty());
}

// -----------------------------------------------------------------------
// ObjectStyleDefaults tests
// -----------------------------------------------------------------------

#[test]
fn test_object_style_defaults_default() {
    let osd = ObjectStyleDefaults::default();
    assert!(osd.sp_def.is_none());
    assert!(osd.ln_def.is_none());
    assert!(osd.tx_def.is_none());
    assert!(osd.ext_lst.is_none());
}

// -----------------------------------------------------------------------
// DefaultShapeDefinition tests
// -----------------------------------------------------------------------

#[test]
fn test_default_shape_definition() {
    let dsd = DefaultShapeDefinition::default();
    assert!(dsd.raw_xml.is_none());

    let dsd2 = DefaultShapeDefinition {
        raw_xml: Some("<xml/>".to_string()),
    };
    assert_eq!(dsd2.raw_xml, Some("<xml/>".to_string()));
}

// -----------------------------------------------------------------------
// ColorSchemeAndMapping tests
// -----------------------------------------------------------------------

#[test]
fn test_color_scheme_and_mapping() {
    let csm = ColorSchemeAndMapping {
        clr_scheme: ColorScheme::default(),
        clr_map: Some(ColorMapping::identity()),
    };
    assert!(csm.clr_map.is_some());
}

// -----------------------------------------------------------------------
// ColorSchemeList tests
// -----------------------------------------------------------------------

#[test]
fn test_color_scheme_list_default() {
    let csl = ColorSchemeList::default();
    assert!(csl.extra_clr_scheme.is_empty());
}

// -----------------------------------------------------------------------
// ClipboardStyleSheet tests
// -----------------------------------------------------------------------

#[test]
fn test_clipboard_style_sheet() {
    let css = ClipboardStyleSheet {
        theme_elements: BaseStyles::default(),
        clr_map: ColorMapping::identity(),
    };
    assert_eq!(css.clr_map, ColorMapping::identity());
}

#[test]
fn test_clipboard_style_sheet_fields_no_default_requirement() {
    let css = ClipboardStyleSheet {
        theme_elements: BaseStyles::default(),
        clr_map: ColorMapping::default(),
    };
    assert_eq!(css.theme_elements, BaseStyles::default());
    assert_eq!(css.clr_map, ColorMapping::identity());
}
