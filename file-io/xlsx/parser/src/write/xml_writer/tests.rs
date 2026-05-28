use super::*;

#[test]
fn test_basic_element() {
    let mut w = XmlWriter::new();
    w.start_element("tag").end_attrs().end_element("tag");
    assert_eq!(w.finish_string(), "<tag></tag>");
}

#[test]
fn test_element_with_attributes() {
    let mut w = XmlWriter::new();
    w.start_element("row")
        .attr("r", "1")
        .attr("spans", "1:5")
        .end_attrs()
        .end_element("row");
    assert_eq!(w.finish_string(), "<row r=\"1\" spans=\"1:5\"></row>");
}

#[test]
fn test_self_closing_element() {
    let mut w = XmlWriter::new();
    w.start_element("br").self_close();
    assert_eq!(w.finish_string(), "<br/>");
}

#[test]
fn test_self_closing_with_attrs() {
    let mut w = XmlWriter::new();
    w.start_element("c")
        .attr("r", "A1")
        .attr("t", "s")
        .self_close();
    assert_eq!(w.finish_string(), "<c r=\"A1\" t=\"s\"/>");
}

#[test]
fn test_text_content() {
    let mut w = XmlWriter::new();
    w.start_element("v").end_attrs().text("42").end_element("v");
    assert_eq!(w.finish_string(), "<v>42</v>");
}

#[test]
fn test_text_escaping() {
    let mut w = XmlWriter::new();
    w.start_element("data")
        .end_attrs()
        .text("<test> & \"value\"")
        .end_element("data");
    assert_eq!(
        w.finish_string(),
        "<data>&lt;test&gt; &amp; \"value\"</data>"
    );
}

#[test]
fn test_xstring_text_escapes_control_chars_and_literal_escape_tokens() {
    let mut w = XmlWriter::new();
    w.start_element("v")
        .end_attrs()
        .text_xstring("A\r\n_x000D_ & <")
        .end_element("v");
    assert_eq!(
        w.finish_string(),
        "<v>A_x000D_\n_x005F_x000D_ &amp; &lt;</v>"
    );
}

#[test]
fn test_xstring_text_preserves_escaped_cr_plus_xml_crlf_shape() {
    let mut w = XmlWriter::new();
    w.start_element("v")
        .end_attrs()
        .text_xstring("A\r\r\nB")
        .end_element("v");
    assert_eq!(w.finish_string(), "<v>A_x000D_\r\nB</v>");
}

#[test]
fn test_attribute_escaping() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr("value", "a & b < c > d \"quoted\" 'apos'")
        .self_close();
    assert_eq!(
        w.finish_string(),
        "<item value=\"a &amp; b &lt; c &gt; d &quot;quoted&quot; &apos;apos&apos;\"/>"
    );
}

#[test]
fn test_attribute_escaping_ampersand() {
    let mut w = XmlWriter::new();
    w.start_element("link")
        .attr("href", "http://example.com?a=1&b=2")
        .self_close();
    assert_eq!(
        w.finish_string(),
        "<link href=\"http://example.com?a=1&amp;b=2\"/>"
    );
}

#[test]
fn test_attribute_disallowed_controls_use_decimal_references() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr("value", "\u{0}\u{7}\u{8}\t\n\r\u{b}\u{c}\u{e}\u{1f}")
        .self_close();
    assert_eq!(
        w.finish_string(),
        "<item value=\"&#0;&#7;&#8;\t\n\r&#11;&#12;&#14;&#31;\"/>"
    );
}

#[test]
fn test_nested_elements() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .end_attrs()
        .start_element("child")
        .end_attrs()
        .start_element("grandchild")
        .end_attrs()
        .end_element("grandchild")
        .end_element("child")
        .end_element("root");
    assert_eq!(
        w.finish_string(),
        "<root><child><grandchild></grandchild></child></root>"
    );
}

#[test]
fn test_multiple_siblings() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .end_attrs()
        .start_element("a")
        .self_close()
        .start_element("b")
        .self_close()
        .start_element("c")
        .self_close()
        .end_element("root");
    assert_eq!(w.finish_string(), "<root><a/><b/><c/></root>");
}

#[test]
fn test_xml_declaration() {
    let mut w = XmlWriter::new();
    w.write_declaration().start_element("root").self_close();
    assert_eq!(
        w.finish_string(),
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><root/>"
    );
}

