use super::cell;
use super::data::authored_style_cells_for_row;
use super::{CellData, RowDef, SheetWriter};
use crate::domain::print::write::format_f64;
use crate::write::xml_writer::XmlWriter;
use domain_types::AuthoredStyleRun;

pub(super) fn calculate_dimension(sheet: &SheetWriter) -> Option<(u32, u32, u32, u32)> {
    if let Some(dim) = sheet.dimension {
        return Some(dim);
    }

    let mut min_row = u32::MAX;
    let mut max_row = 0u32;
    let mut min_col = u32::MAX;
    let mut max_col = 0u32;

    for (&row_idx, (_, cells)) in &sheet.rows {
        if !cells.is_empty() {
            min_row = min_row.min(row_idx);
            max_row = max_row.max(row_idx);

            for cell in cells {
                min_col = min_col.min(cell.col);
                max_col = max_col.max(cell.col);
            }
        }
    }

    for run in &sheet.authored_style_runs {
        if run.start_row <= run.end_row && run.start_col <= run.end_col {
            min_row = min_row.min(run.start_row);
            max_row = max_row.max(run.end_row);
            min_col = min_col.min(run.start_col);
            max_col = max_col.max(run.end_col);
        }
    }

    if min_row <= max_row && min_col <= max_col {
        Some((min_row, min_col, max_row, max_col))
    } else {
        None
    }
}

pub(super) fn write_sheet_data(w: &mut XmlWriter, sheet: &SheetWriter) {
    w.start_element("sheetData").end_attrs();

    let mut runs: Vec<&AuthoredStyleRun> = sheet.authored_style_runs.iter().collect();
    runs.sort_by_key(|run| {
        (
            run.start_row,
            run.start_col,
            run.end_row,
            run.end_col,
            run.style_id,
        )
    });

    let mut row_iter = sheet.rows.iter().peekable();
    let mut run_idx = 0usize;
    let mut active_runs: Vec<&AuthoredStyleRun> = Vec::new();
    let mut current_row = match (row_iter.peek(), runs.first()) {
        (Some((row, _)), Some(run)) => (**row).min(run.start_row),
        (Some((row, _)), None) => **row,
        (None, Some(run)) => run.start_row,
        (None, None) => {
            w.end_element("sheetData");
            return;
        }
    };

    loop {
        while run_idx < runs.len() && runs[run_idx].start_row <= current_row {
            active_runs.push(runs[run_idx]);
            run_idx += 1;
        }
        active_runs.retain(|run| run.end_row >= current_row);

        let row_entry = if row_iter.peek().is_some_and(|(row, _)| **row == current_row) {
            row_iter.next().map(|(_, entry)| entry)
        } else {
            None
        };
        let empty_row;
        let (row_def, cells) = match row_entry {
            Some((row_def, cells)) => (row_def, cells.as_slice()),
            None => {
                empty_row = RowDef::default();
                (&empty_row, &[][..])
            }
        };
        write_row(w, current_row, row_def, cells, &active_runs);

        let next_data_row = row_iter.peek().map(|(row, _)| **row);
        let next_run_row = runs.get(run_idx).map(|run| run.start_row);
        let next_active_row = if active_runs.is_empty() {
            None
        } else {
            Some(current_row.saturating_add(1))
        };
        let next_row = [next_data_row, next_run_row, next_active_row]
            .into_iter()
            .flatten()
            .min();
        let Some(next_row) = next_row else {
            break;
        };
        if next_row <= current_row {
            break;
        }
        current_row = next_row;
    }

    w.end_element("sheetData");
}

fn write_row(
    w: &mut XmlWriter,
    row_idx: u32,
    row_def: &RowDef,
    cells: &[CellData],
    authored_style_runs: &[&AuthoredStyleRun],
) {
    let mut authored_style_cells =
        authored_style_cells_for_row(row_idx, cells, authored_style_runs);
    if cells.is_empty()
        && authored_style_cells.is_empty()
        && row_def.height.is_none()
        && row_def.hidden.is_none()
        && row_def.style.is_none()
        && !row_def.custom_format
        && row_def.outline_level.is_none()
        && row_def.descent.is_none()
        && row_def.collapsed.is_none()
        && !row_def.thick_top
        && !row_def.thick_bot
        && !row_def.phonetic
        && row_def.spans.is_none()
        && !row_def.bare_empty
    {
        return;
    }

    w.start_element("row").attr_num("r", row_idx + 1);

    if let Some(ref spans) = row_def.spans {
        w.attr("spans", spans);
    }
    if let Some(style) = row_def.style {
        w.attr_num("s", style);
    }
    if row_def.custom_format || row_def.style.is_some() {
        w.attr("customFormat", "1");
    }
    if let Some(height) = row_def.height {
        if let Some(ref hs) = row_def.height_str {
            w.attr("ht", hs);
        } else {
            w.attr("ht", &format_f64(height));
        }
    }
    match row_def.hidden {
        Some(true) => {
            w.attr("hidden", "1");
        }
        Some(false) => {
            w.attr("hidden", "0");
        }
        None => {}
    }
    if row_def.custom_height {
        w.attr("customHeight", "1");
    }
    if let Some(level) = row_def.outline_level {
        w.attr_num("outlineLevel", level);
    }
    match row_def.collapsed {
        Some(true) => {
            w.attr("collapsed", "1");
        }
        Some(false) => {
            w.attr("collapsed", "0");
        }
        None => {}
    }
    if row_def.thick_top {
        w.attr("thickTop", "1");
    }
    if row_def.thick_bot {
        w.attr("thickBot", "1");
    }
    if row_def.phonetic {
        w.attr("ph", "1");
    }
    if let Some(descent) = row_def.descent {
        w.attr("x14ac:dyDescent", &format_f64(descent));
    }

    if cells.is_empty() && authored_style_cells.is_empty() {
        w.self_close();
    } else {
        w.end_attrs();

        let mut row_cells: Vec<CellData> = cells.to_vec();
        row_cells.append(&mut authored_style_cells);
        row_cells.sort_by_key(|c| c.col);

        for cell in &row_cells {
            cell::write_cell(w, cell);
        }

        w.end_element("row");
    }
}
