//! Shared Strings Writer for XLSX files
//!
//! This module provides efficient writing of the shared strings table (sharedStrings.xml).
//! The shared strings table stores unique string values, allowing cells to reference
//! strings by index instead of duplicating values.
//!
//! # Design goals
//!
//! 1. **Deduplication** — each unique plain string is stored only once.
//! 2. **Insertion-order emission** — the index returned by `add()` / `seed()`
//!    is the slot at which the entry is emitted in `<sst>`. Cells store
//!    SST indices positionally (`<c t="s"><v>N</v>`), so any reorder
//!    between `add()` and emission silently corrupts text cells. Matches
//!    Excel's own writer behavior.
//! 3. **Rich-text support** — formatted runs with bold, italic, colors, etc.
//! 4. **Efficient lookup** — O(1) string-to-index lookup via HashMap.
//!
//! # XML output format
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
//! <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="5">
//!   <si><t>First inserted</t></si>
//!   <si><t>Second inserted</t></si>
//!   <si>
//!     <r>
//!       <rPr><b/><sz val="12"/><color rgb="FF0000"/><rFont val="Arial"/></rPr>
//!       <t>Bold red text</t>
//!     </r>
//!     <r><t> normal text</t></r>
//!   </si>
//! </sst>
//! ```

use domain_types::RichTextRun as DtRichTextRun;
use std::collections::HashMap;

// ============================================================================
// Types
// ============================================================================

/// A single run of rich text with optional formatting.
#[derive(Debug, Clone, PartialEq)]
pub struct RichTextRun {
    /// The text content of this run
    pub text: String,
    /// Bold formatting
    pub bold: Option<bool>,
    /// Italic formatting
    pub italic: Option<bool>,
    /// Underline formatting
    pub underline: Option<bool>,
    /// Strikethrough formatting
    pub strike: Option<bool>,
    /// Font name (e.g., "Arial", "Calibri")
    pub font_name: Option<String>,
    /// Font size in points
    pub font_size: Option<f64>,
    /// Font color as RGB hex (e.g., "FF0000" for red)
    pub color: Option<String>,
}

impl Default for RichTextRun {
    fn default() -> Self {
        Self {
            text: String::new(),
            bold: None,
            italic: None,
            underline: None,
            strike: None,
            font_name: None,
            font_size: None,
            color: None,
        }
    }
}

impl RichTextRun {
    /// Create a new rich text run with just text.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Default::default()
        }
    }

    /// Check if this run has any formatting properties.
    pub fn has_formatting(&self) -> bool {
        self.bold.is_some()
            || self.italic.is_some()
            || self.underline.is_some()
            || self.strike.is_some()
            || self.font_name.is_some()
            || self.font_size.is_some()
            || self.color.is_some()
    }
}

/// A shared string value - either plain text or rich text with formatting.
#[derive(Debug, Clone, PartialEq)]
pub enum SharedStringValue {
    /// Plain text string
    Plain(String),
    /// Rich text with multiple formatted runs (simple writer types)
    RichText(Vec<RichTextRun>),
    /// Rich text with full domain types (preserves family, charset, scheme, color variants)
    DomainRichText(Vec<DtRichTextRun>),
}

impl SharedStringValue {
    /// Get the plain text content (concatenates all runs for rich text).
    pub fn to_plain_text(&self) -> String {
        match self {
            SharedStringValue::Plain(s) => s.clone(),
            SharedStringValue::RichText(runs) => runs.iter().map(|r| r.text.as_str()).collect(),
            SharedStringValue::DomainRichText(runs) => {
                runs.iter().map(|r| r.text.as_str()).collect()
            }
        }
    }
}

/// Internal entry for tracking string values and their reference counts.
#[derive(Debug, Clone)]
struct StringEntry {
    /// The string value
    value: SharedStringValue,
    /// Reference count (how many times this string is used)
    count: usize,
    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) for this entry.
    phonetic_xml: Option<Vec<u8>>,
}