#[test]
fn test_xml_declaration_custom_encoding() {
    let mut w = XmlWriter::new();
    w.write_declaration_with_encoding("ISO-8859-1")
        .start_element("root")
        .self_close();
    assert!(w.finish_string().contains("encoding=\"ISO-8859-1\""));
}

#[test]
fn test_xml_declaration_custom_encoding_is_written_raw() {
    let mut w = XmlWriter::new();
    w.write_declaration_with_encoding("UTF-8\" unsafe=\"token")
        .start_element("root")
        .self_close();
    assert_eq!(
        w.finish_string(),
        "<?xml version=\"1.0\" encoding=\"UTF-8\" unsafe=\"token\" standalone=\"yes\"?><root/>"
    );
}

#[test]
fn test_namespaced_elements() {
    let mut w = XmlWriter::new();
    w.start_element_ns("x", "worksheet")
        .attr("xmlns:x", "http://example.com")
        .end_attrs()
        .end_element_ns("x", "worksheet");
    assert_eq!(
        w.finish_string(),
        "<x:worksheet xmlns:x=\"http://example.com\"></x:worksheet>"
    );
}

#[test]
fn test_end_element_ns_writes_requested_close_tag_without_stack_validation() {
    let mut w = XmlWriter::new();
    w.start_element_ns("x", "worksheet")
        .end_attrs()
        .end_element_ns("y", "sheet");
    assert_eq!(w.finish_string(), "<x:worksheet></y:sheet>");
}

#[test]
fn test_attr_if_some() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_if("present", Some("yes"))
        .attr_if("absent", None)
        .self_close();
    assert_eq!(w.finish_string(), "<item present=\"yes\"/>");
}

#[test]
fn test_attr_bool() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_bool("enabled", true)
        .attr_bool("disabled", false)
        .self_close();
    assert_eq!(w.finish_string(), "<item enabled=\"1\" disabled=\"0\"/>");
}

#[test]
fn test_attr_bool_if_true() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_bool_if_true("active", true)
        .attr_bool_if_true("inactive", false)
        .self_close();
    assert_eq!(w.finish_string(), "<item active=\"1\"/>");
}

#[test]
fn test_attr_num() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_num("int", 42)
        .attr_num("float", 3.14)
        .attr_num("negative", -100)
        .self_close();
    assert_eq!(
        w.finish_string(),
        "<item int=\"42\" float=\"3.14\" negative=\"-100\"/>"
    );
}

#[test]
fn test_attr_num_if_some() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_num_if("present", Some(42))
        .attr_num_if::<i32>("absent", None)
        .self_close();
    assert_eq!(w.finish_string(), "<item present=\"42\"/>");
}

#[test]
fn test_empty_element_helper() {
    let mut w = XmlWriter::new();
    w.empty_element("br", &[]);
    assert_eq!(w.finish_string(), "<br/>");
}

#[test]
fn test_empty_element_with_attrs() {
    let mut w = XmlWriter::new();
    w.empty_element("input", &[("type", "text"), ("value", "hello")]);
    assert_eq!(w.finish_string(), "<input type=\"text\" value=\"hello\"/>");
}

#[test]
fn test_element_with_text_helper() {
    let mut w = XmlWriter::new();
    w.element_with_text("name", "John");
    assert_eq!(w.finish_string(), "<name>John</name>");
}

#[test]
fn test_element_with_text_and_attrs() {
    let mut w = XmlWriter::new();
    w.element_with_text_and_attrs("cell", &[("id", "A1")], "value");
    assert_eq!(w.finish_string(), "<cell id=\"A1\">value</cell>");
}

#[test]
fn test_cdata() {
    let mut w = XmlWriter::new();
    w.start_element("script")
        .end_attrs()
        .cdata("function() { return x < y; }")
        .end_element("script");
    assert_eq!(
        w.finish_string(),
        "<script><![CDATA[function() { return x < y; }]]></script>"
    );
}

#[test]
fn test_cdata_with_cdata_end() {
    let mut w = XmlWriter::new();
    w.start_element("data")
        .end_attrs()
        .cdata("contains ]]> end")
        .end_element("data");
    assert_eq!(
        w.finish_string(),
        "<data><![CDATA[contains ]]]]><![CDATA[> end]]></data>"
    );
}

#[test]
fn test_comment() {
    let mut w = XmlWriter::new();
    w.comment("This is a comment")
        .start_element("root")
        .self_close();
    assert_eq!(w.finish_string(), "<!-- This is a comment --><root/>");
}

