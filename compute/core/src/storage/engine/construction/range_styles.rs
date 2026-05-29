use super::*;

pub(in crate::storage::engine) fn range_style_formats_enabled() -> bool {
    std::env::var("MOG_XLSX_RANGE_STYLE_FORMATS")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            !matches!(normalized.as_str(), "0" | "false" | "no" | "off")
        })
        .unwrap_or(true)
}

pub(in crate::storage::engine) fn build_imported_range_style_plan(
    sheet_data: &domain_types::SheetData,
    alloc: &crate::storage::infra::hydration::SheetIdAllocation,
    ranges: &[snapshot_types::RangeData],
    allocator: &mut crate::storage::infra::hydration::DefaultIdAllocator,
) -> (
    std::collections::HashSet<(u32, u32)>,
    Vec<crate::storage::infra::hydration::ImportedRangeStyle>,
) {
    let mut style_by_pos: HashMap<(u32, u32), Option<u32>> =
        HashMap::with_capacity(sheet_data.cells.len());
    for cell in &sheet_data.cells {
        style_by_pos.insert((cell.row, cell.col), cell.style_id);
    }

    let row_index_by_id: HashMap<RowId, u32> = alloc
        .row_ids
        .iter()
        .copied()
        .enumerate()
        .map(|(idx, row_id)| (row_id, idx as u32))
        .collect();
    let col_index_by_id: HashMap<ColId, u32> = alloc
        .col_ids
        .iter()
        .copied()
        .enumerate()
        .map(|(idx, col_id)| (col_id, idx as u32))
        .collect();

    let mut positions = std::collections::HashSet::new();
    let mut styles = Vec::new();

    for range in ranges {
        let mut positions_by_style: HashMap<u32, Vec<(u32, u32)>> = HashMap::new();

        for row_id in &range.row_ids {
            let Some(&row) = row_index_by_id.get(row_id) else {
                continue;
            };
            for col_id in &range.col_ids {
                let Some(&col) = col_index_by_id.get(col_id) else {
                    continue;
                };
                let Some(cell_style) = style_by_pos.get(&(row, col)).copied().flatten() else {
                    continue;
                };
                positions_by_style
                    .entry(cell_style)
                    .or_default()
                    .push((row, col));
            }
        }

        let mut style_groups: Vec<_> = positions_by_style.into_iter().collect();
        style_groups.sort_by_key(|(style_id, _)| *style_id);

        let mut first_rect_for_range = true;
        for (style_id, range_positions) in style_groups {
            let range_position_set: std::collections::HashSet<(u32, u32)> =
                range_positions.iter().copied().collect();
            positions.extend(range_positions);
            for (start_row, start_col, end_row, end_col) in
                coalesce_imported_style_positions(&range_position_set)
            {
                styles.push(crate::storage::infra::hydration::ImportedRangeStyle {
                    range_id: if first_rect_for_range {
                        first_rect_for_range = false;
                        range.range_id
                    } else {
                        allocator.alloc_range_id()
                    },
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    style_id,
                });
            }
        }
    }

    (positions, styles)
}

pub(in crate::storage::engine) fn coalesce_imported_style_positions(
    positions: &std::collections::HashSet<(u32, u32)>,
) -> Vec<(u32, u32, u32, u32)> {
    if positions.is_empty() {
        return Vec::new();
    }

    let mut points: Vec<(u32, u32)> = positions.iter().copied().collect();
    points.sort_unstable();

    let mut row_runs: Vec<(u32, u32, u32)> = Vec::new();
    for (row, col) in points {
        if let Some(last) = row_runs.last_mut()
            && last.0 == row
            && last.2.saturating_add(1) == col
        {
            last.2 = col;
            continue;
        }
        row_runs.push((row, col, col));
    }

    let mut rectangles: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut active: HashMap<(u32, u32), usize> = HashMap::new();
    for (row, start_col, end_col) in row_runs {
        let key = (start_col, end_col);
        if let Some(&idx) = active.get(&key)
            && rectangles[idx].2.saturating_add(1) == row
        {
            rectangles[idx].2 = row;
            continue;
        }
        let idx = rectangles.len();
        active.insert(key, idx);
        rectangles.push((row, start_col, row, end_col));
    }

    rectangles.sort_unstable();
    rectangles
}
