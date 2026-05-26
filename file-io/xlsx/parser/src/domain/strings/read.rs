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

use crate::infra::error::{ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail, ParseMode};
use crate::zip::constants::{MAX_RICH_TEXT_RUNS_PER_STRING, MAX_SHARED_STRINGS};
use domain_types::RichTextRun as DtRichTextRun;
use memchr::{memchr, memmem};

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
        let (refs, phonetic_xml) = parse_shared_strings_with_context(&xml, context);
        Self {
            xml,
            refs,
            decode_buffer: Vec::with_capacity(256),
            phonetic_xml,
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

/// Find a byte sequence in the XML starting from the given position
#[inline]
fn find_bytes(xml: &[u8], pattern: &[u8], start: usize) -> Option<usize> {
    if start >= xml.len() {
        return None;
    }
    memmem::find(&xml[start..], pattern).map(|pos| pos + start)
}

/// Find a single byte in the XML starting from the given position
#[inline]
fn find_byte(xml: &[u8], byte: u8, start: usize) -> Option<usize> {
    if start >= xml.len() {
        return None;
    }
    memchr(byte, &xml[start..]).map(|pos| pos + start)
}

/// Parse the uniqueCount attribute from the <sst> element
fn parse_unique_count(xml: &[u8]) -> Option<usize> {
    // Find <sst element
    let sst_pos = find_bytes(xml, b"<sst", 0)?;
    let sst_end = find_byte(xml, b'>', sst_pos)?;

    // Find uniqueCount=" within the <sst> tag
    let attr_start = find_bytes(xml, b"uniqueCount=\"", sst_pos)?;
    if attr_start > sst_end {
        return None;
    }

    let value_start = attr_start + b"uniqueCount=\"".len();
    let value_end = find_byte(xml, b'"', value_start)?;

    // Parse the number
    let value_bytes = &xml[value_start..value_end];
    let value_str = std::str::from_utf8(value_bytes).ok()?;
    value_str.parse().ok()
}

/// Check if a byte slice contains XML text that needs decoding or XML line-end normalization.
#[inline]
fn needs_xml_text_decode(bytes: &[u8]) -> bool {
    // '&' starts XML entities, '_' may start an OOXML _xHHHH_ escape, and
    // raw CR/CRLF in XML text is normalized to LF by conforming XML parsers.
    memchr(b'&', bytes).is_some() || memchr(b'_', bytes).is_some() || memchr(b'\r', bytes).is_some()
}

/// Find the content boundaries of a <t> element
/// Returns (content_start, content_end) or None
fn find_t_content(xml: &[u8], start: usize, end_boundary: usize) -> Option<(usize, usize)> {
    // Find <t or <t>
    let t_start = find_bytes(xml, b"<t", start)?;
    if t_start >= end_boundary {
        return None;
    }

    // Skip past <t> or <t ...>
    let after_t = t_start + 2;
    if after_t >= xml.len() {
        return None;
    }

    let content_start = if xml[after_t] == b'>' {
        // Simple <t>
        after_t + 1
    } else if xml[after_t] == b' ' {
        // <t xml:space="preserve"> or other attributes
        let close = find_byte(xml, b'>', after_t)?;
        close + 1
    } else {
        // Not a <t> tag (could be <table> or something else)
        return None;
    };

    // Find </t>
    let content_end = find_bytes(xml, b"</t>", content_start)?;
    if content_end > end_boundary {
        return None;
    }

    Some((content_start, content_end))
}

/// Parse shared strings from XLSX sharedStrings.xml content
///
/// # Arguments
/// * `xml` - The raw XML bytes of sharedStrings.xml
///
/// # Returns
/// A vector of StringRef pointing into the original XML buffer
pub fn parse_shared_strings_fast(xml: &[u8]) -> Vec<StringRef> {
    // Pre-allocate based on uniqueCount if available
    let capacity = parse_unique_count(xml).unwrap_or(1000);
    let mut strings = Vec::with_capacity(capacity);

    // Find start of string items
    let sst_end = match find_bytes(xml, b"<sst", 0) {
        Some(pos) => find_byte(xml, b'>', pos).unwrap_or(0),
        None => return strings,
    };

    let mut pos = sst_end;

    // Parse each <si> element
    while let Some(si_start) = find_bytes(xml, b"<si", pos) {
        // Find end of this <si> element
        let si_end = match find_bytes(xml, b"</si>", si_start) {
            Some(end) => end,
            None => break,
        };

        // Check if this is a simple string or rich text (bounded search within <si>)
        let has_rich_text = memmem::find(&xml[si_start..si_end], b"<r").is_some();

        if has_rich_text {
            // Rich text: concatenate all <t> elements
            // For rich text, we need to mark that concatenation is needed
            // We store the entire <si> element range and mark needs_decode = true
            // to signal that special handling is required
            if find_t_content(xml, si_start, si_end).is_some() {
                // Store reference to entire <si> range - decoder will handle extraction
                strings.push(StringRef {
                    start: si_start,
                    len: si_end - si_start,
                    needs_decode: true, // Always needs processing for rich text
                });
            } else {
                // No <t> found, empty string
                strings.push(StringRef::new(0, 0, false));
            }
        } else {
            // Simple case: single <t> element
            if let Some((content_start, content_end)) = find_t_content(xml, si_start, si_end) {
                let content = &xml[content_start..content_end];
                strings.push(StringRef {
                    start: content_start,
                    len: content_end - content_start,
                    needs_decode: needs_xml_text_decode(content),
                });
            } else {
                // No <t> element found, might be empty <si></si> or <si/>
                strings.push(StringRef::new(0, 0, false));
            }
        }

        pos = si_end + 5; // Move past </si>
    }

    strings
}

/// Parse shared strings with error recovery support
///
/// This function extends `parse_shared_strings_fast` with error recovery based on
/// the provided `ParseContext`. It handles:
///
/// - Missing uniqueCount attribute: Counts entries manually
/// - Truncated string table: Parses what's available and logs warning
/// - Malformed <si> elements: Skips them and logs error
///
/// # Arguments
/// * `xml` - The raw XML bytes of sharedStrings.xml
/// * `context` - Parse context for error handling
///
/// # Returns
/// A vector of StringRef pointing into the original XML buffer
pub fn parse_shared_strings_with_context(
    xml: &[u8],
    context: &mut ParseContext,
) -> (Vec<StringRef>, Vec<Option<Vec<u8>>>) {
    // Handle empty XML
    if xml.is_empty() {
        context.report_warning(ErrorCode::MissingPart, "Empty shared strings XML");
        return (Vec::new(), Vec::new());
    }

    // Try to get uniqueCount for pre-allocation
    let unique_count = parse_unique_count(xml);
    if let Some(count) = unique_count
        && count > MAX_SHARED_STRINGS
    {
        context.report_error_detail(
            ParseErrorDetail::fatal(
                ErrorCode::DataCorruption,
                format!(
                    "sharedStrings.xml declares uniqueCount {} above parser limit {}",
                    count, MAX_SHARED_STRINGS
                ),
            )
            .with_location(ErrorLocation::new("xl/sharedStrings.xml")),
        );
        return (Vec::new(), Vec::new());
    }
    let capacity = unique_count.unwrap_or_else(|| {
        if context.mode != ParseMode::Strict {
            context.report_warning(
                ErrorCode::MissingAttribute,
                "Missing uniqueCount attribute in <sst>, counting entries manually",
            );
        }
        // Estimate based on XML size (rough heuristic: ~50 bytes per entry)
        (xml.len() / 50).max(100)
    });

    let mut strings = Vec::with_capacity(capacity.min(MAX_SHARED_STRINGS));
    let mut phonetic_xml: Vec<Option<Vec<u8>>> =
        Vec::with_capacity(capacity.min(MAX_SHARED_STRINGS));

    // Quick check: if no phonetic data in the entire XML, skip per-entry extraction
    let has_any_phonetic =
        memmem::find(xml, b"<phoneticPr").is_some() || memmem::find(xml, b"<rPh").is_some();

    // Find start of string items - handle missing <sst> element
    let sst_end = match find_bytes(xml, b"<sst", 0) {
        Some(pos) => {
            match find_byte(xml, b'>', pos) {
                Some(end) => end,
                None => {
                    // Truncated <sst> element
                    if context.mode == ParseMode::Strict {
                        context.report_error(
                            ErrorCode::MalformedXml,
                            "Truncated <sst> element - missing closing '>'",
                        );
                        return (strings, phonetic_xml);
                    }
                    context.report_warning(
                        ErrorCode::MalformedXml,
                        "Truncated <sst> element - missing closing '>', attempting to parse anyway",
                    );
                    pos + 4 // Skip past "<sst"
                }
            }
        }
        None => {
            // No <sst> element found
            context.report_error(
                ErrorCode::MalformedXml,
                "Missing <sst> element in sharedStrings.xml",
            );
            return (strings, phonetic_xml);
        }
    };

    let mut pos = sst_end;
    let mut entry_count = 0;

    // Parse each <si> element
    while let Some(si_start) = find_bytes(xml, b"<si", pos) {
        // Find end of this <si> element
        let si_end = match find_bytes(xml, b"</si>", si_start) {
            Some(end) => end,
            None => {
                // Truncated string table - parse what we have
                context.report_warning(
                    ErrorCode::TruncatedFile,
                    &format!(
                        "Truncated shared string table at entry {} - missing </si>",
                        entry_count
                    ),
                );
                break;
            }
        };

        entry_count += 1;
        if entry_count > MAX_SHARED_STRINGS {
            context.report_error_detail(
                ParseErrorDetail::fatal(
                    ErrorCode::DataCorruption,
                    format!(
                        "sharedStrings.xml contains more than {} <si> entries",
                        MAX_SHARED_STRINGS
                    ),
                )
                .with_location(ErrorLocation::new("xl/sharedStrings.xml")),
            );
            break;
        }

        // Check if this is a simple string or rich text (bounded search within <si>)
        let has_rich_text = memmem::find(&xml[si_start..si_end], b"<r").is_some();

        if has_rich_text {
            // Rich text: concatenate all <t> elements
            if find_t_content(xml, si_start, si_end).is_some() {
                strings.push(StringRef {
                    start: si_start,
                    len: si_end - si_start,
                    needs_decode: true,
                });
            } else {
                // No <t> found in rich text - malformed
                if context.mode == ParseMode::Strict {
                    context.report_error(
                        ErrorCode::MalformedXml,
                        &format!(
                            "Malformed rich text entry {} - no <t> element found",
                            entry_count
                        ),
                    );
                } else {
                    context.report_warning(
                        ErrorCode::MalformedXml,
                        &format!(
                            "Malformed rich text entry {} - using empty string",
                            entry_count
                        ),
                    );
                }
                strings.push(StringRef::new(0, 0, false));
            }
        } else {
            // Simple case: single <t> element
            if let Some((content_start, content_end)) = find_t_content(xml, si_start, si_end) {
                let content = &xml[content_start..content_end];
                strings.push(StringRef {
                    start: content_start,
                    len: content_end - content_start,
                    needs_decode: needs_xml_text_decode(content),
                });
            } else {
                // No <t> element found - might be empty or malformed
                strings.push(StringRef::new(0, 0, false));
            }
        }

        // Extract phonetic XML inline (avoids a second scan of the entire SST)
        if has_any_phonetic {
            let si_bytes = &xml[si_start..si_end];
            phonetic_xml.push(extract_phonetic_xml(si_bytes));
        } else {
            phonetic_xml.push(None);
        }

        pos = si_end + 5; // Move past </si>

        // Check if we should stop (in strict mode with errors)
        if context.should_stop() {
            break;
        }
    }

    // Verify entry count matches uniqueCount if provided
    if let Some(expected) = unique_count {
        if strings.len() != expected && context.mode != ParseMode::Permissive {
            context.report_warning(
                ErrorCode::DataCorruption,
                &format!(
                    "Shared string count mismatch: expected {} but found {}",
                    expected,
                    strings.len()
                ),
            );
        }
    }

    (strings, phonetic_xml)
}

/// Decode XML entities in source bytes and write to destination buffer
///
/// Handles:
/// - &amp; -> &
/// - &lt; -> <
/// - &gt; -> >
/// - &quot; -> "
/// - &apos; -> '
/// - &#NN; -> character (decimal)
/// - &#xHH; -> character (hexadecimal)
pub fn decode_xml_entities(src: &[u8], dst: &mut Vec<u8>) {
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'&' {
            // Try to decode entity
            if let Some((decoded, advance)) = decode_entity(&src[i..]) {
                dst.extend_from_slice(decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'_' {
            // OOXML escape: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
            if let Some((decoded, advance)) = decode_ooxml_escape(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'\r' {
            dst.push(b'\n');
            i += if i + 1 < src.len() && src[i + 1] == b'\n' {
                2
            } else {
                1
            };
            continue;
        }
        dst.push(src[i]);
        i += 1;
    }
}

/// Try to decode a single XML entity starting at the given position
/// Returns (decoded_bytes, bytes_consumed) or None if not a valid entity
fn decode_entity(src: &[u8]) -> Option<(&'static [u8], usize)> {
    if src.len() < 3 || src[0] != b'&' {
        return None;
    }

    // Named entities
    if src.starts_with(b"&amp;") {
        return Some((b"&", 5));
    }
    if src.starts_with(b"&lt;") {
        return Some((b"<", 4));
    }
    if src.starts_with(b"&gt;") {
        return Some((b">", 4));
    }
    if src.starts_with(b"&quot;") {
        return Some((b"\"", 6));
    }
    if src.starts_with(b"&apos;") {
        return Some((b"'", 6));
    }

    None
}

/// Decode an OOXML escape sequence: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
/// e.g. _x000a_ = newline, _x000d_ = carriage return
fn decode_ooxml_escape(src: &[u8]) -> Option<(Vec<u8>, usize)> {
    if src.len() < 7 || src[0] != b'_' || src[1] != b'x' || src[6] != b'_' {
        return None;
    }
    if !src[2..6].iter().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let hex_str = std::str::from_utf8(&src[2..6]).ok()?;
    let code_point = u32::from_str_radix(hex_str, 16).ok()?;
    let ch = char::from_u32(code_point)?;
    let mut buf = [0u8; 4];
    let encoded = ch.encode_utf8(&mut buf);
    Some((encoded.as_bytes().to_vec(), 7))
}

/// Decode a numeric character reference (&#NN; or &#xHH;)
/// Returns the decoded character as UTF-8 bytes and the number of bytes consumed
fn decode_numeric_entity(src: &[u8]) -> Option<(Vec<u8>, usize)> {
    if !src.starts_with(b"&#") {
        return None;
    }

    let semicolon_pos = memchr(b';', src)?;
    if semicolon_pos < 3 {
        return None;
    }

    let is_hex = src[2] == b'x' || src[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };
    let num_bytes = &src[num_start..semicolon_pos];

    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse().ok()?
    };

    let ch = char::from_u32(code_point)?;
    let mut buf = [0u8; 4];
    let encoded = ch.encode_utf8(&mut buf);

    Some((encoded.as_bytes().to_vec(), semicolon_pos + 1))
}

/// Decode XML entities including numeric character references
pub fn decode_xml_entities_full(src: &[u8], dst: &mut Vec<u8>) {
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'&' {
            // Try named entity first
            if let Some((decoded, advance)) = decode_entity(&src[i..]) {
                dst.extend_from_slice(decoded);
                i += advance;
                continue;
            }
            // Try numeric entity
            if let Some((decoded, advance)) = decode_numeric_entity(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'_' {
            // OOXML escape: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
            if let Some((decoded, advance)) = decode_ooxml_escape(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'\r' {
            dst.push(b'\n');
            i += if i + 1 < src.len() && src[i + 1] == b'\n' {
                2
            } else {
                1
            };
            continue;
        }
        dst.push(src[i]);
        i += 1;
    }
}

/// Extract and concatenate all <t> elements from rich text
fn extract_rich_text_content(xml: &[u8], si_start: usize, si_end: usize, dst: &mut Vec<u8>) {
    let mut pos = si_start;
    while let Some((content_start, content_end)) = find_t_content(xml, pos, si_end) {
        let content = &xml[content_start..content_end];
        decode_xml_entities_full(content, dst);
        pos = content_end + 4; // Skip past </t>
    }
}

/// Extract raw phonetic XML (`<rPh>...</rPh>` and `<phoneticPr .../>`) from an `<si>` element.
/// Returns `None` if no phonetic data is present.
fn extract_phonetic_xml(si_bytes: &[u8]) -> Option<Vec<u8>> {
    // Look for <rPh or <phoneticPr within the <si> element
    let rph_pos = find_bytes(si_bytes, b"<rPh", 0);
    let pp_pos = find_bytes(si_bytes, b"<phoneticPr", 0);

    // If neither exists, no phonetic data
    if rph_pos.is_none() && pp_pos.is_none() {
        return None;
    }

    let mut result = Vec::new();

    // Extract all <rPh>...</rPh> elements
    let mut pos = 0;
    while let Some(start) = find_bytes(si_bytes, b"<rPh", pos) {
        // Ensure it's <rPh> or <rPh  not <rPhxxx
        let after = start + 4;
        if after < si_bytes.len() && (si_bytes[after] == b' ' || si_bytes[after] == b'>') {
            if let Some(end_tag) = find_bytes(si_bytes, b"</rPh>", start) {
                let end = end_tag + b"</rPh>".len();
                result.extend_from_slice(&si_bytes[start..end]);
                pos = end;
                continue;
            }
        }
        pos = after;
    }

    // Extract <phoneticPr .../> element
    if let Some(start) = pp_pos {
        // Find the closing > (it's self-closing)
        if let Some(gt) = si_bytes[start..].iter().position(|&b| b == b'>') {
            let end = start + gt + 1;
            result.extend_from_slice(&si_bytes[start..end]);
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// Check whether a shared string entry at `index` is rich text (has `<r>` runs).
pub fn is_rich_text_entry(refs: &[StringRef], xml: &[u8], index: usize) -> bool {
    if let Some(r) = refs.get(index) {
        r.needs_decode && r.len > 0 && r.as_slice(xml).starts_with(b"<si")
    } else {
        false
    }
}

/// Parse rich text runs from a shared string entry.
/// Returns `None` for plain text entries, `Some(runs)` for rich text.
pub fn parse_rich_text_runs(
    refs: &[StringRef],
    xml: &[u8],
    index: usize,
) -> Option<Vec<DtRichTextRun>> {
    let r = refs.get(index)?;
    if !r.needs_decode || r.len == 0 {
        return None;
    }
    let slice = r.as_slice(xml);
    if !slice.starts_with(b"<si") {
        return None;
    }

    let si_start = r.start;
    let si_end = r.start + r.len;
    let mut runs = Vec::new();
    let mut pos = si_start;

    while pos < si_end {
        // Find next <r> or <r > element
        let r_start = match find_bytes(xml, b"<r", pos) {
            Some(p) if p < si_end => p,
            _ => break,
        };
        // Ensure this is <r> or <r > not <rPr> etc.
        let after_r = r_start + 2;
        if after_r >= xml.len() {
            break;
        }
        if xml[after_r] != b'>' && xml[after_r] != b' ' {
            pos = after_r;
            continue;
        }

        // Find </r>
        let r_end = match find_bytes(xml, b"</r>", r_start) {
            Some(p) if p < si_end => p,
            _ => break,
        };

        let mut run = DtRichTextRun::default();

        // Parse <rPr> if present
        if let Some(rpr_start) = find_bytes(xml, b"<rPr", r_start) {
            if rpr_start < r_end {
                if let Some(rpr_end) = find_bytes(xml, b"</rPr>", rpr_start) {
                    if rpr_end < r_end {
                        parse_rpr_into_run(xml, rpr_start, rpr_end, &mut run);
                    }
                }
            }
        }

        // Parse <t> content
        if let Some((t_start, t_end)) = find_t_content(xml, r_start, r_end) {
            let content = &xml[t_start..t_end];
            let mut buf = Vec::new();
            if needs_xml_text_decode(content) {
                decode_xml_entities_full(content, &mut buf);
                run.text = std::str::from_utf8(&buf)
                    .expect("decoded rich-text shared string is valid UTF-8")
                    .to_owned();
            } else {
                run.text = std::str::from_utf8(content)
                    .expect("rich-text shared string XML was validated as UTF-8")
                    .to_owned();
            }
            // Check xml:space="preserve"
            if let Some(t_tag_start) = find_bytes(xml, b"<t", r_start) {
                if t_tag_start < t_start {
                    let t_tag = &xml[t_tag_start..t_start];
                    if memmem::find(t_tag, b"preserve").is_some() {
                        run.preserve_space = true;
                    }
                }
            }
        }

        runs.push(run);
        if runs.len() > MAX_RICH_TEXT_RUNS_PER_STRING {
            return None;
        }
        pos = r_end + 4; // Skip past </r>
    }

    if runs.is_empty() { None } else { Some(runs) }
}

/// Parse `<rPr>` element attributes into a `DtRichTextRun`.
fn parse_rpr_into_run(xml: &[u8], rpr_start: usize, rpr_end: usize, run: &mut DtRichTextRun) {
    let region = &xml[rpr_start..rpr_end];

    // Boolean flags (empty elements like <b/> or <b val="1"/>)
    if memmem::find(region, b"<b").is_some() {
        // Check it's <b/> or <b /> or <b val="..."> (not <border> etc.)
        if let Some(p) = memmem::find(region, b"<b") {
            let after = p + 2;
            if after < region.len()
                && (region[after] == b'/' || region[after] == b'>' || region[after] == b' ')
            {
                // Check for val="0" which means NOT bold
                let is_false = extract_attr_in_region(region, p, b"val")
                    .map(|v| v == b"0" || v == b"false")
                    .unwrap_or(false);
                run.bold = !is_false;
            }
        }
    }
    if memmem::find(region, b"<i").is_some() {
        if let Some(p) = memmem::find(region, b"<i") {
            let after = p + 2;
            if after < region.len()
                && (region[after] == b'/' || region[after] == b'>' || region[after] == b' ')
            {
                let is_false = extract_attr_in_region(region, p, b"val")
                    .map(|v| v == b"0" || v == b"false")
                    .unwrap_or(false);
                run.italic = !is_false;
            }
        }
    }
    if memmem::find(region, b"<u").is_some() {
        if let Some(p) = memmem::find(region, b"<u") {
            let after = p + 2;
            if after < region.len()
                && (region[after] == b'/' || region[after] == b'>' || region[after] == b' ')
            {
                let is_false = extract_attr_in_region(region, p, b"val")
                    .map(|v| v == b"0" || v == b"none" || v == b"false")
                    .unwrap_or(false);
                run.underline = !is_false;
            }
        }
    }
    if memmem::find(region, b"<strike").is_some() {
        if let Some(p) = memmem::find(region, b"<strike") {
            let after = p + 7;
            if after < region.len()
                && (region[after] == b'/' || region[after] == b'>' || region[after] == b' ')
            {
                let is_false = extract_attr_in_region(region, p, b"val")
                    .map(|v| v == b"0" || v == b"false")
                    .unwrap_or(false);
                run.strikethrough = !is_false;
            }
        }
    }

    // <sz val="10.5"/>
    if let Some(p) = memmem::find(region, b"<sz") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<f64>() {
                    run.font_size = Some(v);
                }
            }
        }
    }

    // <color rgb="FF000000"/> or <color indexed="81"/> or <color theme="1" tint="-0.5"/>
    if let Some(p) = memmem::find(region, b"<color") {
        if let Some(val) = extract_attr_in_region(region, p, b"rgb") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.color = Some(s.to_string());
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"indexed") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.color_indexed = Some(v);
                }
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"theme") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.color_theme = Some(v);
                }
            }
        }
        if let Some(val) = extract_attr_in_region(region, p, b"tint") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<f64>() {
                    run.color_tint = Some(v);
                }
            }
        }
    }

    // <rFont val="Arial"/>
    if let Some(p) = memmem::find(region, b"<rFont") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.font_name = Some(s.to_string());
            }
        }
    }

    // <family val="2"/>
    if let Some(p) = memmem::find(region, b"<family") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.family = Some(v);
                }
            }
        }
    }

    // <charset val="128"/>
    if let Some(p) = memmem::find(region, b"<charset") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                if let Ok(v) = s.parse::<u32>() {
                    run.charset = Some(v);
                }
            }
        }
    }

    // <scheme val="minor"/>
    if let Some(p) = memmem::find(region, b"<scheme") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.scheme = Some(s.to_string());
            }
        }
    }

    // <vertAlign val="superscript"/> or <vertAlign val="subscript"/>
    if let Some(p) = memmem::find(region, b"<vertAlign") {
        if let Some(val) = extract_attr_in_region(region, p, b"val") {
            if let Ok(s) = std::str::from_utf8(val) {
                run.vert_align = Some(s.to_string());
            }
        }
    }
}

