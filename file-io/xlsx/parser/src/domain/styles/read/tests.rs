use super::*;
use crate::infra::xml::decode_xml_entities;

#[test]
fn test_parse_empty_styles() {
    let xml = b"<?xml version=\"1.0\"?><styleSheet></styleSheet>";
    let styles = parse_styles(xml);
    assert!(styles.num_fmts.is_empty());
    assert!(styles.cell_xfs.is_empty());
}

#[test]
fn test_parse_num_fmts() {
    let xml = br###"<?xml version="1.0"?>
<styleSheet>
    <numFmts count="2">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
        <numFmt numFmtId="165" formatCode="#,##0.000"/>
    </numFmts>
</styleSheet>"###;

    let styles = parse_styles(xml);
    assert_eq!(styles.num_fmts.len(), 2);

    assert_eq!(styles.num_fmts[0].id, 164);
    assert_eq!(styles.num_fmts[0].format_code, "yyyy-mm-dd");

    assert_eq!(styles.num_fmts[1].id, 165);
    assert_eq!(styles.num_fmts[1].format_code, "#,##0.000");
}

#[test]
fn test_parse_cell_xfs() {
    let xml = br#"<?xml version="1.0"?>
<styleSheet>
    <cellXfs count="3">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
        <xf numFmtId="14" fontId="1" fillId="0" borderId="0" applyNumberFormat="1"/>
        <xf numFmtId="164" fontId="0" fillId="1" borderId="1" applyNumberFormat="true"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);
    assert_eq!(styles.cell_xfs.len(), 3);

    // Default style
    assert_eq!(styles.cell_xfs[0].num_fmt_id, Some(0));
    assert_eq!(styles.cell_xfs[0].font_id, Some(0));
    assert_eq!(styles.cell_xfs[0].apply_number_format, None);

    // Date style (built-in format 14)
    assert_eq!(styles.cell_xfs[1].num_fmt_id, Some(14));
    assert_eq!(styles.cell_xfs[1].font_id, Some(1));
    assert_eq!(styles.cell_xfs[1].apply_number_format, Some(true));

    // Custom format style
    assert_eq!(styles.cell_xfs[2].num_fmt_id, Some(164));
    assert_eq!(styles.cell_xfs[2].fill_id, Some(1));
    assert_eq!(styles.cell_xfs[2].border_id, Some(1));
    assert_eq!(styles.cell_xfs[2].apply_number_format, Some(true));
}

#[test]
fn test_get_number_format_builtin() {
    let xml = br#"<styleSheet>
    <cellXfs count="2">
        <xf numFmtId="0"/>
        <xf numFmtId="14"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);

    assert_eq!(get_number_format(&styles, 0), Some("General"));
    assert_eq!(get_number_format(&styles, 1), Some("m/d/yyyy"));
}

#[test]
fn test_get_number_format_custom() {
    let xml = br#"<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>
    </numFmts>
    <cellXfs count="2">
        <xf numFmtId="0"/>
        <xf numFmtId="164"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);

    assert_eq!(get_number_format(&styles, 0), Some("General"));
    assert_eq!(get_number_format(&styles, 1), Some("yyyy-mm-dd hh:mm:ss"));
}

#[test]
fn test_get_number_format_invalid_index() {
    let xml = br#"<styleSheet>
    <cellXfs count="1">
        <xf numFmtId="0"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);
    assert_eq!(get_number_format(&styles, 99), None);
}

#[test]
fn test_is_date_format_builtin() {
    let xml = br#"<styleSheet>
    <cellXfs count="5">
        <xf numFmtId="0"/>
        <xf numFmtId="14"/>
        <xf numFmtId="22"/>
        <xf numFmtId="45"/>
        <xf numFmtId="4"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);

    assert!(!is_date_format(&styles, 0), "General should not be date");
    assert!(is_date_format(&styles, 1), "m/d/yyyy should be date");
    assert!(is_date_format(&styles, 2), "m/d/yyyy h:mm should be date");
    assert!(is_date_format(&styles, 3), "mm:ss should be date/time");
    assert!(!is_date_format(&styles, 4), "#,##0.00 should not be date");
}

#[test]
fn test_is_date_format_custom() {
    let xml = br###"<styleSheet>
    <numFmts count="3">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
        <numFmt numFmtId="165" formatCode="#,##0.00"/>
        <numFmt numFmtId="166" formatCode="h:mm AM/PM"/>
    </numFmts>
    <cellXfs count="3">
        <xf numFmtId="164"/>
        <xf numFmtId="165"/>
        <xf numFmtId="166"/>
    </cellXfs>
</styleSheet>"###;

    let styles = parse_styles(xml);

    assert!(is_date_format(&styles, 0), "yyyy-mm-dd should be date");
    assert!(!is_date_format(&styles, 1), "#,##0.00 should not be date");
    assert!(is_date_format(&styles, 2), "h:mm AM/PM should be time/date");
}

