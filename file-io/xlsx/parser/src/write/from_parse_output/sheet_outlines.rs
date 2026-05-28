use std::collections::HashMap;

use domain_types::OutlineGroup;

use crate::write::sheet::SheetWriter;

/// Apply outline groups to the sheet writer - rows only.
/// Column outline levels are handled during column coalescing in `build_sheet`.
pub(super) fn apply_outline_groups_rows_only(writer: &mut SheetWriter, groups: &[OutlineGroup]) {
    let mut row_levels: HashMap<u32, u8> = HashMap::new();
    let mut row_hidden: HashMap<u32, bool> = HashMap::new();
    let mut row_collapsed: HashMap<u32, bool> = HashMap::new();

    let mut max_row_level: u8 = 0;

    for group in groups {
        if !group.is_row {
            continue;
        }
        let level = (group.level as u8).min(7);
        max_row_level = max_row_level.max(level);
        for r in group.start..=group.end {
            let entry = row_levels.entry(r).or_insert(0);
            *entry = (*entry).max(level);
            if group.hidden {
                row_hidden.insert(r, true);
            }
        }
        if group.collapsed {
            if group.collapsed_on_member {
                for r in group.start..=group.end {
                    row_collapsed.insert(r, true);
                }
            } else {
                row_collapsed.insert(group.end + 1, true);
            }
        }
    }

    for (&row, &level) in &row_levels {
        writer.set_row_outline_level(row, level);
    }
    for (&row, &hidden) in &row_hidden {
        if hidden {
            writer.set_row_hidden(row, true);
        }
    }
    for (&row, &collapsed) in &row_collapsed {
        writer.set_row_collapsed(row, collapsed);
    }

    if max_row_level > 0 {
        writer.set_sheet_format_outline_level_row(max_row_level);
    }
}
