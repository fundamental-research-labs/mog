//! Streaming XML writer for XLSX generation.
//!
//! This module provides a high-performance streaming XML writer that writes
//! directly to a byte buffer without DOM construction. It is optimized for
//! generating XLSX worksheet XML files.
//!
//! # Features
//!
//! - **No DOM construction** - writes directly to a pre-allocated byte buffer
//! - **Streaming output** - supports incremental writing without holding entire doc in memory
//! - **Proper escaping** - handles all XML entities: &amp; &lt; &gt; &quot; &apos;
//! - **Attribute quoting** - proper double-quote escaping in attribute values
//! - **Namespace support** - handles xmlns declarations and prefixed elements
//! - **Pretty printing** - optional indentation for debugging
//! - **Self-closing tags** - efficient `<foo/>` generation
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::XmlWriter;
//!
//! let xml = XmlWriter::new()
//!     .write_declaration()
//!     .start_element("worksheet")
//!     .attr("xmlns", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
//!     .end_attrs()
//!     .start_element("sheetData")
//!     .end_attrs()
//!     .end_element("sheetData")
//!     .end_element("worksheet")
//!     .finish();
//! ```

use std::fmt::Display;

/// Default buffer capacity in bytes (64KB)
const DEFAULT_CAPACITY: usize = 64 * 1024;

/// Errors that can occur during XML writing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XmlWriteError {
    /// Invalid character encountered (XML 1.0 disallows certain control characters)
    InvalidCharacter(char),
    /// Element nesting error (e.g., closing wrong tag)
    NestingError(String),
}

impl std::fmt::Display for XmlWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            XmlWriteError::InvalidCharacter(c) => write!(f, "Invalid XML character: {:?}", c),
            XmlWriteError::NestingError(msg) => write!(f, "XML nesting error: {}", msg),
        }
    }
}

impl std::error::Error for XmlWriteError {}

/// Internal state tracking for element writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElementState {
    /// Currently writing attributes (between `<tag` and `>`)
    InAttributes,
    /// Element's opening tag is complete (after `>`)
    InContent,
}

/// A streaming XML writer that writes directly to a byte buffer.
///
/// This writer is designed for high-performance XML generation without
/// DOM construction. It tracks element nesting and provides methods for
/// writing elements, attributes, and text content with proper escaping.
///
/// # Fluent API
///
/// The writer provides a fluent API where most methods return `&mut Self`,
/// allowing for method chaining:
///
/// ```ignore
/// let xml = XmlWriter::new()
///     .start_element("row")
///     .attr("r", "1")
///     .end_attrs()
///     .start_element("c")
///     .attr("r", "A1")
///     .attr("t", "s")
///     .end_attrs()
///     .text("0")
///     .end_element("c")
///     .end_element("row")
///     .finish();
/// ```
#[derive(Debug)]
pub struct XmlWriter {
    /// The output byte buffer
    buffer: Vec<u8>,
    /// Current indentation level (for pretty printing)
    indent_level: usize,
    /// Whether to enable pretty printing with indentation
    pretty: bool,
    /// Stack of open element names (for validation)
    element_stack: Vec<String>,
    /// Current element state
    state: ElementState,
}

