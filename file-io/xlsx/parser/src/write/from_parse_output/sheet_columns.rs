use std::collections::{HashMap, HashSet};

use domain_types::SheetData;

use super::style_remap::StyleExportRemapper;
use crate::write::sheet::{ColWidth, SheetWriter};

pub(super) fn apply_columns(
    writer: &mut SheetWriter,
    sheet_data: &SheetData,
    style_remapper: &StyleExportRemapper,
) {
    let col_style_map: HashMap<u32, u32> = sheet_data
        .col_styles
        .iter()
        .filter_map(|cs| {
            style_remapper
                .emitted_cell_xf_id(cs.style_id)
                .map(|style_id| (cs.col, style_id))
        })
        .collect();

    let mut col_outline_levels: HashMap<u32, u8> = HashMap::new();
    let mut col_outline_hidden: HashMap<u32, bool> = HashMap::new();
    let mut col_collapsed: HashMap<u32, bool> = HashMap::new();
    for group in &sheet_data.outline_groups {
        if group.is_row {
            continue;
        }
        let level = (group.level as u8).min(7);
        for c in group.start..=group.end {
            let entry = col_outline_levels.entry(c).or_insert(0);
            *entry = (*entry).max(level);
            if group.hidden {
                col_outline_hidden.insert(c, true);
            }
        }
        if group.collapsed {
            if group.collapsed_on_member {
                for c in group.start..=group.end {
                    col_collapsed.insert(c, true);
                }
            } else {
                col_collapsed.insert(group.end + 1, true);
            }
        }
    }

    struct ColEntry {
        col_0: u32,
        width: f64,
        custom_width: bool,
        hidden: bool,
        best_fit: bool,
        style: Option<u32>,
        has_width: bool,
        outline_level: Option<u8>,
        collapsed: bool,
        phonetic: bool,
    }

    let mut col_entries: Vec<ColEntry> = Vec::new();
    let mut emitted_cols = HashSet::new();

    for col_dim in &sheet_data.dimensions.col_widths {
        let style = col_style_map.get(&col_dim.col).copied();
        let outline_level = col_outline_levels.get(&col_dim.col).copied();
        let hidden = col_dim.hidden
            || col_outline_hidden
                .get(&col_dim.col)
                .copied()
                .unwrap_or(false);
        let is_collapsed =
            col_collapsed.get(&col_dim.col).copied().unwrap_or(false) || col_dim.collapsed;
        col_entries.push(ColEntry {
            col_0: col_dim.col,
            width: col_dim.width,
            custom_width: col_dim.custom_width,
            hidden,
            best_fit: col_dim.best_fit,
            style,
            has_width: true,
            outline_level,
            collapsed: is_collapsed,
            phonetic: col_dim.phonetic,
        });
        emitted_cols.insert(col_dim.col);
    }

    let default_cw = sheet_data.dimensions.default_col_width.unwrap_or(8.43);
    for cs in &sheet_data.col_styles {
        if !emitted_cols.contains(&cs.col) {
            let outline_level = col_outline_levels.get(&cs.col).copied();
            let hidden = col_outline_hidden.get(&cs.col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&cs.col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: cs.col,
                width: default_cw,
                custom_width: false,
                hidden,
                best_fit: false,
                style: style_remapper.emitted_cell_xf_id(cs.style_id),
                has_width: true,
                outline_level,
                collapsed: is_collapsed,
                phonetic: false,
            });
            emitted_cols.insert(cs.col);
        }
    }

    for (&col, &level) in &col_outline_levels {
        if !emitted_cols.contains(&col) {
            let hidden = col_outline_hidden.get(&col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                custom_width: false,
                hidden,
                best_fit: false,
                style: None,
                has_width: true,
                outline_level: Some(level),
                collapsed: is_collapsed,
                phonetic: false,
            });
            emitted_cols.insert(col);
        }
    }

    for (&col, &is_collapsed) in &col_collapsed {
        if is_collapsed && !emitted_cols.contains(&col) {
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                custom_width: false,
                hidden: false,
                best_fit: false,
                style: None,
                has_width: true,
                outline_level: None,
                collapsed: true,
                phonetic: false,
            });
        }
    }

    col_entries.sort_by_key(|e| e.col_0);

    let mut i = 0;
    while i < col_entries.len() {
        let start_idx = i;
        let start = &col_entries[start_idx];
        let mut max_col_0 = start.col_0;

        while i + 1 < col_entries.len() {
            let next = &col_entries[i + 1];
            if next.col_0 == max_col_0 + 1
                && next.width == start.width
                && next.custom_width == start.custom_width
                && next.hidden == start.hidden
                && next.best_fit == start.best_fit
                && next.style == start.style
                && next.has_width == start.has_width
                && next.outline_level == start.outline_level
                && next.collapsed == start.collapsed
                && next.phonetic == start.phonetic
            {
                max_col_0 = next.col_0;
                i += 1;
            } else {
                break;
            }
        }

        let min_1 = start.col_0 + 1;
        let max_1 = max_col_0 + 1;
        let mut cw = ColWidth::range(min_1, max_1, start.width);
        cw.custom_width = start.custom_width;
        cw.hidden = start.hidden;
        cw.best_fit = start.best_fit;
        cw.style = start.style;
        cw.outline_level = start.outline_level;
        cw.collapsed = start.collapsed;
        cw.phonetic = start.phonetic;
        if !start.has_width {
            cw.width = None;
        }
        writer.add_col(cw);

        i += 1;
    }

    for tcr in &sheet_data.dimensions.trailing_col_ranges {
        let mut cw = ColWidth::range(tcr.min, tcr.max, tcr.width);
        cw.custom_width = tcr.custom_width;
        cw.hidden = tcr.hidden;
        cw.best_fit = tcr.best_fit;
        cw.collapsed = tcr.collapsed;
        cw.phonetic = tcr.phonetic;
        if let Some(sid) = tcr.style_id {
            cw.style = style_remapper.emitted_cell_xf_id(sid);
        }
        writer.add_col(cw);
    }
}