#[test]
fn test_comment_escapes_dashes() {
    let mut w = XmlWriter::new();
    w.comment("test -- dashes");
    assert_eq!(w.finish_string(), "<!-- test - - dashes -->");
}

#[test]
fn test_raw_content() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .end_attrs()
        .raw(b"<already>escaped</already>")
        .end_element("root");
    assert_eq!(w.finish_string(), "<root><already>escaped</already></root>");
}

#[test]
fn test_raw_str() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .end_attrs()
        .raw_str("<inner/>")
        .end_element("root");
    assert_eq!(w.finish_string(), "<root><inner/></root>");
}

#[test]
fn test_raw_after_pending_opening_tag_closes_before_verbatim_bytes() {
    let mut w = XmlWriter::new();
    w.start_element("root").raw(b"<inner/>").end_element("root");
    assert_eq!(w.finish_string(), "<root><inner/></root>");
}

#[test]
fn test_raw_str_after_pending_opening_tag_closes_before_verbatim_text() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .raw_str("<inner/>")
        .end_element("root");
    assert_eq!(w.finish_string(), "<root><inner/></root>");
}

#[test]
fn test_pretty_printing_basic() {
    let mut w = XmlWriter::new().pretty();
    w.start_element("root")
        .end_attrs()
        .start_element("child")
        .self_close()
        .end_element("root");
    let xml = w.finish_string();
    assert!(xml.contains('\n'));
    assert!(xml.contains("  <child"));
}

#[test]
fn test_pretty_printing_declaration() {
    let mut w = XmlWriter::new().pretty();
    w.write_declaration().start_element("root").self_close();
    let xml = w.finish_string();
    assert!(xml.contains("?>\n"));
}

#[test]
fn test_pretty_pending_attribute_child_sibling_and_closing_indent() {
    let mut w = XmlWriter::new().pretty();
    w.start_element("root")
        .start_element("child")
        .self_close()
        .start_element("sibling")
        .self_close()
        .end_element("root");
    assert_eq!(
        w.finish_string(),
        "<root>\n  <child/>\n  <sibling/>\n</root>\n"
    );
}

#[test]
fn test_xlsx_worksheet_example() {
    let mut w = XmlWriter::new();
    w.write_declaration()
        .start_element("worksheet")
        .attr(
            "xmlns",
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        )
        .end_attrs()
        .start_element("sheetData")
        .end_attrs()
        .start_element("row")
        .attr("r", "1")
        .end_attrs()
        .start_element("c")
        .attr("r", "A1")
        .attr("t", "s")
        .end_attrs()
        .start_element("v")
        .end_attrs()
        .text("0")
        .end_element("v")
        .end_element("c")
        .end_element("row")
        .end_element("sheetData")
        .end_element("worksheet");

    let xml = w.finish_string();
    assert!(xml.contains("<?xml version=\"1.0\""));
    assert!(xml.contains("<worksheet xmlns="));
    assert!(xml.contains("<sheetData>"));
    assert!(xml.contains("<row r=\"1\">"));
    assert!(xml.contains("<c r=\"A1\" t=\"s\">"));
    assert!(xml.contains("<v>0</v>"));
    assert!(xml.contains("</c>"));
    assert!(xml.contains("</row>"));
    assert!(xml.contains("</sheetData>"));
    assert!(xml.contains("</worksheet>"));
}

#[test]
fn test_clear_and_reuse() {
    let mut w = XmlWriter::new();
    w.start_element("first").self_close();
    assert!(!w.is_empty());

    w.clear();
    assert!(w.is_empty());
    assert_eq!(w.depth(), 0);

    w.start_element("second").self_close();
    assert_eq!(w.finish_string(), "<second/>");
}

#[test]
fn test_clear_preserves_pretty_and_resets_state() {
    let mut w = XmlWriter::new().pretty();
    w.start_element("root").start_element("child");

    w.clear();
    assert!(w.pretty);
    assert_eq!(w.indent_level, 0);
    assert_eq!(w.state, ElementState::InContent);
    assert_eq!(w.depth(), 0);
    assert!(w.is_empty());

    w.start_element("next").self_close();
    assert_eq!(w.finish_string(), "<next/>\n");
}

#[test]
fn test_depth() {
    let mut w = XmlWriter::new();
    assert_eq!(w.depth(), 0);

    w.start_element("a");
    assert_eq!(w.depth(), 1);

    w.start_element("b");
    assert_eq!(w.depth(), 2);

    w.self_close();
    assert_eq!(w.depth(), 1);

    w.end_attrs().end_element("a");
    assert_eq!(w.depth(), 0);
}

