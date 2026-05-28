use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::formula_text::FormulaTextLookup;
use compute_parser::{ASTNode, RangeRef};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

enum FormulaTextTarget {
    Local {
        sheet: cell_types::SheetId,
        row: u32,
        col: u32,
    },
    ExternalUnavailable,
    InvalidRef,
    Unsupported,
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) fn eval_formulatext(
        &self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        match self.resolve_formulatext_target(&args[0]) {
            FormulaTextTarget::Local { sheet, row, col } => {
                Ok(match self.meta.formula_text_at(&sheet, row, col) {
                    FormulaTextLookup::Visible(text) => CellValue::Text(text.into()),
                    FormulaTextLookup::NotFormula
                    | FormulaTextLookup::Hidden
                    | FormulaTextLookup::Unavailable => CellValue::Error(CellError::Na, None),
                    FormulaTextLookup::InvalidRef => CellValue::Error(CellError::Ref, None),
                })
            }
            FormulaTextTarget::ExternalUnavailable => Ok(CellValue::Error(CellError::Na, None)),
            FormulaTextTarget::InvalidRef => Ok(CellValue::Error(CellError::Ref, None)),
            FormulaTextTarget::Unsupported => Ok(CellValue::Error(CellError::Value, None)),
        }
    }
    fn resolve_formulatext_target(&self, node: &ASTNode) -> FormulaTextTarget {
        match node {
            ASTNode::CellReference(cell) => self.resolve_cell_ref_for_formulatext(&cell.reference),
            ASTNode::Range(range) => self.resolve_range_for_formulatext(range),
            ASTNode::SheetRef { sheet, inner } => {
                self.resolve_formulatext_target_in_sheet(inner, *sheet)
            }
            ASTNode::UnresolvedSheetRef { .. } | ASTNode::UnresolvedThreeDRef { .. } => {
                FormulaTextTarget::InvalidRef
            }
            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. } => FormulaTextTarget::ExternalUnavailable,
            ASTNode::Identifier(name) => match self.meta.resolve_defined_name(name) {
                Some(formula_types::ResolvedName::Cell { sheet, row, col }) => {
                    FormulaTextTarget::Local { sheet, row, col }
                }
                Some(formula_types::ResolvedName::Range {
                    sheet,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                }) => FormulaTextTarget::Local {
                    sheet,
                    row: start_row.min(end_row),
                    col: start_col.min(end_col),
                },
                Some(formula_types::ResolvedName::Error(CellError::Ref)) => {
                    FormulaTextTarget::InvalidRef
                }
                _ => FormulaTextTarget::Unsupported,
            },
            ASTNode::Paren(inner) => self.resolve_formulatext_target(inner),
            ASTNode::StructuredRef(_) | ASTNode::ThreeDRef { .. } => FormulaTextTarget::Unsupported,
            _ => FormulaTextTarget::Unsupported,
        }
    }
    fn resolve_formulatext_target_in_sheet(
        &self,
        node: &ASTNode,
        sheet: cell_types::SheetId,
    ) -> FormulaTextTarget {
        match self.resolve_formulatext_target(node) {
            FormulaTextTarget::Local { row, col, .. } => {
                FormulaTextTarget::Local { sheet, row, col }
            }
            other => other,
        }
    }
    fn resolve_cell_ref_for_formulatext(&self, cell_ref: &CellRef) -> FormulaTextTarget {
        match cell_ref {
            CellRef::Resolved(id) => self
                .meta
                .resolve_position(id)
                .map(|(sheet, row, col)| FormulaTextTarget::Local { sheet, row, col })
                .unwrap_or(FormulaTextTarget::InvalidRef),
            CellRef::Positional { sheet, row, col } => {
                let sheet = if *sheet == cell_types::SheetId::from_raw(0) {
                    self.current_sheet_for_formulatext()
                } else {
                    *sheet
                };
                FormulaTextTarget::Local {
                    sheet,
                    row: *row,
                    col: *col,
                }
            }
        }
    }
    fn resolve_range_for_formulatext(&self, range: &RangeRef) -> FormulaTextTarget {
        let start = match self.resolve_cell_ref_for_formulatext(&range.start) {
            FormulaTextTarget::Local { sheet, row, col } => (sheet, row, col),
            other => return other,
        };
        let end = match self.resolve_cell_ref_for_formulatext(&range.end) {
            FormulaTextTarget::Local { sheet, row, col } => (sheet, row, col),
            other => return other,
        };

        if start.0 != end.0 {
            return FormulaTextTarget::InvalidRef;
        }

        FormulaTextTarget::Local {
            sheet: start.0,
            row: start.1.min(end.1),
            col: start.2.min(end.2),
        }
    }
    fn current_sheet_for_formulatext(&self) -> cell_types::SheetId {
        let current = self.meta.current_cell();
        self.meta
            .resolve_position(&current)
            .map(|(sheet, _, _)| sheet)
            .unwrap_or_else(|| cell_types::SheetId::from_raw(0))
    }
}
