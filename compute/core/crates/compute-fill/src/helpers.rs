//! Utility functions for the fill engine.

use std::collections::BTreeSet;

use crate::types::*;

/// Map a target cell position to its corresponding source cell position.
/// Uses cyclic modulo mapping — e.g., if source has 3 rows and we fill 9 rows,
/// target row 5 maps to source row 2 (5 % 3 = 2).
///
/// Cross-axis tiling is asymmetric: for Down/Up fills, columns are tiled
/// rightward only (cols left of source are unmapped). For Right/Left fills,
/// rows are tiled downward only (rows above source are unmapped). This
/// prevents autoFill from overwriting data that precedes the source range.
pub fn map_target_to_source(
    target_row: u32,
    target_col: u32,
    source_range: &FillRangeSpec,
    direction: FillDirection,
) -> (u32, u32) {
    let source_height = source_range.end_row - source_range.start_row + 1;
    let source_width = source_range.end_col - source_range.start_col + 1;

    match direction {
        FillDirection::Down => {
            // Don't tile to columns left of source — return unmapped so the
            // caller's source-cell lookup yields None and the cell is skipped.
            if target_col < source_range.start_col {
                return (target_row, target_col);
            }
            if target_row <= source_range.end_row {
                let col_offset = (target_col - source_range.start_col) % source_width;
                let source_col = source_range.start_col + col_offset;
                return (target_row, source_col);
            }
            let col_offset = (target_col - source_range.start_col) % source_width;
            let raw_offset = (target_row - source_range.end_row - 1) % source_height;
            let source_row = source_range.start_row + (raw_offset + source_height) % source_height;
            let source_col = source_range.start_col + col_offset;
            (source_row, source_col)
        }
        FillDirection::Up => {
            if target_col < source_range.start_col {
                return (target_row, target_col);
            }
            if target_row >= source_range.start_row {
                let col_offset = (target_col - source_range.start_col) % source_width;
                let source_col = source_range.start_col + col_offset;
                return (target_row, source_col);
            }
            let col_offset = (target_col - source_range.start_col) % source_width;
            let raw_offset = (source_range.start_row - target_row - 1) % source_height;
            let source_row = source_range.end_row - (raw_offset + source_height) % source_height;
            let source_col = source_range.start_col + col_offset;
            (source_row, source_col)
        }
        FillDirection::Right => {
            // Don't tile to rows above source.
            if target_row < source_range.start_row {
                return (target_row, target_col);
            }
            if target_col <= source_range.end_col {
                let row_offset = (target_row - source_range.start_row) % source_height;
                let source_row = source_range.start_row + row_offset;
                return (source_row, target_col);
            }
            let row_offset = (target_row - source_range.start_row) % source_height;
            let raw_offset = (target_col - source_range.end_col - 1) % source_width;
            let source_row = source_range.start_row + row_offset;
            let source_col = source_range.start_col + (raw_offset + source_width) % source_width;
            (source_row, source_col)
        }
        FillDirection::Left => {
            if target_row < source_range.start_row {
                return (target_row, target_col);
            }
            if target_col >= source_range.start_col {
                let row_offset = (target_row - source_range.start_row) % source_height;
                let source_row = source_range.start_row + row_offset;
                return (source_row, target_col);
            }
            let row_offset = (target_row - source_range.start_row) % source_height;
            let raw_offset = (source_range.start_col - target_col - 1) % source_width;
            let source_row = source_range.start_row + row_offset;
            let source_col = source_range.end_col - (raw_offset + source_width) % source_width;
            (source_row, source_col)
        }
    }
}

/// Determine fill direction from source and target ranges.
pub fn compute_fill_direction(
    source_range: &FillRangeSpec,
    target_range: &FillRangeSpec,
) -> FillDirection {
    if target_range.end_row > source_range.end_row {
        FillDirection::Down
    } else if target_range.start_row < source_range.start_row {
        FillDirection::Up
    } else if target_range.end_col > source_range.end_col {
        FillDirection::Right
    } else if target_range.start_col < source_range.start_col {
        FillDirection::Left
    } else {
        // Default: same range or overlapping — treat as Down
        FillDirection::Down
    }
}

