//! Read-only AST traversal via the visitor pattern.
//!
//! [`AstVisitor`] provides default implementations that perform correct
//! full-tree recursion. Consumers override only the `visit_*` methods for
//! nodes they care about, eliminating per-site boilerplate.

use cell_types::SheetId;
use formula_types::StructuredRef;
use value_types::CellError;

use crate::ast::{ASTNode, BinOp, CellRefNode, RangeRef, UnaryOp};

/// Read-only AST traversal with default child-walking implementations.
///
/// Override specific `visit_*` methods to inspect nodes of interest.
/// The default branch-node implementations recurse into all children via
/// `self.visit()`, so an empty impl walks the entire tree.
///
/// # Short-circuiting
///
/// For visitors that need early exit (e.g. "does the tree contain X?"),
/// have the `visit_*` override set a flag, then check it at the top of
/// `visit` by overriding `visit` itself:
///
/// ```ignore
/// fn visit(&mut self, node: &ASTNode) {
///     if self.found { return; }   // short-circuit
///     self.walk(node);            // default dispatch
/// }
/// ```
///
/// # Examples
///
/// Count how many cell references appear in a formula:
///
/// ```
/// use compute_parser::{parse_formula, AstVisitor, ASTNode};
/// use compute_parser::CellRefNode;
///
/// struct RefCounter { count: usize }
///
/// impl AstVisitor for RefCounter {
///     fn visit_cell_ref(&mut self, _r: &CellRefNode) {
///         self.count += 1;
///     }
/// }
///
/// let ast = parse_formula("=A1+B1+C1", None).unwrap().into_inner();
/// let mut counter = RefCounter { count: 0 };
/// counter.visit(&ast);
/// assert_eq!(counter.count, 3);
/// ```
#[allow(unused_variables)]
pub trait AstVisitor {
    /// Top-level dispatch — routes to the appropriate `visit_*` method.
    ///
    /// Override this only if you need short-circuiting or pre/post hooks
    /// around every node. Call `self.walk(node)` to invoke the default
    /// dispatch.
    fn visit(&mut self, node: &ASTNode) {
        self.walk(node);
    }

    /// Default dispatch — matches on the node variant and calls the
    /// corresponding `visit_*` method. This is the "walk" that powers
    /// the default `visit` implementation. Consumers who override `visit`
    /// should call `self.walk(node)` to keep the dispatch working.
    fn walk(&mut self, node: &ASTNode) {
        match node {
            ASTNode::Number(n) => self.visit_number(*n),
            ASTNode::Text(s) => self.visit_text(s),
            ASTNode::Boolean(b) => self.visit_boolean(*b),
            ASTNode::Error(e) => self.visit_error(e),
            ASTNode::CellReference(r) => self.visit_cell_ref(r),
            ASTNode::Range(r) => self.visit_range(r),
            ASTNode::SheetRef { sheet, inner } => self.visit_sheet_ref(sheet, inner),
            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                self.visit_unresolved_sheet_ref(sheet_name, inner);
            }
            ASTNode::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => {
                self.visit_three_d_ref(start_sheet, end_sheet, inner);
            }
            ASTNode::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => {
                self.visit_unresolved_three_d_ref(start_name, end_name, inner);
            }
            ASTNode::ExternalSheetRef {
                workbook,
                sheet_name,
                inner,
            } => self.visit_external_sheet_ref(workbook, sheet_name, inner),
            ASTNode::ExternalThreeDRef {
                workbook,
                start_sheet,
                end_sheet,
                inner,
            } => self.visit_external_three_d_ref(workbook, start_sheet, end_sheet, inner),
            ASTNode::ExternalNameRef { workbook, name } => {
                self.visit_external_name_ref(workbook, name);
            }
            ASTNode::StructuredRef(r) => self.visit_structured_ref(r),
            ASTNode::BinaryOp { op, left, right } => self.visit_binary_op(*op, left, right),
            ASTNode::UnaryOp { op, operand } => self.visit_unary_op(*op, operand),
            ASTNode::Function { name, args } => self.visit_function(name, args),
            ASTNode::Paren(inner) => self.visit_paren(inner),
            ASTNode::Identifier(name) => self.visit_identifier(name),
            ASTNode::OptionalLambdaParam(name) => self.visit_optional_lambda_param(name),
            ASTNode::Array { rows } => self.visit_array(rows),
            ASTNode::CallExpression { callee, args } => self.visit_call_expr(callee, args),
            ASTNode::Omitted => self.visit_omitted(),
            ASTNode::RangeOp { start, end } => self.visit_range_op(start, end),
            ASTNode::Union { ranges } => self.visit_union(ranges),
        }
    }

    // ── Leaf nodes (default: no-op) ─────────────────────────────────

    fn visit_number(&mut self, n: f64) {}
    fn visit_text(&mut self, s: &str) {}
    fn visit_boolean(&mut self, b: bool) {}
    fn visit_error(&mut self, e: &CellError) {}
    fn visit_cell_ref(&mut self, r: &CellRefNode) {}
    fn visit_range(&mut self, r: &RangeRef) {}
    fn visit_structured_ref(&mut self, r: &StructuredRef) {}
    fn visit_identifier(&mut self, name: &str) {}
    fn visit_optional_lambda_param(&mut self, name: &str) {}
    fn visit_omitted(&mut self) {}

    // ── Branch nodes (default: walk children) ───────────────────────

    fn visit_sheet_ref(&mut self, sheet: &SheetId, inner: &ASTNode) {
        self.visit(inner);
    }

    fn visit_unresolved_sheet_ref(&mut self, name: &str, inner: &ASTNode) {
        self.visit(inner);
    }

    fn visit_three_d_ref(&mut self, start_sheet: &SheetId, end_sheet: &SheetId, inner: &ASTNode) {
        self.visit(inner);
    }

    fn visit_unresolved_three_d_ref(&mut self, start_name: &str, end_name: &str, inner: &ASTNode) {
        self.visit(inner);
    }

    fn visit_external_sheet_ref(
        &mut self,
        workbook: &formula_types::ExternalWorkbookToken,
        sheet_name: &str,
        inner: &ASTNode,
    ) {
        self.visit(inner);
    }

    fn visit_external_three_d_ref(
        &mut self,
        workbook: &formula_types::ExternalWorkbookToken,
        start_sheet: &str,
        end_sheet: &str,
        inner: &ASTNode,
    ) {
        self.visit(inner);
    }

    fn visit_external_name_ref(
        &mut self,
        workbook: &formula_types::ExternalWorkbookToken,
        name: &str,
    ) {
    }

    fn visit_binary_op(&mut self, op: BinOp, left: &ASTNode, right: &ASTNode) {
        self.visit(left);
        self.visit(right);
    }

    fn visit_unary_op(&mut self, op: UnaryOp, operand: &ASTNode) {
        self.visit(operand);
    }

    fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
        for arg in args {
            self.visit(arg);
        }
    }

    fn visit_paren(&mut self, inner: &ASTNode) {
        self.visit(inner);
    }

    fn visit_array(&mut self, rows: &[Vec<ASTNode>]) {
        for row in rows {
            for elem in row {
                self.visit(elem);
            }
        }
    }

    fn visit_call_expr(&mut self, callee: &ASTNode, args: &[ASTNode]) {
        self.visit(callee);
        for arg in args {
            self.visit(arg);
        }
    }

    fn visit_range_op(&mut self, start: &ASTNode, end: &ASTNode) {
        self.visit(start);
        self.visit(end);
    }

    fn visit_union(&mut self, ranges: &[ASTNode]) {
        for range in ranges {
            self.visit(range);
        }
    }
}
