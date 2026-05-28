use super::*;

#[test]
fn test_parse_bool_attr_true() {
    assert!(parse_bool_attr(b"<cell hidden=\"1\">", b"hidden=\""));
    assert!(parse_bool_attr(b"<cell hidden=\"true\">", b"hidden=\""));
    assert!(parse_bool_attr(b"<cell hidden=\"True\">", b"hidden=\""));
}

#[test]
fn test_parse_bool_attr_false() {
    assert!(!parse_bool_attr(b"<cell hidden=\"0\">", b"hidden=\""));
    assert!(!parse_bool_attr(b"<cell hidden=\"false\">", b"hidden=\""));
}

#[test]
fn test_parse_bool_attr_missing() {
    assert!(!parse_bool_attr(b"<cell>", b"hidden=\""));
}

#[test]
fn test_parse_bool_attr_opt() {
    assert_eq!(
        parse_bool_attr_opt(b"<cell hidden=\"1\">", b"hidden=\""),
        Some(true)
    );
    assert_eq!(
        parse_bool_attr_opt(b"<cell hidden=\"0\">", b"hidden=\""),
        Some(false)
    );
    assert_eq!(parse_bool_attr_opt(b"<cell>", b"hidden=\""), None);
}

#[test]
fn test_parse_bool_attr_opt_present_non_true_is_false() {
    assert_eq!(
        parse_bool_attr_opt(b"<cell hidden=\"no\">", b"hidden=\""),
        Some(false)
    );
}

#[test]
fn test_parse_bool_attr_with_default() {
    assert!(parse_bool_attr_with_default(b"<cell>", b"hidden=\"", true));
    assert!(!parse_bool_attr_with_default(
        b"<cell>",
        b"hidden=\"",
        false
    ));
    assert!(parse_bool_attr_with_default(
        b"<cell hidden=\"1\">",
        b"hidden=\"",
        false
    ));
}

#[test]
fn test_parse_bool_attr_with_default_present_false_cases() {
    assert!(!parse_bool_attr_with_default(
        b"<cell hidden=\"\">",
        b"hidden=\"",
        true
    ));
    assert!(!parse_bool_attr_with_default(
        b"<cell hidden=\"0\">",
        b"hidden=\"",
        true
    ));
    assert!(!parse_bool_attr_with_default(
        b"<cell hidden=\"",
        b"hidden=\"",
        true
    ));
}

#[test]
fn test_parse_u32_attr() {
    assert_eq!(parse_u32_attr(b"<row r=\"123\">", b"r=\""), Some(123));
    assert_eq!(parse_u32_attr(b"<row r=\"0\">", b"r=\""), Some(0));
    assert_eq!(parse_u32_attr(b"<row>", b"r=\""), None);
}

#[test]
fn test_parse_u32_attr_saturates_and_rejects_no_leading_digit() {
    assert_eq!(
        parse_u32_attr(b"<row r=\"999999999999999999999\">", b"r=\""),
        Some(u32::MAX)
    );
    assert_eq!(parse_u32_attr(b"<row r=\"x123\">", b"r=\""), None);
}

#[test]
fn test_parse_u8_attr_saturates_and_rejects_no_leading_digit() {
    assert_eq!(
        parse_u8_attr(b"<color theme=\"999\">", b"theme=\""),
        Some(255)
    );
    assert_eq!(parse_u8_attr(b"<color theme=\"x1\">", b"theme=\""), None);
}

#[test]
fn test_parse_i32_attr() {
    assert_eq!(
        parse_i32_attr(b"<col offset=\"-100\">", b"offset=\""),
        Some(-100)
    );
    assert_eq!(
        parse_i32_attr(b"<col offset=\"100\">", b"offset=\""),
        Some(100)
    );
    assert_eq!(parse_i32_attr(b"<col>", b"offset=\""), None);
}