/// Check if (row, col) is inside a merge but NOT the top-left origin.
pub fn is_non_origin_merged_cell(merges: &[MergeRegion], row: u32, col: u32) -> bool {
    for merge in merges {
        if row >= merge.start_row
            && row <= merge.end_row
            && col >= merge.start_col
            && col <= merge.end_col
        {
            let is_origin = row == merge.start_row && col == merge.start_col;
            if !is_origin {
                return true;
            }
        }
    }
    false
}

/// Count visible cells along a single lane in a range.
///
/// For vertical fill (column lane): counts visible rows in the range.
/// For horizontal fill (row lane): counts visible cols in the range.
/// Returns 0 if the lane itself is hidden.
pub fn count_visible_cells_on_lane(
    range: &FillRangeSpec,
    lane: u32,
    is_vertical: bool,
    hidden_rows: &BTreeSet<u32>,
    hidden_cols: &BTreeSet<u32>,
) -> usize {
    if is_vertical {
        // Vertical fill: lane is a column. Count visible rows.
        if hidden_cols.contains(&lane) {
            return 0;
        }
        (range.start_row..=range.end_row)
            .filter(|r| !hidden_rows.contains(r))
            .count()
    } else {
        // Horizontal fill: lane is a row. Count visible cols.
        if hidden_rows.contains(&lane) {
            return 0;
        }
        (range.start_col..=range.end_col)
            .filter(|c| !hidden_cols.contains(c))
            .count()
    }
}

