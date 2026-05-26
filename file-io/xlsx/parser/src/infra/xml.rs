//! Shared XML attribute parsing utilities.
//!
//! This module provides common functions for parsing XML attributes and decoding
//! XML entities. These utilities are used across multiple parser modules to avoid
//! code duplication.
//!
//! All functions expect the attribute pattern to include the `="` suffix, e.g., `b"name=\""`

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::pipeline::fast_parse;

// ============================================================================
// Boolean Attribute Parsing
// ============================================================================

/// Parse a boolean attribute value (1/true = true, 0/false = false).
/// Returns `false` if the attribute is not found.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix, e.g., `b"hidden=\""`
///
/// # Example
/// ```ignore
/// let xml = b"<sheet hidden=\"1\">";
/// assert!(parse_bool_attr(xml, b"hidden=\""));
/// ```
#[inline]
pub fn parse_bool_attr(xml: &[u8], attr: &[u8]) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if start < end {
                let first_byte = xml[start];
                return first_byte == b'1' || first_byte == b't' || first_byte == b'T';
            }
        }
    }
    false
}

/// Parse a boolean attribute value, returning `None` if the attribute is not found.
///
/// This variant is useful when you need to distinguish between an absent attribute
/// and an attribute explicitly set to false.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<sheet hidden=\"0\">";
/// assert_eq!(parse_bool_attr_opt(xml, b"hidden=\""), Some(false));
/// assert_eq!(parse_bool_attr_opt(xml, b"missing=\""), None);
/// ```
#[inline]
pub fn parse_bool_attr_opt(xml: &[u8], attr: &[u8]) -> Option<bool> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let first_byte = xml[value_start];
    Some(first_byte == b'1' || first_byte == b't' || first_byte == b'T')
}

/// Parse a boolean attribute value with a custom default if not found.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
/// * `default` - The value to return if the attribute is not found
#[inline]
pub fn parse_bool_attr_with_default(xml: &[u8], attr: &[u8], default: bool) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if start < end {
                let first_byte = xml[start];
                return first_byte == b'1' || first_byte == b't' || first_byte == b'T';
            }
        }
        return false;
    }
    default
}

// ============================================================================
// Numeric Attribute Parsing
// ============================================================================

/// Parse a u32 attribute value.
///
/// Uses fast inline parsing without string conversion. Returns `None` if the
/// attribute is not found or contains no digits.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<row r=\"123\">";
/// assert_eq!(parse_u32_attr(xml, b"r=\""), Some(123));
/// ```
#[inline]
pub fn parse_u32_attr(xml: &[u8], attr: &[u8]) -> Option<u32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let mut result: u32 = 0;
    let mut pos = value_start;

    while pos < xml.len() && xml[pos].is_ascii_digit() {
        result = result
            .saturating_mul(10)
            .saturating_add((xml[pos] - b'0') as u32);
        pos += 1;
    }

    if pos > value_start {
        Some(result)
    } else {
        None
    }
}

/// Parse a u8 attribute value.
///
/// Uses fast inline parsing without string conversion. Returns `None` if the
/// attribute is not found or contains no digits. Saturates at u8::MAX (255).
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<color theme=\"1\">";
/// assert_eq!(parse_u8_attr(xml, b"theme=\""), Some(1));
/// ```
#[inline]
pub fn parse_u8_attr(xml: &[u8], attr: &[u8]) -> Option<u8> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let mut result: u8 = 0;
    let mut pos = value_start;

    while pos < xml.len() && xml[pos].is_ascii_digit() {
        result = result.saturating_mul(10).saturating_add(xml[pos] - b'0');
        pos += 1;
    }

    if pos > value_start {
        Some(result)
    } else {
        None
    }
}

/// Parse an i32 attribute value.
///
/// Supports negative numbers. Uses string parsing for simplicity.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<col offset=\"-100\">";
/// assert_eq!(parse_i32_attr(xml, b"offset=\""), Some(-100));
/// ```
#[inline]
pub fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    let value_bytes = &xml[start..end];
    fast_parse::parse_i32_fast(value_bytes)
}

