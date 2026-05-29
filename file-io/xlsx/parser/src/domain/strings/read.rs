//! Shared strings parser for XLSX files
//!
//! XLSX files store strings in a shared string table (sharedStrings.xml) to deduplicate
//! repeated values. This module provides fast, zero-copy parsing of this table.
//!
//! # Error Recovery
//!
//! This module supports error recovery through `ParseContext`. When using `parse_with_context`,
//! the parser will attempt to recover from various errors:
//!
//! - Malformed XML in shared string entry: Use empty string
//! - Invalid XML entities: Attempt partial decode, use raw string as fallback
//! - Truncated string table: Parse what's available, log warning
//! - Missing count attribute: Count entries manually

mod decode;
mod parser;
mod phonetic;
mod rich_text;
mod scanner;

pub use decode::{decode_xml_entities, decode_xml_entities_full};
pub use parser::{parse_shared_strings_fast, parse_shared_strings_with_context};
pub use rich_text::{get_string, is_rich_text_entry, parse_rich_text_runs};

use crate::infra::error::{ErrorCode, ParseContext};
use domain_types::RichTextRun as DtRichTextRun;

/// Wrapper struct for shared strings table that owns both the XML data and parsed references.
/// This allows for efficient string lookups without repeated parsing.
#[derive(Debug)]
pub struct SharedStrings {
    /// The original XML bytes (owned)
    xml: Vec<u8>,
    /// Parsed string references into the XML
    refs: Vec<StringRef>,
    /// Reusable buffer for decoding
    decode_buffer: Vec<u8>,
    /// Per-entry phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) extracted during parsing.
    /// Index-aligned with `refs`. `None` = no phonetic data in this `<si>` entry.
    phonetic_xml: Vec<Option<Vec<u8>>>,
    /// Safe root-level `<extLst>` XML from the shared string table.
    root_ext_lst_xml: Option<Vec<u8>>,
    /// Imported `<sst count="...">` value, when present.
    declared_count: Option<u32>,
    /// Imported `<sst uniqueCount="...">` value, when present.
    declared_unique_count: Option<u32>,
}

impl SharedStrings {
    /// Parse shared strings from XML bytes with error recovery
    ///
    /// This method allows error recovery based on the provided `ParseContext`.
    /// Various errors during parsing will be reported to the context and
    /// recovered from when possible.
    ///
    /// # Arguments
    /// * `xml` - The raw XML bytes of sharedStrings.xml
    /// * `context` - Parse context for error handling and mode
    ///
    /// # Returns
    /// A `SharedStrings` instance with as much data as could be recovered
    pub fn parse_with_context(xml: Vec<u8>, context: &mut ParseContext) -> Self {
        context.set_current_part("xl/sharedStrings.xml");
        let (refs, phonetic_xml, root_ext_lst_xml) =
            parse_shared_strings_with_context(&xml, context);
        let declared_count = scanner::parse_count(&xml).and_then(|value| u32::try_from(value).ok());
        let declared_unique_count =
            scanner::parse_unique_count(&xml).and_then(|value| u32::try_from(value).ok());
        Self {
            xml,
            refs,
            decode_buffer: Vec::with_capacity(256),
            phonetic_xml,
            root_ext_lst_xml,
            declared_count,
            declared_unique_count,
        }
    }

    /// Parse shared strings from XML bytes
    ///
    /// This is the original parse method for backward compatibility.
    /// Uses lenient mode internally.
    pub fn parse(xml: Vec<u8>) -> Self {
        let mut ctx = ParseContext::lenient();
        Self::parse_with_context(xml, &mut ctx)
    }

    /// Get the number of strings in the table
    #[inline]
    pub fn len(&self) -> usize {
        self.refs.len()
    }

