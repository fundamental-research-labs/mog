use super::*;
use crate::infra::xml::decode_xml_entities;

// Color parsing

#[test]
fn test_color_parse_rgb() {
    let xml = br#"<color rgb="FF0000FF"/>"#;
    let color = Color::parse(xml);
    assert_eq!(color.rgb, Some("FF0000FF".to_string()));
    assert!(color.theme.is_none());
    assert!(!color.is_empty());
}

#[test]
fn test_color_parse_theme() {
    let xml = br#"<color theme="1" tint="-0.25"/>"#;
    let color = Color::parse(xml);
    assert_eq!(color.theme, Some(1));
    assert_eq!(color.tint, Some(-0.25));
}

#[test]
fn test_color_parse_indexed() {
    let xml = br#"<color indexed="64"/>"#;
    let color = Color::parse(xml);
    assert_eq!(color.indexed, Some(64));
}

#[test]
fn test_color_parse_auto() {
    let xml = br#"<color auto="1"/>"#;
    let color = Color::parse(xml);
    assert!(color.auto);
}

#[test]
fn test_color_parse_multiple_attributes() {
    let xml = br#"<color rgb="FF112233" theme="2" tint="0.5" indexed="10" auto="1"/>"#;
    let color = Color::parse(xml);
    assert_eq!(color.rgb, Some("FF112233".to_string()));
    assert_eq!(color.theme, Some(2));
    assert_eq!(color.tint, Some(0.5));
    assert_eq!(color.indexed, Some(10));
    assert!(color.auto);
}

#[test]
fn test_color_empty() {
    let color = Color::default();
    assert!(color.is_empty());
}

// Enum parsing

#[test]
fn test_vertical_align_from_str() {
    assert_eq!(
        VerticalAlign::from_str("superscript"),
        VerticalAlign::Superscript
    );
    assert_eq!(
        VerticalAlign::from_str("subscript"),
        VerticalAlign::Subscript
    );
    assert_eq!(VerticalAlign::from_str("baseline"), VerticalAlign::Baseline);
    assert_eq!(VerticalAlign::from_str("unknown"), VerticalAlign::Baseline);
}

#[test]
fn test_underline_style_from_str() {
    assert_eq!(UnderlineStyle::from_str(None), UnderlineStyle::Single);
    assert_eq!(
        UnderlineStyle::from_str(Some("double")),
        UnderlineStyle::Double
    );
    assert_eq!(
        UnderlineStyle::from_str(Some("singleAccounting")),
        UnderlineStyle::SingleAccounting
    );
    assert_eq!(UnderlineStyle::from_str(Some("none")), UnderlineStyle::None);
    assert_eq!(
        UnderlineStyle::from_str(Some("unexpected")),
        UnderlineStyle::Single
    );
}

// Font and run properties

#[test]
fn test_font_properties_parse() {
    let xml = br#"<rPr>
        <rFont val="Arial"/>
        <sz val="12"/>
        <color rgb="FF000000"/>
        <family val="2"/>
        <charset val="0"/>
        <scheme val="minor"/>
    </rPr>"#;

    let font = FontProperties::parse(xml);
    assert_eq!(font.name, Some("Arial".to_string()));
    assert_eq!(font.size, Some(12.0));
    assert!(font.color.is_some());
    assert_eq!(
        font.color.as_ref().unwrap().rgb,
        Some("FF000000".to_string())
    );
    assert_eq!(font.family, Some(2));
    assert_eq!(font.charset, Some(0));
    assert_eq!(font.scheme, Some("minor".to_string()));
}

#[test]
fn test_run_properties_parse_bold_italic() {
    let xml = br#"<rPr><b/><i/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert!(props.bold);
    assert!(props.italic);
    assert!(!props.strikethrough);
}

#[test]
fn test_run_properties_parse_bold_italic_false_values() {
    let xml = br#"<rPr><b val="0"/><i val="0"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert!(!props.bold);
    assert!(!props.italic);
}

#[test]
fn test_run_properties_parse_underline() {
    let xml = br#"<rPr><u/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.underline, UnderlineStyle::Single);

    let xml = br#"<rPr><u val="double"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.underline, UnderlineStyle::Double);
}

#[test]
fn test_run_properties_parse_underline_none_and_unknown() {
    let xml = br#"<rPr><u val="none"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.underline, UnderlineStyle::None);

    let xml = br#"<rPr><u val="unexpected"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.underline, UnderlineStyle::Single);
}

#[test]
fn test_run_properties_parse_strikethrough() {
    let xml = br#"<rPr><strike/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert!(props.strikethrough);
}

#[test]
fn test_run_properties_parse_vert_align() {
    let xml = br#"<rPr><vertAlign val="superscript"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.vert_align, VerticalAlign::Superscript);

    let xml = br#"<rPr><vertAlign val="subscript"/></rPr>"#;
    let props = RunProperties::parse(xml);
    assert_eq!(props.vert_align, VerticalAlign::Subscript);
}

