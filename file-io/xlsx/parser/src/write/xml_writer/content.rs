use super::{ElementState, XmlWriter, escape, xstring};

impl XmlWriter {
    /// Write escaped text content.
    ///
    /// The text will be properly XML-escaped for element content.
    #[inline]
    pub fn text(&mut self, content: &str) -> &mut Self {
        self.close_pending_attrs();
        escape::append_escaped_text(&mut self.buffer, content);
        self
    }

    /// Write OOXML xstring text content.
    ///
    /// Spreadsheet string-bearing text nodes use `_xHHHH_` escapes for XML
    /// control characters. Existing literal escape-looking text is escaped by
    /// prefixing the underscore, matching OOXML xstring rules.
    #[inline]
    pub fn text_xstring(&mut self, content: &str) -> &mut Self {
        self.close_pending_attrs();
        xstring::append_escaped_xstring_text(&mut self.buffer, content);
        self
    }

    /// Write raw bytes without escaping.
    ///
    /// Use with caution - the bytes must be valid XML.
    #[inline]
    pub fn raw(&mut self, content: &[u8]) -> &mut Self {
        self.close_pending_attrs();
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

    /// Write a CDATA section.
    #[inline]
    pub fn cdata(&mut self, content: &str) -> &mut Self {
        self.close_pending_attrs();

        self.buffer.extend_from_slice(b"<![CDATA[");
        let safe_content = escape::normalize_cdata(content);
        self.buffer.extend_from_slice(safe_content.as_bytes());
        self.buffer.extend_from_slice(b"]]>");

        self
    }

    /// Write an XML comment.
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
        let safe_text = escape::normalize_comment(text_content);
        self.buffer.extend_from_slice(safe_text.as_bytes());
        self.buffer.extend_from_slice(b" -->");

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self
    }
}