// ============================================================================
// SharedStringsWriter
// ============================================================================

/// Writer for the shared strings table (xl/sharedStrings.xml).
///
/// Provides deduplication, reference counting, and frequency-based ordering
/// for optimal compression.
///
/// # Example
///
/// ```ignore
/// let mut sst = SharedStringsWriter::new();
///
/// // Add strings (returns index)
/// let idx1 = sst.add("Hello");  // 0
/// let idx2 = sst.add("World");  // 1
/// let idx3 = sst.add("Hello");  // 0 (reused, count incremented)
///
/// // Generate XML
/// let xml = sst.to_xml();
/// ```
#[derive(Debug, Clone, Default)]
pub struct SharedStringsWriter {
    /// All string entries (in original insertion order)
    entries: Vec<StringEntry>,
    /// Plain text -> index map for O(1) lookup (first occurrence only)
    index_map: HashMap<String, usize>,
    /// Next rich text index (rich text entries are always unique)
    next_index: usize,
    /// For seeded SSTs with duplicate strings: maps string → list of all SST indices.
    /// Used in round-trip mode to cycle through duplicate indices in order.
    dup_indices: HashMap<String, Vec<usize>>,
    /// Original `count` attribute from the parsed SST XML, preserved for round-trip fidelity.
    /// When set, `to_xml()` emits this as the `<sst count="…">` attribute
    /// instead of the computed `total_count()`.
    original_sst_count: Option<usize>,
}

