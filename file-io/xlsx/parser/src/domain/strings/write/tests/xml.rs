use super::super::SharedStringsWriter;

#[test]
fn test_empty_xml() {
    let sst = SharedStringsWriter::new();
    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("<?xml version=\"1.0\""));
    assert!(xml_str.contains("count=\"0\""));
    assert!(xml_str.contains("uniqueCount=\"0\""));
}

#[test]
fn test_plain_string_xml() {
    let mut sst = SharedStringsWriter::new();
    sst.add("Hello");
    sst.add("World");

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    assert!(xml_str.contains("count=\"2\""));
    assert!(xml_str.contains("uniqueCount=\"2\""));
    assert!(xml_str.contains("<si><t>Hello</t></si>"));
    assert!(xml_str.contains("<si><t>World</t></si>"));
}

#[test]
fn test_empty_string() {
    let mut sst = SharedStringsWriter::new();
    let idx = sst.add("");

    assert_eq!(idx, 0);

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);
    assert!(xml_str.contains("<si><t></t></si>"));
}

#[test]
fn test_very_long_string() {
    let mut sst = SharedStringsWriter::new();
    let long_string = "A".repeat(10000);
    let idx = sst.add(&long_string);

    assert_eq!(idx, 0);
    assert_eq!(sst.len(), 1);

    let xml = sst.to_xml();
    assert!(xml.len() > 10000);
}

#[test]
fn test_insertion_order_in_xml() {
    let mut sst = SharedStringsWriter::new();

    // Insertion order is the only order: first-inserted emits first,
    // regardless of how many times each string is referenced.
    sst.add("Rare");
    sst.add("Common");
    sst.add("Common");
    sst.add("Common");

    let xml = sst.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    let rare_pos = xml_str.find("<t>Rare</t>").unwrap();
    let common_pos = xml_str.find("<t>Common</t>").unwrap();

    assert!(
        rare_pos < common_pos,
        "Rare was inserted first and must emit first; reordering by \
         frequency would break cell <v> references that store the \
         index add() returned"
    );
}
