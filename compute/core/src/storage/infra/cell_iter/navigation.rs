use std::collections::HashSet;

use cell_types::{CellId, SheetId};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use yrs::{Doc, MapRef, Transact};

use super::super::grid_helpers::get_cells_map;
use super::read::has_data_at;

/// Find the data edge from a cell in a given direction (Ctrl+Arrow navigation).
///
/// Implements Excel's Ctrl+Arrow behaviour:
/// 1. Current empty, next empty  → jump to first non-empty (or sheet edge)
/// 2. Current empty, next data   → jump to that adjacent cell
/// 3. Current data, next empty   → jump over empties to next data (or sheet edge)
/// 4. Current data, next data    → walk to last cell before empty (contiguous edge)
///
/// Hidden rows/columns act as boundaries; merged cells are treated as single
/// blocks and navigation always lands on the merge origin (top-left).
///
/// Horizontally collapsed outline columns are not data-edge boundaries. Excel
/// lets Ctrl+Left/Right traverse the collapsed detail span and land on the
/// nearest visible column at the other side of the outline group. Manually
/// hidden columns still remain hard boundaries.
pub fn find_data_edge(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    direction: &str,
) -> snapshot_types::queries::CellPosition {
    find_data_edge_with_extra_data(
        doc,
        sheets,
        sheet_id,
        grid,
        start_row,
        start_col,
        direction,
        |_, _| false,
    )
}