/// Parse an f64 attribute value.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<col width=\"8.5\">";
/// assert_eq!(parse_f64_attr(xml, b"width=\""), Some(8.5));
/// ```
#[inline]
pub fn parse_f64_attr(xml: &[u8], attr: &[u8]) -> Option<f64> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    if start >= end {
        return None;
    }

    let value_bytes = &xml[start..end];
    fast_parse::parse_f64_fast(value_bytes)
}

// ============================================================================
// String Attribute Parsing
// ============================================================================

/// Parse a string attribute value with XML entity decoding.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<cell name=\"Hello &amp; World\">";
/// assert_eq!(parse_string_attr(xml, b"name=\""), Some("Hello & World".to_string()));
/// ```
#[inline]
pub fn parse_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_string_attr_quoted(xml, attr)
}

/// Parse a string attribute value with XML entity decoding.
///
/// Unlike [`parse_string_attr`]'s historical `name="` pattern, this helper
/// accepts either a raw attribute name (`b"name"`) or the legacy
/// quote-specific forms (`b"name=\""`, `b"name='"`) and supports both single-
/// and double-quoted values.
#[inline]
pub fn parse_string_attr_quoted(xml: &[u8], attr_name: &[u8]) -> Option<String> {
    let attr_name = normalize_attr_name(attr_name);
    if attr_name.is_empty() {
        return None;
    }

    let attr_pos = find_attr_name(xml, attr_name)?;
    let mut pos = attr_pos + attr_name.len();

    while pos < xml.len() && matches!(xml[pos], b' ' | b'\t' | b'\n' | b'\r') {
        pos += 1;
    }

    if pos >= xml.len() || xml[pos] != b'=' {
        return None;
    }
    pos += 1;

    while pos < xml.len() && matches!(xml[pos], b' ' | b'\t' | b'\n' | b'\r') {
        pos += 1;
    }

    let quote = *xml.get(pos)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }

    let value_start = pos + 1;
    if let Some(value_len) = memchr::memchr(quote, &xml[value_start..]) {
        Some(decode_xml_entities(
            &xml[value_start..value_start + value_len],
        ))
    } else if value_start < xml.len() {
        Some(decode_xml_entities(&xml[value_start..]))
    } else {
        None
    }
}

#[inline]
fn normalize_attr_name(attr_name: &[u8]) -> &[u8] {
    if attr_name.ends_with(b"=\"") || attr_name.ends_with(b"='") {
        &attr_name[..attr_name.len() - 2]
    } else if attr_name.ends_with(b"=") {
        &attr_name[..attr_name.len() - 1]
    } else {
        attr_name
    }
}

#[inline]
fn find_attr_name(xml: &[u8], attr_name: &[u8]) -> Option<usize> {
    let first = attr_name[0];
    let mut pos = 0;
    let mut active_quote: Option<u8> = None;

    while pos < xml.len() {
        let b = xml[pos];
        if let Some(quote) = active_quote {
            if b == quote {
                active_quote = None;
            }
            pos += 1;
            continue;
        }

        if b == b'"' || b == b'\'' {
            active_quote = Some(b);
            pos += 1;
            continue;
        }

        let end = pos + attr_name.len();

        if b == first
            && end <= xml.len()
            && &xml[pos..end] == attr_name
            && (pos == 0 || matches!(xml[pos - 1], b' ' | b'\t' | b'\n' | b'\r' | b'<'))
            && (end >= xml.len() || matches!(xml[end], b'=' | b' ' | b'\t' | b'\n' | b'\r'))
        {
            return Some(pos);
        }

        pos += 1;
    }

    None
}

/// Like `parse_string_attr`, but expects single-quoted attribute values (e.g., `style='thin'`).
pub fn parse_string_attr_single_quote(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_string_attr_quoted(xml, attr)
}