    /// Check if the table is empty
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.refs.is_empty()
    }

    /// Get a string by index, returning a reference to the string bytes
    ///
    /// Note: For strings requiring decoding, this temporarily stores the result
    /// in an internal buffer. The returned slice is valid until the next call.
    pub fn get(&mut self, index: usize) -> &[u8] {
        get_string(&self.refs, &self.xml, index, &mut self.decode_buffer)
    }

    /// Get a shared string with bounds checking and error reporting
    ///
    /// This method provides safe access to shared strings with proper error
    /// reporting through the optional `ParseContext`. When an index is out of
    /// bounds, it reports a warning and returns `#REF!` as a placeholder.
    ///
    /// # Arguments
    /// * `index` - The shared string index
    /// * `context` - Optional parse context for error reporting
    ///
    /// # Returns
    /// The string bytes, or `#REF!` if the index is out of bounds
    pub fn get_safe(&mut self, index: usize, context: Option<&mut ParseContext>) -> &[u8] {
        if index >= self.len() {
            if let Some(ctx) = context {
                ctx.report_warning(
                    ErrorCode::InvalidSharedStringIndex,
                    &format!(
                        "Shared string index {} out of bounds (max: {})",
                        index,
                        self.len()
                    ),
                );
            }
            return b"#REF!";
        }
        get_string(&self.refs, &self.xml, index, &mut self.decode_buffer)
    }

    /// Get a string by index as a UTF-8 string slice
    ///
    /// Returns None if the index is out of bounds or the string is not valid UTF-8
    pub fn get_str(&mut self, index: usize) -> Option<&str> {
        let bytes = self.get(index);
        std::str::from_utf8(bytes).ok()
    }

    /// Count strings by category: (plain, entities_only, rich_text).
    /// Useful for profiling the shared strings phase.
    pub fn count_categories(&self) -> (usize, usize, usize) {
        let mut plain = 0;
        let mut entities = 0;
        let mut rich = 0;
        for r in &self.refs {
            if r.len == 0 || !r.needs_decode {
                plain += 1;
            } else if r.as_slice(&self.xml).starts_with(b"<si") {
                rich += 1;
            } else {
                entities += 1;
            }
        }
        (plain, entities, rich)
    }

    /// Check if a string at the given index needs decoding
    ///
    /// This can be used to optimize cases where the raw bytes can be used directly.
    #[inline]
    pub fn needs_decode(&self, index: usize) -> bool {
        self.refs
            .get(index)
            .map(|r| r.needs_decode)
            .unwrap_or(false)
    }

    /// Get a raw reference to the string (without decoding)
    ///
    /// This is useful when you need to handle decoding externally.
    #[inline]
    pub fn get_ref(&self, index: usize) -> Option<&StringRef> {
        self.refs.get(index)
    }

    /// Get a slice of the original XML for a string reference
    #[inline]
    pub fn get_raw_slice(&self, string_ref: &StringRef) -> &[u8] {
        string_ref.as_slice(&self.xml)
    }

    /// Check whether the entry at `index` is rich text.
    pub fn is_rich_text(&self, index: usize) -> bool {
        is_rich_text_entry(&self.refs, &self.xml, index)
    }

    /// Parse rich text runs for entry at `index`.
    /// Returns `None` for plain text entries.
    pub fn get_rich_text_runs(&self, index: usize) -> Option<Vec<DtRichTextRun>> {
        parse_rich_text_runs(&self.refs, &self.xml, index)
    }

    /// Get raw `<rPh>...</rPh>` and `<phoneticPr .../>` XML for the entry at `index`.
    /// Returns `None` if the entry has no phonetic data.
    pub fn get_phonetic_xml(&self, index: usize) -> Option<Vec<u8>> {
        self.phonetic_xml.get(index)?.clone()
    }

    /// Get safe root-level `<extLst>` XML from the shared string table.
    pub fn root_ext_lst_xml(&self) -> Option<Vec<u8>> {
        self.root_ext_lst_xml.clone()
    }

    /// Imported `<sst count="...">` value, when present.
    pub fn declared_count(&self) -> Option<u32> {
        self.declared_count
    }

    /// Imported `<sst uniqueCount="...">` value, when present.
    pub fn declared_unique_count(&self) -> Option<u32> {
        self.declared_unique_count
    }
}