#[test]
fn test_builtin_format_coverage() {
    // Test key built-in formats
    assert_eq!(builtin_format(0), Some("General"));
    assert_eq!(builtin_format(1), Some("0"));
    assert_eq!(builtin_format(14), Some("m/d/yyyy"));
    assert_eq!(builtin_format(22), Some("m/d/yyyy h:mm"));
    assert_eq!(builtin_format(49), Some("@"));

    // Unknown format
    assert_eq!(builtin_format(100), None);
    assert_eq!(builtin_format(164), None); // Custom formats start here
}

#[test]
fn test_is_builtin_date_format() {
    // Date formats
    assert!(is_builtin_date_format(14));
    assert!(is_builtin_date_format(15));
    assert!(is_builtin_date_format(22));
    assert!(is_builtin_date_format(27));
    assert!(is_builtin_date_format(45));
    assert!(is_builtin_date_format(50));

    // Non-date formats
    assert!(!is_builtin_date_format(0));
    assert!(!is_builtin_date_format(1));
    assert!(!is_builtin_date_format(9));
    assert!(!is_builtin_date_format(37));
    assert!(!is_builtin_date_format(49));
}

#[test]
fn test_is_date_format_code() {
    // Date formats
    assert!(is_date_format_code("yyyy-mm-dd"));
    assert!(is_date_format_code("m/d/yyyy"));
    assert!(is_date_format_code("d-mmm-yy"));
    assert!(is_date_format_code("mmm yyyy"));
    assert!(is_date_format_code("h:mm:ss"));
    assert!(is_date_format_code("h:mm AM/PM"));

    // Non-date formats
    assert!(!is_date_format_code("General"));
    assert!(!is_date_format_code("#,##0.00"));
    assert!(!is_date_format_code("0%"));
    assert!(!is_date_format_code("@"));
}

#[test]
fn test_decode_xml_entities() {
    assert_eq!(decode_xml_entities(b"hello"), "hello");
    assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
    assert_eq!(decode_xml_entities(b"&amp;"), "&");
    assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
    assert_eq!(decode_xml_entities(b"&apos;"), "'");
    assert_eq!(
        decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
        "a < b && c > d"
    );
}

#[test]
fn test_parse_with_xml_entities_in_format() {
    let xml = br##"<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/>
    </numFmts>
</styleSheet>"##;

    let styles = parse_styles(xml);
    assert_eq!(styles.num_fmts.len(), 1);
    assert_eq!(styles.num_fmts[0].format_code, "\"$\"#,##0");
}

#[test]
fn test_parse_numfmt_with_gt_lt_in_formatcode() {
    // Regression: formatCode with literal > and &lt; was being truncated
    let xml = br#"<styleSheet>
    <numFmts count="3">
        <numFmt numFmtId="251" formatCode="0.00\%;\-0.00\%;0.00\%"/>
        <numFmt numFmtId="252" formatCode="[Red][>0.05]\ 0%;[Red][&lt;-0.05]\ 0%;0%"/>
        <numFmt numFmtId="253" formatCode="0.00;\-0.00;0.00"/>
    </numFmts>
</styleSheet>"#;

    let styles = parse_styles(xml);
    assert_eq!(styles.num_fmts.len(), 3);
    assert_eq!(styles.num_fmts[0].id, 251);
    assert_eq!(styles.num_fmts[1].id, 252);
    assert_eq!(
        styles.num_fmts[1].format_code,
        r"[Red][>0.05]\ 0%;[Red][<-0.05]\ 0%;0%"
    );
    assert_eq!(styles.num_fmts[2].id, 253);
    assert_eq!(styles.num_fmts[2].format_code, r"0.00;\-0.00;0.00");
}

#[test]
fn test_realistic_styles_xml() {
    // A more realistic styles.xml structure
    let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/>
    </numFmts>
    <fonts count="2">
        <font><sz val="11"/><name val="Calibri"/></font>
        <font><b/><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="2">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
    </fills>
    <borders count="1">
        <border><left/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="4">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    </cellXfs>
</styleSheet>"#;

    let styles = parse_styles(xml);

    // Check number formats
    assert_eq!(styles.num_fmts.len(), 1);
    assert_eq!(styles.num_fmts[0].id, 164);

    // Check cell styles
    assert_eq!(styles.cell_xfs.len(), 4);

    // Style 0: Default
    assert!(!is_date_format(&styles, 0));

    // Style 1: Bold (no number format change)
    assert!(!is_date_format(&styles, 1));

    // Style 2: Built-in date format
    assert!(is_date_format(&styles, 2));
    assert_eq!(get_number_format(&styles, 2), Some("m/d/yyyy"));

    // Style 3: Custom date format
    assert!(is_date_format(&styles, 3));
}