/// Parse a string attribute verbatim — no decoding of OOXML `_xHHHH_` escapes
/// or XML entities.
///
/// Use this for contexts (e.g., VML shape IDs) where `_x0000_` is a literal string,
/// not an escape sequence, and the value contains no XML entities.
#[inline]
pub fn parse_string_attr_verbatim(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_bytes_attr(xml, attr)
        .and_then(|b| std::str::from_utf8(b).ok())
        .map(|s| s.to_string())
}

/// Parse raw bytes from an attribute without XML entity decoding.
///
/// Useful for enum values or when you need to process the bytes directly.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `attr` - The attribute pattern including `="` suffix
///
/// # Example
/// ```ignore
/// let xml = b"<filter type=\"custom\">";
/// assert_eq!(parse_bytes_attr(xml, b"type=\""), Some(b"custom".as_slice()));
/// ```
#[inline]
pub fn parse_bytes_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    // Find closing quote
    let mut pos = value_start;
    while pos < xml.len() && xml[pos] != b'"' {
        pos += 1;
    }

    Some(&xml[value_start..pos])
}

/// Parse an enum attribute value (returns raw bytes).
///
/// This is an alias for `parse_bytes_attr` with a more descriptive name
/// for use with enumeration-style attributes.
#[inline]
pub fn parse_enum_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    parse_bytes_attr(xml, attr)
}

// ============================================================================
// Element Content Parsing
// ============================================================================

/// Parse element text content with XML entity decoding.
///
/// # Arguments
/// * `xml` - The XML bytes to parse
/// * `tag_name` - The tag name (without angle brackets)
///
/// # Example
/// ```ignore
/// let xml = b"<v>Hello &amp; World</v>";
/// assert_eq!(parse_element_content(xml, b"v"), Some("Hello & World".to_string()));
/// ```
#[inline]
pub fn parse_element_content(xml: &[u8], tag_name: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, tag_name, 0)?;
    let content_start = find_gt_simd(xml, tag_start)? + 1;
    let content_end = find_closing_tag(xml, tag_name, content_start)?;

    if content_start < content_end {
        Some(decode_xml_entities(&xml[content_start..content_end]))
    } else {
        Some(String::new())
    }
}

// ============================================================================
// XML Entity Decoding
// ============================================================================

/// Decode XML entities in byte slices.
///
/// Handles the five predefined XML entities:
/// - `&lt;` -> `<`
/// - `&gt;` -> `>`
/// - `&amp;` -> `&`
/// - `&quot;` -> `"`
/// - `&apos;` -> `'`
///
/// Unknown entities (including numeric character references) are passed through as-is.
///
/// # Arguments
/// * `bytes` - The byte slice containing XML-encoded text
///
/// # Example
/// ```ignore
/// let encoded = b"&lt;hello&gt; &amp; &quot;world&quot;";
/// assert_eq!(decode_xml_entities(encoded), "<hello> & \"world\"");
/// ```
pub fn decode_xml_entities(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'&' {
            // Check for common XML entities
            if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&lt;" {
                result.push('<');
                i += 4;
            } else if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&gt;" {
                result.push('>');
                i += 4;
            } else if i + 5 <= bytes.len() && &bytes[i..i + 5] == b"&amp;" {
                result.push('&');
                i += 5;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&quot;" {
                result.push('"');
                i += 6;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&apos;" {
                result.push('\'');
                i += 6;
            } else if i + 2 < bytes.len() && bytes[i + 1] == b'#' {
                // Numeric character reference (&#NN; or &#xHH;)
                if let Some((ch, len)) = parse_numeric_char_ref(&bytes[i..]) {
                    result.push(ch);
                    i += len;
                } else {
                    result.push('&');
                    i += 1;
                }
            } else {
                // Unknown entity, just copy the &
                result.push('&');
                i += 1;
            }
        } else if bytes[i] == b'_' {
            // OOXML escape: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
            // e.g. _x000a_ = newline, _x000d_ = carriage return
            if i + 7 <= bytes.len()
                && bytes[i + 1] == b'x'
                && bytes[i + 6] == b'_'
                && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
            {
                if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 2..i + 6]) {
                    if let Ok(code_point) = u32::from_str_radix(hex_str, 16) {
                        if let Some(ch) = char::from_u32(code_point) {
                            result.push(ch);
                            i += 7;
                            continue;
                        }
                    }
                }
            }
            result.push('_');
            i += 1;
        } else {
            // Handle UTF-8 multi-byte sequences properly
            // Check UTF-8 leading byte to determine sequence length
            let byte = bytes[i];
            let seq_len = if byte & 0x80 == 0 {
                1 // ASCII
            } else if byte & 0xE0 == 0xC0 {
                2 // 2-byte sequence
            } else if byte & 0xF0 == 0xE0 {
                3 // 3-byte sequence
            } else if byte & 0xF8 == 0xF0 {
                4 // 4-byte sequence
            } else {
                1 // Invalid, treat as single byte
            };

            let end = (i + seq_len).min(bytes.len());
            if let Ok(s) = std::str::from_utf8(&bytes[i..end]) {
                result.push_str(s);
            } else {
                // Fallback for invalid UTF-8: use replacement char
                result.push(char::REPLACEMENT_CHARACTER);
            }
            i = end;
        }
    }

    result
}