/// Reference to a string in the original XML buffer.
/// Enables zero-copy access for strings that don't need decoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StringRef {
    /// Start offset in source XML
    pub start: usize,
    /// Length of string in bytes
    pub len: usize,
    /// True if string contains XML entities that need decoding
    pub needs_decode: bool,
}

impl StringRef {
    /// Create a new StringRef
    #[inline]
    pub const fn new(start: usize, len: usize, needs_decode: bool) -> Self {
        Self {
            start,
            len,
            needs_decode,
        }
    }

    /// Get the string slice from the source XML
    #[inline]
    pub fn as_slice<'a>(&self, xml: &'a [u8]) -> &'a [u8] {
        &xml[self.start..self.start + self.len]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_strings() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>Hello</t></si>
<si><t>World</t></si>
<si><t>Test</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 3);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"Hello");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"World");

        let s2 = get_string(&refs, xml, 2, &mut buffer);
        assert_eq!(s2, b"Test");
    }

    #[test]
    fn test_strings_with_xml_entities() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>A &amp; B</t></si>
<si><t>&lt;tag&gt;</t></si>
<si><t>&quot;quoted&quot;</t></si>
<si><t>It&apos;s</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 4);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"A & B");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"<tag>");

        let s2 = get_string(&refs, xml, 2, &mut buffer);
        assert_eq!(s2, b"\"quoted\"");

        let s3 = get_string(&refs, xml, 3, &mut buffer);
        assert_eq!(s3, b"It's");
    }

    #[test]
    fn test_rich_text_strings() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
<si><r><rPr><b/></rPr><t>Bold</t></r><r><t> Normal</t></r></si>
<si><r><t>Part1</t></r><r><t>Part2</t></r><r><t>Part3</t></r></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 2);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"Bold Normal");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"Part1Part2Part3");
    }

    #[test]
    fn test_preserved_whitespace() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
<si><t xml:space="preserve">  spaces  </t></si>
<si><t xml:space="preserve">	tab	</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 2);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"  spaces  ");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"\ttab\t");
    }

    #[test]
    fn test_numeric_character_references() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>&#65;&#66;&#67;</t></si>
<si><t>&#x41;&#x42;&#x43;</t></si>
<si><t>Hello&#10;World</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 3);

        let mut buffer = Vec::new();

        // Decimal: &#65; = 'A', &#66; = 'B', &#67; = 'C'
        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"ABC");

        // Hex: &#x41; = 'A', &#x42; = 'B', &#x43; = 'C'
        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"ABC");

        // &#10; = newline
        let s2 = get_string(&refs, xml, 2, &mut buffer);
        assert_eq!(s2, b"Hello\nWorld");
    }

    #[test]
    fn test_empty_strings() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
<si><t></t></si>
<si></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 2);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(s1, b"");
    }

    #[test]
    fn test_no_unique_count_attribute() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<si><t>Test</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 1);

        let mut buffer = Vec::new();
        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"Test");
    }

    #[test]
    fn test_zero_copy_for_simple_strings() {
        let xml = br#"<sst><si><t>NoEntities</t></si></sst>"#;

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 1);

        // Should not need decoding
        assert!(!refs[0].needs_decode);

        let mut buffer = Vec::new();
        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"NoEntities");

        // Buffer should be empty (zero-copy path taken)
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_out_of_bounds_index() {
        let xml = br#"<sst><si><t>Test</t></si></sst>"#;

        let refs = parse_shared_strings_fast(xml);
        let mut buffer = Vec::new();

        let s = get_string(&refs, xml, 100, &mut buffer);
        assert_eq!(s, b"");
    }

    #[test]
    fn test_decode_xml_entities_function() {
        let mut dst = Vec::new();

        decode_xml_entities(b"Hello &amp; World", &mut dst);
        assert_eq!(dst, b"Hello & World");

        dst.clear();
        decode_xml_entities(b"&lt;div&gt;", &mut dst);
        assert_eq!(dst, b"<div>");

        dst.clear();
        decode_xml_entities(b"&quot;test&quot;", &mut dst);
        assert_eq!(dst, b"\"test\"");

        dst.clear();
        decode_xml_entities(b"O&apos;Neil", &mut dst);
        assert_eq!(dst, b"O'Neil");

        dst.clear();
        decode_xml_entities(b"No entities here", &mut dst);
        assert_eq!(dst, b"No entities here");
    }

    #[test]
    fn test_decode_numeric_entities() {
        let mut dst = Vec::new();

        decode_xml_entities_full(b"&#65;", &mut dst);
        assert_eq!(dst, b"A");

        dst.clear();
        decode_xml_entities_full(b"&#x41;", &mut dst);
        assert_eq!(dst, b"A");

        dst.clear();
        decode_xml_entities_full(b"&#x1F600;", &mut dst); // Emoji
        assert_eq!(std::str::from_utf8(&dst).unwrap(), "\u{1F600}");
    }

    #[test]
    fn test_mixed_content() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
