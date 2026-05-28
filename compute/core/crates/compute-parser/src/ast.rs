//! AST types for the formula parser.
//!
//! These types represent the parsed tree structure of a spreadsheet formula.
//! The AST stays in Rust memory and never crosses the IPC boundary.

use std::borrow::Cow;
use std::fmt;

use cell_types::{SheetId, col_to_letter};
use formula_types::{
    CellRef, ExternalWorkbookToken, RangeType, SpecialItem, StructuredRef, StructuredRefSpecifier,
};
use value_types::CellError;

// ---------------------------------------------------------------------------
// Source spans
// ---------------------------------------------------------------------------

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
/// use compute_parser::{parse_formula, ASTNode, Span};
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

/// Binary operators in order of how they appear in formulas.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, BinOp};
///
/// let ast = parse_formula("=A1+B1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::BinaryOp { op, .. } => assert_eq!(op, BinOp::Add),
///     _ => panic!("expected binary op"),
/// }
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BinOp {
    /// Addition: `+`
    Add,
    /// Subtraction: `-`
    Sub,
    /// Multiplication: `*`
    Mul,
    /// Division: `/`
    Div,
    /// Exponentiation: `^` (right-associative)
    Pow,
    /// String concatenation: `&`
    Concat,
    /// Equality: `=`
    Eq,
    /// Inequality: `<>`
    Neq,
    /// Less than: `<`
    Lt,
    /// Greater than: `>`
    Gt,
    /// Less than or equal: `<=`
    Lte,
    /// Greater than or equal: `>=`
    Gte,
    /// Range intersection (space operator): `A1:B10 B5:C20`.
    ///
    /// In Excel, two range expressions separated only by whitespace produce
    /// the intersection of those ranges. Parsed via speculative lookahead in
    /// the Pratt loop (`try_intersection` in the expression grammar).
    Intersect,
}

/// Unary operators.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, UnaryOp};
///
/// let ast = parse_formula("=-A1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::UnaryOp { op, .. } => assert_eq!(op, UnaryOp::Minus),
///     _ => panic!("expected unary op"),
/// }
///
/// let ast = parse_formula("=50%", None).unwrap().into_inner();
/// match ast {
///     ASTNode::UnaryOp { op, .. } => assert_eq!(op, UnaryOp::Percent),
///     _ => panic!("expected unary op"),
/// }
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnaryOp {
    Plus,
    Minus,
    Percent,
    /// Excel `@` implicit-intersection prefix operator.
    ///
    /// Forces a multi-cell range or array expression to collapse to a single
    /// scalar via row-aligned (for column ranges) or column-aligned (for row
    /// ranges) implicit intersection relative to the formula's own cell
    /// position. For 2-D ranges, picks the cell at (`caller_row`, `caller_col`).
    /// If no alignment is possible, evaluates to `#VALUE!`.
    ///
    /// Examples (caller in C3):
    ///   =@A1:A5  → A3   (column range, row-aligned)
    ///   =@A3:E3  → C3   (row range, column-aligned)
    ///   =@A1:E5  → C3   (2-D range, both aligned)
    ///   =@A1:A2  → #VALUE! (caller row 3 not in 1..=2)
    ///
    /// The parser produces this prefix anywhere `+`/`-` would be accepted.
    /// Inside `[ ]` brackets, `@` is part of structured-table syntax and is
    /// NOT a unary operator (handled by the structured-ref parser).
    ImplicitIntersection,
}

/// A cell reference with absoluteness flags for `$`-prefixed row/column components.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let ast = parse_formula("=$A$1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::CellReference(r) => {
///         assert!(r.abs_row);
///         assert!(r.abs_col);
///     }
///     _ => panic!("expected cell ref"),
/// }
/// ```
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellRefNode {
    pub reference: CellRef,
    pub abs_row: bool,
    pub abs_col: bool,
}

/// Absoluteness flags for a single endpoint of a range reference.
///
/// Each flag controls whether the corresponding component is prefixed with `$`
/// in A1 notation (e.g. `$A$1` has both `row` and `col` set to `true`).
///
/// # Examples
///
/// ```
/// use compute_parser::AbsFlags;
///
/// let flags = AbsFlags { row: true, col: false };
/// assert!(flags.row);   // $-prefixed row
/// assert!(!flags.col);  // relative column
///
/// let default = AbsFlags::default();
/// assert!(!default.row && !default.col); // fully relative
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct AbsFlags {
    pub row: bool,
    pub col: bool,
}