/// Parse a numeric character reference (&#NNN; or &#xHHH;)
fn parse_numeric_char_ref(bytes: &[u8]) -> Option<(char, usize)> {
    if bytes.len() < 4 || bytes[0] != b'&' || bytes[1] != b'#' {
        return None;
    }

    let is_hex = bytes[2] == b'x' || bytes[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };

    let mut end = num_start;
    while end < bytes.len() && bytes[end] != b';' {
        end += 1;
    }

    if end >= bytes.len() || bytes[end] != b';' {
        return None;
    }

    let num_bytes = &bytes[num_start..end];
    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse::<u32>().ok()?
    };

    char::from_u32(code_point).map(|ch| (ch, end + 1))
}

/// Decode XML entities in a string.
///
/// This is a convenience wrapper around `decode_xml_entities` for string inputs.
pub fn decode_xml_entities_string(s: &str) -> String {
    decode_xml_entities(s.as_bytes())
}

// ============================================================================
// Markup Compatibility (mc:AlternateContent) Resolution
// ============================================================================

/// Namespaces we understand and can render. When an `mc:Choice` element's
/// `Requires` attribute lists one of these prefixes *and* the corresponding
/// namespace URI is in this set, we select the Choice branch.
///
/// Add entries here as the parser gains support for more extension namespaces.
pub const MC_SUPPORTED_NAMESPACES: &[&str] = &[
    // x14 — Office 2010 SpreadsheetML extensions (form controls, slicers, etc.)
    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    // x15 — Office 2013 SpreadsheetML extensions (table slicers, etc.)
    "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
];

/// Result of resolving an `mc:AlternateContent` element.
///
/// Contains the byte range (relative to the input slice) of the selected
/// branch content — either the first supported `mc:Choice` or the `mc:Fallback`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McBranch {
    /// Start offset (inclusive) of the selected branch content within the input slice.
    pub start: usize,
    /// End offset (exclusive) of the selected branch content within the input slice.
    pub end: usize,
    /// Whether the Choice branch was selected (`true`) or Fallback (`false`).
    pub is_choice: bool,
}

/// Result of resolving an `mc:AlternateContent` element (v2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McResolution {
    /// A supported Choice branch was selected — use its content.
    Resolved(McBranch),
    /// No supported Choice found, but the entire AC block should be preserved
    /// for round-trip fidelity. Contains the raw XML of the full
    /// `<mc:AlternateContent>...</mc:AlternateContent>` block.
    Preserved(String),
    /// Empty — no Choice and no Fallback (or empty Fallback with no Choice to preserve).
    Empty,
}

type PrefixResolver = dyn Fn(&str) -> Option<&'static str>;

