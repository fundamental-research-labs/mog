use super::{ElementState, XmlWriter, escape};

impl XmlWriter {
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
    /// The encoding token is written raw; callers must pass a safe XML encoding
    /// name.
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
    #[inline]
    pub fn start_element(&mut self, name: &str) -> &mut Self {
        self.close_pending_attrs_before_child();

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        self.push_element(name.to_string());
        self
    }

    /// Start a new element with a namespace prefix.
    #[inline]
    pub fn start_element_ns(&mut self, prefix: &str, name: &str) -> &mut Self {
        self.close_pending_attrs_before_child();

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(prefix.as_bytes());
        self.buffer.push(b':');
        self.buffer.extend_from_slice(name.as_bytes());

        self.push_element(format!("{}:{}", prefix, name));
        self
    }

    /// Close the opening tag's attribute section with `>`.
    #[inline]
    pub fn end_attrs(&mut self) -> &mut Self {
        self.close_pending_attrs();
        self
    }

    /// Write a self-closing tag `/>`.
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

        self.pop_element();
        self
    }

    /// Close the current element with `</name>`.
    #[inline]
    pub fn end_element(&mut self, name: &str) -> &mut Self {
        self.close_pending_attrs_without_state_update();
        self.decrement_indent();
        self.write_indent_after_pretty_newline();

        self.buffer.extend_from_slice(b"</");
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.push(b'>');

        if self.pretty {
            self.buffer.push(b'\n');
        }

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
    #[inline]
    pub fn end_element_ns(&mut self, prefix: &str, name: &str) -> &mut Self {
        self.close_pending_attrs_without_state_update();
        self.decrement_indent();
        self.write_indent_after_pretty_newline();

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

    /// Write an empty element with attributes: `<name attr="value"/>`
    #[inline]
    pub fn empty_element(&mut self, name: &str, attrs: &[(&str, &str)]) -> &mut Self {
        self.close_pending_attrs_before_child();

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        for (attr_name, attr_value) in attrs {
            self.buffer.push(b' ');
            self.buffer.extend_from_slice(attr_name.as_bytes());
            self.buffer.extend_from_slice(b"=\"");
            escape::append_escaped_attr(&mut self.buffer, attr_value);
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
    #[inline]
    pub fn element_with_text(&mut self, name: &str, text_content: &str) -> &mut Self {
        if text_content.is_empty() {
            self.start_element(name).self_close()
        } else {
            self.start_element(name)
                .end_attrs()
                .text(text_content)
                .end_element(name)
        }
    }

    /// Write a complete element with attributes and text content.
    #[inline]
    pub fn element_with_text_and_attrs(
        &mut self,
        name: &str,
        attrs: &[(&str, &str)],
        text_content: &str,
    ) -> &mut Self {
        self.close_pending_attrs_before_child();

        if self.pretty {
            self.write_indent();
        }

        self.buffer.push(b'<');
        self.buffer.extend_from_slice(name.as_bytes());

        for (attr_name, attr_value) in attrs {
            self.buffer.push(b' ');
            self.buffer.extend_from_slice(attr_name.as_bytes());
            self.buffer.extend_from_slice(b"=\"");
            escape::append_escaped_attr(&mut self.buffer, attr_value);
            self.buffer.push(b'"');
        }

        self.buffer.push(b'>');
        escape::append_escaped_text(&mut self.buffer, text_content);
        self.buffer.extend_from_slice(b"</");
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.push(b'>');

        if self.pretty {
            self.buffer.push(b'\n');
        }

        self.state = ElementState::InContent;
        self
    }

    /// Alias for `write_declaration()` for backward compatibility.
    #[inline]
    pub fn xml_declaration(&mut self) -> &mut Self {
        self.write_declaration()
    }

    /// Start an element with attributes in one call.
    #[inline]
    pub fn start_element_with_attrs(&mut self, name: &str, attrs: &[(&str, &str)]) -> &mut Self {
        self.start_element(name);
        for (attr_name, attr_value) in attrs {
            self.attr(attr_name, attr_value);
        }
        self.end_attrs();
        self
    }
}
