use cell_types::SheetId;
use domain_types::{ColStyleEntry, ColStyleRange, RowStyleEntry};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;

use super::super::PaletteOps;
use super::style_ids::style_id_for_cell_format;

fn imported_or_generated_style_id(
    xlsx_style_id: Option<u32>,
    format: Option<&domain_types::CellFormat>,
    palette: &impl PaletteOps,
) -> Option<u32> {
    xlsx_style_id.or_else(|| format.and_then(|fmt| style_id_for_cell_format(fmt, palette)))
}

pub(in crate::storage::engine) fn export_row_col_styles_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
    _max_row: u32,
    _max_col: u32,
    palette: &impl PaletteOps,
) -> (Vec<RowStyleEntry>, Vec<ColStyleEntry>) {
    let Some(grid_index) = stores.grid_indexes.get(sheet_id) else {
        return (Vec::new(), Vec::new());
    };

    // Batch-read all row formats in one transaction
    let all_row_fmts = properties::get_all_row_formats(&stores.storage, sheet_id, Some(grid_index));
    let mut row_styles = Vec::with_capacity(all_row_fmts.len());
    for entry in all_row_fmts {
        let style_id =
            imported_or_generated_style_id(entry.xlsx_style_id, entry.format.as_ref(), palette);
        if let Some(style_id) = style_id {
            row_styles.push(RowStyleEntry {
                row: entry.row,
                style_id,
            });
        }
    }

    // Batch-read all column formats in one transaction
    let all_col_fmts = properties::get_all_col_formats(&stores.storage, sheet_id, Some(grid_index));
    let mut col_styles = Vec::with_capacity(all_col_fmts.len());
    for entry in all_col_fmts {
        let style_id =
            imported_or_generated_style_id(entry.xlsx_style_id, entry.format.as_ref(), palette);
        if let Some(style_id) = style_id {
            col_styles.push(ColStyleEntry {
                col: entry.col,
                style_id,
            });
        }
    }

    (row_styles, col_styles)
}

pub(in crate::storage::engine) fn export_col_style_ranges_for_sheet(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<ColStyleRange> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };

    let mut ranges = Vec::new();
    for range in sheet.col_format_ranges() {
        let style_id = sheet
            .col_range_xlsx_style_id_cache()
            .get(&range.id)
            .copied()
            .or_else(|| {
                sheet
                    .col_format_range_cache()
                    .get(&range.id)
                    .and_then(|format| style_id_for_cell_format(format, palette))
            });
        let Some(style_id) = style_id else {
            continue;
        };
        ranges.push(ColStyleRange {
            start_col: range.start_col,
            end_col: range.end_col,
            style_id,
        });
    }

    ranges.sort_by_key(|r| (r.start_col, r.end_col, r.style_id));
    ranges.dedup();
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::engine::services::export::LocalPalette;
    use domain_types::{CellFormat, DocumentFormat, FontFormat};

    #[test]
    fn pristine_row_or_column_prefers_imported_xf_but_edit_uses_generated_tail() {
        let imported = DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        let mut entries = vec![DocumentFormat::default(), imported];
        let palette = LocalPalette::from_vec_with_imported_prefix(&mut entries, 2);
        let format = CellFormat {
            bold: Some(true),
            ..Default::default()
        };

        assert_eq!(
            imported_or_generated_style_id(Some(1), Some(&format), &palette),
            Some(1)
        );
        assert_eq!(
            imported_or_generated_style_id(None, Some(&format), &palette),
            Some(2)
        );
    }
}