#[test]
fn test_len() {
    let mut w = XmlWriter::new();
    assert_eq!(w.len(), 0);

    w.start_element("test");
    assert!(w.len() > 0);
}

#[test]
fn test_is_empty() {
    let w = XmlWriter::new();
    assert!(w.is_empty());
}

#[test]
fn test_as_bytes() {
    let mut w = XmlWriter::new();
    w.start_element("test").self_close();
    let bytes = w.as_bytes();
    assert_eq!(bytes, b"<test/>");
}

#[test]
fn test_with_capacity() {
    let w = XmlWriter::with_capacity(1024);
    assert!(w.is_empty());
}

#[test]
fn test_into_bytes_alias() {
    let mut w = XmlWriter::new();
    w.element_with_text("test", "value");
    let bytes = w.into_bytes();
    assert_eq!(bytes, b"<test>value</test>");
}

#[test]
fn test_unicode_content() {
    let mut w = XmlWriter::new();
    w.start_element("data")
        .end_attrs()
        .text("Hello, world!")
        .end_element("data");
    assert!(w.finish_string().contains("Hello, world!"));
}

#[test]
fn test_unicode_in_attr() {
    let mut w = XmlWriter::new();
    w.start_element("item").attr("name", "Cafe").self_close();
    assert!(w.finish_string().contains("name=\"Cafe\""));
}

#[test]
fn test_text_between_elements() {
    let mut w = XmlWriter::new();
    w.start_element("root")
        .end_attrs()
        .text("before")
        .start_element("inner")
        .self_close()
        .text("after")
        .end_element("root");
    assert_eq!(w.finish_string(), "<root>before<inner/>after</root>");
}

#[test]
fn test_empty_text() {
    let mut w = XmlWriter::new();
    w.start_element("empty")
        .end_attrs()
        .text("")
        .end_element("empty");
    assert_eq!(w.finish_string(), "<empty></empty>");
}

#[test]
fn test_empty_attr_value() {
    let mut w = XmlWriter::new();
    w.start_element("item").attr("empty", "").self_close();
    assert_eq!(w.finish_string(), "<item empty=\"\"/>");
}

#[test]
fn test_xstring_attr_uses_ooxml_control_escapes() {
    let mut w = XmlWriter::new();
    w.start_element("item")
        .attr_xstring("name", "A\r\n\tB & < \" '_x000a_")
        .self_close();

    assert_eq!(
        w.finish_string(),
        "<item name=\"A_x000d__x000a__x0009_B &amp; &lt; &quot; &apos;_x005f_x000a_\"/>"
    );
}

#[test]
fn test_xstring_literal_token_detection_lowercase_and_uppercase_hex() {
    let mut attr = XmlWriter::new();
    attr.start_element("item")
        .attr_xstring("name", "_x000a_ _x000A_")
        .self_close();
    assert_eq!(
        attr.finish_string(),
        "<item name=\"_x005f_x000a_ _x005f_x000A_\"/>"
    );

    let mut text = XmlWriter::new();
    text.start_element("v")
        .end_attrs()
        .text_xstring("_x000a_ _x000A_")
        .end_element("v");
    assert_eq!(text.finish_string(), "<v>_x005F_x000a_ _x005F_x000A_</v>");
}

#[test]
fn test_xstring_text_lf_and_tab_remain_raw() {
    let mut w = XmlWriter::new();
    w.start_element("v")
        .end_attrs()
        .text_xstring("A\n\tB")
        .end_element("v");
    assert_eq!(w.finish_string(), "<v>A\n\tB</v>");
}

#[test]
fn test_xml_declaration_alias() {
    let mut w = XmlWriter::new();
    w.xml_declaration();
    assert!(w.finish_string().contains("<?xml version"));
}

#[test]
fn test_start_element_with_attrs() {
    let mut w = XmlWriter::new();
    w.start_element_with_attrs("row", &[("r", "1"), ("spans", "1:5")])
        .end_element("row");
    assert_eq!(w.finish_string(), "<row r=\"1\" spans=\"1:5\"></row>");
}

#[test]
fn test_with_indentation() {
    let mut w = XmlWriter::with_indentation();
    w.start_element("root")
        .end_attrs()
        .start_element("child")
        .self_close()
        .end_element("root");
    let xml = w.finish_string();
    assert!(xml.contains('\n'));
}