<si><t>Price: $100 &amp; Tax: &lt;10%</t></si>
</sst>"#;

        let refs = parse_shared_strings_fast(xml);
        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(s0, b"Price: $100 & Tax: <10%");
    }

    #[test]
    fn test_unicode_content() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>日本語</t></si>
<si><t>Ελληνικά</t></si>
<si><t>🎉🎊🎁</t></si>
</sst>"#
            .as_bytes();

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 3);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(std::str::from_utf8(s0).unwrap(), "日本語");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(std::str::from_utf8(s1).unwrap(), "Ελληνικά");

        let s2 = get_string(&refs, xml, 2, &mut buffer);
        assert_eq!(std::str::from_utf8(s2).unwrap(), "🎉🎊🎁");
    }

    #[test]
    fn test_parse_unique_count() {
        let xml = br#"<sst uniqueCount="12345">"#;
        assert_eq!(scanner::parse_unique_count(xml), Some(12345));

        let xml = br#"<sst count="100" uniqueCount="50">"#;
        assert_eq!(scanner::parse_unique_count(xml), Some(50));

        let xml = br#"<sst>"#;
        assert_eq!(scanner::parse_unique_count(xml), None);
    }

    #[test]
    fn test_shared_strings_wrapper() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>Hello</t></si>
<si><t>World &amp; More</t></si>
<si><r><t>Rich</t></r><r><t>Text</t></r></si>
</sst>"#
            .to_vec();

        let mut strings = SharedStrings::parse(xml);

        assert_eq!(strings.len(), 3);
        assert!(!strings.is_empty());

        // Test simple string (zero-copy)
        assert!(!strings.needs_decode(0));
        assert_eq!(strings.get(0), b"Hello");
        assert_eq!(strings.get_str(0), Some("Hello"));

        // Test string with entities (needs decode)
        assert!(strings.needs_decode(1));
        assert_eq!(strings.get(1), b"World & More");
        assert_eq!(strings.get_str(1), Some("World & More"));

        // Test rich text (needs decode)
        assert!(strings.needs_decode(2));
        assert_eq!(strings.get(2), b"RichText");
        assert_eq!(strings.get_str(2), Some("RichText"));

        // Test out of bounds
        assert_eq!(strings.get(100), b"");
        assert_eq!(strings.get_str(100), Some(""));
    }

    #[test]
    fn test_shared_strings_get_ref() {
        let xml = br#"<sst><si><t>Test</t></si></sst>"#.to_vec();
        let strings = SharedStrings::parse(xml);

        let string_ref = strings.get_ref(0).unwrap();
        assert!(!string_ref.needs_decode);

        let raw = strings.get_raw_slice(string_ref);
        assert_eq!(raw, b"Test");

        assert!(strings.get_ref(100).is_none());
    }

    // ─── UTF-8 multi-byte preservation tests ───────────────────────────────
    //
    // Regression guard: OOXML escape decoding (_xHHHH_) was added to
    // decode_xml_entities / decode_xml_entities_full. These tests ensure
    // multi-byte UTF-8 characters (en-dash, em-dash, CJK, emoji) pass
    // through unscathed — both standalone and mixed with XML entities.

    #[test]
    fn test_decode_preserves_utf8_multibyte() {
        let cases: &[(&[u8], &str)] = &[
            ("N/A – Amendment".as_bytes(), "N/A – Amendment"), // en-dash U+2013
            ("Amendment — Pro".as_bytes(), "Amendment — Pro"), // em-dash U+2014
            ("• bullet".as_bytes(), "• bullet"),               // bullet U+2022
            ("€100".as_bytes(), "€100"),                       // euro U+20AC
            ("日本語テスト".as_bytes(), "日本語テスト"),       // CJK
            ("done 🎉".as_bytes(), "done 🎉"),                 // emoji (4-byte)
        ];
        for (input, expected) in cases {
            let mut dst = Vec::new();
            decode_xml_entities(input, &mut dst);
            assert_eq!(
                std::str::from_utf8(&dst).unwrap(),
                *expected,
                "decode_xml_entities corrupted: {:?}",
                expected
            );

            dst.clear();
            decode_xml_entities_full(input, &mut dst);
            assert_eq!(
                std::str::from_utf8(&dst).unwrap(),
                *expected,
                "decode_xml_entities_full corrupted: {:?}",
                expected
            );
        }
    }

    #[test]
    fn test_decode_utf8_mixed_with_xml_entities() {
        // The critical regression scenario: formula text containing BOTH
        // XML entities (&lt; &gt; &amp;) AND multi-byte UTF-8 chars.
        // This triggers decode_xml_entities_full because of the '&'.
        let mut dst = Vec::new();

        // en-dash + &lt;/&gt; (the exact formula pattern)
        decode_xml_entities_full(
            r#"IF(AE5&lt;&gt;"Contract","N/A – Amendment")"#.as_bytes(),
            &mut dst,
        );
        assert_eq!(
            std::str::from_utf8(&dst).unwrap(),
            r#"IF(AE5<>"Contract","N/A – Amendment")"#
        );

        dst.clear();
        decode_xml_entities_full("Price &amp; Tax – Summary".as_bytes(), &mut dst);
        assert_eq!(std::str::from_utf8(&dst).unwrap(), "Price & Tax – Summary");

        dst.clear();
        decode_xml_entities_full("Amendment – Price Increase &amp; More".as_bytes(), &mut dst);
        assert_eq!(
            std::str::from_utf8(&dst).unwrap(),
            "Amendment – Price Increase & More"
        );
    }

    #[test]
    fn test_ooxml_escape_does_not_match_xlfn_xlpm() {
        // _xlfn. and _xlpm. are XLSX function prefixes, NOT OOXML escapes.
        // 'l' and 'p' are not hex digits so they must pass through unchanged.
        let mut dst = Vec::new();

        decode_xml_entities(b"_xlfn.LET(_xlpm.key,1)", &mut dst);
        assert_eq!(std::str::from_utf8(&dst).unwrap(), "_xlfn.LET(_xlpm.key,1)");

        dst.clear();
        decode_xml_entities(b"_xlfn.XMATCH(A1,B:B)", &mut dst);
        assert_eq!(std::str::from_utf8(&dst).unwrap(), "_xlfn.XMATCH(A1,B:B)");
    }

    #[test]
    fn test_ooxml_escape_valid_sequences_decoded() {
        // Actual OOXML escapes SHOULD be decoded
        let mut dst = Vec::new();

        decode_xml_entities(b"line1_x000a_line2", &mut dst);
        assert_eq!(
            std::str::from_utf8(&dst).unwrap(),
            "line1\nline2",
            "_x000a_ should decode to newline"
        );

        dst.clear();
        decode_xml_entities(b"_x000d_", &mut dst);
        assert_eq!(dst, b"\r", "_x000d_ should decode to carriage return");

        dst.clear();
        decode_xml_entities(b"en_x2013_dash", &mut dst);
        assert_eq!(
            std::str::from_utf8(&dst).unwrap(),
            "en–dash",
            "_x2013_ should decode to en-dash"
        );
    }

    #[test]
    fn test_shared_string_xml_line_endings_normalized_without_synthesizing_cr_escape() {
        let xml = b"<sst><si><t>alpha\r\nbeta</t></si><si><t>gamma_x000D_\r\ndelta</t></si></sst>"
            .to_vec();
        let mut strings = SharedStrings::parse(xml);

        assert!(strings.needs_decode(0));
        assert_eq!(strings.get(0), b"alpha\nbeta");
        assert_eq!(strings.get(1), b"gamma\r\ndelta");
    }

    #[test]
    fn test_shared_strings_with_en_dash() {
        // Shared strings containing en-dash as literal UTF-8 (no XML entities)
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>Amendment – Price Increase</t></si>
<si><t>N/A – Amendment</t></si>
<si><t>No special chars</t></si>
</sst>"#
            .as_bytes();

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 3);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(
            std::str::from_utf8(s0).unwrap(),
            "Amendment – Price Increase"
        );

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(std::str::from_utf8(s1).unwrap(), "N/A – Amendment");

        let s2 = get_string(&refs, xml, 2, &mut buffer);
        assert_eq!(std::str::from_utf8(s2).unwrap(), "No special chars");
    }

    #[test]
    fn test_shared_strings_en_dash_with_xml_entities() {
        // The critical combo: en-dash AND XML entities in the same string.
        // The '&' triggers needs_decode=true, sending the string through
        // decode_xml_entities_full — the en-dash must survive.
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
<si><t>Price &amp; Tax – Summary</t></si>
<si><t>A &lt; B – C &gt; D</t></si>
</sst>"#
            .as_bytes();

        let refs = parse_shared_strings_fast(xml);
        assert_eq!(refs.len(), 2);

        let mut buffer = Vec::new();

        let s0 = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(std::str::from_utf8(s0).unwrap(), "Price & Tax – Summary");

        let s1 = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(std::str::from_utf8(s1).unwrap(), "A < B – C > D");
    }

    #[test]
    fn test_shared_strings_normalizes_literal_xml_crlf_but_preserves_ooxml_cr_escape() {
        let xml =
            b"<sst><si><t>Line 1\r\nLine 2</t></si><si><t>Line 1_x000D_\nLine 2</t></si></sst>";
        let refs = parse_shared_strings_fast(xml);
        let mut buffer = Vec::new();

        let literal = get_string(&refs, xml, 0, &mut buffer);
        assert_eq!(literal, b"Line 1\nLine 2");

        let escaped = get_string(&refs, xml, 1, &mut buffer);
        assert_eq!(escaped, b"Line 1\r\nLine 2");
    }
}