/// Extract an attribute value from a region starting at element position `elem_pos`.
/// Searches for `attr_name="value"` within the element (up to `>` or `/>` or end of region).
fn extract_attr_in_region<'a>(
    region: &'a [u8],
    elem_pos: usize,
    attr_name: &[u8],
) -> Option<&'a [u8]> {
    // Find end of element (> or />)
    let elem_end = memchr(b'>', &region[elem_pos..])
        .map(|p| p + elem_pos + 1)
        .unwrap_or(region.len());
    let tag = &region[elem_pos..elem_end];

    // Build pattern: attr_name="
    let mut pattern = Vec::with_capacity(attr_name.len() + 2);
    pattern.extend_from_slice(attr_name);
    pattern.extend_from_slice(b"=\"");

    let attr_pos = memmem::find(tag, &pattern)?;
    let val_start = attr_pos + pattern.len();
    let val_end = memchr(b'"', &tag[val_start..])? + val_start;
    Some(&tag[val_start..val_end])
}

/// Get a string by index from the shared string table
///
/// # Arguments
/// * `refs` - The vector of StringRef returned by parse_shared_strings_fast
/// * `xml` - The original XML buffer
/// * `index` - The string index to retrieve
/// * `buffer` - A reusable buffer for decoded strings
///
/// # Returns
/// A slice containing the decoded string
pub fn get_string<'a>(
    refs: &[StringRef],
    xml: &'a [u8],
    index: usize,
    buffer: &'a mut Vec<u8>,
) -> &'a [u8] {
    buffer.clear();

    if index >= refs.len() {
        return &[];
    }

    let string_ref = &refs[index];

    if string_ref.len == 0 {
        return &[];
    }

    // Check if this is a rich text reference (needs_decode + points to <si>)
    let slice = string_ref.as_slice(xml);
    if string_ref.needs_decode && slice.starts_with(b"<si") {
        // Rich text: extract and concatenate all <t> elements
        extract_rich_text_content(
            xml,
            string_ref.start,
            string_ref.start + string_ref.len,
            buffer,
        );
        return buffer;
    }

    if string_ref.needs_decode {
        // Simple string with entities
        decode_xml_entities_full(slice, buffer);
        buffer
    } else {
        // Zero-copy case: no decoding needed
        slice
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
        assert_eq!(parse_unique_count(xml), Some(12345));

        let xml = br#"<sst count="100" uniqueCount="50">"#;
        assert_eq!(parse_unique_count(xml), Some(50));

        let xml = br#"<sst>"#;
        assert_eq!(parse_unique_count(xml), None);
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
