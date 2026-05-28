use std::fmt::Write;

use cell_types::{CellId, SheetId};
use formula_types::{
    CellRef, IdentityCellRef, IdentityColRangeRef, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef, RangeType,
};

use crate::IdentityResolver;
use crate::ast::{CellRefNode, RangeRef, Span};
use crate::parser::{ParseError, ParseErrorKind};

use super::entrypoints::IdentityOptions;

/// Sentinel value meaning "current sheet" — used by the parser when no explicit
/// sheet qualifier is present (e.g. `=A1` vs `=Sheet2!A1`).
///
/// **Why `SheetId(0)`?** `CellRef::Positional.sheet` is a bare `SheetId`, not
/// `Option<SheetId>`, so we need a sentinel to distinguish "same sheet" from a
/// real cross-sheet reference. `SheetId` wraps a UUID-sourced `u128`, so zero is
/// impossible in production (UUIDs are never all-zero).
///
/// // TODO: refactor `CellRef::Positional.sheet` to `Option<SheetId>` so we can
/// // use `None` instead of a sentinel value.
pub(super) const CURRENT_SHEET: SheetId = SheetId::from_raw(0);

/// Resolve a [`CellRef`] to a [`CellId`], handling both `Positional` and `Resolved` variants.
pub(super) fn resolve_cell_id(
    cell_ref: &CellRef,
    current_sheet: SheetId,
    resolver: &dyn IdentityResolver,
) -> CellId {
    match cell_ref {
        CellRef::Resolved(id) => *id,
        CellRef::Positional { sheet, row, col } => {
            let s = if *sheet == CURRENT_SHEET {
                current_sheet
            } else {
                *sheet
            };
            resolver.get_or_create_cell_id(&s, *row, *col)
        }
    }
}

/// Extract (sheet, row, col) from a [`CellRef`], using `default_sheet` when
/// the ref's sheet is `CURRENT_SHEET` (the sentinel for "no explicit sheet").
///
/// Returns an error for `CellRef::Resolved` because resolved refs do not carry
/// positional information needed by row/column ranges.
pub(super) fn extract_position(
    cell_ref: &CellRef,
    default_sheet: SheetId,
) -> Result<(SheetId, u32, u32), ParseError> {
    match cell_ref {
        CellRef::Positional { sheet, row, col } => {
            let s = if *sheet == CURRENT_SHEET {
                default_sheet
            } else {
                *sheet
            };
            Ok((s, *row, *col))
        }
        CellRef::Resolved(_) => Err(ParseError::new(
            ParseErrorKind::InvalidReference,
            Span::empty(),
        )),
    }
}

pub(super) fn emit_cell_ref(
    cell: &CellRefNode,
    current_sheet: SheetId,
    resolver: &dyn IdentityResolver,
    refs: &mut Vec<IdentityFormulaRef>,
    out: &mut String,
) {
    let cell_id = resolve_cell_id(&cell.reference, current_sheet, resolver);
    let idx = refs.len();
    refs.push(IdentityFormulaRef::Cell(IdentityCellRef {
        id: cell_id,
        row_absolute: cell.abs_row,
        col_absolute: cell.abs_col,
    }));
    let _ = write!(out, "{{{idx}}}");
}

pub(super) fn emit_range_ref(
    range: &RangeRef,
    current_sheet: SheetId,
    resolver: &dyn IdentityResolver,
    options: IdentityOptions,
    refs: &mut Vec<IdentityFormulaRef>,
    out: &mut String,
) -> Result<(), ParseError> {
    match range.range_type {
        RangeType::CellRange => {
            let idx = refs.len();
            if options.prefer_rect_ranges
                && let Ok((s_sheet, s_row, s_col)) = extract_position(&range.start, current_sheet)
                && let Ok((e_sheet, e_row, e_col)) = extract_position(&range.end, current_sheet)
                && s_sheet == e_sheet
                && let (Some(start_row_id), Some(start_col_id), Some(end_row_id), Some(end_col_id)) = (
                    resolver.get_row_id(&s_sheet, s_row),
                    resolver.get_col_id(&s_sheet, s_col),
                    resolver.get_row_id(&e_sheet, e_row),
                    resolver.get_col_id(&e_sheet, e_col),
                )
            {
                refs.push(IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                    sheet_id: s_sheet,
                    start_row_id,
                    start_col_id,
                    end_row_id,
                    end_col_id,
                    start_row_absolute: range.abs_start.row,
                    start_col_absolute: range.abs_start.col,
                    end_row_absolute: range.abs_end.row,
                    end_col_absolute: range.abs_end.col,
                }));
            } else {
                let start_id = resolve_cell_id(&range.start, current_sheet, resolver);
                let end_id = resolve_cell_id(&range.end, current_sheet, resolver);
                refs.push(IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id,
                    end_id,
                    start_row_absolute: range.abs_start.row,
                    start_col_absolute: range.abs_start.col,
                    end_row_absolute: range.abs_end.row,
                    end_col_absolute: range.abs_end.col,
                }));
            }
            let _ = write!(out, "{{{idx}}}");
        }
        RangeType::RowRange => {
            let (s_sheet, s_row, _) = extract_position(&range.start, current_sheet)?;
            let (_, e_row, _) = extract_position(&range.end, current_sheet)?;
            let start_row_id = resolver.get_row_id(&s_sheet, s_row).ok_or_else(|| {
                ParseError::new(
                    ParseErrorKind::InvalidRowNumber { row: s_row },
                    Span::empty(),
                )
            })?;
            let end_row_id = resolver.get_row_id(&s_sheet, e_row).ok_or_else(|| {
                ParseError::new(
                    ParseErrorKind::InvalidRowNumber { row: e_row },
                    Span::empty(),
                )
            })?;
            let idx = refs.len();
            if s_row == e_row {
                refs.push(IdentityFormulaRef::FullRow(IdentityFullRowRef {
                    row_id: start_row_id,
                    absolute: range.abs_start.row,
                }));
            } else {
                refs.push(IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                    start_row_id,
                    end_row_id,
                    start_absolute: range.abs_start.row,
                    end_absolute: range.abs_end.row,
                }));
            }
            let _ = write!(out, "{{{idx}}}");
        }
        RangeType::ColumnRange => {
            let (s_sheet, _, s_col) = extract_position(&range.start, current_sheet)?;
            let (_, _, e_col) = extract_position(&range.end, current_sheet)?;
            let start_col_id = resolver.get_col_id(&s_sheet, s_col).ok_or_else(|| {
                ParseError::new(
                    ParseErrorKind::InvalidColumnNumber { col: s_col },
                    Span::empty(),
                )
            })?;
            let end_col_id = resolver.get_col_id(&s_sheet, e_col).ok_or_else(|| {
                ParseError::new(
                    ParseErrorKind::InvalidColumnNumber { col: e_col },
                    Span::empty(),
                )
            })?;
            let idx = refs.len();
            if s_col == e_col {
                refs.push(IdentityFormulaRef::FullCol(IdentityFullColRef {
                    col_id: start_col_id,
                    absolute: range.abs_start.col,
                }));
            } else {
                refs.push(IdentityFormulaRef::ColRange(IdentityColRangeRef {
                    start_col_id,
                    end_col_id,
                    start_absolute: range.abs_start.col,
                    end_absolute: range.abs_end.col,
                }));
            }
            let _ = write!(out, "{{{idx}}}");
        }
        // RangeType is #[non_exhaustive]; future variants fall through here.
        _ => {
            out.push_str("#UNKNOWN_RANGE");
        }
    }
    Ok(())
}