#[cfg(test)]
mod error_recovery_tests {
    use super::*;
    use crate::infra::error::{ErrorCode, ParseContext};

    #[test]
    fn test_get_safe_valid_index() {
        let xml = br#"<sst><si><t>Hello</t></si><si><t>World</t></si></sst>"#.to_vec();
        let mut strings = SharedStrings::parse(xml);

        // Valid index without context
        let result = strings.get_safe(0, None);
        assert_eq!(result, b"Hello");

        // Valid index with context
        let mut ctx = ParseContext::lenient();
        let result = strings.get_safe(1, Some(&mut ctx));
        assert_eq!(result, b"World");
        assert_eq!(ctx.warning_count(), 0);
    }

    #[test]
    fn test_get_safe_invalid_index() {
        let xml = br#"<sst><si><t>Hello</t></si></sst>"#.to_vec();
        let mut strings = SharedStrings::parse(xml);

        // Invalid index without context
        let result = strings.get_safe(100, None);
        assert_eq!(result, b"#REF!");

        // Invalid index with context
        let mut ctx = ParseContext::lenient();
        let result = strings.get_safe(100, Some(&mut ctx));
        assert_eq!(result, b"#REF!");
        assert_eq!(ctx.warning_count(), 1);

        let errors = ctx.errors();
        assert_eq!(errors[0].code, ErrorCode::InvalidSharedStringIndex);
    }

