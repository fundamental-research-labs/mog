use crate::formula_text::FormulaTextDepTarget;
use crate::mirror::CellMirror;
use cell_types::{SheetId, SheetPos};
use compute_parser::ASTNode;
use formula_types::{CellRef, IdentityFormulaRef, Scope};

use super::refs::cell_ref_to_position;

pub(super) enum FormulaTextCollectOutcome {
    Handled,
    Fallback,
}

pub(super) struct FormulaTextDepCollector<'a, 'b> {
    pub(super) sheet_ctx: &'b mut SheetId,
    pub(super) mirror: &'a CellMirror,
    pub(super) out: &'b mut Vec<FormulaTextDepTarget>,
}

impl<'a, 'b> FormulaTextDepCollector<'a, 'b> {
    pub(super) fn collect(&mut self, node: &ASTNode) -> FormulaTextCollectOutcome {
        match node {
            ASTNode::CellReference(cell) => {
                if let Some((sheet, row, col)) =
                    cell_ref_to_position(&cell.reference, self.sheet_ctx, self.mirror)
                {
                    self.push_cell_dep(sheet, row, col);
                }
                FormulaTextCollectOutcome::Handled
            }
            ASTNode::Range(range) => {
                let start = cell_ref_to_position(&range.start, self.sheet_ctx, self.mirror);
                let end = cell_ref_to_position(&range.end, self.sheet_ctx, self.mirror);
                if let (Some((sheet, s_row, s_col)), Some((_, e_row, e_col))) = (start, end) {
                    self.push_cell_dep(sheet, s_row.min(e_row), s_col.min(e_col));
                }
                FormulaTextCollectOutcome::Handled
            }
            ASTNode::SheetRef { sheet, inner } => {
                let prev = *self.sheet_ctx;
                *self.sheet_ctx = *sheet;
                let outcome = self.collect(inner);
                *self.sheet_ctx = prev;
                outcome
            }
            ASTNode::Identifier(name) => {
                let chain = [Scope::Sheet(*self.sheet_ctx), Scope::Workbook];
                if let Some((_var_cell_id, def)) =
                    self.mirror.variables.resolve_with_id(name, &chain)
                {
                    self.out.push(FormulaTextDepTarget::NameBinding {
                        scope: def.scope.clone(),
                        name: name.to_ascii_lowercase(),
                    });
                    if let Some(ref_item) = def.refers_to.refs.first() {
                        match ref_item {
                            IdentityFormulaRef::Cell(cell_ref) => {
                                if let Some((sheet, row, col)) =
                                    self.mirror.sheet_for_cell(&cell_ref.id).and_then(|sheet| {
                                        self.mirror
                                            .resolve_position(&cell_ref.id)
                                            .map(|pos| (sheet, pos.row(), pos.col()))
                                    })
                                {
                                    self.push_cell_dep(sheet, row, col);
                                }
                            }
                            IdentityFormulaRef::Range(range_ref) => {
                                let start = cell_ref_to_position(
                                    &CellRef::Resolved(range_ref.start_id),
                                    self.sheet_ctx,
                                    self.mirror,
                                );
                                let end = cell_ref_to_position(
                                    &CellRef::Resolved(range_ref.end_id),
                                    self.sheet_ctx,
                                    self.mirror,
                                );
                                if let (Some((sheet, s_row, s_col)), Some((_, e_row, e_col))) =
                                    (start, end)
                                {
                                    self.push_cell_dep(sheet, s_row.min(e_row), s_col.min(e_col));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                FormulaTextCollectOutcome::Handled
            }
            ASTNode::Paren(inner) => self.collect(inner),
            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. }
            | ASTNode::UnresolvedSheetRef { .. }
            | ASTNode::UnresolvedThreeDRef { .. }
            | ASTNode::StructuredRef(_)
            | ASTNode::ThreeDRef { .. } => FormulaTextCollectOutcome::Handled,
            _ => FormulaTextCollectOutcome::Fallback,
        }
    }

    fn push_cell_dep(&mut self, sheet: SheetId, row: u32, col: u32) {
        self.out
            .push(FormulaTextDepTarget::PosTopLeft { sheet, row, col });
        if let Some(cell_id) = self.mirror.resolve_cell_id(&sheet, SheetPos::new(row, col)) {
            self.out.push(FormulaTextDepTarget::Cell(cell_id));
        }
    }
}
