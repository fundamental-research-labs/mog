use std::cell::Cell;

use super::CellRefResolver;
use super::parser::ParseErrorKind;

/// WASM targets default to a 1 MB stack. The Pratt parser uses ~3 stack frames
/// per nesting level (vs ~9 for recursive descent), so 128 levels fits well
/// within 1 MB. On native targets the stack is larger, but 128 nesting levels
/// is far beyond any realistic formula.
pub const MAX_DEPTH: u32 = 128;

pub struct ParseState<'a> {
    pub depth: Cell<u32>,
    pub resolver: Option<&'a dyn CellRefResolver>,
    /// Set to `true` when a depth check exceeds `MAX_DEPTH`.
    /// Used by `parse_formula` to classify errors as `MaxDepthExceeded`.
    pub depth_exceeded: Cell<bool>,
    /// The formula input string (after stripping `=` and leading whitespace).
    /// Used to compute byte offsets for spans.
    pub formula_input: &'a str,
    /// Structured error kind set by `cut_err` paths before raising a fatal error.
    /// Retrieved by `parse_formula` to produce precise `ParseError` values.
    pub last_error_kind: Cell<Option<ParseErrorKind>>,
}

impl<'a> ParseState<'a> {
    pub fn new(resolver: Option<&'a dyn CellRefResolver>, formula_input: &'a str) -> Self {
        ParseState {
            depth: Cell::new(0),
            resolver,
            depth_exceeded: Cell::new(false),
            formula_input,
            last_error_kind: Cell::new(None),
        }
    }

    /// Compute the byte offset of `remaining` relative to `self.formula_input`.
    #[inline]
    #[allow(clippy::cast_possible_truncation)]
    pub fn offset(&self, remaining: &str) -> u32 {
        let offset = (self.formula_input.len() - remaining.len()) as u32;
        debug_assert!(offset as usize <= self.formula_input.len());
        offset
    }

    /// Return an RAII guard that increments depth now and decrements on drop.
    /// Prevents depth-tracking bugs from early returns.
    #[inline]
    pub(crate) fn depth_guard(&self) -> DepthGuard<'_> {
        self.depth.set(self.depth.get() + 1);
        DepthGuard { depth: &self.depth }
    }
}

/// RAII guard that decrements `depth` when dropped, ensuring balanced
/// depth tracking even in the presence of early returns or `?` operators.
pub struct DepthGuard<'a> {
    depth: &'a Cell<u32>,
}

impl Drop for DepthGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        self.depth.set(self.depth.get() - 1);
    }
}
