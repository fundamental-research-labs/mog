use std::fmt::Display;
use std::io::Write;

use super::{ElementState, XmlWriter, escape, xstring};

impl XmlWriter {
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
        escape::append_escaped_attr(&mut self.buffer, value);
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
        xstring::append_escaped_xstring_attr(&mut self.buffer, value);
        self.buffer.push(b'"');

        self
    }

    /// Add an attribute only if the value is Some.
    ///
    /// # Arguments
    /// * `name` - The attribute name
    /// * `value` - Optional attribute value
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
    #[inline]
    pub fn attr_bool(&mut self, name: &str, value: bool) -> &mut Self {
        self.attr(name, if value { "1" } else { "0" })
    }

    /// Add a boolean attribute only if true.
    #[inline]
    pub fn attr_bool_if_true(&mut self, name: &str, value: bool) -> &mut Self {
        if value {
            self.attr(name, "1");
        }
        self
    }

    /// Add a numeric attribute.
    #[inline]
    pub fn attr_num<T: Display>(&mut self, name: &str, value: T) -> &mut Self {
        debug_assert!(
            self.state == ElementState::InAttributes,
            "attr_num() called outside element"
        );

        self.buffer.push(b' ');
        self.buffer.extend_from_slice(name.as_bytes());
        self.buffer.extend_from_slice(b"=\"");
        write!(&mut self.buffer, "{}", value).ok();
        self.buffer.push(b'"');
        self
    }

    /// Add a numeric attribute only if the value is Some.
    #[inline]
    pub fn attr_num_if<T: Display>(&mut self, name: &str, value: Option<T>) -> &mut Self {
        if let Some(v) = value {
            self.attr_num(name, v);
        }
        self
    }
}
