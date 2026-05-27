use super::*;

// =============================================================================
// Domain conversions: Outline groups
// =============================================================================

/// Compute `OutlineGroup` entries from row heights and column widths.
///
/// Outline groups in OOXML are encoded implicitly: each row/column has an
/// `outline_level` (0-7) and a `collapsed` flag. We scan for consecutive runs
/// of rows/columns at each level and emit one `OutlineGroup` per run.
///
/// Level 0 means "not in any group" and is skipped.
pub(crate) fn compute_outline_groups(
    row_heights: &[RowHeight],
    col_widths: &[ColWidth],
) -> Vec<OutlineGroup> {
    let mut groups = Vec::new();

    // --- Row outline groups ---
    // Sort by row index to ensure consecutive grouping
    let mut row_entries: Vec<(u32, u8, bool, bool)> = row_heights
        .iter()
        .filter_map(|rh| {
            let level = rh.outline_level.unwrap_or(0);
            if level == 0 {
                return None;
            }
            let collapsed = rh.collapsed.unwrap_or(false);
            let hidden = rh.hidden.unwrap_or(false);
            Some((rh.row, level, collapsed, hidden))
        })
        .collect();
    row_entries.sort_by_key(|&(row, ..)| row);

    collect_outline_runs(&row_entries, true, &mut groups);

    // --- Column outline groups ---
    // ColWidth spans a range (min..=max, 1-indexed), expand each range entry
    let mut col_entries: Vec<(u32, u8, bool, bool)> = Vec::new();
    for cw in col_widths {
        let level = cw.outline_level.unwrap_or(0);
        if level == 0 {
            continue;
        }
        let collapsed = cw.collapsed;
        let hidden = cw.hidden;
        // min/max are 1-indexed in OOXML, convert to 0-indexed
        let start = cw.min.saturating_sub(1);
        let end = cw.max.saturating_sub(1);
        for col in start..=end {
            col_entries.push((col, level, collapsed, hidden));
        }
    }
    col_entries.sort_by_key(|&(col, ..)| col);
    col_entries.dedup_by_key(|entry| entry.0); // deduplicate in case of overlapping ranges

    collect_outline_runs(&col_entries, false, &mut groups);

    // In OOXML, the `collapsed` attribute typically goes on the row/col AFTER
    // the outline group end, not on the group members themselves. Scan all
    // rows/cols for `collapsed=true` and mark the matching outline group.
    // When collapsed comes from this path, `collapsed_on_member` stays false
    // (meaning the writer should put collapsed on `end + 1`).
    for cw in col_widths {
        if cw.collapsed {
            let collapsed_col_0 = cw.min.saturating_sub(1); // 0-indexed
            if collapsed_col_0 > 0 {
                let group_end = collapsed_col_0 - 1;
                for g in groups.iter_mut() {
                    if !g.is_row && g.end == group_end {
                        g.collapsed = true;
                        g.collapsed_on_member = false;
                    }
                }
            }
        }
    }
    for rh in row_heights {
        if rh.collapsed == Some(true) {
            let collapsed_row = rh.row;
            if collapsed_row > 0 {
                let group_end = collapsed_row - 1;
                for g in groups.iter_mut() {
                    if g.is_row && g.end == group_end {
                        g.collapsed = true;
                        g.collapsed_on_member = false;
                    }
                }
            }
        }
    }

    groups
}

/// Collect consecutive runs of items at the same outline level into `OutlineGroup`s.
///
/// Items must be pre-sorted by index. A run breaks when:
/// - The level changes
/// - The index is not consecutive (gap > 1)
///
/// Each level gets its own groups — level 2 rows inside a level 1 range
/// become separate OutlineGroup entries (the caller can reconstruct hierarchy
/// from the level field).
fn collect_outline_runs(
    entries: &[(u32, u8, bool, bool)], // (index, level, collapsed, hidden)
    is_row: bool,
    groups: &mut Vec<OutlineGroup>,
) {
    if entries.is_empty() {
        return;
    }

    let mut start = entries[0].0;
    let mut end = entries[0].0;
    let mut level = entries[0].1;
    let mut collapsed = entries[0].2;
    let mut hidden = entries[0].3;

    for &(idx, lv, col, hid) in &entries[1..] {
        if lv == level && idx == end + 1 && col == collapsed && hid == hidden {
            // Extend current run (same level, consecutive, same collapsed & hidden state)
            end = idx;
        } else {
            // Emit previous run.  When collapsed was detected from a group
            // member (outlineLevel > 0), mark `collapsed_on_member = true` so
            // the writer places the attribute on `end` instead of `end + 1`.
            groups.push(OutlineGroup {
                is_row,
                start,
                end,
                level: level as u32,
                collapsed,
                hidden,
                collapsed_on_member: collapsed,
            });
            // Start new run
            start = idx;
            end = idx;
            level = lv;
            collapsed = col;
            hidden = hid;
        }
    }
    // Emit final run
    groups.push(OutlineGroup {
        is_row,
        start,
        end,
        level: level as u32,
        collapsed,
        hidden,
        collapsed_on_member: collapsed,
    });
}
