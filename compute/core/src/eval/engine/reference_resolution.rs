//! Eval-time reference parsing and sheet patching helpers.

use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use cell_types::{SheetId, col_to_letter};
use compute_parser::{ASTNode, AstFold, CellRefNode, RangeRef};
use formula_types::CellRef;

pub(in crate::eval) fn cell_ref_to_a1(reference: &CellRef) -> String {
    match reference {
        CellRef::Positional { col, row, .. } => {
            format!("{}{}", col_to_letter(*col), row + 1)
        }
        CellRef::Resolved(cell_id) => format!("__resolved_{}", cell_id),
    }
}

struct EvalRefResolver<'a, M: EvalMetadata> {
    meta: &'a M,
}

impl<M: EvalMetadata> compute_parser::CellRefResolver for EvalRefResolver<'_, M> {
    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.meta.sheet_by_name(name)
    }

    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        CellRef::Positional {
            sheet: *sheet,
            row,
            col,
        }
    }

    fn current_sheet(&self) -> SheetId {
        let cell_id = self.meta.current_cell();
        self.meta
            .resolve_position(&cell_id)
            .map(|(sheet, _, _)| sheet)
            .unwrap_or_else(|| SheetId::from_raw(0))
    }
}

pub(super) fn parse_defined_name_formula<M: EvalMetadata>(
    raw_expression: &str,
    meta: &M,
) -> Option<ASTNode> {
    let resolver = EvalRefResolver { meta };
    compute_parser::parse_formula(raw_expression, Some(&resolver))
        .ok()
        .map(|spanned| spanned.into_inner())
}

struct SheetPatcher {
    sheet_id: SheetId,
}

impl SheetPatcher {
    fn patch_cell_ref(cell_ref: &CellRef, sheet_id: SheetId) -> CellRef {
        match cell_ref {
            CellRef::Positional { row, col, .. } => CellRef::Positional {
                sheet: sheet_id,
                row: *row,
                col: *col,
            },
            CellRef::Resolved(id) => CellRef::Resolved(*id),
        }
    }
}

impl AstFold for SheetPatcher {
    fn fold_cell_ref(&mut self, r: CellRefNode) -> ASTNode {
        ASTNode::CellReference(CellRefNode {
            reference: Self::patch_cell_ref(&r.reference, self.sheet_id),
            ..r
        })
    }

    fn fold_range(&mut self, r: RangeRef) -> ASTNode {
        ASTNode::Range(RangeRef {
            start: Self::patch_cell_ref(&r.start, self.sheet_id),
            end: Self::patch_cell_ref(&r.end, self.sheet_id),
            ..r
        })
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) fn resolve_cell_ref_position(
        &self,
        cell_ref: &CellRef,
    ) -> Option<(SheetId, u32, u32)> {
        match cell_ref {
            CellRef::Resolved(id) => self.meta.resolve_position(id),
            CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
        }
    }

    pub(super) fn patch_sheet_id(node: &ASTNode, sheet_id: SheetId) -> ASTNode {
        SheetPatcher { sheet_id }.fold(node.clone())
    }
}