#[test]
fn test_run_properties_parse_complete() {
    let xml = br#"<rPr>
        <b/>
        <i/>
        <u val="double"/>
        <strike/>
        <outline/>
        <shadow/>
        <vertAlign val="superscript"/>
        <rFont val="Calibri"/>
        <sz val="11"/>
    </rPr>"#;

    let props = RunProperties::parse(xml);
    assert!(props.bold);
    assert!(props.italic);
    assert_eq!(props.underline, UnderlineStyle::Double);
    assert!(props.strikethrough);
    assert!(props.outline);
    assert!(props.shadow);
    assert_eq!(props.vert_align, VerticalAlign::Superscript);
    assert_eq!(props.font.name, Some("Calibri".to_string()));
    assert_eq!(props.font.size, Some(11.0));
}

// Text runs

#[test]
fn test_text_run_parse_simple() {
    let xml = br#"<r><t>Hello World</t></r>"#;
    let run = TextRun::parse(xml);
    assert_eq!(run.text, "Hello World");
    assert!(run.properties.is_none());
}

#[test]
fn test_text_run_parse_with_properties() {
    let xml = br#"<r><rPr><b/><sz val="14"/></rPr><t>Bold Text</t></r>"#;
    let run = TextRun::parse(xml);
    assert_eq!(run.text, "Bold Text");
    assert!(run.properties.is_some());
    let props = run.properties.unwrap();
    assert!(props.bold);
    assert_eq!(props.font.size, Some(14.0));
}

#[test]
fn test_text_run_parse_with_entities() {
    let xml = br#"<r><t>A &amp; B &lt; C</t></r>"#;
    let run = TextRun::parse(xml);
    assert_eq!(run.text, "A & B < C");
}

#[test]
fn test_text_run_parse_preserved_space() {
    let xml = br#"<r><t xml:space="preserve">  spaces  </t></r>"#;
    let run = TextRun::parse(xml);
    assert_eq!(run.text, "  spaces  ");
}

// Phonetic annotations

#[test]
fn test_phonetic_run_parse() {
    let xml = r#"<rPh sb="0" eb="2"><t>とうきょう</t></rPh>"#.as_bytes();
    let phonetic = PhoneticRun::parse(xml);
    assert_eq!(phonetic.text, "とうきょう");
    assert_eq!(phonetic.start_index, 0);
    assert_eq!(phonetic.end_index, 2);
}

#[test]
fn test_phonetic_properties_parse() {
    let xml = br#"<phoneticPr fontId="1" type="fullwidthKatakana" alignment="left"/>"#;
    let props = PhoneticProperties::parse(xml);
    assert_eq!(props.font_id, Some(1));
    assert_eq!(props.phonetic_type, Some("fullwidthKatakana".to_string()));
    assert_eq!(props.alignment, Some("left".to_string()));
}

// Rich text assembly

#[test]
fn test_rich_text_parse_plain() {
    let xml = br#"<si><t>Plain text</t></si>"#;
    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 1);
    assert_eq!(rich_text.runs[0].text, "Plain text");
    assert!(rich_text.runs[0].properties.is_none());
}

#[test]
fn test_rich_text_parse_plain_empty_text_omitted() {
    let xml = br#"<si><t></t></si>"#;
    let rich_text = RichText::parse(xml);
    assert!(rich_text.runs.is_empty());
    assert!(rich_text.is_empty());
}

#[test]
fn test_rich_text_parse_multiple_runs() {
    let xml = br#"<si>
        <r><rPr><b/></rPr><t>Bold</t></r>
        <r><t> and </t></r>
        <r><rPr><i/></rPr><t>Italic</t></r>
    </si>"#;

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 3);

    assert_eq!(rich_text.runs[0].text, "Bold");
    assert!(rich_text.runs[0].properties.as_ref().unwrap().bold);

    assert_eq!(rich_text.runs[1].text, " and ");
    assert!(rich_text.runs[1].properties.is_none());

    assert_eq!(rich_text.runs[2].text, "Italic");
    assert!(rich_text.runs[2].properties.as_ref().unwrap().italic);
}

#[test]
fn test_rich_text_parse_empty_run_preserved() {
    let xml = br#"<si><r><t></t></r></si>"#;
    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 1);
    assert_eq!(rich_text.runs[0].text, "");
    assert!(rich_text.is_empty());
}

#[test]
fn test_rich_text_does_not_parse_rph_as_text_run() {
    let xml = r#"<si>
        <r><t>東京</t></r>
        <rPh sb="0" eb="2"><t>とうきょう</t></rPh>
    </si>"#
        .as_bytes();

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 1);
    assert_eq!(rich_text.runs[0].text, "東京");
    assert_eq!(rich_text.phonetic_runs.len(), 1);
    assert_eq!(rich_text.phonetic_runs[0].text, "とうきょう");
}

#[test]
fn test_rich_text_to_plain_text() {
    let xml = br#"<si>
        <r><rPr><b/></rPr><t>Hello</t></r>
        <r><t> </t></r>
        <r><rPr><i/></rPr><t>World</t></r>
    </si>"#;

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.to_plain_text(), "Hello World");
}