#[test]
fn test_parse_f64_attr() {
    assert_eq!(
        parse_f64_attr(b"<col width=\"8.5\">", b"width=\""),
        Some(8.5)
    );
    assert_eq!(
        parse_f64_attr(b"<col width=\"-3.14\">", b"width=\""),
        Some(-3.14)
    );
    assert_eq!(parse_f64_attr(b"<col>", b"width=\""), None);
}

#[test]
fn test_parse_string_attr() {
    assert_eq!(
        parse_string_attr(b"<cell name=\"hello\">", b"name=\""),
        Some("hello".to_string())
    );
    assert_eq!(
        parse_string_attr(b"<cell name=\"\">", b"name=\""),
        Some(String::new())
    );
    assert_eq!(parse_string_attr(b"<cell>", b"name=\""), None);
}

#[test]
fn test_parse_string_attr_with_entities() {
    assert_eq!(
        parse_string_attr(b"<cell name=\"&lt;hello&gt;\">", b"name=\""),
        Some("<hello>".to_string())
    );
    assert_eq!(
        parse_string_attr(b"<cell name=\"A &amp; B\">", b"name=\""),
        Some("A & B".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_supports_single_quotes() {
    assert_eq!(
        parse_string_attr_quoted(b"<cell name='hello'>", b"name"),
        Some("hello".to_string())
    );
    assert_eq!(
        parse_string_attr_quoted(b"<cell name='&lt;hello&gt;'>", b"name=\""),
        Some("<hello>".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_keeps_raw_gt_in_value() {
    assert_eq!(
        parse_string_attr_quoted(b"<sheetName val=\"A>B>C\"/>", b"val"),
        Some("A>B>C".to_string())
    );
    assert_eq!(
        parse_string_attr_quoted(b"<sheetName val='A>B>C'/>", b"val=\""),
        Some("A>B>C".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_allows_whitespace_around_equals() {
    assert_eq!(
        parse_string_attr_quoted(b"<cell name = 'hello'>", b"name"),
        Some("hello".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_accepts_trailing_equals_pattern() {
    assert_eq!(
        parse_string_attr_quoted(b"<cell name=\"hello\">", b"name="),
        Some("hello".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_ignores_attribute_like_text_in_quotes() {
    assert_eq!(
        parse_string_attr_quoted(b"<cell other=\" name='wrong' \" name=\"right\">", b"name"),
        Some("right".to_string())
    );
}

#[test]
fn test_parse_string_attr_quoted_decodes_unclosed_tail() {
    assert_eq!(
        parse_string_attr_quoted(b"<cell name=\"A &amp; B", b"name"),
        Some("A & B".to_string())
    );
}

#[test]
fn test_parse_string_attr_verbatim_preserves_ooxml_escapes() {
    assert_eq!(
        parse_string_attr_verbatim(b"<cell name=\"_x0041_\">", b"name=\""),
        Some("_x0041_".to_string())
    );
}

#[test]
fn test_parse_bytes_attr() {
    assert_eq!(
        parse_bytes_attr(b"<filter type=\"custom\">", b"type=\""),
        Some(b"custom".as_slice())
    );
    assert_eq!(parse_bytes_attr(b"<filter>", b"type=\""), None);
}

#[test]
fn test_parse_bytes_attr_rejects_single_quotes_and_returns_unclosed_tail() {
    assert_eq!(
        parse_bytes_attr(b"<filter type='custom'>", b"type=\""),
        None
    );
    assert_eq!(
        parse_bytes_attr(b"<filter type=\"custom", b"type=\""),
        Some(b"custom".as_slice())
    );
}

#[test]
fn test_decode_xml_entities() {
    assert_eq!(decode_xml_entities(b"hello"), "hello");
    assert_eq!(decode_xml_entities(b"&lt;"), "<");
    assert_eq!(decode_xml_entities(b"&gt;"), ">");
    assert_eq!(decode_xml_entities(b"&amp;"), "&");
    assert_eq!(decode_xml_entities(b"&quot;"), "\"");
    assert_eq!(decode_xml_entities(b"&apos;"), "'");
    assert_eq!(decode_xml_entities(b"&lt;hello&gt;"), "<hello>");
    assert_eq!(decode_xml_entities(b"A &amp; B"), "A & B");
}

#[test]
fn test_decode_xml_entities_unknown() {
    assert_eq!(decode_xml_entities(b"&unknown;"), "&unknown;");
}

#[test]
fn test_decode_xml_entities_numeric_refs() {
    assert_eq!(decode_xml_entities(b"&#65;&#x42;&#X43;"), "ABC");
}

#[test]
fn test_decode_xml_entities_invalid_utf8_replacement() {
    assert_eq!(
        decode_xml_entities(&[0xFF]),
        char::REPLACEMENT_CHARACTER.to_string()
    );
}

#[test]
fn test_decode_xml_entities_malformed_ooxml_escapes_pass_through() {
    assert_eq!(decode_xml_entities(b"_x41_ _x0041"), "_x41_ _x0041");
}

#[test]
fn test_decode_xml_entities_uppercase_ooxml_escape_not_decoded() {
    assert_eq!(decode_xml_entities(b"_X0041_"), "_X0041_");
}

#[test]
fn test_decode_xml_entities_string() {
    assert_eq!(decode_xml_entities_string("&lt;hello&gt;"), "<hello>");
}

#[test]
fn test_mc_resolve_choice_x14() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x14"><controls><control shapeId="1"/></controls></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;
    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(branch.is_choice);
    let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
    assert!(content.contains("<controls>"));
    assert!(content.contains("shapeId"));
}

#[test]
fn test_mc_resolve_fallback_when_unsupported() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="unknownNs"><stuff/></mc:Choice>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(!branch.is_choice);
    let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
    assert!(content.contains("<legacy>data</legacy>"));
}

#[test]
fn test_mc_resolve_empty_self_closing_fallback() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="unknownNs"><stuff/></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;
    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(!branch.is_choice);
    assert_eq!(branch.start, branch.end);
}

#[test]
fn test_mc_resolve_no_choice_no_fallback() {
    let xml = b"<mc:AlternateContent></mc:AlternateContent>";
    assert!(resolve_mc_alternate_content(xml, None).is_none());
}

#[test]
fn test_mc_resolve_with_custom_resolver() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="myns"><data>custom</data></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;

    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(!branch.is_choice);

    let resolver = |prefix: &str| -> Option<&'static str> {
        if prefix == "myns" {
            Some("http://schemas.microsoft.com/office/spreadsheetml/2009/9/main")
        } else {
            None
        }
    };
    let branch = resolve_mc_alternate_content(xml, Some(&resolver)).unwrap();
    assert!(branch.is_choice);
    let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
    assert!(content.contains("<data>custom</data>"));
}

#[test]
fn test_mc_resolve_x15_choice() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x15"><tableSlicerCache/></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;
    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(branch.is_choice);
}

#[test]
fn test_mc_resolve_requires_all_prefixes_supported() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x14 unknownNs"><controls>bad</controls></mc:Choice>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let branch = resolve_mc_alternate_content(xml, None).unwrap();
    assert!(!branch.is_choice);
}

#[test]
fn test_mc_v2_supported_choice() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x14"><controls><control shapeId="1"/></controls></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    match result {
        McResolution::Resolved(branch) => {
            assert!(branch.is_choice);
            let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
            assert!(content.contains("<controls>"));
            assert!(content.contains("shapeId"));
        }
        other => panic!("Expected Resolved, got {:?}", other),
    }
}

#[test]
fn test_mc_v2_unsupported_choice_preserved() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="unknownNs"><stuff>important</stuff></mc:Choice>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    match result {
        McResolution::Preserved(raw) => {
            assert!(raw.contains("mc:AlternateContent"));
            assert!(raw.contains("unknownNs"));
            assert!(raw.contains("<stuff>important</stuff>"));
            assert!(raw.contains("<legacy>data</legacy>"));
        }
        other => panic!("Expected Preserved, got {:?}", other),
    }
}

#[test]
fn test_mc_v2_choice_without_requires_does_not_preserve() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice><stuff>ignored</stuff></mc:Choice>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    match result {
        McResolution::Resolved(branch) => {
            assert!(!branch.is_choice);
            let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
            assert!(content.contains("<legacy>data</legacy>"));
        }
        other => panic!("Expected Resolved(fallback), got {:?}", other),
    }
}

#[test]
fn test_mc_v2_requires_all_prefixes_supported() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x14 unknownNs"><controls>bad</controls></mc:Choice>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    assert!(matches!(result, McResolution::Preserved(_)));
}

#[test]
fn test_mc_v2_empty_fallback_no_choice() {
    let xml = b"<mc:AlternateContent><mc:Fallback/></mc:AlternateContent>";
    let result = resolve_mc_alternate_content_v2(xml, None);
    assert_eq!(result, McResolution::Empty);
}

#[test]
fn test_mc_v2_no_choice_no_fallback() {
    let xml = b"<mc:AlternateContent></mc:AlternateContent>";
    let result = resolve_mc_alternate_content_v2(xml, None);
    assert_eq!(result, McResolution::Empty);
}

#[test]
fn test_mc_v2_fallback_content_no_choice() {
    let xml = br#"<mc:AlternateContent>
  <mc:Fallback><legacy>data</legacy></mc:Fallback>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    match result {
        McResolution::Resolved(branch) => {
            assert!(!branch.is_choice);
            let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
            assert!(content.contains("<legacy>data</legacy>"));
        }
        other => panic!("Expected Resolved(fallback), got {:?}", other),
    }
}

#[test]
fn test_mc_v2_mixed_choices_supported_wins() {
    let xml = br#"<mc:AlternateContent>
  <mc:Choice Requires="x14"><controls>good</controls></mc:Choice>
  <mc:Choice Requires="unknownNs"><stuff>other</stuff></mc:Choice>
  <mc:Fallback/>
</mc:AlternateContent>"#;
    let result = resolve_mc_alternate_content_v2(xml, None);
    match result {
        McResolution::Resolved(branch) => {
            assert!(branch.is_choice);
            let content = std::str::from_utf8(&xml[branch.start..branch.end]).unwrap();
            assert!(content.contains("<controls>good</controls>"));
        }
        other => panic!("Expected Resolved(choice), got {:?}", other),
    }
}

#[test]
fn relationship_attr_detector_covers_id_embed_link_and_relid() {
    assert!(raw_xml_contains_relationship_attr(
        r#"<x:state r:id = "rId1"/>"#
    ));
    assert!(raw_xml_contains_relationship_attr(
        r#"<a:blip rel:embed="rId2"/>"#
    ));
    assert!(raw_xml_contains_relationship_attr(
        r#"<a:blip other:link = "rId3"/>"#
    ));
    assert!(raw_xml_contains_relationship_attr(
        r#"<v:imagedata o:relid="rId4"/>"#
    ));
    assert!(!raw_xml_contains_relationship_attr(
        r#"<x:state id="local" embed="literal" link="literal"/>"#
    ));
}

#[test]
fn relationship_attr_detector_is_prefix_agnostic_and_conservative() {
    assert!(raw_xml_contains_relationship_attr(
        r#"<x:state arbitrary:id   = "rId1"/>"#
    ));
    assert!(raw_xml_contains_relationship_attr(
        r#"<x:state>text with arbitrary:embed = "rId1"</x:state>"#
    ));
    assert!(!raw_xml_contains_relationship_attr(
        r#"<x:state id = "rId1" embed = "rId2" link = "rId3"/>"#
    ));
}
