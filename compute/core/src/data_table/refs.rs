use cell_types::SheetId;
use formula_types::CellRef;
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::range_manager::{A1RangeRef, parse_range, stringify_range};

use super::errors::invalid_data_table;
use super::geometry::Rect;

pub(super) fn resolve_range_sheet(
    mirror: &CellMirror,
    default_sheet: &SheetId,
    range: &A1RangeRef,
) -> Result<SheetId, ComputeError> {
    match range.sheet_name.as_deref() {
        Some(sheet_name) => mirror.sheet_by_name(sheet_name).ok_or_else(|| {
            invalid_data_table(
                "DATA_TABLE_SHEET_NOT_FOUND",
                &format!("sheet not found: {sheet_name}"),
            )
        }),
        None => Ok(*default_sheet),
    }
}

pub(super) fn resolve_optional_input_cell(
    mirror: &CellMirror,
    default_sheet: &SheetId,
    raw: Option<&str>,
    label: &str,
) -> Result<Option<(SheetId, u32, u32)>, ComputeError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let range = parse_range(raw).ok_or_else(|| {
        invalid_data_table(
            "DATA_TABLE_INVALID_INPUT_REF",
            &format!("{label} is not a valid A1 cell reference"),
        )
    })?;
    let rect = rect_from_range(&range);
    if rect.start_row != rect.end_row || rect.start_col != rect.end_col {
        return Err(invalid_data_table(
            "DATA_TABLE_INVALID_INPUT_REF",
            &format!("{label} must be a single cell"),
        ));
    }
    let sheet = resolve_range_sheet(mirror, default_sheet, &range)?;
    Ok(Some((sheet, rect.start_row, rect.start_col)))
}
pub(super) fn rect_from_range(range: &A1RangeRef) -> Rect {
    Rect {
        start_row: range.start.row.min(range.end.row),
        start_col: range.start.col.min(range.end.col),
        end_row: range.start.row.max(range.end.row),
        end_col: range.start.col.max(range.end.col),
    }
}

pub(super) fn range_string(rect: Rect) -> String {
    stringify_range(&A1RangeRef {
        start: crate::range_manager::A1CellRef {
            row: rect.start_row,
            col: rect.start_col,
            row_absolute: false,
            col_absolute: false,
        },
        end: crate::range_manager::A1CellRef {
            row: rect.end_row,
            col: rect.end_col,
            row_absolute: false,
            col_absolute: false,
        },
        sheet_name: None,
    })
}

pub(super) fn cell_ref_from_pos((sheet, row, col): (SheetId, u32, u32)) -> CellRef {
    CellRef::Positional { sheet, row, col }
}
