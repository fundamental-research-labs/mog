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
    let style_for_col = |col: u32| -> Option<u32> {
        col_style_map.get(&col).copied().or_else(|| {
            sheet_data
                .col_style_ranges
                .iter()
                .rev()
                .find(|range| col >= range.start_col && col <= range.end_col)
                .and_then(|range| style_remapper.emitted_cell_xf_id(range.style_id))
        })
    };

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
        width_str: Option<String>,
        custom_width: bool,
        custom_width_attr: Option<bool>,
        hidden: bool,
        hidden_attr: Option<bool>,
        best_fit: bool,
        best_fit_attr: Option<bool>,
        style: Option<u32>,
        has_width: bool,
        outline_level: Option<u8>,
        collapsed: bool,
        collapsed_attr: Option<bool>,
        phonetic: bool,
        phonetic_attr: Option<bool>,
    }

    let mut col_entries: Vec<ColEntry> = Vec::new();
    let mut emitted_cols = HashSet::new();

    for col_dim in &sheet_data.dimensions.col_widths {
        let style = style_for_col(col_dim.col);
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
            width_str: col_dim.width_str.clone(),
            custom_width: col_dim.custom_width,
            custom_width_attr: col_dim.custom_width_attr,
            hidden,
            hidden_attr: if hidden {
                Some(true)
            } else {
                col_dim.hidden_attr
            },
            best_fit: col_dim.best_fit,
            best_fit_attr: col_dim.best_fit_attr,
            style,
            has_width: col_dim.width_present.unwrap_or(true),
            outline_level: col_dim.outline_level.or(outline_level),
            collapsed: is_collapsed,
            collapsed_attr: if is_collapsed {
                Some(true)
            } else {
                col_dim.collapsed_attr
            },
            phonetic: col_dim.phonetic,
            phonetic_attr: col_dim.phonetic_attr,
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
                width_str: None,
                custom_width: false,
                custom_width_attr: None,
                hidden,
                hidden_attr: hidden.then_some(true),
                best_fit: false,
                best_fit_attr: None,
                style: style_remapper.emitted_cell_xf_id(cs.style_id),
                has_width: true,
                outline_level,
                collapsed: is_collapsed,
                collapsed_attr: is_collapsed.then_some(true),
                phonetic: false,
                phonetic_attr: None,
            });
            emitted_cols.insert(cs.col);
        }
    }

    for range in &sheet_data.col_style_ranges {
        let Some(style) = style_remapper.emitted_cell_xf_id(range.style_id) else {
            continue;
        };
        for col in range.start_col..=range.end_col {
            if emitted_cols.contains(&col) {
                continue;
            }
            let outline_level = col_outline_levels.get(&col).copied();
            let hidden = col_outline_hidden.get(&col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                width_str: None,
                custom_width: false,
                custom_width_attr: None,
                hidden,
                hidden_attr: hidden.then_some(true),
                best_fit: false,
                best_fit_attr: None,
                style: Some(style),
                has_width: false,
                outline_level,
                collapsed: is_collapsed,
                collapsed_attr: is_collapsed.then_some(true),
                phonetic: false,
                phonetic_attr: None,
            });
            emitted_cols.insert(col);
        }
    }

    for (&col, &level) in &col_outline_levels {
        if !emitted_cols.contains(&col) {
            let hidden = col_outline_hidden.get(&col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                width_str: None,
                custom_width: false,
                custom_width_attr: None,
                hidden,
                hidden_attr: hidden.then_some(true),
                best_fit: false,
                best_fit_attr: None,
                style: None,
                has_width: true,
                outline_level: Some(level),
                collapsed: is_collapsed,
                collapsed_attr: is_collapsed.then_some(true),
                phonetic: false,
                phonetic_attr: None,
            });
            emitted_cols.insert(col);
        }
    }

    for (&col, &is_collapsed) in &col_collapsed {
        if is_collapsed && !emitted_cols.contains(&col) {
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                width_str: None,
                custom_width: false,
                custom_width_attr: None,
                hidden: false,
                hidden_attr: None,
                best_fit: false,
                best_fit_attr: None,
                style: None,
                has_width: true,
                outline_level: None,
                collapsed: true,
                collapsed_attr: Some(true),
                phonetic: false,
                phonetic_attr: None,
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
                && next.width_str == start.width_str
                && next.custom_width == start.custom_width
                && next.custom_width_attr == start.custom_width_attr
                && next.hidden == start.hidden
                && next.hidden_attr == start.hidden_attr
                && next.best_fit == start.best_fit
                && next.best_fit_attr == start.best_fit_attr
                && next.style == start.style
                && next.has_width == start.has_width
                && next.outline_level == start.outline_level
                && next.collapsed == start.collapsed
                && next.collapsed_attr == start.collapsed_attr
                && next.phonetic == start.phonetic
                && next.phonetic_attr == start.phonetic_attr
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
        cw.width_str = start.width_str.clone();
        cw.custom_width = start.custom_width;
        cw.custom_width_attr = start.custom_width_attr;
        cw.hidden = start.hidden;
        cw.hidden_attr = start.hidden_attr;
        cw.best_fit = start.best_fit;
        cw.best_fit_attr = start.best_fit_attr;
        cw.style = start.style;
        cw.outline_level = start.outline_level;
        cw.collapsed = start.collapsed;
        cw.collapsed_attr = start.collapsed_attr;
        cw.phonetic = start.phonetic;
        cw.phonetic_attr = start.phonetic_attr;
        if !start.has_width {
            cw.width = None;
            cw.width_str = None;
        }
        writer.add_col(cw);

        i += 1;
    }

    for tcr in &sheet_data.dimensions.trailing_col_ranges {
        let mut cw = ColWidth::range(tcr.min, tcr.max, tcr.width);
        cw.width_str = tcr.width_str.clone();
        cw.custom_width = tcr.custom_width;
        cw.custom_width_attr = tcr.custom_width_attr;
        cw.hidden = tcr.hidden;
        cw.hidden_attr = tcr.hidden_attr;
        cw.best_fit = tcr.best_fit;
        cw.best_fit_attr = tcr.best_fit_attr;
        cw.outline_level = tcr.outline_level;
        cw.collapsed = tcr.collapsed;
        cw.collapsed_attr = tcr.collapsed_attr;
        cw.phonetic = tcr.phonetic;
        cw.phonetic_attr = tcr.phonetic_attr;
        if let Some(sid) = tcr.style_id {
            cw.style = style_remapper.emitted_cell_xf_id(sid);
        } else {
            let start_col = tcr.min.saturating_sub(1);
            let end_col = tcr.max.saturating_sub(1);
            let mut uniform_style = style_for_col(start_col);
            for col in start_col.saturating_add(1)..=end_col {
                if style_for_col(col) != uniform_style {
                    uniform_style = None;
                    break;
                }
            }
            cw.style = uniform_style;
        }
        if !tcr.width_present.unwrap_or(true) {
            cw.width = None;
            cw.width_str = None;
        }
        writer.add_col(cw);
    }
}