/// Resolve an `mc:AlternateContent` element, returning the byte range of the
/// best matching branch.
///
/// The function searches for `mc:Choice` elements inside the given XML slice.
/// For each Choice whose `Requires` attribute lists a namespace prefix that
/// maps (via `prefix_resolver`) to a URI in [`MC_SUPPORTED_NAMESPACES`], the
/// Choice's inner content is returned. If no supported Choice is found the
/// `mc:Fallback` content is returned instead.
///
/// # Arguments
/// * `xml` — The bytes of the `mc:AlternateContent` element (outer tags included).
/// * `prefix_resolver` — A function that maps a namespace prefix (e.g. `"x14"`)
///   to its URI. Pass `None` to use a built-in default that recognises `x14`
///   and `x15`.
///
/// # Returns
/// `Some(McBranch)` with the selected branch range, or `None` if the element
/// could not be parsed at all (no Choice *and* no Fallback).
///
/// # Example
/// ```ignore
/// let xml = br#"<mc:AlternateContent>
///   <mc:Choice Requires="x14"><controls>...</controls></mc:Choice>
///   <mc:Fallback/>
/// </mc:AlternateContent>"#;
/// let branch = resolve_mc_alternate_content(xml, None);
/// assert!(branch.unwrap().is_choice);
/// ```
pub fn resolve_mc_alternate_content(
    xml: &[u8],
    prefix_resolver: Option<&PrefixResolver>,
) -> Option<McBranch> {
    // Default resolver for the common x14/x15 prefixes
    fn default_resolver(prefix: &str) -> Option<&'static str> {
        match prefix {
            "x14" => Some("http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"),
            "x15" => Some("http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"),
            _ => None,
        }
    }

    // Try each mc:Choice in document order
    let mut pos: usize = 0;
    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        // Extract the opening tag's bytes to read Requires=""
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            // Requires may list multiple space-separated prefixes; we check each.
            let supported = requires.split_whitespace().all(|pfx| {
                let uri = if let Some(resolver) = prefix_resolver {
                    resolver(pfx)
                } else {
                    default_resolver(pfx)
                };
                match uri {
                    Some(u) => MC_SUPPORTED_NAMESPACES.contains(&u),
                    None => false,
                }
            });

            if supported && !requires.is_empty() {
                // Content starts after the opening tag `>`
                let content_start = choice_elem_end;
                let content_end =
                    find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(xml.len());

                return Some(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            }
        }

        // Move past this Choice to look for the next one
        let choice_close =
            find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(choice_elem_end);
        pos = find_gt_simd(xml, choice_close)
            .map(|p| p + 1)
            .unwrap_or(choice_close + 1);
    }

    // No supported Choice found — try mc:Fallback
    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        // Check for self-closing tag  <mc:Fallback/>
        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            // Self-closing — empty fallback
            return Some(McBranch {
                start: fb_elem_end,
                end: fb_elem_end,
                is_choice: false,
            });
        }

        let content_start = fb_elem_end;
        let content_end = find_closing_tag(xml, b"mc:Fallback", fb_start).unwrap_or(xml.len());

        return Some(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    None
}

