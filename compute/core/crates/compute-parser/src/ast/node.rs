use std::borrow::Cow;

use cell_types::SheetId;
use formula_types::ExternalWorkbookToken;
use value_types::CellError;

use super::{BinOp, CellRefNode, RangeRef, UnaryOp};

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

// Allows EvalValue::Lambda to hold a type-erased ASTNode.
impl value_types::LambdaNode for ASTNode {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