/// A range reference (cell range, row range, or column range) with absoluteness flags.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let ast = parse_formula("=A1:B10", None).unwrap().into_inner();
/// match ast {
///     ASTNode::Range(r) => {
///         // Both endpoints default to relative (no $)
///         assert!(!r.abs_start.row && !r.abs_start.col);
///         assert!(!r.abs_end.row && !r.abs_end.col);
///     }
///     _ => panic!("expected range"),
/// }
/// ```
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RangeRef {
    pub start: CellRef,
    pub end: CellRef,
    pub abs_start: AbsFlags,
    pub abs_end: AbsFlags,
    pub range_type: RangeType,
}

impl RangeRef {
    /// Create a new `RangeRef` with all absoluteness flags set to `false` (the common case).
    #[inline]
    pub const fn new(start: CellRef, end: CellRef, range_type: RangeType) -> Self {
        Self {
            start,
            end,
            abs_start: AbsFlags {
                row: false,
                col: false,
            },
            abs_end: AbsFlags {
                row: false,
                col: false,
            },
            range_type,
        }
    }

    /// Create a new `RangeRef` with explicit absoluteness flags.
    ///
    /// Each flag in `abs_start` / `abs_end` controls the `$` prefix for that
    /// component of the reference (e.g. `$A$1:$B$10` has all four set to `true`).
    #[inline]
    pub const fn with_abs(
        start: CellRef,
        end: CellRef,
        range_type: RangeType,
        abs_start: AbsFlags,
        abs_end: AbsFlags,
    ) -> Self {
        Self {
            start,
            end,
            abs_start,
            abs_end,
            range_type,
        }
    }

    /// Builder: set `abs_start.row`.
    #[inline]
    pub const fn with_abs_start_row(mut self, abs: bool) -> Self {
        self.abs_start.row = abs;
        self
    }

    /// Builder: set `abs_start.col`.
    #[inline]
    pub const fn with_abs_start_col(mut self, abs: bool) -> Self {
        self.abs_start.col = abs;
        self
    }

    /// Builder: set `abs_end.row`.
    #[inline]
    pub const fn with_abs_end_row(mut self, abs: bool) -> Self {
        self.abs_end.row = abs;
        self
    }

    /// Builder: set `abs_end.col`.
    #[inline]
    pub const fn with_abs_end_col(mut self, abs: bool) -> Self {
        self.abs_end.col = abs;
        self
    }

    /// Validate that both corners of the range are on the same sheet.
    ///
    /// Returns the common `SheetId` if both refs are positional and on the same sheet,
    /// or `None` if the refs are resolved (CellId-based) or on different sheets.
    /// Callers can use this for early validation instead of waiting for a runtime #REF!.
    #[must_use]
    pub fn same_sheet(&self) -> Option<SheetId> {
        match (&self.start, &self.end) {
            (CellRef::Positional { sheet: s1, .. }, CellRef::Positional { sheet: s2, .. }) => {
                if s1 == s2 { Some(*s1) } else { None }
            }
            _ => None, // Can't determine from Resolved refs without mirror
        }
    }
}