/// Like [`find_data_edge`], but lets higher layers contribute cell occupancy
/// from non-Yrs sources such as the compute mirror. This keeps the low-level
/// storage iterator reusable while matching viewport/query semantics for
/// deferred imports where formula cells can be mirror-resident before every
/// formula body has been written into Yrs.
pub fn find_data_edge_with_extra_data(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    direction: &str,
    extra_has_data: impl Fn(u32, u32) -> bool,
) -> snapshot_types::queries::CellPosition {
    use crate::storage::sheet::{dimensions, grouping, merges};

    const MAX_ROW: u32 = 1_048_575;
    const MAX_COL: u32 = 16_383;

    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();

    let fallback = snapshot_types::queries::CellPosition {
        row: start_row,
        col: start_col,
    };

    let Some(cells_map) = get_cells_map(&txn, sheets, &sheet_hex) else {
        return fallback;
    };

    // Pre-fetch hidden sets for efficiency. `dimensions::get_hidden_columns`
    // contains manually hidden columns, but imported collapsed outlines can
    // also hydrate their detail columns into the same map. Treat columns also
    // owned by an outline group as structural for horizontal navigation.
    let hidden_rows: HashSet<u32> = dimensions::get_hidden_rows(doc, sheets, &sheet_id)
        .into_iter()
        .chain(grouping::get_rows_hidden_by_structural_groups(
            doc, sheets, &sheet_id,
        ))
        .collect();
    let dimension_hidden_cols: HashSet<u32> =
        dimensions::get_hidden_columns(doc, sheets, &sheet_id)
            .into_iter()
            .collect();
    let structural_hidden_cols: HashSet<u32> =
        grouping::get_columns_hidden_by_structural_groups(doc, sheets, &sheet_id)
            .into_iter()
            .collect();
    let rendered_hidden_cols: HashSet<u32> = dimension_hidden_cols
        .iter()
        .copied()
        .chain(structural_hidden_cols.iter().copied())
        .collect();
    let blocking_hidden_cols: HashSet<u32> = dimension_hidden_cols
        .into_iter()
        .filter(|col| !structural_hidden_cols.contains(col))
        .collect();

    // Direction deltas
    let (dr, dc): (i64, i64) = match direction {
        "up" => (-1, 0),
        "down" => (1, 0),
        "left" => (0, -1),
        "right" => (0, 1),
        _ => {
            return snapshot_types::queries::CellPosition {
                row: start_row,
                col: start_col,
            };
        }
    };

    // --- helpers ---

    let in_bounds =
        |r: i64, c: i64| -> bool { r >= 0 && r <= MAX_ROW as i64 && c >= 0 && c <= MAX_COL as i64 };

    let col_is_boundary = |c: u32| -> bool {
        if dc != 0 {
            blocking_hidden_cols.contains(&c)
        } else {
            rendered_hidden_cols.contains(&c)
        }
    };

    let is_hidden = |r: u32, c: u32| -> bool { hidden_rows.contains(&r) || col_is_boundary(c) };

    let is_traversable_structural_col = |c: u32| -> bool {
        dc != 0 && structural_hidden_cols.contains(&c) && !blocking_hidden_cols.contains(&c)
    };

    let relevant_filter_ids = relevant_vertical_filter_ids(
        doc, sheets, &sheet_id, grid, start_row, start_col, direction,
    );

    let is_filter_skipped_row = |r: u32, c: u32| -> bool {
        if dc != 0 || rendered_hidden_cols.contains(&c) || !hidden_rows.contains(&r) {
            return false;
        }
        let ownership =
            dimensions::get_row_visibility_ownership(doc, sheets, &sheet_id, r, Some(grid));
        ownership.effective_hidden
            && !ownership.manual
            && !ownership.structural
            && !ownership.cache_hidden_without_owner
            && !ownership.filter_owner_ids.is_empty()
            && ownership
                .filter_owner_ids
                .iter()
                .all(|filter_id| relevant_filter_ids.contains(filter_id))
    };

    let is_hidden_boundary =
        |r: u32, c: u32| -> bool { is_hidden(r, c) && !is_filter_skipped_row(r, c) };

    #[derive(Default)]
    struct SkipResult {
        filter_rows: bool,
        structural_cols: bool,
    }

    let advance_skipped_cells = |ri: &mut i64, ci: &mut i64| -> SkipResult {
        let mut result = SkipResult::default();
        let mut skipped = false;
        while in_bounds(*ri, *ci) && is_filter_skipped_row(*ri as u32, *ci as u32) {
            skipped = true;
            *ri += dr;
            *ci += dc;
        }
        result.filter_rows = skipped;

        let mut skipped = false;
        while in_bounds(*ri, *ci) && is_traversable_structural_col(*ci as u32) {
            skipped = true;
            *ri += dr;
            *ci += dc;
        }
        result.structural_cols = skipped;

        result
    };

    let check_data = |r: u32, c: u32| -> bool {
        has_data_at(&txn, grid, &cells_map, r, c) || extra_has_data(r, c)
    };

    // Check data at a cell, accounting for merges (check merge origin).
    let cell_has_data = |r: u32, c: u32| -> bool {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            return check_data(m.start_row, m.start_col);
        }
        check_data(r, c)
    };

    // Advance past a merged cell in the walking direction.
    let advance_past_merge = |r: u32, c: u32| -> (i64, i64) {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            if dr > 0 {
                return (m.end_row as i64 + 1, c as i64);
            }
            if dr < 0 {
                return (m.start_row as i64 - 1, c as i64);
            }
            if dc > 0 {
                return (r as i64, m.end_col as i64 + 1);
            }
            if dc < 0 {
                return (r as i64, m.start_col as i64 - 1);
            }
        }
        (r as i64 + dr, c as i64 + dc)
    };

    // Return merge origin for a cell, or the cell itself.
    let to_merge_origin = |r: u32, c: u32| -> snapshot_types::queries::CellPosition {
        if let Some(info) = merges::get_merge_for_cell(doc, sheets, sheet_id, grid, r, c) {
            let m = &info.merge;
            return snapshot_types::queries::CellPosition {
                row: m.start_row,
                col: m.start_col,
            };
        }
        snapshot_types::queries::CellPosition { row: r, col: c }
    };

    let clamp = |r: i64, c: i64| -> snapshot_types::queries::CellPosition {
        snapshot_types::queries::CellPosition {
            row: r.max(0).min(MAX_ROW as i64) as u32,
            col: c.max(0).min(MAX_COL as i64) as u32,
        }
    };

    let find_structural_exit_from_empty_lead_in =
        |mut scan_ri: i64, mut scan_ci: i64| -> Option<snapshot_types::queries::CellPosition> {
            if dc == 0 {
                return None;
            }

            let mut visible_empty_count = 0u8;
            let mut seen_visible_data = false;
            while in_bounds(scan_ri, scan_ci) {
                let skip = advance_skipped_cells(&mut scan_ri, &mut scan_ci);
                if skip.structural_cols {
                    if !in_bounds(scan_ri, scan_ci) {
                        return None;
                    }
                    return Some(to_merge_origin(scan_ri as u32, scan_ci as u32));
                }
                if !in_bounds(scan_ri, scan_ci) {
                    return None;
                }

                let rr = scan_ri as u32;
                let cc = scan_ci as u32;
                if is_hidden_boundary(rr, cc) {
                    return None;
                }

                if cell_has_data(rr, cc) {
                    seen_visible_data = true;
                    visible_empty_count = 0;
                } else {
                    if !seen_visible_data {
                        return None;
                    }
                    visible_empty_count = visible_empty_count.saturating_add(1);
                    if visible_empty_count > 1 {
                        return None;
                    }
                }

                scan_ri += dr;
                scan_ci += dc;
            }

            None
        };

    let start_pos = snapshot_types::queries::CellPosition {
        row: start_row,
        col: start_col,
    };

    // --- algorithm ---

    if col_is_boundary(start_col) {
        return start_pos;
    }
    let start_filter_skipped = is_filter_skipped_row(start_row, start_col);
    if is_hidden(start_row, start_col) && !start_filter_skipped {
        return start_pos;
    }
    let current_has_data = !start_filter_skipped && cell_has_data(start_row, start_col);

    // Get next position (skip past current merge if applicable)
    let (mut ri, mut ci) = advance_past_merge(start_row, start_col);

    // Already at edge
    if !in_bounds(ri, ci) {
        return start_pos;
    }
    let initial_skip = advance_skipped_cells(&mut ri, &mut ci);
    if !in_bounds(ri, ci) {
        return start_pos;
    }

    let r = ri as u32;
    let c = ci as u32;

    // Stop at hidden boundary
    if is_hidden_boundary(r, c) {
        return start_pos;
    }

    if initial_skip.structural_cols && current_has_data {
        return to_merge_origin(r, c);
    }

    let next_has_data = cell_has_data(r, c);

    if !current_has_data {
        if let Some(target) = find_structural_exit_from_empty_lead_in(ri, ci) {
            return target;
        }

        // Case 2: next has data → stop at adjacent cell
        if next_has_data {
            return to_merge_origin(r, c);
        }

        // Case 1: both empty → find first non-empty
        let mut last_visible_landing = start_pos;
        while in_bounds(ri, ci) {
            if advance_skipped_cells(&mut ri, &mut ci).filter_rows && !in_bounds(ri, ci) {
                return last_visible_landing;
            }
            if !in_bounds(ri, ci) {
                break;
            }
            let rr = ri as u32;
            let cc = ci as u32;
            if is_hidden_boundary(rr, cc) {
                return last_visible_landing;
            }
            if cell_has_data(rr, cc) {
                return to_merge_origin(rr, cc);
            }
            last_visible_landing = to_merge_origin(rr, cc);
            ri += dr;
            ci += dc;
        }
        // Hit sheet edge without finding data
        return clamp(ri - dr, ci - dc);
    }

    // Current has data
    if !next_has_data {
        // Case 3: next empty → jump over empties to next data
        let mut last_visible_landing = start_pos;
        while in_bounds(ri, ci) {
            if advance_skipped_cells(&mut ri, &mut ci).filter_rows && !in_bounds(ri, ci) {
                return last_visible_landing;
            }
            if !in_bounds(ri, ci) {
                break;
            }
            let rr = ri as u32;
            let cc = ci as u32;
            if is_hidden_boundary(rr, cc) {
                return last_visible_landing;
            }
            if cell_has_data(rr, cc) {
                return to_merge_origin(rr, cc);
            }
            last_visible_landing = to_merge_origin(rr, cc);
            ri += dr;
            ci += dc;
        }
        return clamp(ri - dr, ci - dc);
    }

    // Case 4: both have data → walk to edge of contiguous region
    let mut prev_r = start_row;
    let mut prev_c = start_col;
    while in_bounds(ri, ci) {
        let skip = advance_skipped_cells(&mut ri, &mut ci);
        if !in_bounds(ri, ci) {
            break;
        }
        let rr = ri as u32;
        let cc = ci as u32;
        if skip.structural_cols {
            return to_merge_origin(rr, cc);
        }
        if is_hidden_boundary(rr, cc) {
            return to_merge_origin(prev_r, prev_c);
        }
        if !cell_has_data(rr, cc) {
            return to_merge_origin(prev_r, prev_c);
        }
        prev_r = rr;
        prev_c = cc;
        let next = advance_past_merge(rr, cc);
        ri = next.0;
        ci = next.1;
    }
    to_merge_origin(prev_r, prev_c)
}

