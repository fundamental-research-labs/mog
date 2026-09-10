//! Export authored rectangles without allocating native cells for styled blanks.
use cell_types::{SheetId, SheetRange};
use domain_types::AuthoredStyleRun;

use crate::cells::{CellStore, FormatRange};
use crate::storage::{engine::stores::EngineStores, properties};

use super::super::PaletteOps;
use super::style_ids::resolved_range_style_id;

fn bounds(range: &FormatRange) -> SheetRange {
    SheetRange::new(
        range.start_row,
        range.start_col,
        range.end_row,
        range.end_col,
    )
}
fn run(bounds: SheetRange, style_id: u32) -> AuthoredStyleRun {
    AuthoredStyleRun {
        start_row: bounds.start_row(),
        start_col: bounds.start_col(),
        end_row: bounds.end_row(),
        end_col: bounds.end_col(),
        style_id,
    }
}
fn subtract(rectangles: Vec<SheetRange>, cut: SheetRange) -> Vec<SheetRange> {
    rectangles
        .into_iter()
        .flat_map(|rect| {
            rect.intersection(&cut)
                .map(|intersection| properties::rectangle_difference(rect, intersection))
                .unwrap_or_else(|| vec![rect])
        })
        .collect()
}

pub(in crate::storage::engine) fn export_authored_style_runs_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<AuthoredStyleRun> {
    let Some(sheet) = cell_store.get_sheet(sheet_id) else {
        return Vec::new();
    };
    // Unedited imported rectangles retain their original XF lineage. Edited
    // rectangles must resolve their sparse patch against the inherited layers.
    let mut edited = Vec::new();
    for range in sheet
        .format_ranges()
        .iter()
        .filter(|range| !sheet.range_xlsx_style_id_cache().contains_key(&range.id))
    {
        let mut pieces = vec![bounds(range)];
        for previous in &edited {
            pieces = subtract(pieces, *previous);
        }
        edited.extend(pieces);
    }
    let mut runs = Vec::new();
    for range in sheet.format_ranges() {
        let style_id = sheet.range_xlsx_style_id_cache().get(&range.id).copied();
        let Some(style_id) = style_id else {
            continue;
        };
        let mut pieces = vec![bounds(range)];
        for edited in &edited {
            pieces = subtract(pieces, *edited);
        }
        runs.extend(pieces.into_iter().map(|piece| run(piece, style_id)));
    }
    if edited.is_empty() {
        runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
        runs.dedup();
        return runs;
    }

    let grid = stores.grid_indexes.get(sheet_id);
    let rows = properties::get_all_row_formats(&stores.storage, sheet_id, grid);
    let columns = properties::get_all_col_formats(&stores.storage, sheet_id, grid);
    let sheet_name = sheet_id.to_uuid_string();
    let mut structured: Vec<SheetRange> = cell_store
        .all_tables()
        .iter()
        .filter(|table| table.sheet_id == sheet_name)
        .map(|table| table.range)
        .collect();
    structured.extend(
        cell_store
            .all_pivot_tables()
            .iter()
            .filter(|pivot| pivot.sheet == sheet_name && !pivot.is_empty_rendered_region())
            .map(|pivot| {
                SheetRange::new(
                    pivot.start_row,
                    pivot.start_col,
                    pivot.end_row,
                    pivot.end_col,
                )
            }),
    );

    for rect in edited {
        let mut row_edges = vec![rect.start_row(), rect.end_row() + 1];
        for range in sheet.format_ranges() {
            if let Some(overlap) = bounds(range).intersection(&rect) {
                row_edges.extend([overlap.start_row(), overlap.end_row() + 1]);
            }
        }
        for row in &rows {
            if row.row >= rect.start_row() && row.row <= rect.end_row() {
                row_edges.extend([row.row, row.row + 1]);
            }
        }
        // Table banding and pivot style rules can vary at every row/column.
        // Only the intersection needs those boundaries, never the whole sheet.
        for area in &structured {
            if let Some(overlap) = area.intersection(&rect) {
                row_edges.extend(overlap.start_row()..=overlap.end_row() + 1);
            }
        }
        row_edges.sort_unstable();
        row_edges.dedup();
        for span in row_edges.windows(2) {
            let row = span[0];
            let mut col_edges = vec![rect.start_col(), rect.end_col() + 1];
            for range in sheet
                .format_ranges()
                .iter()
                .filter(|range| range.start_row <= row && range.end_row >= row)
            {
                add_col_edges(&mut col_edges, rect, range.start_col, range.end_col);
            }
            for range in sheet.col_format_ranges() {
                add_col_edges(&mut col_edges, rect, range.start_col, range.end_col);
            }
            for column in &columns {
                add_col_edges(&mut col_edges, rect, column.col, column.col);
            }
            for area in structured
                .iter()
                .filter(|area| area.start_row() <= row && area.end_row() >= row)
            {
                let start = rect.start_col().max(area.start_col());
                let end = rect.end_col().min(area.end_col());
                if start <= end {
                    col_edges.extend(start..=end + 1);
                }
            }
            col_edges.sort_unstable();
            col_edges.dedup();
            let mut row_runs: Vec<AuthoredStyleRun> = Vec::new();
            for cols in col_edges.windows(2) {
                let Some(style_id) = resolved_range_style_id(
                    stores, cell_store, sheet_id, row, cols[0], true, palette,
                ) else {
                    continue;
                };
                if let Some(previous) = row_runs.last_mut().filter(|previous| {
                    previous.end_col + 1 == cols[0] && previous.style_id == style_id
                }) {
                    previous.end_col = cols[1] - 1;
                } else {
                    row_runs.push(run(
                        SheetRange::new(row, cols[0], span[1] - 1, cols[1] - 1),
                        style_id,
                    ));
                }
            }
            runs.extend(row_runs);
        }
    }
    runs.sort_by_key(|r| (r.start_col, r.end_col, r.style_id, r.start_row));
    let mut coalesced: Vec<AuthoredStyleRun> = Vec::new();
    for current in runs {
        if let Some(previous) = coalesced.last_mut().filter(|previous| {
            previous.start_col == current.start_col
                && previous.end_col == current.end_col
                && previous.style_id == current.style_id
                && previous.end_row + 1 == current.start_row
        }) {
            previous.end_row = current.end_row;
        } else {
            coalesced.push(current);
        }
    }
    coalesced.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    coalesced.dedup();
    coalesced
}

fn add_col_edges(edges: &mut Vec<u32>, rect: SheetRange, start: u32, end: u32) {
    let start = start.max(rect.start_col());
    let end = end.min(rect.end_col());
    if start <= end {
        edges.extend([start, end + 1]);
    }
}
