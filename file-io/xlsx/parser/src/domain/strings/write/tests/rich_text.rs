use super::super::{RichTextRun, SharedStringsWriter};

#[test]
fn test_rich_text_run_has_formatting() {
    let plain = RichTextRun::new("Text");
    assert!(!plain.has_formatting());

    let bold = RichTextRun {
        text: "Bold".to_string(),
        bold: Some(true),
        ..Default::default()
    };
    assert!(bold.has_formatting());

    let with_font = RichTextRun {
        text: "Font".to_string(),
        font_name: Some("Arial".to_string()),
        ..Default::default()
    };
    assert!(with_font.has_formatting());
}

#[test]
fn false_formatting_options_still_emit_rpr() {
    let mut sst = SharedStringsWriter::new();
    sst.add_rich_text(vec![RichTextRun {
        text: "Plain-looking".to_string(),
        bold: Some(false),
        ..Default::default()
    }]);

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("<r><rPr></rPr><t>Plain-looking</t></r>"));
}

#[test]
fn test_rich_text_xml() {
    let mut sst = SharedStringsWriter::new();

    let runs = vec![
        RichTextRun {
            text: "Bold".to_string(),
            bold: Some(true),
            ..Default::default()
        },
        RichTextRun {
            text: " normal".to_string(),
            ..Default::default()
        },
    ];

    sst.add_rich_text(runs);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Note: " normal" starts with space, so xml:space="preserve" is added
    assert!(xml_str.contains(
        "<si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space=\"preserve\"> normal</t></r></si>"
    ));
}

#[test]
fn test_rich_text_with_formatting() {
    let mut sst = SharedStringsWriter::new();

    let runs = vec![RichTextRun {
        text: "Styled".to_string(),
        bold: Some(true),
        italic: Some(true),
        font_size: Some(12.0),
        color: Some("FF0000".to_string()),
        font_name: Some("Arial".to_string()),
        ..Default::default()
    }];

    sst.add_rich_text(runs);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<b/>"));
    assert!(xml_str.contains("<i/>"));
    assert!(xml_str.contains("<sz val=\"12\"/>"));
    assert!(xml_str.contains("<color rgb=\"FFFF0000\"/>")); // Note: FF prepended
    assert!(xml_str.contains("<rFont val=\"Arial\"/>"));
}

#[test]
fn test_rich_text_underline_and_strike() {
    let mut sst = SharedStringsWriter::new();

    let runs = vec![RichTextRun {
        text: "Decorated".to_string(),
        underline: Some(true),
        strike: Some(true),
        ..Default::default()
    }];

    sst.add_rich_text(runs);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<u/>"));
    assert!(xml_str.contains("<strike/>"));
}

#[test]
fn test_special_characters_in_font_name() {
    let mut sst = SharedStringsWriter::new();

    let runs = vec![RichTextRun {
        text: "Text".to_string(),
        font_name: Some("Font \"Special\" & <Name>".to_string()),
        ..Default::default()
    }];

    sst.add_rich_text(runs);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Font name should be escaped
    assert!(xml_str.contains("&quot;"));
    assert!(xml_str.contains("&amp;"));
    assert!(xml_str.contains("&lt;"));
    assert!(xml_str.contains("&gt;"));
}

#[test]
fn test_font_size_formatting() {
    let mut sst = SharedStringsWriter::new();

    // Whole number
    let runs1 = vec![RichTextRun {
        text: "Whole".to_string(),
        font_size: Some(12.0),
        ..Default::default()
    }];
    sst.add_rich_text(runs1);

    // Decimal
    let runs2 = vec![RichTextRun {
        text: "Decimal".to_string(),
        font_size: Some(11.5),
        ..Default::default()
    }];
    sst.add_rich_text(runs2);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<sz val=\"12\"/>")); // Whole number
    assert!(xml_str.contains("<sz val=\"11.5\"/>")); // Decimal
}

#[test]
fn test_color_rgb_format() {
    let mut sst = SharedStringsWriter::new();

    // 6-char RGB (should get FF prepended)
    let runs1 = vec![RichTextRun {
        text: "Red".to_string(),
        color: Some("FF0000".to_string()),
        ..Default::default()
    }];
    sst.add_rich_text(runs1);

    // 8-char ARGB (should stay as-is)
    let runs2 = vec![RichTextRun {
        text: "Transparent".to_string(),
        color: Some("80FF0000".to_string()),
        ..Default::default()
    }];
    sst.add_rich_text(runs2);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<color rgb=\"FFFF0000\"/>")); // FF prepended
    assert!(xml_str.contains("<color rgb=\"80FF0000\"/>")); // Unchanged
}
