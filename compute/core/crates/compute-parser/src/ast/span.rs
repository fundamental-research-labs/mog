/// A byte-offset range within the original formula string.
///
/// Used for error reporting, IDE integration, and source mapping.
/// Offsets are relative to the start of the formula (after stripping `=`).
///
/// # Examples
///
/// ```
/// use compute_parser::Span;
///
/// let span = Span::new(0, 5);
/// assert_eq!(span.len(), 5);
/// assert!(!span.is_empty());
///
/// let merged = span.merge(Span::new(3, 10));
/// assert_eq!(merged, Span::new(0, 10));
/// ```
#[must_use]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    /// Inclusive start byte offset.
    pub start: u32,
    /// Exclusive end byte offset.
    pub end: u32,
}

impl Span {
    /// Create a new span from start (inclusive) to end (exclusive).
    #[inline]
    pub const fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    /// An empty span at position 0.
    #[inline]
    pub const fn empty() -> Self {
        Self { start: 0, end: 0 }
    }

    /// Merge two spans into one that covers both.
    #[inline]
    pub fn merge(self, other: Self) -> Self {
        Self {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }

    /// Length of the span in bytes.
    #[inline]
    #[must_use]
    pub const fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }

    /// Whether the span is empty (zero length).
    #[inline]
    #[must_use]
    pub const fn is_empty(self) -> bool {
        self.start >= self.end
    }
}

/// An AST node paired with its source span.
///
/// Consumers that don't need spans can destructure: `let Spanned { node, .. } = ...`
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let spanned = parse_formula("=42", None).unwrap();
/// assert_eq!(spanned.node, ASTNode::Number(42.0));
/// assert!(!spanned.span.is_empty());
///
/// // Strip the span when you only need the node:
/// let node = spanned.into_inner();
/// assert_eq!(node, ASTNode::Number(42.0));
/// ```
#[must_use = "a spanned AST node should be used"]
#[derive(Debug, Clone, PartialEq)]
pub struct Spanned<T> {
    pub node: T,
    pub span: Span,
}

impl<T: Eq> Eq for Spanned<T> {}

impl<T> Spanned<T> {
    /// Transform the inner node, keeping the span.
    #[inline]
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Spanned<U> {
        Spanned {
            node: f(self.node),
            span: self.span,
        }
    }

    /// Strip the span and return the inner node.
    #[must_use]
    #[inline]
    pub fn into_inner(self) -> T {
        self.node
    }
}

impl<T: std::fmt::Display> std::fmt::Display for Spanned<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.node.fmt(f)
    }
}