#[test]
fn test_rich_text_with_phonetic() {
    let xml = r#"<si>
        <t>東京</t>
        <rPh sb="0" eb="1"><t>とう</t></rPh>
        <rPh sb="1" eb="2"><t>きょう</t></rPh>
        <phoneticPr fontId="1"/>
    </si>"#
        .as_bytes();

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 1);
    assert_eq!(rich_text.runs[0].text, "東京");
    assert_eq!(rich_text.phonetic_runs.len(), 2);
    assert_eq!(rich_text.phonetic_runs[0].text, "とう");
    assert_eq!(rich_text.phonetic_runs[1].text, "きょう");
    assert!(rich_text.phonetic_properties.is_some());
}

#[test]
fn test_rich_text_empty() {
    let xml = br#"<si></si>"#;
    let rich_text = RichText::parse(xml);
    assert!(rich_text.is_empty());
}

#[test]
fn test_rich_text_run_count() {
    let xml = br#"<si>
        <r><t>One</t></r>
        <r><t>Two</t></r>
        <r><t>Three</t></r>
    </si>"#;

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.run_count(), 3);
}

#[test]
fn test_crate_root_public_reexports() {
    use crate::{
        Color as RootColor, FontProperties as RootFontProperties,
        PhoneticProperties as RootPhoneticProperties, PhoneticRun as RootPhoneticRun,
        RichText as RootRichText, RunProperties as RootRunProperties, TextRun as RootTextRun,
        UnderlineStyle as RootUnderlineStyle, VerticalAlign as RootVerticalAlign,
    };

    let _: RootColor = RootColor::default();
    let _: RootFontProperties = RootFontProperties::default();
    let _: RootRunProperties = RootRunProperties::default();
    let _: RootTextRun = RootTextRun::text_only("text".to_string());
    let _: RootPhoneticRun = RootPhoneticRun::default();
    let _: RootPhoneticProperties = RootPhoneticProperties::default();
    let _: RootRichText = RootRichText::default();
    assert_eq!(
        RootUnderlineStyle::from_str(None),
        RootUnderlineStyle::Single
    );
    assert_eq!(
        RootVerticalAlign::from_str("superscript"),
        RootVerticalAlign::Superscript
    );
}

// XML entity decoding

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
fn test_decode_numeric_entities() {
    assert_eq!(decode_xml_entities(b"&#65;"), "A");
    assert_eq!(decode_xml_entities(b"&#x41;"), "A");
    assert_eq!(decode_xml_entities(b"&#x1F600;"), "\u{1F600}");
    assert_eq!(decode_xml_entities(b"Hello&#10;World"), "Hello\nWorld");
}

#[test]
fn test_decode_unicode_content() {
    assert_eq!(decode_xml_entities("日本語".as_bytes()), "日本語");
    assert_eq!(decode_xml_entities("Hello 世界".as_bytes()), "Hello 世界");
    assert_eq!(decode_xml_entities("🎉🎊".as_bytes()), "🎉🎊");
}

// Realistic integration-style examples

#[test]
fn test_realistic_rich_text() {
    let xml = br#"<si>
        <r>
            <rPr>
                <b/>
                <sz val="11"/>
                <color theme="1"/>
                <rFont val="Calibri"/>
                <family val="2"/>
                <scheme val="minor"/>
            </rPr>
            <t>Revenue</t>
        </r>
        <r>
            <rPr>
                <sz val="11"/>
                <color theme="1"/>
                <rFont val="Calibri"/>
                <family val="2"/>
                <scheme val="minor"/>
            </rPr>
            <t> (in millions)</t>
        </r>
    </si>"#;

    let rich_text = RichText::parse(xml);
    assert_eq!(rich_text.runs.len(), 2);

    let run1 = &rich_text.runs[0];
    assert_eq!(run1.text, "Revenue");
    let props1 = run1.properties.as_ref().unwrap();
    assert!(props1.bold);
    assert_eq!(props1.font.name, Some("Calibri".to_string()));
    assert_eq!(props1.font.size, Some(11.0));

    let run2 = &rich_text.runs[1];
    assert_eq!(run2.text, " (in millions)");
    let props2 = run2.properties.as_ref().unwrap();
    assert!(!props2.bold);

    assert_eq!(rich_text.to_plain_text(), "Revenue (in millions)");
}

#[test]
fn test_complex_formatting() {
    let xml = br#"<si>
        <r>
            <rPr>
                <b/>
                <i/>
                <u val="double"/>
                <strike/>
                <vertAlign val="superscript"/>
                <sz val="14"/>
                <color rgb="FFFF0000"/>
                <rFont val="Times New Roman"/>
            </rPr>
            <t>Complex</t>
        </r>
    </si>"#;

    let rich_text = RichText::parse(xml);
    let run = &rich_text.runs[0];
    let props = run.properties.as_ref().unwrap();

    assert!(props.bold);
    assert!(props.italic);
    assert_eq!(props.underline, UnderlineStyle::Double);
    assert!(props.strikethrough);
    assert_eq!(props.vert_align, VerticalAlign::Superscript);
    assert_eq!(props.font.size, Some(14.0));
    assert_eq!(
        props.font.color.as_ref().unwrap().rgb,
        Some("FFFF0000".to_string())
    );
    assert_eq!(props.font.name, Some("Times New Roman".to_string()));
}
