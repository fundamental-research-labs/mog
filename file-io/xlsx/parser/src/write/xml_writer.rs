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

mod attrs;
mod content;
mod elements;
mod escape;
mod state;
mod xstring;

#[cfg(test)]
mod tests;

use self::state::ElementState;

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
}