/// Count visible cells in a range (excluding hidden rows/cols).
pub fn count_visible_cells(
    range: &FillRangeSpec,
    hidden_rows: &BTreeSet<u32>,
    hidden_cols: &BTreeSet<u32>,
) -> u32 {
    let mut count = 0u32;
    for row in range.start_row..=range.end_row {
        if hidden_rows.contains(&row) {
            continue;
        }
        for col in range.start_col..=range.end_col {
            if hidden_cols.contains(&col) {
                continue;
            }
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(sr: u32, sc: u32, er: u32, ec: u32) -> FillRangeSpec {
        FillRangeSpec {
            start_row: sr,
            start_col: sc,
            end_row: er,
            end_col: ec,
        }
    }

    // ── map_target_to_source: Down ───────────────────────────────────

    #[test]
    fn map_down_first_target_row() {
        let src = range(0, 0, 2, 0);
        assert_eq!(
            map_target_to_source(3, 0, &src, FillDirection::Down),
            (0, 0)
        );
    }

    #[test]
    fn map_down_second_target_row() {
        let src = range(0, 0, 2, 0);
        assert_eq!(
            map_target_to_source(4, 0, &src, FillDirection::Down),
            (1, 0)
        );
    }

    #[test]
    fn map_down_third_target_row() {
        let src = range(0, 0, 2, 0);
        assert_eq!(
            map_target_to_source(5, 0, &src, FillDirection::Down),
            (2, 0)
        );
    }

    #[test]
    fn map_down_cyclic_wrap() {
        let src = range(0, 0, 2, 0);
        assert_eq!(
            map_target_to_source(6, 0, &src, FillDirection::Down),
            (0, 0)
        );
    }

    #[test]
    fn map_down_multi_col() {
        let src = range(5, 2, 6, 4);
        assert_eq!(
            map_target_to_source(7, 3, &src, FillDirection::Down),
            (5, 3)
        );
        assert_eq!(
            map_target_to_source(8, 4, &src, FillDirection::Down),
            (6, 4)
        );
    }

    // ── map_target_to_source: Up ─────────────────────────────────────

    #[test]
    fn map_up_first_target_row() {
        let src = range(5, 0, 7, 0);
        assert_eq!(map_target_to_source(4, 0, &src, FillDirection::Up), (7, 0));
    }

    #[test]
    fn map_up_second_target_row() {
        let src = range(5, 0, 7, 0);
        assert_eq!(map_target_to_source(3, 0, &src, FillDirection::Up), (6, 0));
    }

    #[test]
    fn map_up_third_target_row() {
        let src = range(5, 0, 7, 0);
        assert_eq!(map_target_to_source(2, 0, &src, FillDirection::Up), (5, 0));
    }

    #[test]
    fn map_up_cyclic_wrap() {
        let src = range(5, 0, 7, 0);
        assert_eq!(map_target_to_source(1, 0, &src, FillDirection::Up), (7, 0));
    }

    // ── map_target_to_source: Right ──────────────────────────────────

    #[test]
    fn map_right_first_target_col() {
        let src = range(0, 0, 0, 2);
        assert_eq!(
            map_target_to_source(0, 3, &src, FillDirection::Right),
            (0, 0)
        );
    }

    #[test]
    fn map_right_second_target_col() {
        let src = range(0, 0, 0, 2);
        assert_eq!(
            map_target_to_source(0, 4, &src, FillDirection::Right),
            (0, 1)
        );
    }

    #[test]
    fn map_right_cyclic_wrap() {
        let src = range(0, 0, 0, 2);
        assert_eq!(
            map_target_to_source(0, 6, &src, FillDirection::Right),
            (0, 0)
        );
    }

    // ── map_target_to_source: Left ───────────────────────────────────

    #[test]
    fn map_left_first_target_col() {
        let src = range(0, 5, 0, 7);
        assert_eq!(
            map_target_to_source(0, 4, &src, FillDirection::Left),
            (0, 7)
        );
    }

    #[test]
    fn map_left_second_target_col() {
        let src = range(0, 5, 0, 7);
        assert_eq!(
            map_target_to_source(0, 3, &src, FillDirection::Left),
            (0, 6)
        );
    }

    #[test]
    fn map_left_third_target_col() {
        // Source: cols 5, 6, 7. Target col 2: 3 cols left of start.
        // col 4 -> 7, col 3 -> 6, col 2 -> 5
        let src = range(0, 5, 0, 7);
        assert_eq!(
            map_target_to_source(0, 2, &src, FillDirection::Left),
            (0, 5)
        );
    }

    #[test]
    fn map_left_cyclic_wrap() {
        // Source: cols 5, 6, 7 (width=3). Target col 1: 4 cols left of start.
        // col 4 -> 7, col 3 -> 6, col 2 -> 5, col 1 -> 7 (wraps)
        let src = range(0, 5, 0, 7);
        assert_eq!(
            map_target_to_source(0, 1, &src, FillDirection::Left),
            (0, 7)
        );
    }

    // ── compute_fill_direction ────────────────────────────────────────

    #[test]
    fn direction_down() {
        assert_eq!(
            compute_fill_direction(&range(0, 0, 2, 2), &range(3, 0, 5, 2)),
            FillDirection::Down
        );
    }

    #[test]
    fn direction_up() {
        assert_eq!(
            compute_fill_direction(&range(5, 0, 7, 2), &range(2, 0, 4, 2)),
            FillDirection::Up
        );
    }

    #[test]
    fn direction_right() {
        assert_eq!(
            compute_fill_direction(&range(0, 0, 2, 2), &range(0, 3, 2, 5)),
            FillDirection::Right
        );
    }

    #[test]
    fn direction_left() {
        assert_eq!(
            compute_fill_direction(&range(0, 5, 2, 7), &range(0, 2, 2, 4)),
            FillDirection::Left
        );
    }

    #[test]
    fn direction_default_same_range() {
        assert_eq!(
            compute_fill_direction(&range(0, 0, 2, 2), &range(0, 0, 2, 2)),
            FillDirection::Down
        );
    }

    // ── is_non_origin_merged_cell ─────────────────────────────────────

    #[test]
    fn merge_origin_returns_false() {
        let merges = vec![MergeRegion {
            start_row: 2,
            start_col: 3,
            end_row: 4,
            end_col: 5,
        }];
        assert!(!is_non_origin_merged_cell(&merges, 2, 3));
    }

    #[test]
    fn merge_non_origin_returns_true() {
        let merges = vec![MergeRegion {
            start_row: 2,
            start_col: 3,
            end_row: 4,
            end_col: 5,
        }];
        assert!(is_non_origin_merged_cell(&merges, 3, 4));
    }

    #[test]
    fn merge_outside_returns_false() {
        let merges = vec![MergeRegion {
            start_row: 2,
            start_col: 3,
            end_row: 4,
            end_col: 5,
        }];
        assert!(!is_non_origin_merged_cell(&merges, 0, 0));
    }

    #[test]
    fn merge_bottom_right_corner_non_origin() {
        let merges = vec![MergeRegion {
            start_row: 2,
            start_col: 3,
            end_row: 4,
            end_col: 5,
        }];
        assert!(is_non_origin_merged_cell(&merges, 4, 5));
    }

    #[test]
    fn no_merges_returns_false() {
        assert!(!is_non_origin_merged_cell(&[], 0, 0));
    }

    #[test]
    fn multiple_merges_non_origin_in_second() {
        let merges = vec![
            MergeRegion {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 1,
            },
            MergeRegion {
                start_row: 5,
                start_col: 5,
                end_row: 7,
                end_col: 7,
            },
        ];
        assert!(is_non_origin_merged_cell(&merges, 6, 6));
        assert!(!is_non_origin_merged_cell(&merges, 5, 5)); // origin of second
    }

    // ── count_visible_cells ──────────────────────────────────────────

    #[test]
    fn count_all_visible() {
        assert_eq!(
            count_visible_cells(&range(0, 0, 2, 2), &BTreeSet::new(), &BTreeSet::new()),
            9
        );
    }

    #[test]
    fn count_with_hidden_rows() {
        let hidden_rows: BTreeSet<u32> = [1].into();
        assert_eq!(
            count_visible_cells(&range(0, 0, 2, 2), &hidden_rows, &BTreeSet::new()),
            6
        );
    }

    #[test]
    fn count_with_hidden_cols() {
        let hidden_cols: BTreeSet<u32> = [0, 2].into();
        assert_eq!(
            count_visible_cells(&range(0, 0, 2, 2), &BTreeSet::new(), &hidden_cols),
            3
        );
    }

    #[test]
    fn count_with_hidden_rows_and_cols() {
        let hidden_rows: BTreeSet<u32> = [1].into();
        let hidden_cols: BTreeSet<u32> = [0].into();
        assert_eq!(
            count_visible_cells(&range(0, 0, 2, 2), &hidden_rows, &hidden_cols),
            4
        );
    }

    #[test]
    fn count_single_cell_visible() {
        assert_eq!(
            count_visible_cells(&range(5, 5, 5, 5), &BTreeSet::new(), &BTreeSet::new()),
            1
        );
    }

    #[test]
    fn count_single_cell_hidden() {
        let hidden_rows: BTreeSet<u32> = [5].into();
        assert_eq!(
            count_visible_cells(&range(5, 5, 5, 5), &hidden_rows, &BTreeSet::new()),
            0
        );
    }

    #[test]
    fn count_hidden_outside_range_ignored() {
        // Hidden rows/cols outside the range should not affect count
        let hidden_rows: BTreeSet<u32> = [10, 20].into();
        let hidden_cols: BTreeSet<u32> = [10, 20].into();
        assert_eq!(
            count_visible_cells(&range(0, 0, 2, 2), &hidden_rows, &hidden_cols),
            9
        );
    }

    // ── Reproduction tests: overlapping source/target u32 underflow ──
    //
    // When the target range overlaps the source range, some target cells
    // fall within the source bounds. The current implementation computes
    // e.g. `target_row - source_range.end_row - 1` which underflows for
    // u32 when target_row <= source_range.end_row. These tests document
    // the CORRECT cyclic mapping behavior and should FAIL (panic in debug
    // mode due to u32 underflow) until the bug is fixed.

    #[test]
    fn map_down_overlapping_target_within_source() {
        // Source: A1:A3 = rows 0–2, col 0. Target: A2:A6 = rows 1–5, col 0.
        // Rows 1 and 2 overlap with source. They should map cyclically back
        // into the source range.
        //
        // The fill pattern repeats the source (rows 0,1,2) cyclically.
        // For FillDirection::Down, target cells after the source map as:
        //   row 3 -> source row 0, row 4 -> source row 1, row 5 -> source row 2
        // Overlapping target cells should also map cyclically:
        //   row 1 -> source row 1 (identity, it IS source row 1)
        //   row 2 -> source row 2 (identity, it IS source row 2)
        let src = range(0, 0, 2, 0);

        // Row 1 is within the source range (0..=2). Should map to source row 1.
        // BUG: 1 - 2 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(1, 0, &src, FillDirection::Down),
            (1, 0)
        );

        // Row 2 is the last source row. Should map to source row 2.
        // BUG: 2 - 2 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(2, 0, &src, FillDirection::Down),
            (2, 0)
        );
    }

    #[test]
    fn map_up_overlapping_target_within_source() {
        // Source: rows 5–7, col 0. Target: rows 3–6, col 0.
        // Rows 5 and 6 overlap with source. They should map cyclically.
        //
        // For FillDirection::Up, target cells before the source map as:
        //   row 4 -> source row 7, row 3 -> source row 6, row 2 -> source row 5
        // Overlapping target cells should map cyclically:
        //   row 6 -> source row 6 (identity)
        //   row 5 -> source row 5 (identity)
        let src = range(5, 0, 7, 0);

        // Row 6 is within source (5..=7). Should map to source row 6.
        // BUG: 5 - 6 - 1 = u32 underflow
        assert_eq!(map_target_to_source(6, 0, &src, FillDirection::Up), (6, 0));

        // Row 5 is the first source row. Should map to source row 5.
        // BUG: 5 - 5 - 1 = u32 underflow
        assert_eq!(map_target_to_source(5, 0, &src, FillDirection::Up), (5, 0));
    }

    #[test]
    fn map_right_overlapping_target_within_source() {
        // Source: row 0, cols 0–2. Target: row 0, cols 1–5.
        // Cols 1 and 2 overlap with source. They should map cyclically.
        //
        // For FillDirection::Right, target cells after the source map as:
        //   col 3 -> source col 0, col 4 -> source col 1, col 5 -> source col 2
        // Overlapping target cells should map cyclically:
        //   col 1 -> source col 1 (identity)
        //   col 2 -> source col 2 (identity)
        let src = range(0, 0, 0, 2);

        // Col 1 is within source (0..=2). Should map to source col 1.
        // BUG: 1 - 2 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(0, 1, &src, FillDirection::Right),
            (0, 1)
        );

        // Col 2 is the last source col. Should map to source col 2.
        // BUG: 2 - 2 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(0, 2, &src, FillDirection::Right),
            (0, 2)
        );
    }

    #[test]
    fn map_left_overlapping_target_within_source() {
        // Source: row 0, cols 5–7. Target: row 0, cols 3–6.
        // Cols 5 and 6 overlap with source. They should map cyclically.
        //
        // For FillDirection::Left, target cells before the source map as:
        //   col 4 -> source col 7, col 3 -> source col 6, col 2 -> source col 5
        // Overlapping target cells should map cyclically:
        //   col 6 -> source col 6 (identity)
        //   col 5 -> source col 5 (identity)
        let src = range(0, 5, 0, 7);

        // Col 6 is within source (5..=7). Should map to source col 6.
        // BUG: 5 - 6 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(0, 6, &src, FillDirection::Left),
            (0, 6)
        );

        // Col 5 is the first source col. Should map to source col 5.
        // BUG: 5 - 5 - 1 = u32 underflow
        assert_eq!(
            map_target_to_source(0, 5, &src, FillDirection::Left),
            (0, 5)
        );
    }

    // ── map_target_to_source: wider target (multi-dimension) ────────

    #[test]
    fn map_down_wider_target_overlap_row() {
        // Source: B7 (row=6, col=1), Target: B7:E10 (row=6..9, col=1..4)
        let src = range(6, 1, 6, 1);
        // C7 (row=6, col=2) should map back to source col 1 (B)
        assert_eq!(
            map_target_to_source(6, 2, &src, FillDirection::Down),
            (6, 1)
        );
        // D7 (row=6, col=3) should also map to source col 1
        assert_eq!(
            map_target_to_source(6, 3, &src, FillDirection::Down),
            (6, 1)
        );
        // E7 (row=6, col=4) should also map to source col 1
        assert_eq!(
            map_target_to_source(6, 4, &src, FillDirection::Down),
            (6, 1)
        );
    }

    #[test]
    fn map_down_wider_target_extension_rows() {
        // Source: B7 (row=6, col=1), Target: B7:E10
        let src = range(6, 1, 6, 1);
        // C8 (row=7, col=2) should map back to (6, 1)
        assert_eq!(
            map_target_to_source(7, 2, &src, FillDirection::Down),
            (6, 1)
        );
        // D9 (row=8, col=3) should map to (6, 1)
        assert_eq!(
            map_target_to_source(8, 3, &src, FillDirection::Down),
            (6, 1)
        );
    }

    #[test]
    fn map_down_wider_target_multi_col_source() {
        // Source: B7:C7 (row=6, col=1..2), Target: B7:F10 (row=6..9, col=1..5)
        let src = range(6, 1, 6, 2);
        // D7 (col=3) should map to col 1 (B) — cyclic: (3-1) % 2 = 0 → col 1
        assert_eq!(
            map_target_to_source(6, 3, &src, FillDirection::Down),
            (6, 1)
        );
        // E7 (col=4) should map to col 2 (C) — cyclic: (4-1) % 2 = 1 → col 2
        assert_eq!(
            map_target_to_source(6, 4, &src, FillDirection::Down),
            (6, 2)
        );
        // F7 (col=5) should map to col 1 (B) — cyclic: (5-1) % 2 = 0 → col 1
        assert_eq!(
            map_target_to_source(6, 5, &src, FillDirection::Down),
            (6, 1)
        );
    }

    #[test]
    fn map_up_wider_target() {
        // Source: row=7, col=1 (single cell). Target extends up and wider.
        let src = range(7, 1, 7, 1);
        // Row 6, col 2 should map to (7, 1) — up direction, col cyclically mapped
        assert_eq!(map_target_to_source(6, 2, &src, FillDirection::Up), (7, 1));
        // Row 7 (overlap), col 2 should map to (7, 1)
        assert_eq!(map_target_to_source(7, 2, &src, FillDirection::Up), (7, 1));
    }

    #[test]
    fn map_right_wider_target() {
        // Source: row=0, col=0 (single cell). Target extends right and taller.
        let src = range(0, 0, 0, 0);
        // Row 1, col 1 should map to (0, 0)
        assert_eq!(
            map_target_to_source(1, 1, &src, FillDirection::Right),
            (0, 0)
        );
        // Row 0 (overlap), col 0 would be source itself; row 1, col 0 is outside
        assert_eq!(
            map_target_to_source(1, 0, &src, FillDirection::Right),
            (0, 0)
        );
    }

    #[test]
    fn map_left_wider_target() {
        // Source: row=0, col=5 (single cell). Target extends left and taller.
        let src = range(0, 5, 0, 5);
        // Row 1, col 4 should map to (0, 5)
        assert_eq!(
            map_target_to_source(1, 4, &src, FillDirection::Left),
            (0, 5)
        );
        // Row 0 (overlap), col 5 would be source itself; row 1, col 5 is outside
        assert_eq!(
            map_target_to_source(1, 5, &src, FillDirection::Left),
            (0, 5)
        );
    }

    // ── Asymmetric tiling: leftward/upward extensions are unmapped ────

    #[test]
    fn map_down_leftward_col_returns_unmapped() {
        // Source: C1:E1 (row=0, col=2..4). Target extends left to A (col=0).
        // Columns left of source should NOT be tiled — return unmapped position.
        let src = range(0, 2, 0, 4);
        // A1 (col=0) is left of source → unmapped
        assert_eq!(
            map_target_to_source(0, 0, &src, FillDirection::Down),
            (0, 0)
        );
        // B2 (col=1) is left of source → unmapped
        assert_eq!(
            map_target_to_source(1, 1, &src, FillDirection::Down),
            (1, 1)
        );
    }

    #[test]
    fn map_down_rightward_col_is_tiled() {
        // Same source C1:E1. Columns right of source ARE tiled.
        let src = range(0, 2, 0, 4);
        // F1 (col=5): (5-2) % 3 = 0 → source col 2 (C)
        assert_eq!(
            map_target_to_source(0, 5, &src, FillDirection::Down),
            (0, 2)
        );
        // G1 (col=6): (6-2) % 3 = 1 → source col 3 (D)
        assert_eq!(
            map_target_to_source(0, 6, &src, FillDirection::Down),
            (0, 3)
        );
        // G2 (col=6, row=1): maps to source (0, 3)
        assert_eq!(
            map_target_to_source(1, 6, &src, FillDirection::Down),
            (0, 3)
        );
    }

    #[test]
    fn map_right_upward_row_returns_unmapped() {
        // Source: A3:C3 (row=2, col=0..2). Target extends up to row 0.
        // Rows above source should NOT be tiled.
        let src = range(2, 0, 2, 2);
        // A1 (row=0) is above source → unmapped
        assert_eq!(
            map_target_to_source(0, 3, &src, FillDirection::Right),
            (0, 3)
        );
    }

    #[test]
    fn map_right_downward_row_is_tiled() {
        // Same source A3:C3. Rows below source ARE tiled.
        let src = range(2, 0, 2, 2);
        // Row 3, col 3: row_offset = (3-2) % 1 = 0 → source row 2
        assert_eq!(
            map_target_to_source(3, 3, &src, FillDirection::Right),
            (2, 0)
        );
    }
}