#[test]
fn test_parse_cell_xfs_with_alignment() {
    let xml = br#"<cellXfs count="2">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1">
                <alignment horizontal="center" vertical="center" wrapText="1"/>
            </xf>
            <xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>
        </cellXfs>"#;
    let mut styles = Stylesheet::default();
    parse_cell_xfs(&mut styles.cell_xfs, xml);
    assert_eq!(styles.cell_xfs.len(), 2);

    let xf = &styles.cell_xfs[0];
    assert_eq!(xf.apply_alignment, Some(true));
    let align = xf.alignment.as_ref().unwrap();
    assert_eq!(align.horizontal, Some(HorizontalAlign::Center));
    assert_eq!(align.vertical, Some(VerticalAlign::Center));
    assert_eq!(align.wrap_text, Some(true));

    let xf2 = &styles.cell_xfs[1];
    assert_eq!(xf2.apply_alignment, None);
    assert!(xf2.alignment.is_none());
}

#[test]
fn test_parse_cell_xfs_with_protection() {
    let xml = br#"<cellXfs count="1">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyProtection="1">
                <protection locked="0" hidden="1"/>
            </xf>
        </cellXfs>"#;
    let mut styles = Stylesheet::default();
    parse_cell_xfs(&mut styles.cell_xfs, xml);
    assert_eq!(styles.cell_xfs.len(), 1);

    let xf = &styles.cell_xfs[0];
    assert_eq!(xf.apply_protection, Some(true));
    let prot = xf.protection.as_ref().unwrap();
    assert_eq!(prot.locked, Some(false));
    assert_eq!(prot.hidden, Some(true));
}

#[test]
fn test_parse_cell_xfs_self_closing() {
    let xml = br#"<cellXfs count="1">
            <xf numFmtId="164" fontId="2" fillId="3" borderId="1" applyFont="1"/>
        </cellXfs>"#;
    let mut styles = Stylesheet::default();
    parse_cell_xfs(&mut styles.cell_xfs, xml);
    assert_eq!(styles.cell_xfs.len(), 1);
    assert_eq!(styles.cell_xfs[0].num_fmt_id, Some(164));
    assert!(styles.cell_xfs[0].alignment.is_none());
    assert!(styles.cell_xfs[0].protection.is_none());
}

#[test]
fn test_parse_font_vert_align() {
    let xml = br#"<fonts count="1">
            <font>
                <sz val="11"/>
                <name val="Calibri"/>
                <vertAlign val="superscript"/>
            </font>
        </fonts>"#;
    let mut styles = Stylesheet::default();
    parse_fonts(&mut styles.fonts, xml);
    assert_eq!(styles.fonts.len(), 1);
    assert_eq!(
        styles.fonts[0].vert_align,
        Some(VerticalAlignRun::Superscript)
    );
}

#[test]
fn test_parse_font_no_vert_align() {
    let xml = br#"<fonts count="1">
            <font>
                <sz val="11"/>
                <name val="Calibri"/>
            </font>
        </fonts>"#;
    let mut styles = Stylesheet::default();
    parse_fonts(&mut styles.fonts, xml);
    assert_eq!(styles.fonts.len(), 1);
    assert!(styles.fonts[0].vert_align.is_none());
}

#[test]
fn test_parse_cell_style_xfs() {
    let xml = br#"<styleSheet>
    <cellStyleXfs count="2">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
        <xf numFmtId="9" fontId="1" fillId="0" borderId="0"/>
    </cellStyleXfs>
</styleSheet>"#;
    let styles = parse_styles(xml);
    assert_eq!(styles.cell_style_xfs.len(), 2);
    assert_eq!(styles.cell_style_xfs[0].num_fmt_id, Some(0));
    assert_eq!(styles.cell_style_xfs[1].num_fmt_id, Some(9));
    assert_eq!(styles.cell_style_xfs[1].font_id, Some(1));
}