/// AST node — the parsed representation of a formula.
///
/// # Examples
///
/// Pattern-match on the parsed AST to inspect its structure:
///
/// ```
/// use compute_parser::{parse_formula, ASTNode, BinOp};
///
/// let ast = parse_formula("=SUM(A1:B10)+1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::BinaryOp { op: BinOp::Add, left, right } => {
///         // left is a SUM function call, right is a number
///         assert!(matches!(*left, ASTNode::Function { .. }));
///         assert!(matches!(*right, ASTNode::Number(1.0)));
///     }
///     _ => panic!("expected binary add"),
/// }
/// ```
///
/// Literals parse to the expected variants:
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let ast = parse_formula("=\"hello\"", None).unwrap().into_inner();
/// assert_eq!(ast, ASTNode::Text("hello".to_string()));
///
/// let ast = parse_formula("=TRUE", None).unwrap().into_inner();
/// assert_eq!(ast, ASTNode::Boolean(true));
/// ```
#[must_use = "parsed AST nodes should be used"]
#[derive(Debug, Clone, PartialEq)]
pub enum ASTNode {
    /// Numeric literal: `42`, `3.14`, `1e10`
    Number(f64),
    /// String literal: `"hello"`
    Text(String),
    /// Boolean literal: `TRUE`, `FALSE`
    Boolean(bool),
    /// Error literal: `#DIV/0!`, `#N/A`, etc.
    Error(CellError),
    /// Cell reference: `A1`, `$A$1`, `A$1`, `$A1`
    CellReference(CellRefNode),
    /// Range reference: `A1:B10`, `A:C`, `1:5`
    Range(RangeRef),
    /// Sheet-qualified reference (resolved): `Sheet1!A1`
    SheetRef { sheet: SheetId, inner: Box<Self> },
    /// Sheet-qualified reference (unresolved): when resolver can't find the sheet
    UnresolvedSheetRef {
        sheet_name: String,
        inner: Box<Self>,
    },
    /// 3-D reference across a sheet range (resolved): `Sheet1:Sheet3!A1`
    ///
    /// Covers every sheet from `start_sheet` to `end_sheet` inclusive, in
    /// workbook order. `inner` holds the cell/range reference on each sheet.
    ThreeDRef {
        start_sheet: SheetId,
        end_sheet: SheetId,
        inner: Box<Self>,
    },
    /// 3-D reference across a sheet range (unresolved): one or both sheet
    /// names could not be resolved at parse time.
    UnresolvedThreeDRef {
        start_name: String,
        end_name: String,
        inner: Box<Self>,
    },
    /// External workbook sheet reference preserving workbook token syntax.
    ExternalSheetRef {
        workbook: ExternalWorkbookToken,
        sheet_name: String,
        inner: Box<Self>,
    },
    /// External workbook 3-D reference preserving workbook token syntax.
    ExternalThreeDRef {
        workbook: ExternalWorkbookToken,
        start_sheet: String,
        end_sheet: String,
        inner: Box<Self>,
    },
    /// External workbook defined-name reference preserving workbook token syntax.
    ExternalNameRef {
        workbook: ExternalWorkbookToken,
        name: String,
    },
    /// Structured (table) reference: `Table1[Col]`, `Table1[[#Data],[Col1]:[Col2]]`
    StructuredRef(formula_types::StructuredRef),
    /// Binary operation: `A1 + B1`, `C1 * 2`
    BinaryOp {
        op: BinOp,
        left: Box<Self>,
        right: Box<Self>,
    },
    /// Unary operation: `-A1`, `+5`, `50%`
    UnaryOp { op: UnaryOp, operand: Box<Self> },
    /// Function call: `SUM(A1:B10)`, `IF(A1>0,1,0)`
    Function {
        name: Cow<'static, str>,
        args: Vec<Self>,
    },
    /// Parenthesized expression: `(A1+B1)`
    Paren(Box<Self>),
    /// Identifier (named range, LET/LAMBDA variable, etc.)
    Identifier(String),
    /// Bracketed optional LAMBDA parameter declaration, e.g. `[value]`.
    OptionalLambdaParam(String),
    /// Array literal: `{1,2;3,4}`
    Array { rows: Vec<Vec<Self>> },
    /// Call expression: `(LAMBDA(x, x+1))(5)` or `myFunc(3, 4)` where callee is an expression
    CallExpression { callee: Box<Self>, args: Vec<Self> },
    /// Omitted function argument: e.g. the trailing comma in `VLOOKUP(A1,B:D,3,)`
    /// Evaluates to 0.0 by default but allows functions to detect omitted vs explicit 0.
    Omitted,
    /// Expression-level range operator: `INDEX(A1:B5,1,1):INDEX(A1:B5,1,2)`
    ///
    /// Excel's `:` operator works between any two cell-returning expressions,
    /// not just literal cell references. When both sides are literal refs, the
    /// parser produces `ASTNode::Range` instead (faster common path). This node
    /// is only produced when at least one side is a non-literal expression
    /// (e.g. `INDEX()`, `OFFSET()`).
    RangeOp { start: Box<Self>, end: Box<Self> },
    /// Union of multiple ranges: `(A1:A5,C1:C5)`
    ///
    /// Excel's union operator uses a comma inside parenthesized range contexts.
    /// The comma already serves as the function argument separator; the parser
    /// disambiguates by treating comma as union when it appears inside
    /// parenthesized expressions (not function argument lists) where the first
    /// expression is a range-like node.
    ///
    /// Union has the lowest precedence of any range operator.
    Union { ranges: Vec<Self> },
}

impl std::fmt::Display for BinOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Add => write!(f, "+"),
            Self::Sub => write!(f, "-"),
            Self::Mul => write!(f, "*"),
            Self::Div => write!(f, "/"),
            Self::Pow => write!(f, "^"),
            Self::Concat => write!(f, "&"),
            Self::Eq => write!(f, "="),
            Self::Neq => write!(f, "<>"),
            Self::Lt => write!(f, "<"),
            Self::Gt => write!(f, ">"),
            Self::Lte => write!(f, "<="),
            Self::Gte => write!(f, ">="),
            Self::Intersect => write!(f, " "),
        }
    }
}

impl std::fmt::Display for UnaryOp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Plus => write!(f, "+"),
            Self::Minus => write!(f, "-"),
            Self::Percent => write!(f, "%"),
            Self::ImplicitIntersection => write!(f, "@"),
        }
    }
}

