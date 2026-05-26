//! Pure AST geometry functions — reference resolution and range extraction.
//!
//! These helpers take `ASTNode`/`CellRef` and return positions/bounds.
//! They have zero `Evaluator` dependency.

use cell_types::SheetId;
use compute_parser::{ASTNode, RangeRef};
use formula_types::{CellRef, RangeType};

use crate::eval::context::traits::EvalMetadata;

// ---------------------------------------------------------------------------
// Free functions — reference resolution
// ---------------------------------------------------------------------------

/// Resolve a `CellRef` to `(SheetId, row, col)` using only the `EvalMetadata` trait.
/// Works for both `Resolved` (has CellId) and `Positional` (empty cell) variants.
///
/// This is the canonical cell-ref resolution helper for all lookup and range
/// extraction functions in the eval layer.
pub(in crate::eval) fn resolve_cell_ref_position(
    cell_ref: &CellRef,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32)> {
    match cell_ref {
        CellRef::Resolved(id) => meta.resolve_position(id),
        CellRef::Positional { sheet, row, col } => Some((*sheet, *row, *col)),
    }
}

/// Resolve a `CellRef` to `(SheetId, row, col)` using the evaluation metadata.
/// Alias for [`resolve_cell_ref_position`] — retained for backward compatibility.
#[inline]
pub(in crate::eval) fn resolve_cellref(
    cell_ref: &CellRef,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32)> {
    resolve_cell_ref_position(cell_ref, meta)
}

pub(in crate::eval) fn extract_range_bounds(
    arg: &ASTNode,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32, u32)> {
    let inner = match arg {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match inner {
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_cellref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_cellref(end, meta)?;
            if s_sheet != e_sheet {
                return None;
            }
            Some((
                s_sheet,
                s_row.min(e_row),
                s_row.max(e_row),
                s_col.min(e_col),
                s_col.max(e_col),
            ))
        }
        _ => None,
    }
}

pub(in crate::eval) fn try_extract_single_col_range(
    arg: &ASTNode,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32)> {
    let inner = match arg {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match inner {
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_cellref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_cellref(end, meta)?;
            if s_sheet != e_sheet || s_col != e_col {
                return None;
            }
            Some((s_sheet, s_col, s_row.min(e_row), s_row.max(e_row)))
        }
        _ => None,
    }
}

/// Like [`try_extract_single_col_range`] but returns sentinel `0..u32::MAX` rows for
/// full-column references (`RangeType::ColumnRange`). Callers must clamp to actual
/// data length via `.min(col_values.len())`.
///
/// Used by the borrowed multi-criteria fast path where column ranges (e.g. `$D:$D`)
/// need to express "all rows" without knowing the data extent at extraction time.
///
/// **Do NOT replace `try_extract_single_col_range` with this** — the sentinel values
/// would break `get_sorted_for_range` (which allocates based on row bounds) and could
/// cause arithmetic overflow in XLOOKUP's offset calculation.
pub(in crate::eval) fn try_extract_single_col_range_with_sentinels(
    arg: &ASTNode,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32)> {
    let inner = match arg {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match inner {
        ASTNode::Range(rr @ RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_cellref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_cellref(end, meta)?;
            if s_sheet != e_sheet || s_col != e_col {
                return None;
            }
            match rr.range_type {
                RangeType::ColumnRange => Some((s_sheet, s_col, 0, u32::MAX)),
                _ => Some((s_sheet, s_col, s_row.min(e_row), s_row.max(e_row))),
            }
        }
        _ => None,
    }
}

/// Try to extract a single-row range from an AST argument.
/// Returns `(SheetId, row, start_col, end_col)` if the range spans exactly one row.
/// Used by HLOOKUP to optimize lookup on single-row table arguments.
pub(in crate::eval) fn try_extract_single_row_range(
    arg: &ASTNode,
    meta: &dyn EvalMetadata,
) -> Option<(SheetId, u32, u32, u32)> {
    let inner = match arg {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    match inner {
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) = resolve_cellref(start, meta)?;
            let (e_sheet, e_row, e_col) = resolve_cellref(end, meta)?;
            if s_sheet != e_sheet || s_row != e_row {
                return None;
            }
            Some((s_sheet, s_row, s_col.min(e_col), s_col.max(e_col)))
        }
        _ => None,
    }
}

/// Returns true when the AST node is a ColumnRange (A:A) or RowRange (1:1).
///
/// Excel's whole-column/row references span the full 1M+ rows/16K+ cols.
/// Our engine clamps them to `sheet.rows` for performance, which means
/// trailing empties beyond the data extent are lost.  XLOOKUP searching
/// for Null (empty) in such a range should still be able to match those
/// virtual trailing empties — this helper lets the caller detect that case.
pub(in crate::eval) fn is_whole_range(arg: &ASTNode) -> bool {
    let inner = match arg {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        ASTNode::Paren(inner) => inner.as_ref(),
        other => other,
    };
    matches!(
        inner,
        ASTNode::Range(RangeRef {
            range_type: RangeType::ColumnRange | RangeType::RowRange,
            ..
        })
    )
}
