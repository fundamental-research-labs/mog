/// A stateful XML byte scanner that tracks position while parsing.
///
/// This provides a convenient API for sequential parsing of XML documents,
/// maintaining the current position and providing methods that advance through
/// the byte stream.
///
/// # Example
/// ```ignore
/// use xlsx_parser::infra::scanner::XmlScanner;
///
/// let xml = b"<row r=\"1\"><c r=\"A1\"><v>42</v></c></row>";
/// let mut scanner = XmlScanner::new(xml);
///
/// // Find and advance to elements
/// assert!(scanner.find_tag(b"row").is_some());
/// assert!(scanner.find_tag(b"c").is_some());
/// ```
#[derive(Debug, Clone)]
pub struct XmlScanner<'a> {
    /// The byte slice being scanned
    bytes: &'a [u8],
    /// Current position in the byte stream
    pos: usize,
}

impl<'a> XmlScanner<'a> {
    /// Create a new scanner for the given bytes.
    #[inline]
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    /// Create a scanner starting at a specific position.
    #[inline]
    pub fn new_at(bytes: &'a [u8], pos: usize) -> Self {
        Self { bytes, pos }
    }

    /// Get the underlying byte slice.
    #[inline]
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    /// Get the current position.
    #[inline]
    pub fn pos(&self) -> usize {
        self.pos
    }

    /// Set the current position.
    #[inline]
    pub fn set_pos(&mut self, pos: usize) {
        self.pos = pos;
    }

    /// Advance the position by `n` bytes.
    #[inline]
    pub fn advance(&mut self, n: usize) {
        self.pos += n;
    }

    /// Check if we've reached the end.
    #[inline]
    pub fn is_at_end(&self) -> bool {
        self.pos >= self.bytes.len()
    }

    /// Get remaining bytes from current position.
    #[inline]
    pub fn remaining(&self) -> &'a [u8] {
        if self.pos >= self.bytes.len() {
            &[]
        } else {
            &self.bytes[self.pos..]
        }
    }

    /// Get remaining length.
    #[inline]
    pub fn remaining_len(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    // -------------------------------------------------------------------------
    // Find methods (return position without advancing)
    // -------------------------------------------------------------------------

    /// Find the next '<' character from current position.
    /// Does not advance the scanner position.
    #[inline]
    pub fn find_lt(&self) -> Option<usize> {
        super::find_lt_simd(self.bytes, self.pos)
    }

    /// Find the next '>' character from current position.
    /// Does not advance the scanner position.
    #[inline]
    pub fn find_gt(&self) -> Option<usize> {
        super::find_gt_simd(self.bytes, self.pos)
    }

    /// Find any of the target bytes from current position.
    /// Returns (position, found_byte). Does not advance.
    #[inline]
    pub fn find_any(&self, targets: &[u8]) -> Option<(usize, u8)> {
        super::find_any_simd(self.bytes, self.pos, targets)
    }

    /// Find a specific XML tag from current position.
    /// Returns the position of the '<'. Does not advance.
    #[inline]
    pub fn find_tag(&self, tag: &[u8]) -> Option<usize> {
        super::find_tag_simd(self.bytes, tag, self.pos)
    }

    /// Find an XML attribute from current position.
    /// Returns the position of the attribute name. Does not advance.
    #[inline]
    pub fn find_attr(&self, attr: &[u8]) -> Option<usize> {
        super::find_attr_simd(self.bytes, attr, self.pos)
    }

    /// Find the closing tag from current position.
    /// Returns the position of the '</'. Does not advance.
    #[inline]
    pub fn find_closing(&self, tag: &[u8]) -> Option<usize> {
        super::find_closing_tag(self.bytes, tag, self.pos)
    }

    // -------------------------------------------------------------------------
    // Skip/advance methods
    // -------------------------------------------------------------------------

    /// Skip whitespace from current position and update pos.
    /// Returns the new position.
    #[inline]
    pub fn skip_whitespace(&mut self) -> usize {
        self.pos = super::skip_whitespace_simd(self.bytes, self.pos);
        self.pos
    }

    /// Advance to the next '<' character.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_lt(&mut self) -> Option<usize> {
        if let Some(pos) = super::find_lt_simd(self.bytes, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance to the next '>' character.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_gt(&mut self) -> Option<usize> {
        if let Some(pos) = super::find_gt_simd(self.bytes, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance past the next '>' character.
    /// Returns true if successful.
    #[inline]
    pub fn advance_past_gt(&mut self) -> bool {
        if let Some(pos) = super::find_gt_simd(self.bytes, self.pos) {
            self.pos = pos + 1;
            true
        } else {
            false
        }
    }

    /// Advance to the next occurrence of a specific tag.
    /// Returns the position if found, None otherwise.
    #[inline]
    pub fn advance_to_tag(&mut self, tag: &[u8]) -> Option<usize> {
        if let Some(pos) = super::find_tag_simd(self.bytes, tag, self.pos) {
            self.pos = pos;
            Some(pos)
        } else {
            None
        }
    }

    /// Advance past a specific tag (past its '>').
    /// Returns true if successful.
    #[inline]
    pub fn advance_past_tag(&mut self, tag: &[u8]) -> bool {
        if let Some(pos) = super::find_tag_simd(self.bytes, tag, self.pos) {
            self.pos = pos;
            // Now find the '>' to skip past it
            if let Some(end) = super::find_element_end(self.bytes, pos + 1) {
                self.pos = end + 1;
                return true;
            }
        }
        false
    }

    // -------------------------------------------------------------------------
    // Extraction methods
    // -------------------------------------------------------------------------

    /// Extract attribute value for given attribute name (e.g., `r="`).
    /// Returns the value bytes (without quotes) if found.
    /// Does not advance the scanner.
    #[inline]
    pub fn extract_attr_value(&self, attr: &[u8]) -> Option<&'a [u8]> {
        let attr_pos = super::find_attr_simd(self.bytes, attr, self.pos)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = super::extract_quoted_value(self.bytes, value_start)?;
        Some(&self.bytes[start..end])
    }

    /// Extract text content between current position and closing tag.
    /// Useful for getting values like `<v>123</v>`.
    #[inline]
    pub fn extract_until_closing(&self, tag: &[u8]) -> Option<&'a [u8]> {
        let end_pos = super::find_closing_tag(self.bytes, tag, self.pos)?;
        if self.pos < end_pos {
            Some(&self.bytes[self.pos..end_pos])
        } else {
            None
        }
    }

    /// Check if bytes at current position match pattern.
    #[inline]
    pub fn matches(&self, pattern: &[u8]) -> bool {
        super::matches_at(self.bytes, self.pos, pattern)
    }

    /// Get byte at current position, if available.
    #[inline]
    pub fn current_byte(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    /// Peek at byte at offset from current position.
    #[inline]
    pub fn peek(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.pos + offset).copied()
    }
}