// LambdaNode implementation — allows EvalValue::Lambda to hold a type-erased ASTNode.
// Only eval/evaluator.rs downcasts back to ASTNode (2 sites).
impl value_types::LambdaNode for ASTNode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/// Format a cell reference as `A1`, `$A$1`, etc.
fn format_cell_ref(
    f: &mut std::fmt::Formatter<'_>,
    reference: &CellRef,
    abs_row: bool,
    abs_col: bool,
) -> std::fmt::Result {
    match reference {
        CellRef::Positional { row, col, .. } => {
            if abs_col {
                write!(f, "$")?;
            }
            write!(f, "{}", col_to_letter(*col))?;
            if abs_row {
                write!(f, "$")?;
            }
            write!(f, "{}", row + 1)
        }
        CellRef::Resolved(_cell_id) => {
            // Resolved refs don't carry row/col — best-effort fallback.
            write!(f, "<resolved>")
        }
    }
}

/// Format a range reference: `A1:B10`, `A:C`, `1:5`.
fn format_range(
    f: &mut std::fmt::Formatter<'_>,
    start: &CellRef,
    end: &CellRef,
    abs_start: AbsFlags,
    abs_end: AbsFlags,
    range_type: RangeType,
) -> std::fmt::Result {
    match range_type {
        RangeType::CellRange => {
            format_cell_ref(f, start, abs_start.row, abs_start.col)?;
            write!(f, ":")?;
            format_cell_ref(f, end, abs_end.row, abs_end.col)
        }
        RangeType::ColumnRange => {
            // Column-only range: A:C
            if let (CellRef::Positional { col: sc, .. }, CellRef::Positional { col: ec, .. }) =
                (start, end)
            {
                if abs_start.col {
                    write!(f, "$")?;
                }
                write!(f, "{}", col_to_letter(*sc))?;
                write!(f, ":")?;
                if abs_end.col {
                    write!(f, "$")?;
                }
                write!(f, "{}", col_to_letter(*ec))?;
                return Ok(());
            }
            write!(f, "<col-range>")
        }
        RangeType::RowRange => {
            // Row-only range: 1:5
            if let (CellRef::Positional { row: sr, .. }, CellRef::Positional { row: er, .. }) =
                (start, end)
            {
                if abs_start.row {
                    write!(f, "$")?;
                }
                write!(f, "{}", sr + 1)?;
                write!(f, ":")?;
                if abs_end.row {
                    write!(f, "$")?;
                }
                write!(f, "{}", er + 1)?;
                return Ok(());
            }
            write!(f, "<row-range>")
        }
        _ => write!(f, "<range>"),
    }
}

/// Whether a sheet name needs single-quote quoting in formulas.
///
/// Returns `true` if a sheet name requires single-quote delimiters in A1 notation.
/// A name needs quoting if it:
/// - Is empty
/// - Starts with a digit
/// - Starts with a non-alphabetic, non-underscore character
/// - Contains any character that is not alphanumeric or underscore
///
/// This matches Excel's quoting rules for sheet name references.
///
/// # Examples
///
/// ```
/// use compute_parser::needs_quoting;
///
/// assert!(!needs_quoting("Sheet1"));       // simple name — no quoting
/// assert!(needs_quoting("My Sheet"));      // contains space
/// assert!(needs_quoting("D&A_BUILD"));     // contains &
/// assert!(needs_quoting(""));              // empty name
/// ```
#[must_use]
pub fn needs_quoting(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }
    let first = name.as_bytes()[0];
    // First char must be ASCII letter or underscore
    if first.is_ascii_digit() || (!first.is_ascii_alphabetic() && first != b'_') {
        return true;
    }
    // Remaining chars must be alphanumeric or underscore.
    // `name[1..]` — byte 0 is the verified ASCII letter/underscore above,
    // so `[1..]` is at a char boundary. `.bytes()` scans the full UTF-8
    // sequence (non-ASCII bytes will fail the ascii predicates and return
    // true, which is the correct "needs quoting" answer).
    #[allow(clippy::string_slice)]
    let rest = &name[1..];
    rest.bytes()
        .any(|b| !b.is_ascii_alphanumeric() && b != b'_')
}

/// Format a structured reference directly to a formatter.
fn format_structured_ref(f: &mut fmt::Formatter<'_>, sr: &StructuredRef) -> fmt::Result {
    write!(f, "{}[", sr.table_name)?;
    let specs = &sr.specifiers;
    if specs.len() == 1 {
        // Simple form: Table1[Col] or Table1[[#Headers]]
        format_specifier(f, &specs[0])?;
    } else {
        // Multiple specifiers: Table1[[#Headers],[Col1]:[Col2]]
        for (i, spec) in specs.iter().enumerate() {
            if i > 0 {
                write!(f, ",")?;
            }
            format_specifier(f, spec)?;
        }
    }
    write!(f, "]")
}

