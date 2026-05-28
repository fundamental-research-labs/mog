use crate::helpers::is_non_origin_merged_cell;
use crate::types::*;

#[derive(Clone, Copy)]
pub(crate) struct TargetCell {
    pub(crate) row: u32,
    pub(crate) col: u32,
}

pub(crate) fn target_cells(input: &FillInput) -> Vec<TargetCell> {
    let direction = input.request.direction;
    let source = &input.request.source_range;
    let target = &input.request.target_range;

    let rows: Vec<u32> = if direction == FillDirection::Up {
        (target.start_row..=target.end_row).rev().collect()
    } else {
        (target.start_row..=target.end_row).collect()
    };
    let cols: Vec<u32> = if direction == FillDirection::Left {
        (target.start_col..=target.end_col).rev().collect()
    } else {
        (target.start_col..=target.end_col).collect()
    };

    let mut cells = Vec::new();
    for row in rows {
        if input.hidden_rows.contains(&row) {
            continue;
        }
        for &col in &cols {
            if input.hidden_cols.contains(&col)
                || is_in_source_range(row, col, source)
                || is_non_origin_merged_cell(&input.merges, row, col)
            {
                continue;
            }
            cells.push(TargetCell { row, col });
        }
    }

    cells
}

pub(crate) fn target_merge_warning(input: &FillInput) -> Option<FillWarning> {
    let target = &input.request.target_range;
    let has_merges_in_target = input.merges.iter().any(|merge| {
        !(merge.end_row < target.start_row
            || merge.start_row > target.end_row
            || merge.end_col < target.start_col
            || merge.start_col > target.end_col)
    });

    has_merges_in_target.then_some(FillWarning {
        row: target.start_row,
        col: target.start_col,
        kind: FillWarningKind::MergedCellsInTarget,
    })
}

fn is_in_source_range(row: u32, col: u32, source: &FillRangeSpec) -> bool {
    row >= source.start_row
        && row <= source.end_row
        && col >= source.start_col
        && col <= source.end_col
}
