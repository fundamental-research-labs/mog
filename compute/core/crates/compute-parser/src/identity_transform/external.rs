use std::fmt::Write;

use formula_types::{
    CellRef, ExternalA1Cell, ExternalA1Range, ExternalAbsFlags, ExternalCellRef, ExternalNameRef,
    ExternalRangeAbsFlags, ExternalRangeRef, ExternalSheetKey, ExternalWorkbookToken,
    IdentityFormulaRef, LinkId,
};

use crate::Span;
use crate::ast::ASTNode;
use crate::parser::{ParseError, ParseErrorKind};

/// Capability used by formula commit code to bind parser-preserved external
/// workbook tokens to persisted link registry ids.
pub trait ExternalLinkBinder {
    /// Bind or reuse a destination-scoped [`LinkId`] for the given token.
    ///
    /// # Errors
    ///
    /// Returns [`ParseError`] to abort formula persistence atomically when a
    /// token cannot be bound.
    fn bind_external_workbook(
        &self,
        workbook: &ExternalWorkbookToken,
    ) -> Result<LinkId, ParseError>;
}

pub(super) fn external_binding_error() -> ParseError {
    ParseError::new(ParseErrorKind::InvalidReference, Span::empty())
}

pub(super) fn emit_external_ref(
    workbook: &ExternalWorkbookToken,
    sheet_name: Option<&str>,
    inner: &ASTNode,
    external_binder: Option<&dyn ExternalLinkBinder>,
    refs: &mut Vec<IdentityFormulaRef>,
    out: &mut String,
) -> Result<(), ParseError> {
    let binder = external_binder.ok_or_else(external_binding_error)?;
    let link_id = binder.bind_external_workbook(workbook)?;
    let sheet = sheet_name.map(|name| ExternalSheetKey::Name {
        name: name.to_string(),
    });
    let idx = refs.len();
    let formula_ref = external_identity_ref(link_id, sheet, inner)?;
    refs.push(formula_ref);
    let _ = write!(out, "{{{idx}}}");
    Ok(())
}

pub(super) fn emit_external_name_ref(
    workbook: &ExternalWorkbookToken,
    name: &str,
    external_binder: Option<&dyn ExternalLinkBinder>,
    refs: &mut Vec<IdentityFormulaRef>,
    out: &mut String,
) -> Result<(), ParseError> {
    let binder = external_binder.ok_or_else(external_binding_error)?;
    let link_id = binder.bind_external_workbook(workbook)?;
    let idx = refs.len();
    refs.push(IdentityFormulaRef::ExternalName(ExternalNameRef {
        link_id,
        sheet: None,
        name: name.to_string(),
    }));
    let _ = write!(out, "{{{idx}}}");
    Ok(())
}

pub(super) fn external_identity_ref(
    link_id: LinkId,
    sheet: Option<ExternalSheetKey>,
    inner: &ASTNode,
) -> Result<IdentityFormulaRef, ParseError> {
    match inner {
        ASTNode::CellReference(cell) => {
            let cell_key = external_cell_from_ref(&cell.reference)?;
            Ok(IdentityFormulaRef::ExternalCell(ExternalCellRef {
                link_id,
                sheet: sheet.ok_or_else(external_binding_error)?,
                address: cell_key,
                abs: ExternalAbsFlags {
                    row_abs: cell.abs_row,
                    col_abs: cell.abs_col,
                },
            }))
        }
        ASTNode::Range(range) => {
            let start = external_cell_from_ref(&range.start)?;
            let end = external_cell_from_ref(&range.end)?;
            Ok(IdentityFormulaRef::ExternalRange(ExternalRangeRef {
                link_id,
                sheet: sheet.ok_or_else(external_binding_error)?,
                address: ExternalA1Range { start, end },
                abs: ExternalRangeAbsFlags {
                    start: ExternalAbsFlags {
                        row_abs: range.abs_start.row,
                        col_abs: range.abs_start.col,
                    },
                    end: ExternalAbsFlags {
                        row_abs: range.abs_end.row,
                        col_abs: range.abs_end.col,
                    },
                },
            }))
        }
        ASTNode::Identifier(name) => Ok(IdentityFormulaRef::ExternalName(ExternalNameRef {
            link_id,
            sheet,
            name: name.clone(),
        })),
        _ => Err(external_binding_error()),
    }
}

pub(super) fn external_cell_from_ref(cell_ref: &CellRef) -> Result<ExternalA1Cell, ParseError> {
    match cell_ref {
        CellRef::Positional { row, col, .. } => Ok(ExternalA1Cell {
            row: row.saturating_add(1),
            col: col.saturating_add(1),
        }),
        CellRef::Resolved(_) => Err(external_binding_error()),
    }
}