fn relevant_vertical_filter_ids(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    grid: &GridIndex,
    start_row: u32,
    start_col: u32,
    direction: &str,
) -> HashSet<String> {
    if !matches!(direction, "up" | "down") {
        return HashSet::new();
    }

    crate::storage::sheet::filters::get_filters_in_sheet(doc, sheets, sheet_id)
        .into_iter()
        .filter(|filter| !filter.column_filters.is_empty())
        .filter_map(|filter| {
            let (header_row, filter_start_col) =
                resolve_filter_cell_pos(grid, &filter.header_start_cell_id)?;
            let (_, filter_end_col) = resolve_filter_cell_pos(grid, &filter.header_end_cell_id)?;
            let (data_end_row, _) = resolve_filter_cell_pos(grid, &filter.data_end_cell_id)?;

            let start_col_in_range = start_col >= filter_start_col.min(filter_end_col)
                && start_col <= filter_start_col.max(filter_end_col);
            let start_row_in_body = start_row > header_row && start_row <= data_end_row;

            if start_col_in_range && start_row_in_body {
                Some(filter.id)
            } else {
                None
            }
        })
        .collect()
}

fn resolve_filter_cell_pos(grid: &GridIndex, cell_id_hex: &str) -> Option<(u32, u32)> {
    let cell_id = CellId::from_raw(hex_to_id(cell_id_hex)?);
    grid.cell_position(&cell_id)
}