impl SharedStringsWriter {
    /// Create a new empty shared strings writer.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            index_map: HashMap::new(),
            next_index: 0,
            dup_indices: HashMap::new(),
            original_sst_count: None,
        }
    }

    /// Create a new shared strings writer with pre-allocated capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
            index_map: HashMap::with_capacity(capacity),
            next_index: 0,
            dup_indices: HashMap::new(),
            original_sst_count: None,
        }
    }

    /// Set the original `count` attribute value from the parsed SST XML.
    /// When set, `to_xml()` emits this value in the `<sst count="…">`
    /// attribute instead of the computed total reference count, so that
    /// round-tripped files preserve the original count byte-for-byte even
    /// if our cell-reference counting differs in edge cases.
    pub fn set_original_sst_count(&mut self, count: usize) {
        self.original_sst_count = Some(count);
    }

    /// Seed a plain string with count=0 and return its index.
    ///
    /// Use this to pre-populate the SST from a parsed file's shared strings
    /// without inflating the reference count. Subsequent `add()` calls from
    /// cell processing will find the string and increment count correctly,
    /// so `total_count()` reflects only actual cell references.
    ///
    /// If the string already exists, returns the existing index without
    /// changing its count.
    pub fn seed(&mut self, text: &str) -> usize {
        // Always create an entry at the next sequential index, even for duplicate
        // text values. The original XLSX SST may contain the same string at multiple
        // indices (e.g., once as rich text and once as plain text). Collapsing
        // duplicates here would shift all subsequent indices and corrupt cell <v>
        // references.
        //
        // The index_map still maps to the FIRST occurrence so that `add()` lookups
        // return a valid index for new strings added during cell processing.
        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::Plain(text.to_string()),
            count: 0,
            phonetic_xml: None,
        });
        // Track all indices for each string (for round-trip duplicate cycling)
        self.dup_indices
            .entry(text.to_string())
            .or_default()
            .push(idx);
        if !self.index_map.contains_key(text) {
            self.index_map.insert(text.to_string(), idx);
        }
        self.next_index += 1;
        idx
    }

    /// Seed a rich text entry with domain-type runs (full round-trip fidelity).
    pub fn seed_rich(&mut self, runs: Vec<DtRichTextRun>) -> usize {
        let idx = self.next_index;
        // Build plain text key for dedup lookups
        let plain_text: String = runs.iter().map(|r| r.text.as_str()).collect();
        self.entries.push(StringEntry {
            value: SharedStringValue::DomainRichText(runs),
            count: 0,
            phonetic_xml: None,
        });
        self.dup_indices
            .entry(plain_text.clone())
            .or_default()
            .push(idx);
        self.index_map.entry(plain_text).or_insert(idx);
        self.next_index += 1;
        idx
    }

    /// Set phonetic XML for the entry at the given index.
    pub fn set_phonetic_xml(&mut self, index: usize, phonetic_xml: Vec<u8>) {
        if let Some(entry) = self.entries.get_mut(index) {
            entry.phonetic_xml = Some(phonetic_xml);
        }
    }

    /// Add a plain string and return its index.
    ///
    /// If the string already exists, increments its reference count
    /// and returns the existing index.
    ///
    /// # Arguments
    /// * `text` - The string to add
    ///
    /// # Returns
    /// The index of the string in the shared strings table
    pub fn add(&mut self, text: &str) -> usize {
        // Check if string already exists (returns first occurrence index for duplicates)
        if let Some(&idx) = self.index_map.get(text) {
            self.entries[idx].count += 1;
            return idx;
        }

        // Add new string
        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::Plain(text.to_string()),
            count: 1,
            phonetic_xml: None,
        });
        self.index_map.insert(text.to_string(), idx);
        self.next_index += 1;
        idx
    }

    /// Add rich text and return its index.
    ///
    /// Rich text is always added as a new entry (no deduplication)
    /// because comparing rich text formatting would be expensive.
    ///
    /// # Arguments
    /// * `runs` - The rich text runs with formatting
    ///
    /// # Returns
    /// The index of the rich text in the shared strings table
    pub fn add_rich_text(&mut self, runs: Vec<RichTextRun>) -> usize {
        let idx = self.next_index;
        self.entries.push(StringEntry {
            value: SharedStringValue::RichText(runs),
            count: 1,
            phonetic_xml: None,
        });
        self.next_index += 1;
        idx
    }

    /// Get the index of a plain string (if it exists).
    ///
    /// # Arguments
    /// * `text` - The string to look up
    ///
    /// # Returns
    /// The index if the string exists, None otherwise
    pub fn get_index(&self, text: &str) -> Option<usize> {
        self.index_map.get(text).copied()
    }

    /// Check whether an entry exists at the given index.
    pub fn has_entry(&self, index: usize) -> bool {
        index < self.entries.len()
    }

    /// Check whether an entry exists at the given index and resolves to `text`.
    pub fn entry_text_matches(&self, index: usize, text: &str) -> bool {
        self.entries
            .get(index)
            .is_some_and(|entry| entry.value.to_plain_text() == text)
    }

    /// Mark an entry at the given index as used (increment its reference count).
    pub fn mark_used(&mut self, index: usize) {
        if let Some(entry) = self.entries.get_mut(index) {
            entry.count += 1;
        }
    }

    /// Get the total count of unique strings.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the shared strings table is empty.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Get the total reference count (sum of all string usage counts).
    ///
    /// This is used for the `count` attribute in the `<sst>` element.
    pub fn total_count(&self) -> usize {
        self.entries.iter().map(|e| e.count).sum()
    }

    /// Generate the sharedStrings.xml content in insertion order.
    ///
    /// Cells reference SST entries by position (`<c t="s"><v>N</v>`),
    /// so the slot emitted here must equal the index returned by
    /// `add()` / `seed()` for every entry. Emitting in insertion order
    /// makes that invariant structural: the entry at `entries[i]` is
    /// emitted at slot `i`, which is the index its insertion returned.
    /// Any reorder on this path silently corrupts text cells, because
    /// cell `<v>` values are stored before the XML is produced.
    pub fn to_xml(&self) -> Vec<u8> {
        if self.is_empty() {
            return self.write_empty_xml();
        }

        let total_count = self
            .original_sst_count
            .unwrap_or_else(|| self.total_count());
        let unique_count = self.len();

        let mut xml = Vec::with_capacity(64 + unique_count * 64);

        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
        xml.extend_from_slice(
            b"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"",
        );
        xml.extend_from_slice(total_count.to_string().as_bytes());
        xml.extend_from_slice(b"\" uniqueCount=\"");
        xml.extend_from_slice(unique_count.to_string().as_bytes());
        xml.extend_from_slice(b"\">");

        for entry in &self.entries {
            self.write_string_item(entry, &mut xml);
        }

        xml.extend_from_slice(b"</sst>");
        xml
    }

    /// Write empty SST XML.
    fn write_empty_xml(&self) -> Vec<u8> {
        let mut xml = Vec::with_capacity(256);
        xml.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
        xml.extend_from_slice(b"<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"0\" uniqueCount=\"0\"/>");
        xml
    }

    /// Write a single string item (`<si>` element).
    fn write_string_item(&self, entry: &StringEntry, xml: &mut Vec<u8>) {
        xml.extend_from_slice(b"<si>");

        match &entry.value {
            SharedStringValue::Plain(text) => {
                self.write_text_element(text, xml);
            }
            SharedStringValue::RichText(runs) => {
                for run in runs {
                    self.write_rich_text_run(run, xml);
                }
            }
            SharedStringValue::DomainRichText(runs) => {
                for run in runs {
                    write_domain_rich_text_run(run, xml);
                }
            }
        }

        // Write phonetic data (rPh elements + phoneticPr) if present
        if let Some(ref phonetic) = entry.phonetic_xml {
            xml.extend_from_slice(phonetic);
        }

        xml.extend_from_slice(b"</si>");
    }

    /// Write a plain text element (`<t>`).
    fn write_text_element(&self, text: &str, xml: &mut Vec<u8>) {
        // Excel emits xml:space="preserve" when there is leading/trailing
        // whitespace, including \r and \n.  While XML 1.0 §2.10 preserves
        // newlines in element text, Excel still adds the attribute for strings
        // ending with \r\n (carriage return + newline), so we match that
        // behaviour to avoid round-trip diffs.
        let needs_preserve = text.starts_with(' ')
            || text.ends_with(' ')
            || text.starts_with('\t')
            || text.ends_with('\t')
            || text.ends_with('\n')
            || text.ends_with('\r')
            || text.starts_with('\n')
            || text.starts_with('\r');

        if text.is_empty() {
            xml.extend_from_slice(b"<t></t>");
            return;
        }

        if needs_preserve {
            xml.extend_from_slice(b"<t xml:space=\"preserve\">");
        } else {
            xml.extend_from_slice(b"<t>");
        }

        escape_xml_content(text, xml);
        xml.extend_from_slice(b"</t>");
    }

    /// Write a rich text run (`<r>` element).
    fn write_rich_text_run(&self, run: &RichTextRun, xml: &mut Vec<u8>) {
        xml.extend_from_slice(b"<r>");

        // Write run properties if any
        if run.has_formatting() {
            xml.extend_from_slice(b"<rPr>");

            if run.bold == Some(true) {
                xml.extend_from_slice(b"<b/>");
            }
            if run.italic == Some(true) {
                xml.extend_from_slice(b"<i/>");
            }
            if run.underline == Some(true) {
                xml.extend_from_slice(b"<u/>");
            }
            if run.strike == Some(true) {
                xml.extend_from_slice(b"<strike/>");
            }
            if let Some(size) = run.font_size {
                xml.extend_from_slice(b"<sz val=\"");
                // Format as integer if whole number, otherwise with decimals
                if size.fract() == 0.0 {
                    xml.extend_from_slice((size as i64).to_string().as_bytes());
                } else {
                    xml.extend_from_slice(size.to_string().as_bytes());
                }
                xml.extend_from_slice(b"\"/>");
            }
            if let Some(ref color) = run.color {
                xml.extend_from_slice(b"<color rgb=\"");
                // Ensure ARGB format (prepend FF if only RGB)
                if color.len() == 6 {
                    xml.extend_from_slice(b"FF");
                }
                xml.extend_from_slice(color.as_bytes());
                xml.extend_from_slice(b"\"/>");
            }
            if let Some(ref font_name) = run.font_name {
                xml.extend_from_slice(b"<rFont val=\"");
                escape_xml_attr(font_name, xml);
                xml.extend_from_slice(b"\"/>");
            }

            xml.extend_from_slice(b"</rPr>");
        }

        // Write text content
        self.write_text_element(&run.text, xml);

        xml.extend_from_slice(b"</r>");
    }
}