impl Default for XmlWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl XmlWriter {
    /// Create a new XML writer with default capacity (64KB).
    #[inline]
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    /// Create a new XML writer with specified initial capacity.
    ///
    /// # Arguments
    /// * `capacity` - Initial buffer capacity in bytes
    ///
    /// # Example
    /// ```ignore
    /// // Pre-allocate 1MB for a large document
    /// let writer = XmlWriter::with_capacity(1024 * 1024);
    /// ```
    #[inline]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(capacity),
            indent_level: 0,
            pretty: false,
            element_stack: Vec::with_capacity(32),
            state: ElementState::InContent,
        }
    }

    /// Enable pretty printing with indentation.
    ///
    /// When enabled, elements will be indented and separated by newlines
    /// for readability. This is useful for debugging but adds overhead.
    ///
    /// # Example
    /// ```ignore
    /// let writer = XmlWriter::new().pretty();
    /// ```
    #[inline]
    pub fn pretty(mut self) -> Self {
        self.pretty = true;
        self
    }

    /// Write the XML declaration: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    #[inline]
    pub fn write_declaration(&mut self) -> &mut Self {
        self.buffer
            .extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        if self.pretty {
            self.buffer.push(b'\n');
        }
        self
    }

    /// Write the XML declaration with custom encoding.
    ///
    /// # Arguments
    /// * `encoding` - The character encoding (e.g., "UTF-8", "ISO-8859-1")
    #[inline]
    pub fn write_declaration_with_encoding(&mut self, encoding: &str) -> &mut Self {
        self.buffer
            .extend_from_slice(b"<?xml version=\"1.0\" encoding=\"");
        self.buffer.extend_from_slice(encoding.as_bytes());
        self.buffer.extend_from_slice(b"\" standalone=\"yes\"?>");
        if self.pretty {
            self.buffer.push(b'\n');
        }
        self
    }

    /// Start a new element with the given name.
    ///
    /// After calling this, use `attr()` to add attributes, then `end_attrs()`
    /// to close the opening tag, or `self_close()` for self-closing tags.
    ///
    /// # Arguments
    /// * `name` - The element name (without angle brackets)
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("row")
    ///       .attr("r", "1")
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn start_element(&mut self, name: &str) -> &mut Self {
        // Close any pending attribute section
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
        }

        // Write indentation if pretty printing
        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        self.element_stack.push(name.to_string());
        self.state = ElementState::InAttributes;
        self.indent_level += 1;

        self
    }

    /// Start a new element with a namespace prefix.
    ///
    /// # Arguments
    /// * `prefix` - The namespace prefix (e.g., "x", "r")
    /// * `name` - The local element name (e.g., "worksheet")
    ///
    /// Results in `<prefix:name>`
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element_ns("x", "worksheet")
    ///       .attr("xmlns:x", "http://example.com")
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn start_element_ns(&mut self, prefix: &str, name: &str) -> &mut Self {
        // Close any pending attribute section
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
        }

        // Write indentation if pretty printing
        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(prefix.as_bytes());
        self.buffer.push(b':');
        self.buffer.extend_from_slice(name.as_bytes());

        // Store with prefix for closing tag validation
        let full_name = format!("{}:{}", prefix, name);
        self.element_stack.push(full_name);
        self.state = ElementState::InAttributes;
        self.indent_level += 1;

        self
    }

    /// Add an attribute to the current element.
    ///
    /// Must be called after `start_element()` and before `end_attrs()` or `self_close()`.
    /// The value will be properly XML-escaped.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - The attribute value (will be escaped)
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("cell")
    ///       .attr("r", "A1")
    ///       .attr("t", "s")
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn attr(&mut self, name: &str, value: &str) -> &mut Self {
        debug_assert!(
            self.state == ElementState::InAttributes,
            "attr() called outside element"
        );

        self.buffer.push(b' ');
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.extend_from_slice(b"=\"");
        self.write_escaped_attr(value);
        self.buffer.push(b'"');

        self
    }

    /// Add an OOXML ST_Xstring attribute to the current element.
    ///
    /// ST_Xstring values use `_xHHHH_` escapes for characters that must survive
    /// XML attribute normalization. The in-memory domain value stays decoded;
    /// this method restores the OOXML lexical form on write.
    #[inline]
    pub fn attr_xstring(&mut self, name: &str, value: &str) -> &mut Self {
        debug_assert!(
            self.state == ElementState::InAttributes,
            "attr_xstring() called outside element"
        );

        self.buffer.push(b' ');
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.extend_from_slice(b"=\"");
        self.write_escaped_xstring_attr(value);
        self.buffer.push(b'"');

        self
    }

    /// Add an attribute only if the value is Some.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - Optional attribute value
    ///
    /// # Example
    /// ```ignore
    /// let style: Option<&str> = Some("bold");
    /// writer.start_element("cell")
    ///       .attr_if("style", style)
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn attr_if(&mut self, name: &str, value: Option<&str>) -> &mut Self {
        if let Some(v) = value {
            self.attr(name, v);
        }
        self
    }

    /// Add a boolean attribute.
    ///
    /// Writes "1" for true, "0" for false (XLSX convention).
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - The boolean value
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("sheet")
    ///       .attr_bool("hidden", false)
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn attr_bool(&mut self, name: &str, value: bool) -> &mut Self {
        self.attr(name, if value { "1" } else { "0" })
    }

    /// Add a boolean attribute only if true.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - The boolean value
    #[inline]
    pub fn attr_bool_if_true(&mut self, name: &str, value: bool) -> &mut Self {
        if value {
            self.attr(name, "1");
        }
        self
    }

    /// Add a numeric attribute.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - The numeric value (anything implementing Display)
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("row")
    ///       .attr_num("r", 1)
    ///       .attr_num("ht", 15.5)
    ///       .end_attrs();
    /// ```
    #[inline]
    pub fn attr_num<T: Display>(&mut self, name: &str, value: T) -> &mut Self {
        debug_assert!(
            self.state == ElementState::InAttributes,
            "attr_num() called outside element"
        );

        self.buffer.push(b' ');
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.extend_from_slice(b"=\"");

        // Write the number directly to avoid allocation
        use std::io::Write;
        write!(&mut self.buffer, "{}", value).ok();

        self.buffer.push(b'"');
        self
    }

    /// Add a numeric attribute only if the value is Some.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - Optional numeric value
    #[inline]
    pub fn attr_num_if<T: Display>(&mut self, name: &str, value: Option<T>) -> &mut Self {
        if let Some(v) = value {
            self.attr_num(name, v);
        }
        self
    }

    /// Close the opening tag's attribute section with `>`.
    ///
    /// Call this after adding all attributes to transition to content mode.
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("row")
    ///       .attr("r", "1")
    ///       .end_attrs()  // Writes ">"
    ///       .text("content");
    /// ```
    #[inline]
    pub fn end_attrs(&mut self) -> &mut Self {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }
        self
    }

    /// Write a self-closing tag `/>`.
    ///
    /// Use this instead of `end_attrs()` + `end_element()` for empty elements.
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("br")
    ///       .self_close();  // Writes "/>"
    /// // Result: <br/>
    /// ```
    #[inline]
    pub fn self_close(&mut self) -> &mut Self {
        debug_assert!(
            self.state == ElementState::InAttributes,
            "self_close() called after end_attrs()"
        );

        self.buffer.extend_from_slice(b"/>");
        if self.pretty {
            self.buffer.push(b'\n');
        }

        self.element_stack.pop();
        self.indent_level = self.indent_level.saturating_sub(1);
        self.state = ElementState::InContent;

        self
    }

    /// Close the current element with `</name>`.
    ///
    /// # Arguments
    /// * `name` - The element name (must match the opening tag)
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("row")
    ///       .end_attrs()
    ///       .end_element("row");
    /// ```
    #[inline]
    pub fn end_element(&mut self, name: &str) -> &mut Self {
        // If still in attributes, close the opening tag first
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
        }

        self.indent_level = self.indent_level.saturating_sub(1);

        // Write indentation if pretty printing and we had a newline
        if self.pretty {
            let needs_indent = !self.buffer.is_empty() && self.buffer.last() == Some(&b'\n');
            if needs_indent {
                self.write_indent();
            }
        }

        self.buffer.extend_from_slice(b"</");
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.push(b'>');

        if self.pretty {
            self.buffer.push(b'\n');
        }

        // Validate element stack
        debug_assert!(
            self.element_stack.last().map(|s| s.as_str()) == Some(name),
            "end_element({}) doesn't match open element {:?}",
            name,
            self.element_stack.last()
        );
        self.element_stack.pop();
        self.state = ElementState::InContent;

        self
    }

    /// Close the current element with namespace prefix.
    ///
    /// # Arguments
    /// * `prefix` - The namespace prefix
    /// * `name` - The local element name
    #[inline]
    pub fn end_element_ns(&mut self, prefix: &str, name: &str) -> &mut Self {
        // If still in attributes, close the opening tag first
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
        }

        self.indent_level = self.indent_level.saturating_sub(1);

        if self.pretty {
            let needs_indent = !self.buffer.is_empty() && self.buffer.last() == Some(&b'\n');
            if needs_indent {
                self.write_indent();
            }
        }

        self.buffer.extend_from_slice(b"</");
        self.buffer.extend_from_slice(prefix.as_bytes());
        self.buffer.push(b':');
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.push(b'>');

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self.element_stack.pop();
        self.state = ElementState::InContent;

        self
    }

    /// Write escaped text content.
    ///
    /// The text will be properly XML-escaped for element content.
    ///
    /// # Arguments
    /// * `content` - The text content (will be escaped)
    ///
    /// # Example
    /// ```ignore
    /// writer.start_element("v")
    ///       .end_attrs()
    ///       .text("42")
    ///       .end_element("v");
    /// // Result: <v>42</v>
    /// ```
    #[inline]
    pub fn text(&mut self, content: &str) -> &mut Self {
        // Ensure we're in content mode
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }

        self.write_escaped_text(content);
        self
    }

    /// Write OOXML xstring text content.
    ///
    /// Spreadsheet string-bearing text nodes use `_xHHHH_` escapes for XML
    /// control characters. Existing literal escape-looking text is escaped by
    /// prefixing the underscore, matching OOXML xstring rules.
    #[inline]
    pub fn text_xstring(&mut self, content: &str) -> &mut Self {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }

        self.write_escaped_xstring_text(content);
        self
    }

    /// Write raw bytes without escaping.
    ///
    /// Use with caution - the bytes must be valid XML.
    ///
    /// # Arguments
    /// * `content` - Raw bytes to write
    #[inline]
    pub fn raw(&mut self, content: &[u8]) -> &mut Self {
        // Ensure we're in content mode
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }

        self.buffer.extend_from_slice(content);
        self
    }

    /// Write raw string without escaping.
    ///
    /// Use with caution - the string must be valid XML.
    #[inline]
    pub fn raw_str(&mut self, content: &str) -> &mut Self {
        self.raw(content.as_bytes())
    }

    /// Write an empty element with attributes: `<name attr="value"/>`
    ///
    /// # Arguments
    /// * `name` - The element name
    /// * `attrs` - Slice of (name, value) attribute pairs
    #[inline]
    pub fn empty_element(&mut self, name: &str, attrs: &[(&str, &str)]) -> &mut Self {
        // Close any pending attribute section
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
        }

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        for (attr_name, attr_value) in attrs {
            self.buffer.push(b' ');
            self.buffer.extend_from_slice(attr_name.as_bytes());
            self.buffer.extend_from_slice(b"=\"");
            self.write_escaped_attr(attr_value);
            self.buffer.push(b'"');
        }

        self.buffer.extend_from_slice(b"/>");

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self.state = ElementState::InContent;
        self
    }

    /// Write a complete element with text content: `<name>text</name>`
    ///
    /// # Arguments
    /// * `name` - The element name
    /// * `text_content` - The text content (will be escaped)
    #[inline]
    pub fn element_with_text(&mut self, name: &str, text_content: &str) -> &mut Self {
        if text_content.is_empty() {
            // Emit self-closing <element/> for empty text (matches Excel's canonical output)
            self.start_element(name).self_close()
        } else {
            self.start_element(name)
                .end_attrs()
                .text(text_content)
                .end_element(name)
        }
    }

    /// Write a complete element with attributes and text content.
    ///
    /// # Arguments
    /// * `name` - The element name
    /// * `attrs` - Slice of (name, value) attribute pairs
    /// * `text_content` - The text content (will be escaped)
    #[inline]
    pub fn element_with_text_and_attrs(
        &mut self,
        name: &str,
        attrs: &[(&str, &str)],
        text_content: &str,
    ) -> &mut Self {
        // Close any pending attribute section
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
        }

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        for (attr_name, attr_value) in attrs {
            self.buffer.push(b' ');
            self.buffer.extend_from_slice(attr_name.as_bytes());
            self.buffer.extend_from_slice(b"=\"");
            self.write_escaped_attr(attr_value);
            self.buffer.push(b'"');
        }

        self.buffer.push(b'>');
        self.write_escaped_text(text_content);
        self.buffer.extend_from_slice(b"</");
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.push(b'>');

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self.state = ElementState::InContent;
        self
    }

    /// Write a CDATA section.
    ///
    /// # Arguments
    /// * `content` - The CDATA content
    #[inline]
    pub fn cdata(&mut self, content: &str) -> &mut Self {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }

        self.buffer.extend_from_slice(b"<![CDATA[");
        // CDATA content can contain anything except "]]>"
        // For safety, we escape that sequence
        let safe_content = content.replace("]]>", "]]]]><![CDATA[>");
        self.buffer.extend_from_slice(safe_content.as_bytes());
        self.buffer.extend_from_slice(b"]]>");

        self
    }

    /// Write an XML comment.
    ///
    /// # Arguments
    /// * `text_content` - The comment text
    #[inline]
    pub fn comment(&mut self, text_content: &str) -> &mut Self {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
            self.state = ElementState::InContent;
        }

        if self.pretty {
            self.write_indent();
        }

        self.buffer.extend_from_slice(b"<!-- ");
        // Comments can't contain "--" so we escape it
        let safe_text = text_content.replace("--", "- -");
        self.buffer.extend_from_slice(safe_text.as_bytes());
        self.buffer.extend_from_slice(b" -->");

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self
    }

    /// Get the current buffer contents as a byte slice.
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        &self.buffer
    }

    /// Get the current buffer length.
    #[inline]
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Check if the buffer is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Get the current element nesting depth.
    #[inline]
    pub fn depth(&self) -> usize {
        self.element_stack.len()
    }

    /// Consume the writer and return the byte buffer.
    #[inline]
    pub fn finish(self) -> Vec<u8> {
        debug_assert!(
            self.element_stack.is_empty(),
            "Unclosed elements: {:?}",
            self.element_stack
        );
        self.buffer
    }

    /// Consume the writer and return the buffer as a String.
    ///
    /// # Panics
    /// Panics if the buffer contains invalid UTF-8.
    #[inline]
    pub fn finish_string(self) -> String {
        String::from_utf8(self.finish()).expect("XmlWriter produced invalid UTF-8")
    }

    /// Alias for `finish()` for compatibility with existing code.
    #[inline]
    pub fn into_bytes(self) -> Vec<u8> {
        self.finish()
    }

    // -------------------------------------------------------------------------
    // Backward compatibility methods
    // -------------------------------------------------------------------------

    /// Alias for `write_declaration()` for backward compatibility.
    #[inline]
    pub fn xml_declaration(&mut self) -> &mut Self {
        self.write_declaration()
    }

    /// Start an element with attributes in one call.
    ///
    /// This is provided for backward compatibility with existing code.
    /// New code should use `start_element().attr().attr().end_attrs()`.
    ///
    /// # Arguments
    /// * `name` - The element name
    /// * `attrs` - Slice of (name, value) attribute pairs
    #[inline]
    pub fn start_element_with_attrs(&mut self, name: &str, attrs: &[(&str, &str)]) -> &mut Self {
        self.start_element(name);
        for (attr_name, attr_value) in attrs {
            self.attr(attr_name, attr_value);
        }
        self.end_attrs();
        self
    }

    /// Create a writer with indentation enabled.
    ///
    /// Alias for `XmlWriter::new().pretty()` for backward compatibility.
    #[inline]
    pub fn with_indentation() -> Self {
        Self::new().pretty()
    }

    /// Clear the buffer and reset state for reuse.
    #[inline]
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.element_stack.clear();
        self.indent_level = 0;
        self.state = ElementState::InContent;
    }

    // -------------------------------------------------------------------------
    // Private helper methods
    // -------------------------------------------------------------------------

    /// Write indentation spaces.
    #[inline]
    fn write_indent(&mut self) {
        for _ in 0..self.indent_level {
            self.buffer.extend_from_slice(b"  ");
        }
    }

    /// Write text content with XML escaping.
    ///
    /// Escapes: & < >
    #[inline]
    fn write_escaped_text(&mut self, text: &str) {
        for byte in text.bytes() {
            match byte {
                b'&' => self.buffer.extend_from_slice(b"&amp;"),
                b'<' => self.buffer.extend_from_slice(b"&lt;"),
                b'>' => self.buffer.extend_from_slice(b"&gt;"),
                _ => self.buffer.push(byte),
            }
        }
    }

    /// Write attribute value with XML escaping.
    ///
    /// Escapes: & < > " '
    #[inline]
    fn write_escaped_attr(&mut self, value: &str) {
        for byte in value.bytes() {
            match byte {
                b'&' => self.buffer.extend_from_slice(b"&amp;"),
                b'<' => self.buffer.extend_from_slice(b"&lt;"),
                b'>' => self.buffer.extend_from_slice(b"&gt;"),
                b'"' => self.buffer.extend_from_slice(b"&quot;"),
                b'\'' => self.buffer.extend_from_slice(b"&apos;"),
                // Also escape control characters for XML 1.0 compatibility
                0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                    // Write as numeric character reference
                    self.buffer.extend_from_slice(b"&#");
                    use std::io::Write;
                    write!(&mut self.buffer, "{}", byte).ok();
                    self.buffer.push(b';');
                }
                _ => self.buffer.push(byte),
            }
        }
    }

    #[inline]
    fn write_escaped_xstring_attr(&mut self, value: &str) {
        let bytes = value.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let byte = bytes[i];
            if byte == b'\r'
                && i + 2 < bytes.len()
                && bytes[i + 1] == b'\r'
                && bytes[i + 2] == b'\n'
            {
                self.buffer.extend_from_slice(b"_x000D_\r\n");
                i += 3;
                continue;
            }
            if byte == b'_'
                && i + 6 < bytes.len()
                && bytes[i + 1] == b'x'
                && bytes[i + 6] == b'_'
                && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
            {
                self.buffer.extend_from_slice(b"_x005f_");
                i += 1;
                continue;
            }

            match byte {
                b'\n' => self.buffer.extend_from_slice(b"_x000a_"),
                b'\r' => self.buffer.extend_from_slice(b"_x000d_"),
                b'\t' => self.buffer.extend_from_slice(b"_x0009_"),
                b'&' => self.buffer.extend_from_slice(b"&amp;"),
                b'<' => self.buffer.extend_from_slice(b"&lt;"),
                b'>' => self.buffer.extend_from_slice(b"&gt;"),
                b'"' => self.buffer.extend_from_slice(b"&quot;"),
                b'\'' => self.buffer.extend_from_slice(b"&apos;"),
                0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                    use std::io::Write;
                    write!(&mut self.buffer, "_x{byte:04x}_").ok();
                }
                _ => self.buffer.push(byte),
            }
            i += 1;
        }
    }

    #[inline]
    fn write_escaped_xstring_text(&mut self, value: &str) {
        let bytes = value.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let byte = bytes[i];
            if byte == b'\r'
                && i + 2 < bytes.len()
                && bytes[i + 1] == b'\r'
                && bytes[i + 2] == b'\n'
            {
                self.buffer.extend_from_slice(b"_x000D_\r\n");
                i += 3;
                continue;
            }
            if byte == b'_'
                && i + 6 < bytes.len()
                && bytes[i + 1] == b'x'
                && bytes[i + 6] == b'_'
                && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
            {
                self.buffer.extend_from_slice(b"_x005F_");
                i += 1;
                continue;
            }

            match byte {
                b'\r' => self.buffer.extend_from_slice(b"_x000D_"),
                b'&' => self.buffer.extend_from_slice(b"&amp;"),
                b'<' => self.buffer.extend_from_slice(b"&lt;"),
                b'>' => self.buffer.extend_from_slice(b"&gt;"),
                0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                    use std::io::Write;
                    write!(&mut self.buffer, "_x{byte:04X}_").ok();
                }
                _ => self.buffer.push(byte),
            }
            i += 1;
        }
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Basic element tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Text content tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Attribute escaping tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Nested elements tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // XML declaration tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Namespace tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Conditional attribute tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Helper method tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // CDATA and comment tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Raw content tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Pretty printing tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_pretty_printing_basic() {
        let mut w = XmlWriter::new().pretty();
        w.start_element("root")
            .end_attrs()
            .start_element("child")
            .self_close()
            .end_element("root");
        let xml = w.finish_string();
        // Should have newlines
        assert!(xml.contains('\n'));
        // Should have indentation
        assert!(xml.contains("  <child"));
    }

    #[test]
    fn test_pretty_printing_declaration() {
        let mut w = XmlWriter::new().pretty();
        w.write_declaration().start_element("root").self_close();
        let xml = w.finish_string();
        // Declaration should be followed by newline
        assert!(xml.contains("?>\n"));
    }

    // -------------------------------------------------------------------------
    // XLSX example test
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Utility method tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Unicode content tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Backward compatibility tests
    // -------------------------------------------------------------------------

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
}
