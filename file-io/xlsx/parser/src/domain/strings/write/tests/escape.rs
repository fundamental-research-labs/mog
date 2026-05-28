use super::super::SharedStringsWriter;

#[test]
fn test_xml_escaping() {
    let mut sst = SharedStringsWriter::new();
    sst.add("A & B");
    sst.add("<tag>");
    sst.add("x > y");

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("A &amp; B"));
    assert!(xml_str.contains("&lt;tag&gt;"));
    assert!(xml_str.contains("x &gt; y"));
}

#[test]
fn test_whitespace_preservation() {
    let mut sst = SharedStringsWriter::new();
    sst.add("  leading");
    sst.add("trailing  ");
    sst.add("normal");

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<t xml:space=\"preserve\">  leading</t>"));
    assert!(xml_str.contains("<t xml:space=\"preserve\">trailing  </t>"));
    assert!(xml_str.contains("<t>normal</t>"));
}

#[test]
fn test_newline_preservation() {
    let mut sst = SharedStringsWriter::new();
    sst.add("Line1\nLine2");

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Newlines are preserved by XML 1.0 without xml:space="preserve",
    // so we no longer emit it just for internal newlines (matches Excel).
    assert!(!xml_str.contains("xml:space=\"preserve\""));
    assert!(xml_str.contains("Line1\nLine2"));
}

#[test]
fn test_unicode_strings() {
    let mut sst = SharedStringsWriter::new();
    sst.add("Hello");
    sst.add("Caf\u{00E9}");
    sst.add("\u{4E2D}\u{6587}");
    sst.add("\u{1F600}"); // Emoji

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("Hello"));
    assert!(xml_str.contains("Caf\u{00E9}"));
    assert!(xml_str.contains("\u{4E2D}\u{6587}"));
    assert!(xml_str.contains("\u{1F600}"));
}

#[test]
fn literal_xhhhh_sequences_are_escaped() {
    let mut sst = SharedStringsWriter::new();
    sst.add("_x000D_");

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("_x005F_x000D_"));
}

#[test]
fn control_characters_are_escaped() {
    let mut sst = SharedStringsWriter::new();
    sst.add("A\u{0001}B");

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");
    assert!(xml.contains("A_x0001_B"));
}