fn format_specifier(f: &mut fmt::Formatter<'_>, spec: &StructuredRefSpecifier) -> fmt::Result {
    match spec {
        StructuredRefSpecifier::Column { name } => {
            write!(f, "[{name}]")
        }
        StructuredRefSpecifier::ColumnRange { start, end } => {
            write!(f, "[{start}]:[{end}]")
        }
        StructuredRefSpecifier::ThisRow => {
            write!(f, "[#This Row]")
        }
        StructuredRefSpecifier::Special { item } => match item {
            SpecialItem::All => write!(f, "[#All]"),
            SpecialItem::Data => write!(f, "[#Data]"),
            SpecialItem::Headers => write!(f, "[#Headers]"),
            SpecialItem::Totals => write!(f, "[#Totals]"),
            SpecialItem::ThisRow => write!(f, "[#This Row]"),
        },
    }
}

// ---------------------------------------------------------------------------
// Display for ASTNode
// ---------------------------------------------------------------------------

/// Debug/test display for AST nodes.
///
/// **Note:** This `Display` impl is intended for debugging and round-trip tests
/// on *unresolved* ASTs only. Resolved ASTs (containing `SheetRef` with `SheetId`
/// or `CellRef::Resolved`) produce unparseable output like `Sheet(UUID)!A1`.
/// For production formula display, use [`crate::a1_display::to_a1_string`] instead.
#[allow(clippy::too_many_lines)]
#[allow(clippy::float_cmp)] // intentional: checking if float is whole number
impl std::fmt::Display for ASTNode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(n) => {
                if n.is_nan() {
                    write!(f, "#NUM!")
                } else if n.is_infinite() {
                    if *n > 0.0 {
                        write!(f, "1E+308")
                    } else {
                        write!(f, "-1E+308")
                    }
                } else if *n == 0.0 {
                    // Handles both 0.0 and -0.0
                    write!(f, "0")
                } else if *n == n.floor() && n.abs() < 1e15 {
                    #[allow(clippy::cast_possible_truncation)] // value is < 1e15, fits in i64
                    let int_val = *n as i64;
                    write!(f, "{int_val}")
                } else {
                    write!(f, "{n}")
                }
            }
            Self::Text(s) => {
                write!(f, "\"")?;
                let mut first = true;
                for part in s.split('"') {
                    if !first {
                        write!(f, "\"\"")?;
                    }
                    first = false;
                    f.write_str(part)?;
                }
                write!(f, "\"")
            }
            Self::Boolean(b) => {
                write!(f, "{}", if *b { "TRUE" } else { "FALSE" })
            }
            Self::Error(e) => write!(f, "{e}"),
            Self::CellReference(c) => format_cell_ref(f, &c.reference, c.abs_row, c.abs_col),
            Self::Range(r) => {
                format_range(f, &r.start, &r.end, r.abs_start, r.abs_end, r.range_type)
            }
            Self::SheetRef { sheet, inner } => {
                // Resolved SheetId — we don't have the name, so emit the UUID.
                write!(f, "Sheet({sheet})!")?;
                write!(f, "{inner}")
            }
            Self::UnresolvedSheetRef { sheet_name, inner } => {
                if needs_quoting(sheet_name) {
                    write!(f, "'{}'!", sheet_name.replace('\'', "''"))?;
                } else {
                    write!(f, "{sheet_name}!")?;
                }
                write!(f, "{inner}")
            }
            Self::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => {
                write!(f, "Sheet({start_sheet}):Sheet({end_sheet})!")?;
                write!(f, "{inner}")
            }
            Self::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => {
                let start_q = needs_quoting(start_name);
                let end_q = needs_quoting(end_name);
                if start_q || end_q {
                    write!(f, "'{}':", start_name.replace('\'', "''"))?;
                    write!(f, "'{}'!", end_name.replace('\'', "''"))?;
                } else {
                    write!(f, "{start_name}:{end_name}!")?;
                }
                write!(f, "{inner}")
            }
            Self::ExternalSheetRef {
                workbook,
                sheet_name,
                inner,
            } => {
                write!(
                    f,
                    "'{}{}'!{inner}",
                    workbook.as_str().replace('\'', "''"),
                    sheet_name.replace('\'', "''")
                )
            }
            Self::ExternalThreeDRef {
                workbook,
                start_sheet,
                end_sheet,
                inner,
            } => write!(
                f,
                "'{}{}:{}'!{inner}",
                workbook.as_str().replace('\'', "''"),
                start_sheet.replace('\'', "''"),
                end_sheet.replace('\'', "''")
            ),
            Self::ExternalNameRef { workbook, name } => {
                write!(f, "{}{}", workbook.as_str(), name)
            }
            Self::StructuredRef(sr) => format_structured_ref(f, sr),
            Self::BinaryOp { op, left, right } => {
                write!(f, "{left}{op}{right}")
            }
            Self::UnaryOp { op, operand } => match op {
                UnaryOp::Percent => write!(f, "{operand}%"),
                UnaryOp::Plus => write!(f, "+{operand}"),
                UnaryOp::Minus => write!(f, "-{operand}"),
                UnaryOp::ImplicitIntersection => write!(f, "@{operand}"),
            },
            Self::Function { name, args } => {
                write!(f, "{name}(")?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{arg}")?;
                }
                write!(f, ")")
            }
            Self::Paren(inner) => write!(f, "({inner})"),
            Self::Identifier(name) => write!(f, "{name}"),
            Self::OptionalLambdaParam(name) => write!(f, "[{name}]"),
            Self::Array { rows } => {
                write!(f, "{{")?;
                for (i, row) in rows.iter().enumerate() {
                    if i > 0 {
                        write!(f, ";")?;
                    }
                    for (j, elem) in row.iter().enumerate() {
                        if j > 0 {
                            write!(f, ",")?;
                        }
                        write!(f, "{elem}")?;
                    }
                }
                write!(f, "}}")
            }
            Self::CallExpression { callee, args } => {
                write!(f, "{callee}(")?;
                for (i, arg) in args.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{arg}")?;
                }
                write!(f, ")")
            }
            Self::Omitted => Ok(()),
            Self::RangeOp { start, end } => write!(f, "{start}:{end}"),
            Self::Union { ranges } => {
                write!(f, "(")?;
                for (i, range) in ranges.iter().enumerate() {
                    if i > 0 {
                        write!(f, ",")?;
                    }
                    write!(f, "{range}")?;
                }
                write!(f, ")")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;

    fn pos(row: u32, col: u32) -> CellRef {
        CellRef::positional(SheetId::from_raw(0), row, col)
    }

    #[test]
    fn test_display_number_integer() {
        assert_eq!(format!("{}", ASTNode::Number(42.0)), "42");
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn test_display_number_float() {
        assert_eq!(format!("{}", ASTNode::Number(3.14)), "3.14");
    }

    #[test]
    fn test_display_number_negative_integer() {
        assert_eq!(format!("{}", ASTNode::Number(-7.0)), "-7");
    }

    #[test]
    fn test_display_text_simple() {
        assert_eq!(
            format!("{}", ASTNode::Text("hello".to_string())),
            "\"hello\""
        );
    }

    #[test]
    fn test_display_text_with_quotes() {
        assert_eq!(
            format!("{}", ASTNode::Text("say \"hi\"".to_string())),
            "\"say \"\"hi\"\"\""
        );
    }

    #[test]
    fn test_display_text_empty() {
        assert_eq!(format!("{}", ASTNode::Text(String::new())), "\"\"");
    }

    #[test]
    fn test_display_boolean() {
        assert_eq!(format!("{}", ASTNode::Boolean(true)), "TRUE");
        assert_eq!(format!("{}", ASTNode::Boolean(false)), "FALSE");
    }

    #[test]
    fn test_display_errors() {
        assert_eq!(format!("{}", ASTNode::Error(CellError::Div0)), "#DIV/0!");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Na)), "#N/A");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Ref)), "#REF!");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Value)), "#VALUE!");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Name)), "#NAME?");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Null)), "#NULL!");
        assert_eq!(format!("{}", ASTNode::Error(CellError::Num)), "#NUM!");
    }

    #[test]
    fn test_display_cell_ref_a1() {
        let node = ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: false,
        });
        assert_eq!(format!("{node}"), "A1");
    }

    #[test]
    fn test_display_cell_ref_absolute() {
        let node = ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: true,
            abs_col: true,
        });
        assert_eq!(format!("{node}"), "$A$1");
    }

    #[test]
    fn test_display_cell_ref_mixed() {
        let abs_col = ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: false,
            abs_col: true,
        });
        assert_eq!(format!("{abs_col}"), "$A1");

        let abs_row = ASTNode::CellReference(CellRefNode {
            reference: pos(0, 0),
            abs_row: true,
            abs_col: false,
        });
        assert_eq!(format!("{abs_row}"), "A$1");
    }

    #[test]
    fn test_display_cell_ref_b2() {
        let node = ASTNode::CellReference(CellRefNode {
            reference: pos(1, 1),
            abs_row: false,
            abs_col: false,
        });
        assert_eq!(format!("{node}"), "B2");
    }

    #[test]
    fn test_display_cell_ref_aa100() {
        let node = ASTNode::CellReference(CellRefNode {
            reference: pos(99, 26),
            abs_row: false,
            abs_col: false,
        });
        assert_eq!(format!("{node}"), "AA100");
    }

    #[test]
    fn test_display_range_cell() {
        let node = ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(9, 1),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        });
        assert_eq!(format!("{node}"), "A1:B10");
    }

    #[test]
    fn test_display_range_cell_absolute() {
        let node = ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(9, 1),
            abs_start: AbsFlags {
                row: true,
                col: true,
            },

            abs_end: AbsFlags {
                row: true,
                col: true,
            },
            range_type: RangeType::CellRange,
        });
        assert_eq!(format!("{node}"), "$A$1:$B$10");
    }

    #[test]
    fn test_display_range_column() {
        let node = ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(0, 2),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::ColumnRange,
        });
        assert_eq!(format!("{node}"), "A:C");
    }

    #[test]
    fn test_display_range_row() {
        let node = ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(4, 0),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::RowRange,
        });
        assert_eq!(format!("{node}"), "1:5");
    }

    #[test]
    fn test_display_unresolved_sheet_ref() {
        let node = ASTNode::UnresolvedSheetRef {
            sheet_name: "Sheet1".to_string(),
            inner: Box::new(ASTNode::CellReference(CellRefNode {
                reference: pos(0, 0),
                abs_row: false,
                abs_col: false,
            })),
        };
        assert_eq!(format!("{node}"), "Sheet1!A1");
    }

    #[test]
    fn test_display_unresolved_sheet_ref_quoted() {
        let node = ASTNode::UnresolvedSheetRef {
            sheet_name: "My Sheet".to_string(),
            inner: Box::new(ASTNode::CellReference(CellRefNode {
                reference: pos(0, 0),
                abs_row: false,
                abs_col: false,
            })),
        };
        assert_eq!(format!("{node}"), "'My Sheet'!A1");
    }

    #[test]
    fn test_display_sheet_ref_resolved() {
        let node = ASTNode::SheetRef {
            sheet: SheetId::from_raw(1),
            inner: Box::new(ASTNode::CellReference(CellRefNode {
                reference: pos(0, 0),
                abs_row: false,
                abs_col: false,
            })),
        };
        let s = format!("{node}");
        assert!(s.contains('!'));
        assert!(s.ends_with("A1"));
    }

    #[test]
    fn test_display_structured_ref_simple() {
        let sr = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![StructuredRefSpecifier::Column {
                name: "Col1".to_string(),
            }],
        };
        assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "Table1[[Col1]]");
    }

    #[test]
    fn test_display_structured_ref_with_specifiers() {
        let sr = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers,
                },
                StructuredRefSpecifier::Column {
                    name: "Col1".to_string(),
                },
            ],
        };
        assert_eq!(
            format!("{}", ASTNode::StructuredRef(sr)),
            "Table1[[#Headers],[Col1]]"
        );
    }

    #[test]
    fn test_display_structured_ref_column_range() {
        let sr = StructuredRef {
            table_name: "Table1".to_string(),
            specifiers: vec![StructuredRefSpecifier::ColumnRange {
                start: "Col1".to_string(),
                end: "Col2".to_string(),
            }],
        };
        assert_eq!(
            format!("{}", ASTNode::StructuredRef(sr)),
            "Table1[[Col1]:[Col2]]"
        );
    }

    #[test]
    fn test_display_binary_op() {
        let node = ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        };
        assert_eq!(format!("{node}"), "1+2");
    }

    #[test]
    fn test_display_binary_op_nested() {
        let node = ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::BinaryOp {
                op: BinOp::Mul,
                left: Box::new(ASTNode::Number(2.0)),
                right: Box::new(ASTNode::Number(3.0)),
            }),
        };
        assert_eq!(format!("{node}"), "1+2*3");
    }

    #[test]
    fn test_display_unary_minus() {
        let node = ASTNode::UnaryOp {
            op: UnaryOp::Minus,
            operand: Box::new(ASTNode::Number(5.0)),
        };
        assert_eq!(format!("{node}"), "-5");
    }

    #[test]
    fn test_display_unary_plus() {
        let node = ASTNode::UnaryOp {
            op: UnaryOp::Plus,
            operand: Box::new(ASTNode::Number(5.0)),
        };
        assert_eq!(format!("{node}"), "+5");
    }

    #[test]
    fn test_display_unary_percent() {
        let node = ASTNode::UnaryOp {
            op: UnaryOp::Percent,
            operand: Box::new(ASTNode::Number(50.0)),
        };
        assert_eq!(format!("{node}"), "50%");
    }

    #[test]
    fn test_display_function() {
        let node = ASTNode::Function {
            name: "SUM".into(),
            args: vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
        };
        assert_eq!(format!("{node}"), "SUM(1,2)");
    }

    #[test]
    fn test_display_function_no_args() {
        let node = ASTNode::Function {
            name: "NOW".into(),
            args: vec![],
        };
        assert_eq!(format!("{node}"), "NOW()");
    }

    #[test]
    fn test_display_paren() {
        let node = ASTNode::Paren(Box::new(ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }));
        assert_eq!(format!("{node}"), "(1+2)");
    }

    #[test]
    fn test_display_identifier() {
        assert_eq!(
            format!("{}", ASTNode::Identifier("myRange".to_string())),
            "myRange"
        );
    }

    #[test]
    fn test_display_array() {
        let node = ASTNode::Array {
            rows: vec![
                vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
                vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
            ],
        };
        assert_eq!(format!("{node}"), "{1,2;3,4}");
    }

    #[test]
    fn test_display_call_expression() {
        let node = ASTNode::CallExpression {
            callee: Box::new(ASTNode::Identifier("myFunc".to_string())),
            args: vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        };
        assert_eq!(format!("{node}"), "myFunc(3,4)");
    }

    #[test]
    fn test_display_omitted() {
        assert_eq!(format!("{}", ASTNode::Omitted), "");
    }

    #[test]
    fn test_display_round_trip_corpus() {
        use crate::parse_formula;
        let formulas = vec![
            "42",
            "3.14",
            "\"hello\"",
            "\"say \"\"hi\"\"\"",
            "\"\"",
            "TRUE",
            "FALSE",
            "#DIV/0!",
            "#N/A",
            "#REF!",
            "#VALUE!",
            "#NAME?",
            "#NULL!",
            "#NUM!",
            "A1",
            "$A$1",
            "A$1",
            "$A1",
            "B2",
            "AA100",
            "A1:B10",
            "$A$1:$B$10",
            "A:C",
            "1:5",
            "1+2",
            "1+2*3",
            "2^3^4",
            "-5",
            "+5",
            "50%",
            "\"a\"&\"b\"",
            "SUM(A1:B10)",
            "IF(A1>0,1,0)",
            "NOW()",
            "(1+2)*3",
            "{1,2;3,4}",
            "{\"hello\",TRUE;1,#N/A}",
            "LAMBDA(x,x+1)",
            "LET(x,10,x+1)",
            // Omitted args
            "IF(A1,,0)",
            "FUNC(,,)",
            // Intersection operator
            "A1:B10 B5:C20",
            // Union operator
            "(A1:A5,C1:C5)",
            "(A1:A5,C1:C5,E1:E5)",
            "SUM((A1:A5,C1:C5))",
        ];
        for formula in &formulas {
            let ast1 = parse_formula(formula, None).unwrap_or_else(|e| {
                panic!("Failed to parse '{formula}': {e}");
            });
            let displayed = format!("{ast1}");
            let ast2 = parse_formula(&displayed, None).unwrap_or_else(|e| {
                panic!("Round-trip failed for '{formula}' -> '{displayed}': {e}");
            });
            assert_eq!(
                ast1, ast2,
                "Round-trip mismatch for '{formula}' -> '{displayed}'"
            );
        }
    }

    // ── Intersection operator (BinOp::Intersect) ────────────────────────

    #[test]
    fn test_intersect_display() {
        assert_eq!(format!("{}", BinOp::Intersect), " ");
    }

    #[test]
    fn test_intersect_ast_construction() {
        // Manually construct what the parser would produce for `A1:B10 B5:C20`
        let node = ASTNode::BinaryOp {
            op: BinOp::Intersect,
            left: Box::new(ASTNode::Range(RangeRef {
                start: pos(0, 0),
                end: pos(9, 1),
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: RangeType::CellRange,
            })),
            right: Box::new(ASTNode::Range(RangeRef {
                start: pos(4, 1),
                end: pos(19, 2),
                abs_start: AbsFlags::default(),
                abs_end: AbsFlags::default(),
                range_type: RangeType::CellRange,
            })),
        };
        // Display should show a space between the two ranges
        assert_eq!(format!("{node}"), "A1:B10 B5:C20");
    }

    #[test]
    fn test_intersect_eq_ne() {
        assert_eq!(BinOp::Intersect, BinOp::Intersect);
        assert_ne!(BinOp::Intersect, BinOp::Add);
    }
}
