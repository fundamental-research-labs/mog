/// Internal state tracking for element writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ElementState {
    /// Currently writing attributes (between `<tag` and `>`)
    InAttributes,
    /// Element's opening tag is complete (after `>`)
    InContent,
}

use super::XmlWriter;

impl XmlWriter {
    #[inline]
    pub(super) fn close_pending_attrs(&mut self) {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            self.state = ElementState::InContent;
        }
    }

    #[inline]
    pub(super) fn close_pending_attrs_before_child(&mut self) {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
            if self.pretty {
                self.buffer.push(b'\n');
            }
            self.state = ElementState::InContent;
        }
    }

    #[inline]
    pub(super) fn close_pending_attrs_without_state_update(&mut self) {
        if self.state == ElementState::InAttributes {
            self.buffer.push(b'>');
        }
    }

    /// Write indentation spaces.
    #[inline]
    pub(super) fn write_indent(&mut self) {
        for _ in 0..self.indent_level {
            self.buffer.extend_from_slice(b"  ");
        }
    }

    #[inline]
    pub(super) fn write_indent_after_pretty_newline(&mut self) {
        if self.pretty {
            let needs_indent = !self.buffer.is_empty() && self.buffer.last() == Some(&b'\n');
            if needs_indent {
                self.write_indent();
            }
        }
    }

    #[inline]
    pub(super) fn push_element(&mut self, name: String) {
        self.element_stack.push(name);
        self.state = ElementState::InAttributes;
        self.indent_level += 1;
    }

    #[inline]
    pub(super) fn pop_element(&mut self) {
        self.element_stack.pop();
        self.indent_level = self.indent_level.saturating_sub(1);
        self.state = ElementState::InContent;
    }

    #[inline]
    pub(super) fn decrement_indent(&mut self) {
        self.indent_level = self.indent_level.saturating_sub(1);
    }
}