    #[test]
    fn test_parse_with_context_empty_xml() {
        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(Vec::new(), &mut ctx);

        assert!(strings.is_empty());
        assert_eq!(ctx.warning_count(), 1);
    }

    #[test]
    fn test_parse_with_context_missing_sst() {
        let xml = br#"<invalid>not shared strings</invalid>"#.to_vec();
        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        assert!(strings.is_empty());
        assert!(ctx.error_count() > 0);
    }

    #[test]
    fn test_parse_with_context_missing_unique_count() {
        let xml = br#"<sst><si><t>Test</t></si></sst>"#.to_vec();
        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        assert_eq!(strings.len(), 1);
        // Should log warning about missing uniqueCount
        assert!(ctx.warning_count() > 0);
    }

    #[test]
    fn test_parse_with_context_truncated_string_table() {
        // XML that starts valid strings but truncates
        let xml = br#"<sst uniqueCount="3">
<si><t>First</t></si>
<si><t>Second"#
            .to_vec(); // Truncated - no closing tags

        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        // Should parse what it can
        assert_eq!(strings.len(), 1); // Only "First" was complete
        assert!(ctx.warning_count() > 0);
    }

    #[test]
    fn test_parse_with_context_count_mismatch() {
        // uniqueCount says 3, but only 2 entries
        let xml = br#"<sst uniqueCount="3">
<si><t>First</t></si>
<si><t>Second</t></si>
</sst>"#
            .to_vec();

        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        assert_eq!(strings.len(), 2);
        // Should log warning about count mismatch
        assert!(ctx.warning_count() > 0);

        // Check for the specific mismatch warning
        let has_mismatch_warning = ctx
            .errors()
            .iter()
            .any(|e| e.code == ErrorCode::DataCorruption && e.message.contains("mismatch"));
        assert!(has_mismatch_warning);
    }

