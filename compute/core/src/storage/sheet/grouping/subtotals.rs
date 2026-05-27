use cell_types::{SheetId, col_to_letter};
use yrs::{Doc, MapRef};

use super::crud::{clear_row_grouping, group_rows};
use super::types::{
    CellRange, GroupBoundary, SubtotalFunction, SubtotalOptions, SubtotalResult,
    SubtotalsCellAccessor,
};

pub fn build_subtotal_formula(
    func: SubtotalFunction,
    col: u32,
    start_row: u32,
    end_row: u32,
) -> String {
    format!(
        "=SUBTOTAL({},{}{}:{}{})",
        func.hidden_code(),
        col_to_letter(col),
        start_row + 1,
        col_to_letter(col),
        end_row + 1
    )
}

pub fn find_group_boundaries(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
    group_by_column: u32,
    has_headers: bool,
) -> Vec<GroupBoundary> {
    let mut boundaries = Vec::new();
    let dsr = if has_headers {
        range.start_row() + 1
    } else {
        range.start_row()
    };
    if dsr > range.end_row() {
        return boundaries;
    }
    let mut cv = cell_accessor.get_cell_value(sheet_id, dsr, group_by_column);
    let mut gsr = dsr;
    for row in (dsr + 1)..=range.end_row() {
        let v = cell_accessor.get_cell_value(sheet_id, row, group_by_column);
        if v != cv {
            boundaries.push(GroupBoundary {
                group_value: cv,
                start_row: gsr,
                end_row: row - 1,
            });
            cv = v;
            gsr = row;
        }
    }
    boundaries.push(GroupBoundary {
        group_value: cv,
        start_row: gsr,
        end_row: range.end_row(),
    });
    boundaries
}

pub fn is_subtotal_row(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    row: u32,
    start_col: u32,
    end_col: u32,
) -> bool {
    (start_col..=end_col).any(|col| {
        cell_accessor
            .get_cell_raw_value(sheet_id, row, col)
            .to_uppercase()
            .contains("SUBTOTAL(")
    })
}

pub fn create_subtotals(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &mut dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
    options: &SubtotalOptions,
) -> SubtotalResult {
    let sb = options.summary_below_data;
    if options.replace_existing {
        remove_subtotals(doc, sheets, cell_accessor, sheet_id, range);
    }
    let boundaries = find_group_boundaries(
        cell_accessor,
        sheet_id,
        range,
        options.group_by_column,
        options.has_headers,
    );
    if boundaries.is_empty() {
        return SubtotalResult {
            groups_created: 0,
            subtotal_rows_inserted: 0,
            affected_range: *range,
        };
    }
    let mut ri: u32 = 0;
    let mut gc: u32 = 0;
    let sorted: Vec<GroupBoundary> = if sb {
        boundaries.into_iter().rev().collect()
    } else {
        boundaries
    };
    for b in &sorted {
        let as_ = if sb { b.start_row } else { b.start_row + ri };
        let ae = b.end_row + ri;
        let srp = if sb { ae + 1 } else { as_ };
        cell_accessor.insert_rows(sheet_id, srp, 1);
        ri += 1;
        cell_accessor.set_cell_value(
            sheet_id,
            srp,
            options.group_by_column,
            &format!("{} Total", b.group_value),
        );
        for &col in &options.subtotal_columns {
            let fs = if sb { as_ } else { as_ + 1 };
            let fe = if sb { ae } else { ae + 1 };
            cell_accessor.set_cell_value(
                sheet_id,
                srp,
                col,
                &build_subtotal_formula(options.function, col, fs, fe),
            );
        }
        let gs = if sb { as_ } else { srp };
        let ge = if sb { srp } else { ae + 1 };
        if group_rows(doc, sheets, sheet_id, gs, ge).is_ok() {
            gc += 1;
        }
    }
    let mn = options
        .subtotal_columns
        .iter()
        .copied()
        .min()
        .unwrap_or(options.group_by_column)
        .min(options.group_by_column);
    let mx = options
        .subtotal_columns
        .iter()
        .copied()
        .max()
        .unwrap_or(options.group_by_column)
        .max(options.group_by_column);
    SubtotalResult {
        groups_created: gc,
        subtotal_rows_inserted: ri,
        affected_range: CellRange::new(range.start_row(), mn, range.end_row() + ri, mx),
    }
}

pub fn remove_subtotals(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &mut dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) {
    let sr: Vec<u32> = (range.start_row()..=range.end_row())
        .rev()
        .filter(|&row| {
            is_subtotal_row(
                cell_accessor,
                sheet_id,
                row,
                range.start_col(),
                range.end_col(),
            )
        })
        .collect();
    if sr.is_empty() {
        return;
    }
    clear_row_grouping(doc, sheets, sheet_id, range.start_row(), range.end_row());
    for row in &sr {
        cell_accessor.delete_rows(sheet_id, *row, 1);
    }
}