#[test]
fn test_parse_cell_styles_section() {
    let xml = b"<cellStyles count=\"2\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/><cellStyle name=\"Percent\" xfId=\"1\" builtinId=\"5\"/></cellStyles>";
    let result = parse_cell_styles(xml);
    assert_eq!(result.len(), 2);
    assert_eq!(result[0].effective_name(), "Normal");
    assert_eq!(result[0].xf_id, 0);
    assert_eq!(result[0].builtin_id, Some(0));
    assert!(!result[0].effective_custom_builtin());
    assert_eq!(result[1].effective_name(), "Percent");
    assert_eq!(result[1].xf_id, 1);
    assert_eq!(result[1].builtin_id, Some(5));
}

#[test]
fn test_parse_cell_styles_with_custom_builtin() {
    let xml = b"<cellStyles count=\"1\"><cellStyle name=\"MyStyle\" xfId=\"2\" builtinId=\"3\" customBuiltin=\"1\"/></cellStyles>";
    let result = parse_cell_styles(xml);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].effective_name(), "MyStyle");
    assert!(result[0].effective_custom_builtin());
}

#[test]
fn test_parse_cell_styles_with_ext_lst() {
    let xml = br#"<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"><extLst><ext uri="style"/></extLst></cellStyle></cellStyles>"#;
    let result = parse_cell_styles(xml);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].effective_name(), "Normal");
    assert_eq!(
        result[0]
            .ext_lst
            .as_ref()
            .and_then(|e| e.raw_xml.as_deref()),
        Some(r#"<extLst><ext uri="style"/></extLst>"#)
    );
}

#[test]
fn test_parse_dxfs_section() {
    let xml = b"<dxfs count=\"1\"><dxf><font><b/><color rgb=\"FFFF0000\"/></font></dxf></dxfs>";
    let result = parse_dxfs(xml);
    assert_eq!(result.len(), 1);
    let dxf = &result[0];
    assert!(dxf.font.is_some());
    let font = dxf.font.as_ref().unwrap();
    assert_eq!(font.bold, Some(true));
    assert!(matches!(font.color, Some(ColorDef::Rgb { ref val, .. }) if val == "FFFF0000"));
}

#[test]
fn test_parse_dxfs_with_ext_lst() {
    let xml =
        br#"<dxfs count="1"><dxf><font><b/></font><extLst><ext uri="dxf"/></extLst></dxf></dxfs>"#;
    let result = parse_dxfs(xml);
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0]
            .ext_lst
            .as_ref()
            .and_then(|e| e.raw_xml.as_deref()),
        Some(r#"<extLst><ext uri="dxf"/></extLst>"#)
    );
}

#[test]
fn test_parse_dxfs_with_gradient_fill() {
    let xml = br#"<dxfs count="1"><dxf><fill><gradientFill degree="45"><stop position="0"><color theme="1" tint="0.2"/></stop><stop position="1"><color rgb="FFFFFFFF"/></stop></gradientFill></fill></dxf></dxfs>"#;
    let result = parse_dxfs(xml);
    assert_eq!(result.len(), 1);
    let fill = result[0].fill.as_ref().unwrap();
    match fill {
        FillDef::Gradient {
            gradient_type,
            degree,
            stops,
            ..
        } => {
            assert_eq!(*gradient_type, GradientType::Linear);
            assert_eq!(*degree, Some(45.0));
            assert_eq!(stops.len(), 2);
            assert_eq!(
                stops[0].color,
                ColorDef::Theme {
                    id: 1,
                    tint: Some("0.2".to_string())
                }
            );
        }
        other => panic!("expected gradient fill, got {other:?}"),
    }
}

#[test]
fn test_parse_dxfs_with_numfmt() {
    let xml =
        br##"<dxfs count="1"><dxf><numFmt numFmtId="164" formatCode="#,##0.00"/></dxf></dxfs>"##;
    let result = parse_dxfs(xml);
    assert_eq!(result.len(), 1);
    let nf = result[0].num_fmt.as_ref().unwrap();
    assert_eq!(nf.id, 164);
    assert_eq!(nf.format_code, "#,##0.00");
}

#[test]
fn test_parse_dxfs_empty() {
    let xml = b"<dxfs count=\"1\"><dxf/></dxfs>";
    let result = parse_dxfs(xml);
    assert_eq!(result.len(), 1);
    assert!(result[0].font.is_none());
    assert!(result[0].num_fmt.is_none());
    assert!(result[0].fill.is_none());
    assert!(result[0].border.is_none());
}

