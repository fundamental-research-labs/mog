use super::common::*;

#[test]
fn test_run_props_all_attributes() {
    use ooxml_types::drawings::{
        Paragraph, RunProperties, TextBody, TextBodyProperties, TextCapsType, TextRun,
        TextRunContent, TextStrikeType, TextUnderlineType,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "RunPropsAll".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "styled".to_string(),
                        props: RunProperties {
                            kumimoji: Some(true),
                            lang: Some("ja-JP".to_string()),
                            alt_lang: Some("en-US".to_string()),
                            size: Some(StTextFontSize::new_unchecked(2400)),
                            bold: Some(true),
                            italic: Some(true),
                            underline: Some(TextUnderlineType::Double),
                            strike: Some(TextStrikeType::SingleStrike),
                            kern: Some(StTextNonNegativePoint::new_unchecked(1200)),
                            cap: Some(TextCapsType::All),
                            spacing: Some(StTextPoint::new(300)),
                            normalize_h: Some(true),
                            baseline: Some(StPercentage::new(30000)),
                            no_proof: Some(true),
                            dirty: Some(false),
                            err: Some(false),
                            smt_clean: Some(true),
                            smt_id: Some(42),
                            bmk: Some("bookmark1".to_string()),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("kumimoji=\"1\""), "kumimoji");
    assert!(xml_str.contains("lang=\"ja-JP\""), "lang");
    assert!(xml_str.contains("altLang=\"en-US\""), "alt lang");
    assert!(xml_str.contains("sz=\"2400\""), "size");
    assert!(xml_str.contains("b=\"1\""), "bold");
    assert!(xml_str.contains("i=\"1\""), "italic");
    assert!(xml_str.contains("u=\"dbl\""), "underline double");
    assert!(xml_str.contains("strike=\"sngStrike\""), "strike");
    assert!(xml_str.contains("kern=\"1200\""), "kern");
    assert!(xml_str.contains("cap=\"all\""), "cap");
    assert!(xml_str.contains("spc=\"300\""), "spacing");
    assert!(xml_str.contains("normalizeH=\"1\""), "normalize h");
    assert!(xml_str.contains("baseline=\"30000\""), "baseline");
    assert!(xml_str.contains("noProof=\"1\""), "no proof");
    assert!(xml_str.contains("dirty=\"0\""), "dirty");
    assert!(xml_str.contains("err=\"0\""), "err");
    assert!(xml_str.contains("smtClean=\"1\""), "smt clean");
    assert!(xml_str.contains("smtId=\"42\""), "smt id");
    assert!(xml_str.contains("bmk=\"bookmark1\""), "bookmark");
}

#[test]
fn test_run_props_with_fonts_and_color() {
    use ooxml_types::drawings::{
        DrawingColor, Paragraph, RunProperties, TextBody, TextBodyProperties, TextFont, TextRun,
        TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "Fonts".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "fonted".to_string(),
                        props: RunProperties {
                            latin: Some(TextFont {
                                typeface: "Calibri".to_string(),
                                panose: Some("020F0502020204030204".to_string()),
                                pitch_family: Some(StPitchFamily::new(34)),
                                charset: Some(0),
                            }),
                            ea: Some(TextFont {
                                typeface: "+mn-ea".to_string(),
                                panose: None,
                                pitch_family: None,
                                charset: None,
                            }),
                            cs: Some(TextFont {
                                typeface: "+mn-cs".to_string(),
                                panose: None,
                                pitch_family: None,
                                charset: None,
                            }),
                            color: Some(DrawingColor::SrgbClr {
                                val: "FF0000".to_string(),
                                transforms: vec![],
                            }),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:latin typeface=\"Calibri\" panose=\"020F0502020204030204\" pitchFamily=\"34\" charset=\"0\"/>"),
        "latin font with all attrs"
    );
    assert!(
        xml_str.contains("<a:ea typeface=\"+mn-ea\"/>"),
        "ea font minimal"
    );
    assert!(
        xml_str.contains("<a:cs typeface=\"+mn-cs\"/>"),
        "cs font minimal"
    );
    assert!(
        xml_str.contains("<a:solidFill><a:srgbClr val=\"FF0000\"/></a:solidFill>"),
        "text color"
    );
}

#[test]
fn test_run_props_with_hyperlink() {
    use ooxml_types::drawings::{
        Hyperlink, Paragraph, RunProperties, TextBody, TextBodyProperties, TextRun, TextRunContent,
    };

    let mut writer = DrawingWriter::new();
    writer.add_text_box(
        CellAnchor::default(),
        CellAnchor::default(),
        TextBox {
            original_id: None,
            name: "Hlink".to_string(),
            text_body: Some(TextBody {
                body_props: TextBodyProperties::default(),
                paragraphs: vec![Paragraph {
                    runs: vec![TextRunContent::Run(TextRun {
                        text: "click me".to_string(),
                        props: RunProperties {
                            hlink_click: Some(Hyperlink {
                                r_id: Some("rId3".to_string()),
                                tooltip: Some("Go to site".to_string()),
                                ..Default::default()
                            }),
                            hlink_mouse_over: Some(Hyperlink {
                                r_id: Some("rId4".to_string()),
                                action: Some(
                                    "ppaction://hlinkshowjump?jump=firstslide".to_string(),
                                ),
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                    })],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            fill: None,
            outline: None,
            style: None,
            ..Default::default()
        },
    );

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(
        xml_str.contains("<a:hlinkClick r:id=\"rId3\" tooltip=\"Go to site\"/>"),
        "hlink click"
    );
    assert!(
        xml_str.contains(
            "<a:hlinkMouseOver r:id=\"rId4\" action=\"ppaction://hlinkshowjump?jump=firstslide\"/>"
        ),
        "hlink mouse over"
    );
}
