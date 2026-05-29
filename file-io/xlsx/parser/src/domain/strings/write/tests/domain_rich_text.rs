use super::super::SharedStringsWriter;

#[test]
fn rich_shared_string_without_runs_falls_back_to_plain_text() {
    let mut sst = SharedStringsWriter::new();
    sst.add_rich_shared_string(domain_types::RichSharedString {
        plain_text: "Plain fallback".to_string(),
        ..Default::default()
    });

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("<si><t>Plain fallback</t></si>"));
}

#[test]
fn domain_rich_text_preserves_color_and_font_fields() {
    let mut sst = SharedStringsWriter::new();
    sst.add_rich_shared_string(domain_types::RichSharedString {
        plain_text: "Styled".to_string(),
        runs: vec![domain_types::RichTextRun {
            text: "Styled".to_string(),
            bold: true,
            italic: true,
            underline: true,
            underline_style: None,
            strikethrough: true,
            font_size: Some(13.5),
            color: Some("FF00AA".to_string()),
            color_indexed: Some(64),
            color_theme: Some(2),
            color_tint: Some(-0.25),
            font_name: Some("A&B".to_string()),
            family: Some(2),
            charset: Some(1),
            scheme: Some("minor".to_string()),
            vert_align: Some("superscript".to_string()),
            preserve_space: true,
            outline: None,
            shadow: None,
            condense: None,
            extend: None,
        }],
        ..Default::default()
    });

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("<b/><i/><u/><strike/>"));
    assert!(xml.contains("<sz val=\"13.5\"/>"));
    assert!(xml.contains("<color rgb=\"FF00AA\" indexed=\"64\" theme=\"2\" tint=\"-0.25\"/>"));
    assert!(xml.contains("<rFont val=\"A&amp;B\"/>"));
    assert!(xml.contains("<family val=\"2\"/>"));
    assert!(xml.contains("<charset val=\"1\"/>"));
    assert!(xml.contains("<scheme val=\"minor\"/>"));
    assert!(xml.contains("<vertAlign val=\"superscript\"/>"));
    assert!(xml.contains("<t xml:space=\"preserve\">Styled</t>"));
}