    #[test]
    fn test_parse_with_context_strict_mode() {
        let xml = br#"<invalid>not shared strings</invalid>"#.to_vec();
        let mut ctx = ParseContext::strict();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        assert!(strings.is_empty());
        assert!(ctx.should_stop());
    }

    #[test]
    fn test_parse_with_context_permissive_mode() {
        // Even with mismatched counts, permissive mode doesn't warn
        let xml = br#"<sst uniqueCount="10">
<si><t>Only</t></si>
</sst>"#
            .to_vec();

        let mut ctx = ParseContext::permissive();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        assert_eq!(strings.len(), 1);
        // Permissive mode should not report count mismatch
        let has_mismatch_warning = ctx
            .errors()
            .iter()
            .any(|e| e.code == ErrorCode::DataCorruption && e.message.contains("mismatch"));
        assert!(!has_mismatch_warning);
    }

    #[test]
    fn test_parse_with_context_malformed_rich_text() {
        // Rich text element without <t> tags
        let xml = br#"<sst uniqueCount="1">
<si><r><rPr><b/></rPr></r></si>
</sst>"#
            .to_vec();

        let mut ctx = ParseContext::lenient();
        let strings = SharedStrings::parse_with_context(xml, &mut ctx);

        // Should still have one entry (empty string as fallback)
        assert_eq!(strings.len(), 1);
        // Should have logged a warning about malformed rich text
        assert!(ctx.warning_count() > 0);
    }

    #[test]
    fn test_parse_with_context_truncated_sst_element() {
        // <sst> element without closing >
        let xml = br#"<sst uniqueCount="1"
<si><t>Test</t></si>"#
            .to_vec(); // Missing > after uniqueCount

        let mut ctx = ParseContext::lenient();
        let _strings = SharedStrings::parse_with_context(xml, &mut ctx);

        // Should attempt to recover
        assert!(ctx.warning_count() > 0 || ctx.error_count() > 0);
    }
}
