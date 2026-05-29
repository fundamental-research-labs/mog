use cell_types::SheetId;
use domain_types::{AuthoredStyleRun, CellFormat, DocumentFormat};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

use super::super::super::super::export::cell_format_to_document_format;
use super::super::PaletteOps;

pub(super) fn style_id_for_cell_format(
    format: &CellFormat,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let doc_fmt = cell_format_to_document_format(format);
    if doc_fmt == DocumentFormat::default() {
        return None;
    }
    Some(palette.get_or_insert(doc_fmt))
}

pub(super) fn format_range_style_id_at(
    sheet: &crate::mirror::SheetMirror,
    row: u32,
    col: u32,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let matching = sheet.format_ranges_at(row, col);
    if matching.is_empty() {
        return None;
    }

    let (range_id, format) = matching.last()?;
    sheet
        .range_xlsx_style_id_cache()
        .get(range_id)
        .copied()
        .or_else(|| style_id_for_cell_format(format, palette))
}
pub(in crate::storage::engine) fn export_authored_style_runs_for_sheet(
    _stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<AuthoredStyleRun> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };

    let mut runs = Vec::new();
    for range in sheet.format_ranges() {
        let style_id = sheet
            .range_xlsx_style_id_cache()
            .get(&range.id)
            .copied()
            .or_else(|| {
                sheet
                    .range_format_cache()
                    .get(&range.id)
                    .and_then(|format| style_id_for_cell_format(format, palette))
            });
        let Some(style_id) = style_id else {
            continue;
        };
        runs.push(AuthoredStyleRun {
            start_row: range.start_row,
            start_col: range.start_col,
            end_row: range.end_row,
            end_col: range.end_col,
            style_id,
        });
    }

    runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    runs.dedup();
    runs
}