/// Resolve an `mc:AlternateContent` element with preservation support (v2).
///
/// Like [`resolve_mc_alternate_content`], but instead of discarding Choice
/// branches with unsupported namespaces (and returning only the Fallback),
/// this function preserves the entire `<mc:AlternateContent>` block as raw XML
/// when no supported Choice is found but unsupported Choices exist.
///
/// # Returns
/// - `McResolution::Resolved(McBranch)` — a supported Choice was found, or
///   there are no Choices but a Fallback with content exists.
/// - `McResolution::Preserved(String)` — no supported Choice, but at least one
///   unsupported Choice exists. The full AC block is preserved as-is.
/// - `McResolution::Empty` — no Choices and no Fallback (or only an empty
///   self-closing Fallback with no Choices).
pub fn resolve_mc_alternate_content_v2(
    xml: &[u8],
    prefix_resolver: Option<&PrefixResolver>,
) -> McResolution {
    // Default resolver for the common x14/x15 prefixes
    fn default_resolver(prefix: &str) -> Option<&'static str> {
        match prefix {
            "x14" => Some("http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"),
            "x15" => Some("http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"),
            _ => None,
        }
    }

    let mut has_unsupported_choice = false;

    // Try each mc:Choice in document order
    let mut pos: usize = 0;
    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        // Extract the opening tag's bytes to read Requires=""
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            // Requires may list multiple space-separated prefixes; we check each.
            let supported = !requires.is_empty()
                && requires.split_whitespace().all(|pfx| {
                    let uri = if let Some(resolver) = prefix_resolver {
                        resolver(pfx)
                    } else {
                        default_resolver(pfx)
                    };
                    match uri {
                        Some(u) => MC_SUPPORTED_NAMESPACES.contains(&u),
                        None => false,
                    }
                });

            if supported {
                // Content starts after the opening tag `>`
                let content_start = choice_elem_end;
                let content_end =
                    find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(xml.len());

                return McResolution::Resolved(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            } else {
                has_unsupported_choice = true;
            }
        }

        // Move past this Choice to look for the next one
        let choice_close =
            find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(choice_elem_end);
        pos = find_gt_simd(xml, choice_close)
            .map(|p| p + 1)
            .unwrap_or(choice_close + 1);
    }

    // No supported Choice found.
    if has_unsupported_choice {
        // Preserve the entire AC block for round-trip fidelity.
        return McResolution::Preserved(String::from_utf8_lossy(xml).into_owned());
    }

    // No Choices at all — try mc:Fallback
    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        // Check for self-closing tag  <mc:Fallback/>
        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            return McResolution::Empty;
        }

        let content_start = fb_elem_end;
        let content_end = find_closing_tag(xml, b"mc:Fallback", fb_start).unwrap_or(xml.len());

        return McResolution::Resolved(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    McResolution::Empty
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Boolean attribute tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Numeric attribute tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_u32_attr() {
        assert_eq!(parse_u32_attr(b"<row r=\"123\">", b"r=\""), Some(123));
        assert_eq!(parse_u32_attr(b"<row r=\"0\">", b"r=\""), Some(0));
        assert_eq!(parse_u32_attr(b"<row>", b"r=\""), None);
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

    // -------------------------------------------------------------------------
    // String attribute tests
    // -------------------------------------------------------------------------

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
    fn test_parse_bytes_attr() {
        assert_eq!(
            parse_bytes_attr(b"<filter type=\"custom\">", b"type=\""),
            Some(b"custom".as_slice())
        );
        assert_eq!(parse_bytes_attr(b"<filter>", b"type=\""), None);
    }

    // -------------------------------------------------------------------------
    // XML entity decoding tests
    // -------------------------------------------------------------------------

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
        // Unknown entities should be passed through
        assert_eq!(decode_xml_entities(b"&unknown;"), "&unknown;");
    }

    #[test]
    fn test_decode_xml_entities_string() {
        assert_eq!(decode_xml_entities_string("&lt;hello&gt;"), "<hello>");
    }

    // -------------------------------------------------------------------------
    // mc:AlternateContent resolution tests
    // -------------------------------------------------------------------------

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
        assert_eq!(branch.start, branch.end); // empty content
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

        // Without custom resolver, falls back
        let branch = resolve_mc_alternate_content(xml, None).unwrap();
        assert!(!branch.is_choice);

        // With custom resolver that recognises "myns"
        let resolver = |prefix: &str| -> Option<&str> {
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

    // -------------------------------------------------------------------------
    // mc:AlternateContent resolution v2 tests (with preservation)
    // -------------------------------------------------------------------------

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
                // The full AC block is preserved, including both Choice and Fallback
                assert!(raw.contains("mc:AlternateContent"));
                assert!(raw.contains("unknownNs"));
                assert!(raw.contains("<stuff>important</stuff>"));
                assert!(raw.contains("<legacy>data</legacy>"));
            }
            other => panic!("Expected Preserved, got {:?}", other),
        }
    }

    #[test]
    fn test_mc_v2_empty_fallback_no_choice() {
        // No Choice elements at all, just an empty self-closing Fallback
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
        // No Choice elements, but a Fallback with actual content
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
        // First Choice is supported (x14), second is unsupported — supported wins
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
}
