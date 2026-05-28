use super::super::{RichTextRun, SharedStringValue, SharedStringsWriter};

#[test]
fn test_new_shared_strings_writer() {
    let sst = SharedStringsWriter::new();
    assert!(sst.is_empty());
    assert_eq!(sst.len(), 0);
    assert_eq!(sst.total_count(), 0);
}

#[test]
fn test_add_plain_string() {
    let mut sst = SharedStringsWriter::new();
    let idx = sst.add("Hello");
    assert_eq!(idx, 0);
    assert_eq!(sst.len(), 1);
    assert_eq!(sst.total_count(), 1);
}

#[test]
fn test_add_multiple_strings() {
    let mut sst = SharedStringsWriter::new();
    let idx1 = sst.add("Hello");
    let idx2 = sst.add("World");
    let idx3 = sst.add("Test");

    assert_eq!(idx1, 0);
    assert_eq!(idx2, 1);
    assert_eq!(idx3, 2);
    assert_eq!(sst.len(), 3);
    assert_eq!(sst.total_count(), 3);
}

#[test]
fn test_deduplication() {
    let mut sst = SharedStringsWriter::new();
    let idx1 = sst.add("Hello");
    let idx2 = sst.add("World");
    let idx3 = sst.add("Hello"); // Duplicate

    assert_eq!(idx1, 0);
    assert_eq!(idx2, 1);
    assert_eq!(idx3, 0); // Same index as first "Hello"
    assert_eq!(sst.len(), 2); // Only 2 unique strings
    assert_eq!(sst.total_count(), 3); // But 3 references
}

#[test]
fn test_reference_counting() {
    let mut sst = SharedStringsWriter::new();
    sst.add("A");
    sst.add("B");
    sst.add("A");
    sst.add("A");
    sst.add("B");

    assert_eq!(sst.len(), 2);
    assert_eq!(sst.total_count(), 5);
}

#[test]
fn test_get_index() {
    let mut sst = SharedStringsWriter::new();
    sst.add("Hello");
    sst.add("World");

    assert_eq!(sst.get_index("Hello"), Some(0));
    assert_eq!(sst.get_index("World"), Some(1));
    assert_eq!(sst.get_index("Missing"), None);
}

#[test]
fn test_add_rich_text() {
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

    let idx = sst.add_rich_text(runs);
    assert_eq!(idx, 0);
    assert_eq!(sst.len(), 1);
}

#[test]
fn test_rich_text_no_deduplication() {
    let mut sst = SharedStringsWriter::new();

    let runs1 = vec![RichTextRun::new("Hello")];
    let runs2 = vec![RichTextRun::new("Hello")];

    let idx1 = sst.add_rich_text(runs1);
    let idx2 = sst.add_rich_text(runs2);

    // Rich text entries are never deduplicated
    assert_eq!(idx1, 0);
    assert_eq!(idx2, 1);
    assert_eq!(sst.len(), 2);
}

#[test]
fn test_add_index_matches_emitted_xml_slot() {
    let mut sst = SharedStringsWriter::new();
    let idx_country = sst.add("Country"); // 1 ref
    let idx_sales = sst.add("Sales"); //    1 ref
    let idx_usa = sst.add("USA"); //        will have 3 refs
    sst.add("USA");
    sst.add("USA");
    let idx_can = sst.add("CAN"); //        1 ref

    let xml = String::from_utf8(sst.to_xml()).expect("valid utf8");

    // Extract `<t>...</t>` text from each `<si>` element in order.
    let strings: Vec<String> = xml
        .split("<si>")
        .skip(1)
        .map(|chunk| {
            let start = chunk.find("<t>").expect("<t> open") + "<t>".len();
            let end = chunk.find("</t>").expect("</t> close");
            chunk[start..end].to_string()
        })
        .collect();
    assert_eq!(strings.len(), 4, "expected 4 unique strings in <sst>");

    let check = |idx: usize, want: &str| {
        assert_eq!(
            strings.get(idx).map(String::as_str),
            Some(want),
            "add() returned index {idx} for {want:?}, but <sst>[{idx}] = \
             {got:?} - cells that carry this index will read the wrong \
             string on import",
            got = strings.get(idx),
        );
    };
    check(idx_country, "Country");
    check(idx_sales, "Sales");
    check(idx_usa, "USA");
    check(idx_can, "CAN");
}

#[test]
fn test_shared_string_value_to_plain_text() {
    let plain = SharedStringValue::Plain("Hello".to_string());
    assert_eq!(plain.to_plain_text(), "Hello");

    let rich = SharedStringValue::RichText(vec![
        RichTextRun::new("Hello"),
        RichTextRun::new(" "),
        RichTextRun::new("World"),
    ]);
    assert_eq!(rich.to_plain_text(), "Hello World");
}

#[test]
fn test_with_capacity() {
    let sst = SharedStringsWriter::with_capacity(100);
    assert!(sst.is_empty());
    // The capacity hint doesn't change behavior, just pre-allocates
}

#[test]
fn rich_shared_strings_deduplicate_structurally() {
    let rich = domain_types::RichSharedString {
        plain_text: "Hello".to_string(),
        runs: vec![domain_types::RichTextRun {
            text: "Hello".to_string(),
            bold: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let mut sst = SharedStringsWriter::new();
    let idx1 = sst.add_rich_shared_string(rich.clone());
    let idx2 = sst.add_rich_shared_string(rich);

    assert_eq!(idx1, 0);
    assert_eq!(idx2, 0);
    assert_eq!(sst.len(), 1);
    assert_eq!(sst.total_count(), 2);
}
