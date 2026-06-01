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

fn row_has_content(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    row: u32,
    start_col: u32,
    end_col: u32,
) -> bool {
    (start_col..=end_col).any(|col| {
        !cell_accessor
            .get_cell_raw_value(sheet_id, row, col)
            .is_empty()
            || !cell_accessor.get_cell_value(sheet_id, row, col).is_empty()
    })
}

fn subtotal_replacement_range(
    cell_accessor: &dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) -> CellRange {
    let height = range
        .end_row()
        .saturating_sub(range.start_row())
        .saturating_add(1);
    let scan_extra = height.saturating_mul(4).max(16);
    let scan_end = range.end_row().saturating_add(scan_extra);
    let mut seen_subtotal = false;
    let mut last_content_row = range.end_row();

    for row in range.start_row()..=scan_end {
        let subtotal = is_subtotal_row(
            cell_accessor,
            sheet_id,
            row,
            range.start_col(),
            range.end_col(),
        );
        let has_content = subtotal
            || row_has_content(
                cell_accessor,
                sheet_id,
                row,
                range.start_col(),
                range.end_col(),
            );

        if subtotal {
            seen_subtotal = true;
        }
        if has_content {
            last_content_row = row;
        } else if row > range.end_row() {
            break;
        }
    }

    if seen_subtotal {
        CellRange::new(
            range.start_row(),
            range.start_col(),
            last_content_row,
            range.end_col(),
        )
    } else {
        *range
    }
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
    let replacement_range = if options.replace_existing {
        let replacement_range = subtotal_replacement_range(cell_accessor, sheet_id, range);
        remove_subtotals(doc, sheets, cell_accessor, sheet_id, &replacement_range);
        replacement_range
    } else {
        *range
    };

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

    if options.subtotal_columns.is_empty() {
        return SubtotalResult {
            groups_created: 0,
            subtotal_rows_inserted: 0,
            affected_range: CellRange::new(
                range.start_row(),
                mn,
                replacement_range.end_row().max(range.end_row()),
                mx,
            ),
        };
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
    for b in &boundaries {
        let shifted_start = b.start_row + ri;
        let shifted_end = b.end_row + ri;
        let subtotal_row = if sb { shifted_end + 1 } else { shifted_start };

        cell_accessor.insert_rows(sheet_id, subtotal_row, 1);

        let formula_start = if sb { shifted_start } else { shifted_start + 1 };
        let formula_end = if sb { shifted_end } else { shifted_end + 1 };

        cell_accessor.set_cell_value(
            sheet_id,
            subtotal_row,
            options.group_by_column,
            &format!("{} Total", b.group_value),
        );
        for &col in &options.subtotal_columns {
            cell_accessor.set_cell_value(
                sheet_id,
                subtotal_row,
                col,
                &build_subtotal_formula(options.function, col, formula_start, formula_end),
            );
        }
        if group_rows(doc, sheets, sheet_id, formula_start, formula_end).is_ok() {
            gc += 1;
        }
        ri += 1;
    }

    if sb {
        let grand_row = range.end_row() + ri + 1;
        let data_start = if options.has_headers {
            range.start_row() + 1
        } else {
            range.start_row()
        };
        cell_accessor.insert_rows(sheet_id, grand_row, 1);
        cell_accessor.set_cell_value(sheet_id, grand_row, options.group_by_column, "Grand Total");
        for &col in &options.subtotal_columns {
            cell_accessor.set_cell_value(
                sheet_id,
                grand_row,
                col,
                &build_subtotal_formula(options.function, col, data_start, grand_row - 1),
            );
        }
        ri += 1;
    }

    SubtotalResult {
        groups_created: gc,
        subtotal_rows_inserted: ri,
        affected_range: CellRange::new(
            range.start_row(),
            mn,
            replacement_range.end_row().max(range.end_row() + ri),
            mx,
        ),
    }
}

pub fn remove_subtotals(
    doc: &Doc,
    sheets: &MapRef,
    cell_accessor: &mut dyn SubtotalsCellAccessor,
    sheet_id: &SheetId,
    range: &CellRange,
) -> u32 {
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
        return 0;
    }
    clear_row_grouping(doc, sheets, sheet_id, range.start_row(), range.end_row());
    let removed = sr.len() as u32;
    for row in &sr {
        cell_accessor.delete_rows(sheet_id, *row, 1);
    }
    removed
}
