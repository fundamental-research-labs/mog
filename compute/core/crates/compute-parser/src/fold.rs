//! Owned AST transformation via the fold pattern.
//!
//! [`AstFold`] provides default implementations that rebuild the tree
//! unchanged while recursing into children. Consumers override only the
//! `fold_*` methods for nodes they want to transform.

use std::borrow::Cow;

use cell_types::SheetId;
use formula_types::StructuredRef;
use value_types::CellError;

use crate::ast::{ASTNode, BinOp, CellRefNode, RangeRef, UnaryOp};

/// Owned AST transformation with default identity-rebuild implementations.
///
/// Override specific `fold_*` methods to transform nodes of interest.
/// Default implementations reconstruct the node unchanged while recursing
/// into children via `self.fold()`.
///
/// # Examples
///
/// Negate every numeric literal in a formula:
///
/// ```
/// use compute_parser::{parse_formula, AstFold, ASTNode};
///
/// struct Negator;
///
/// impl AstFold for Negator {
///     fn fold_number(&mut self, n: f64) -> ASTNode {
///         ASTNode::Number(-n)
///     }
/// }
///
/// let ast = parse_formula("=1+2", None).unwrap().into_inner();
/// let negated = Negator.fold(ast);
/// // Both 1 and 2 are now negated in the tree
/// match negated {
///     ASTNode::BinaryOp { left, right, .. } => {
///         assert_eq!(*left, ASTNode::Number(-1.0));
///         assert_eq!(*right, ASTNode::Number(-2.0));
///     }
///     _ => panic!("expected binary op"),
/// }
/// ```
#[allow(unused_variables)]
pub trait AstFold {
    /// Top-level dispatch — routes to the appropriate `fold_*` method.
    fn fold(&mut self, node: ASTNode) -> ASTNode {
        match node {
            ASTNode::Number(n) => self.fold_number(n),
            ASTNode::Text(s) => self.fold_text(s),
            ASTNode::Boolean(b) => self.fold_boolean(b),
            ASTNode::Error(e) => self.fold_error(e),
            ASTNode::CellReference(r) => self.fold_cell_ref(r),
            ASTNode::Range(r) => self.fold_range(r),
            ASTNode::SheetRef { sheet, inner } => self.fold_sheet_ref(sheet, *inner),
            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                self.fold_unresolved_sheet_ref(sheet_name, *inner)
            }
            ASTNode::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => self.fold_three_d_ref(start_sheet, end_sheet, *inner),
            ASTNode::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => self.fold_unresolved_three_d_ref(start_name, end_name, *inner),
            ASTNode::ExternalSheetRef {
                workbook,
                sheet_name,
                inner,
            } => self.fold_external_sheet_ref(workbook, sheet_name, *inner),
            ASTNode::ExternalThreeDRef {
                workbook,
                start_sheet,
                end_sheet,
                inner,
            } => self.fold_external_three_d_ref(workbook, start_sheet, end_sheet, *inner),
            ASTNode::ExternalNameRef { workbook, name } => {
                self.fold_external_name_ref(workbook, name)
            }
            ASTNode::StructuredRef(r) => self.fold_structured_ref(r),
            ASTNode::BinaryOp { op, left, right } => self.fold_binary_op(op, *left, *right),
            ASTNode::UnaryOp { op, operand } => self.fold_unary_op(op, *operand),
            ASTNode::Function { name, args } => self.fold_function(name, args),
            ASTNode::Paren(inner) => self.fold_paren(*inner),
            ASTNode::Identifier(name) => self.fold_identifier(name),
            ASTNode::OptionalLambdaParam(name) => self.fold_optional_lambda_param(name),
            ASTNode::Array { rows } => self.fold_array(rows),
            ASTNode::CallExpression { callee, args } => self.fold_call_expr(*callee, args),
            ASTNode::Omitted => self.fold_omitted(),
            ASTNode::RangeOp { start, end } => self.fold_range_op(*start, *end),
            ASTNode::Union { ranges } => self.fold_union(ranges),
        }
    }

    // ── Leaf nodes (default: identity) ──────────────────────────────

    fn fold_number(&mut self, n: f64) -> ASTNode {
        ASTNode::Number(n)
    }
    fn fold_text(&mut self, s: String) -> ASTNode {
        ASTNode::Text(s)
    }
    fn fold_boolean(&mut self, b: bool) -> ASTNode {
        ASTNode::Boolean(b)
    }
    fn fold_error(&mut self, e: CellError) -> ASTNode {
        ASTNode::Error(e)
    }
    fn fold_cell_ref(&mut self, r: CellRefNode) -> ASTNode {
        ASTNode::CellReference(r)
    }
    fn fold_range(&mut self, r: RangeRef) -> ASTNode {
        ASTNode::Range(r)
    }
    fn fold_structured_ref(&mut self, r: StructuredRef) -> ASTNode {
        ASTNode::StructuredRef(r)
    }
    fn fold_identifier(&mut self, name: String) -> ASTNode {
        ASTNode::Identifier(name)
    }
    fn fold_optional_lambda_param(&mut self, name: String) -> ASTNode {
        ASTNode::OptionalLambdaParam(name)
    }
    fn fold_omitted(&mut self) -> ASTNode {
        ASTNode::Omitted
    }

    // ── Branch nodes (default: rebuild with folded children) ────────

    fn fold_sheet_ref(&mut self, sheet: SheetId, inner: ASTNode) -> ASTNode {
        ASTNode::SheetRef {
            sheet,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_unresolved_sheet_ref(&mut self, name: String, inner: ASTNode) -> ASTNode {
        ASTNode::UnresolvedSheetRef {
            sheet_name: name,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_three_d_ref(
        &mut self,
        start_sheet: SheetId,
        end_sheet: SheetId,
        inner: ASTNode,
    ) -> ASTNode {
        ASTNode::ThreeDRef {
            start_sheet,
            end_sheet,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_unresolved_three_d_ref(
        &mut self,
        start_name: String,
        end_name: String,
        inner: ASTNode,
    ) -> ASTNode {
        ASTNode::UnresolvedThreeDRef {
            start_name,
            end_name,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_external_sheet_ref(
        &mut self,
        workbook: formula_types::ExternalWorkbookToken,
        sheet_name: String,
        inner: ASTNode,
    ) -> ASTNode {
        ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_external_three_d_ref(
        &mut self,
        workbook: formula_types::ExternalWorkbookToken,
        start_sheet: String,
        end_sheet: String,
        inner: ASTNode,
    ) -> ASTNode {
        ASTNode::ExternalThreeDRef {
            workbook,
            start_sheet,
            end_sheet,
            inner: Box::new(self.fold(inner)),
        }
    }

    fn fold_external_name_ref(
        &mut self,
        workbook: formula_types::ExternalWorkbookToken,
        name: String,
    ) -> ASTNode {
        ASTNode::ExternalNameRef { workbook, name }
    }

    fn fold_binary_op(&mut self, op: BinOp, left: ASTNode, right: ASTNode) -> ASTNode {
        ASTNode::BinaryOp {
            op,
            left: Box::new(self.fold(left)),
            right: Box::new(self.fold(right)),
        }
    }

    fn fold_unary_op(&mut self, op: UnaryOp, operand: ASTNode) -> ASTNode {
        ASTNode::UnaryOp {
            op,
            operand: Box::new(self.fold(operand)),
        }
    }

    fn fold_function(&mut self, name: Cow<'static, str>, args: Vec<ASTNode>) -> ASTNode {
        ASTNode::Function {
            name,
            args: args.into_iter().map(|a| self.fold(a)).collect(),
        }
    }

    fn fold_paren(&mut self, inner: ASTNode) -> ASTNode {
        ASTNode::Paren(Box::new(self.fold(inner)))
    }

    fn fold_array(&mut self, rows: Vec<Vec<ASTNode>>) -> ASTNode {
        ASTNode::Array {
            rows: rows
                .into_iter()
                .map(|r| r.into_iter().map(|e| self.fold(e)).collect())
                .collect(),
        }
    }

    fn fold_call_expr(&mut self, callee: ASTNode, args: Vec<ASTNode>) -> ASTNode {
        ASTNode::CallExpression {
            callee: Box::new(self.fold(callee)),
            args: args.into_iter().map(|a| self.fold(a)).collect(),
        }
    }

    fn fold_range_op(&mut self, start: ASTNode, end: ASTNode) -> ASTNode {
        ASTNode::RangeOp {
            start: Box::new(self.fold(start)),
            end: Box::new(self.fold(end)),
        }
    }

    fn fold_union(&mut self, ranges: Vec<ASTNode>) -> ASTNode {
        ASTNode::Union {
            ranges: ranges.into_iter().map(|r| self.fold(r)).collect(),
        }
    }
}
