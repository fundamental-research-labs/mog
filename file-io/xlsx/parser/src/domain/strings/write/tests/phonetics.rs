use super::super::SharedStringsWriter;

#[test]
fn raw_phonetic_xml_is_passed_through() {
    let mut sst = SharedStringsWriter::new();
    sst.add_rich_shared_string(domain_types::RichSharedString {
        plain_text: "Tokyo".to_string(),
        phonetic_xml: Some(b"<rPh sb=\"0\" eb=\"5\"><t>raw</t></rPh>".to_vec()),
        ..Default::default()
    });

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("<t>Tokyo</t><rPh sb=\"0\" eb=\"5\"><t>raw</t></rPh>"));
}

#[test]
fn typed_phonetic_runs_and_properties_are_emitted() {
    let mut sst = SharedStringsWriter::new();
    sst.add_rich_shared_string(domain_types::RichSharedString {
        plain_text: "Tokyo".to_string(),
        phonetic_runs: vec![domain_types::PhoneticRun {
            text: "To&kyo".to_string(),
            start_index: 0,
            end_index: 5,
        }],
        phonetic_properties: Some(domain_types::PhoneticProperties {
            font_id: Some(1),
            phonetic_type: Some("fullwidthKatakana".to_string()),
            alignment: Some("center\"x".to_string()),
        }),
        ..Default::default()
    });

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("<rPh sb=\"0\" eb=\"5\"><t>To&amp;kyo</t></rPh>"));
    assert!(xml.contains(
        "<phoneticPr fontId=\"1\" type=\"fullwidthKatakana\" alignment=\"center&quot;x\"/>"
    ));
}