// ============================================================================
// Domain rich text writer
// ============================================================================

/// Write a rich text run from a domain-types `RichTextRun` with full attribute fidelity.
fn write_domain_rich_text_run(run: &DtRichTextRun, xml: &mut Vec<u8>) {
    xml.extend_from_slice(b"<r>");

    // Write <rPr> if any formatting present
    let has_fmt = run.bold
        || run.italic
        || run.underline
        || run.strikethrough
        || run.font_size.is_some()
        || run.color.is_some()
        || run.color_indexed.is_some()
        || run.color_theme.is_some()
        || run.font_name.is_some()
        || run.family.is_some()
        || run.charset.is_some()
        || run.scheme.is_some()
        || run.vert_align.is_some();

    if has_fmt {
        xml.extend_from_slice(b"<rPr>");

        if run.bold {
            xml.extend_from_slice(b"<b/>");
        }
        if run.italic {
            xml.extend_from_slice(b"<i/>");
        }
        if run.underline {
            xml.extend_from_slice(b"<u/>");
        }
        if run.strikethrough {
            xml.extend_from_slice(b"<strike/>");
        }
        if let Some(size) = run.font_size {
            xml.extend_from_slice(b"<sz val=\"");
            if size.fract() == 0.0 {
                xml.extend_from_slice((size as i64).to_string().as_bytes());
            } else {
                xml.extend_from_slice(size.to_string().as_bytes());
            }
            xml.extend_from_slice(b"\"/>");
        }
        // <color> — support rgb, indexed, theme+tint
        if run.color.is_some() || run.color_indexed.is_some() || run.color_theme.is_some() {
            xml.extend_from_slice(b"<color");
            if let Some(ref rgb) = run.color {
                xml.extend_from_slice(b" rgb=\"");
                xml.extend_from_slice(rgb.as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(indexed) = run.color_indexed {
                xml.extend_from_slice(b" indexed=\"");
                xml.extend_from_slice(indexed.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(theme) = run.color_theme {
                xml.extend_from_slice(b" theme=\"");
                xml.extend_from_slice(theme.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            if let Some(tint) = run.color_tint {
                xml.extend_from_slice(b" tint=\"");
                xml.extend_from_slice(tint.to_string().as_bytes());
                xml.extend_from_slice(b"\"");
            }
            xml.extend_from_slice(b"/>");
        }
        if let Some(ref font_name) = run.font_name {
            xml.extend_from_slice(b"<rFont val=\"");
            escape_xml_attr(font_name, xml);
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(family) = run.family {
            xml.extend_from_slice(b"<family val=\"");
            xml.extend_from_slice(family.to_string().as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(charset) = run.charset {
            xml.extend_from_slice(b"<charset val=\"");
            xml.extend_from_slice(charset.to_string().as_bytes());
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref scheme) = run.scheme {
            xml.extend_from_slice(b"<scheme val=\"");
            escape_xml_attr(scheme, xml);
            xml.extend_from_slice(b"\"/>");
        }
        if let Some(ref vert_align) = run.vert_align {
            xml.extend_from_slice(b"<vertAlign val=\"");
            escape_xml_attr(vert_align, xml);
            xml.extend_from_slice(b"\"/>");
        }

        xml.extend_from_slice(b"</rPr>");
    }

    // Write <t> with optional xml:space="preserve"
    let needs_preserve = run.preserve_space
        || run.text.starts_with(' ')
        || run.text.ends_with(' ')
        || run.text.starts_with('\t')
        || run.text.ends_with('\t')
        || run.text.ends_with('\n')
        || run.text.ends_with('\r')
        || run.text.starts_with('\n')
        || run.text.starts_with('\r');

    if needs_preserve {
        xml.extend_from_slice(b"<t xml:space=\"preserve\">");
    } else {
        xml.extend_from_slice(b"<t>");
    }

    escape_xml_content(&run.text, xml);
    xml.extend_from_slice(b"</t>");
    xml.extend_from_slice(b"</r>");
}

// ============================================================================
// XML Escaping
// ============================================================================

/// Escape XML special characters in content.
fn escape_xml_content(text: &str, out: &mut Vec<u8>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\r' && i + 2 < bytes.len() && bytes[i + 1] == b'\r' && bytes[i + 2] == b'\n' {
            out.extend_from_slice(b"_x000D_\r\n");
            i += 3;
            continue;
        }
        if byte == b'_'
            && i + 6 < bytes.len()
            && bytes[i + 1] == b'x'
            && bytes[i + 6] == b'_'
            && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
        {
            out.extend_from_slice(b"_x005F_");
            i += 1;
            continue;
        }

        match byte {
            b'\r' => out.extend_from_slice(b"_x000D_"),
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                use std::io::Write;
                write!(out, "_x{byte:04X}_").ok();
            }
            _ => out.push(byte),
        }
        i += 1;
    }
}

/// Escape XML special characters in attribute values.
fn escape_xml_attr(text: &str, out: &mut Vec<u8>) {
    for ch in text.chars() {
        match ch {
            '&' => out.extend_from_slice(b"&amp;"),
            '<' => out.extend_from_slice(b"&lt;"),
            '>' => out.extend_from_slice(b"&gt;"),
            '"' => out.extend_from_slice(b"&quot;"),
            '\'' => out.extend_from_slice(b"&apos;"),
            _ => {
                let mut buf = [0u8; 4];
                let encoded = ch.encode_utf8(&mut buf);
                out.extend_from_slice(encoded.as_bytes());
            }
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Basic operations
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Deduplication
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Index lookup
    // -------------------------------------------------------------------------

    #[test]
    fn test_get_index() {
        let mut sst = SharedStringsWriter::new();
        sst.add("Hello");
        sst.add("World");

        assert_eq!(sst.get_index("Hello"), Some(0));
        assert_eq!(sst.get_index("World"), Some(1));
        assert_eq!(sst.get_index("Missing"), None);
    }

    // -------------------------------------------------------------------------
    // Rich text
    // -------------------------------------------------------------------------

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
    fn test_rich_text_run_has_formatting() {
        let plain = RichTextRun::new("Text");
        assert!(!plain.has_formatting());

        let bold = RichTextRun {
            text: "Bold".to_string(),
            bold: Some(true),
            ..Default::default()
        };
        assert!(bold.has_formatting());

        let with_font = RichTextRun {
            text: "Font".to_string(),
            font_name: Some("Arial".to_string()),
            ..Default::default()
        };
        assert!(with_font.has_formatting());
    }

    // -------------------------------------------------------------------------
    // Emission-slot invariant (the load-bearing property of this writer)
    // -------------------------------------------------------------------------

    /// Regression for shared-string index: the index returned by `add()` must
    /// point to the string `add()` just inserted in the XML that
    /// `to_xml()` emits. Cell `<v>` references embed the index
    /// returned by `add()`; if the emitted SST slot holds a different
    /// string, every text cell is silently corrupted on XLSX
    /// round-trip. Triggered when string frequencies differ —
    /// equal-frequency tests (the only kind that existed before this
    /// round) collapse to insertion order and hid the bug for over a
    /// year.
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
                 {got:?} — cells that carry this index will read the wrong \
                 string on import",
                got = strings.get(idx),
            );
        };
        check(idx_country, "Country");
        check(idx_sales, "Sales");
        check(idx_usa, "USA");
        check(idx_can, "CAN");
    }

    // -------------------------------------------------------------------------
    // XML generation
    // -------------------------------------------------------------------------

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
    fn test_rich_text_xml() {
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

        sst.add_rich_text(runs);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        // Note: " normal" starts with space, so xml:space="preserve" is added
        assert!(xml_str.contains(
            "<si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space=\"preserve\"> normal</t></r></si>"
        ));
    }

    #[test]
    fn test_rich_text_with_formatting() {
        let mut sst = SharedStringsWriter::new();

        let runs = vec![RichTextRun {
            text: "Styled".to_string(),
            bold: Some(true),
            italic: Some(true),
            font_size: Some(12.0),
            color: Some("FF0000".to_string()),
            font_name: Some("Arial".to_string()),
            ..Default::default()
        }];

        sst.add_rich_text(runs);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains("<b/>"));
        assert!(xml_str.contains("<i/>"));
        assert!(xml_str.contains("<sz val=\"12\"/>"));
        assert!(xml_str.contains("<color rgb=\"FFFF0000\"/>")); // Note: FF prepended
        assert!(xml_str.contains("<rFont val=\"Arial\"/>"));
    }

    #[test]
    fn test_rich_text_underline_and_strike() {
        let mut sst = SharedStringsWriter::new();

        let runs = vec![RichTextRun {
            text: "Decorated".to_string(),
            underline: Some(true),
            strike: Some(true),
            ..Default::default()
        }];

        sst.add_rich_text(runs);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains("<u/>"));
        assert!(xml_str.contains("<strike/>"));
    }

    // -------------------------------------------------------------------------
    // Unicode support
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // SharedStringValue
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

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
    fn test_special_characters_in_font_name() {
        let mut sst = SharedStringsWriter::new();

        let runs = vec![RichTextRun {
            text: "Text".to_string(),
            font_name: Some("Font \"Special\" & <Name>".to_string()),
            ..Default::default()
        }];

        sst.add_rich_text(runs);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        // Font name should be escaped
        assert!(xml_str.contains("&quot;"));
        assert!(xml_str.contains("&amp;"));
        assert!(xml_str.contains("&lt;"));
        assert!(xml_str.contains("&gt;"));
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

    #[test]
    fn test_with_capacity() {
        let sst = SharedStringsWriter::with_capacity(100);
        assert!(sst.is_empty());
        // The capacity hint doesn't change behavior, just pre-allocates
    }

    #[test]
    fn test_font_size_formatting() {
        let mut sst = SharedStringsWriter::new();

        // Whole number
        let runs1 = vec![RichTextRun {
            text: "Whole".to_string(),
            font_size: Some(12.0),
            ..Default::default()
        }];
        sst.add_rich_text(runs1);

        // Decimal
        let runs2 = vec![RichTextRun {
            text: "Decimal".to_string(),
            font_size: Some(11.5),
            ..Default::default()
        }];
        sst.add_rich_text(runs2);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains("<sz val=\"12\"/>")); // Whole number
        assert!(xml_str.contains("<sz val=\"11.5\"/>")); // Decimal
    }

    #[test]
    fn test_color_rgb_format() {
        let mut sst = SharedStringsWriter::new();

        // 6-char RGB (should get FF prepended)
        let runs1 = vec![RichTextRun {
            text: "Red".to_string(),
            color: Some("FF0000".to_string()),
            ..Default::default()
        }];
        sst.add_rich_text(runs1);

        // 8-char ARGB (should stay as-is)
        let runs2 = vec![RichTextRun {
            text: "Transparent".to_string(),
            color: Some("80FF0000".to_string()),
            ..Default::default()
        }];
        sst.add_rich_text(runs2);

        let xml = sst.to_xml();
        let xml_str = String::from_utf8_lossy(&xml);

        assert!(xml_str.contains("<color rgb=\"FFFF0000\"/>")); // FF prepended
        assert!(xml_str.contains("<color rgb=\"80FF0000\"/>")); // Unchanged
    }
}