#[test]
fn test_parse_colors_section() {
    let xml = b"<colors><indexedColors><rgbColor rgb=\"FF000000\"/><rgbColor rgb=\"FFFFFFFF\"/></indexedColors><mruColors><color rgb=\"FFFF0000\"/></mruColors></colors>";
    let result = parse_colors(xml);
    assert_eq!(result.indexed_colors.len(), 2);
    assert_eq!(result.indexed_colors[0], "FF000000");
    assert_eq!(result.indexed_colors[1], "FFFFFFFF");
    assert_eq!(result.mru_colors.len(), 1);
    assert_eq!(result.mru_colors[0], ColorDef::rgb("FFFF0000"));
}

#[test]
fn test_parse_mru_colors_full_ct_color_variants() {
    let xml = br#"<colors><mruColors><color theme="2" tint="0.1"/><color indexed="64" tint="0.2"/><color auto="1" tint="0.3"/><color rgb="FFFF0000" tint="0.4"/></mruColors></colors>"#;
    let result = parse_colors(xml);
    assert_eq!(
        result.mru_colors,
        vec![
            ColorDef::Theme {
                id: 2,
                tint: Some("0.1".to_string())
            },
            ColorDef::Indexed {
                id: 64,
                tint: Some("0.2".to_string())
            },
            ColorDef::Auto {
                tint: Some("0.3".to_string())
            },
            ColorDef::Rgb {
                val: "FFFF0000".to_string(),
                tint: Some("0.4".to_string())
            }
        ]
    );
}

#[test]
fn test_parse_colors_empty() {
    let xml = b"<colors></colors>";
    let result = parse_colors(xml);
    assert!(result.indexed_colors.is_empty());
    assert!(result.mru_colors.is_empty());
}

#[test]
fn test_parse_table_styles_section() {
    let xml = br#"<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"><tableStyle name="TableStyleMedium2" pivot="0" count="2"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="firstRowStripe" dxfId="1" size="1"/></tableStyle></tableStyles>"#;
    let (styles, default_table, default_pivot) = parse_table_styles(xml);
    assert_eq!(styles.len(), 1);
    assert_eq!(styles[0].name, "TableStyleMedium2");
    assert_eq!(styles[0].pivot, Some(false));
    assert_eq!(styles[0].count, Some(2));
    assert_eq!(styles[0].elements.len(), 2);
    assert_eq!(styles[0].elements[0].style_type, TableStyleType::WholeTable);
    assert_eq!(styles[0].elements[0].dxf_id, Some(0));
    assert_eq!(
        styles[0].elements[1].style_type,
        TableStyleType::FirstRowStripe
    );
    assert_eq!(styles[0].elements[1].dxf_id, Some(1));
    assert_eq!(styles[0].elements[1].size, Some(1));
    assert_eq!(default_table, Some("TableStyleMedium2".to_string()));
    assert_eq!(default_pivot, Some("PivotStyleLight16".to_string()));
}

#[test]
fn test_parse_full_stylesheet_with_new_sections() {
    let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/>
    </numFmts>
    <fonts count="1">
        <font><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="1">
        <fill><patternFill patternType="none"/></fill>
    </fills>
    <borders count="1">
        <border><left/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    </cellXfs>
    <cellStyles count="1">
        <cellStyle name="Normal" xfId="0" builtinId="0"/>
    </cellStyles>
    <dxfs count="1">
        <dxf><font><b/></font></dxf>
    </dxfs>
    <colors>
        <mruColors><color rgb="FF00FF00"/></mruColors>
    </colors>
    <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>"#;

    let styles = parse_styles(xml);

    // Existing sections still work
    assert_eq!(styles.num_fmts.len(), 1);
    assert_eq!(styles.fonts.len(), 1);
    assert_eq!(styles.cell_xfs.len(), 1);

    // New sections
    assert_eq!(styles.cell_style_xfs.len(), 1);
    assert_eq!(styles.cell_style_xfs[0].num_fmt_id, Some(0));

    assert_eq!(styles.cell_styles.len(), 1);
    assert_eq!(styles.cell_styles[0].effective_name(), "Normal");
    assert_eq!(styles.cell_styles[0].builtin_id, Some(0));

    assert_eq!(styles.dxfs.len(), 1);
    assert!(styles.dxfs[0].font.is_some());
    assert_eq!(styles.dxfs[0].font.as_ref().unwrap().bold, Some(true));

    let colors = styles.colors.as_ref().unwrap();
    assert_eq!(colors.mru_colors.len(), 1);
    assert_eq!(colors.mru_colors[0], ColorDef::rgb("FF00FF00"));

    assert_eq!(
        styles.default_table_style,
        Some("TableStyleMedium2".to_string())
    );
    assert_eq!(
        styles.default_pivot_style,
        Some("PivotStyleLight16".to_string())
    );
}
