//! Sheet building: SheetData to SheetWriter.

use std::collections::HashSet;

use domain_types::{DataTableRegion, OutlineGroup, SheetData};

use super::super::SharedStringsWriter;
use super::sheet_cells;
use super::sheet_columns;
use super::sheet_outlines;
use super::sheet_rows;
use super::sheet_views;
use super::style_remap::StyleExportRemapper;
use crate::write::sheet::{SheetFormatPr, SheetWriter};

/// Build a `SheetWriter` from a `SheetData`.
///
/// `data_table_body_positions` is the set of `(row, col)` body-cell positions
/// of any Data Table region that lives on this sheet (i.e. every position in
/// each region rectangle except the master at `(start_row, start_col)`). The
/// data model carries body-cell formulas symmetrically (every region cell
/// owns a synthesized `=TABLE(r2, r1)` text), but the OOXML representation is
/// asymmetric for compactness: only the master emits `<f t="dataTable">`,
/// while body cells round-trip as `<v>`-only. Body-cell formula text is
/// suppressed here at the write boundary so the asymmetry is restored.
pub(super) fn build_sheet(
    sheet_data: &SheetData,
    shared_strings: &mut SharedStringsWriter,
    data_table_body_positions: &HashSet<(u32, u32)>,
    data_table_regions: &[DataTableRegion],
    emit_cell_metadata_refs: bool,
    style_remapper: &StyleExportRemapper,
) -> SheetWriter {
    let mut writer = SheetWriter::new();

    apply_sheet_properties(&mut writer, sheet_data);
    apply_sheet_format(&mut writer, sheet_data);
    sheet_columns::apply_columns(&mut writer, sheet_data, style_remapper);
    sheet_rows::apply_rows(&mut writer, sheet_data, style_remapper);
    sheet_cells::apply_cells(
        &mut writer,
        sheet_data,
        shared_strings,
        data_table_body_positions,
        data_table_regions,
        emit_cell_metadata_refs,
        style_remapper,
    );
    apply_merges(&mut writer, sheet_data);
    sheet_views::apply_sheet_views(&mut writer, sheet_data);

    writer
}

fn apply_sheet_properties(writer: &mut SheetWriter, sheet_data: &SheetData) {
    if let Some(sheet_properties) = &sheet_data.sheet_properties {
        let mut sheet_properties = sheet_properties.clone();
        if let Some(print_settings) = &sheet_data.print_settings
            && let Some(page_setup_properties) = &print_settings.page_setup_properties
        {
            sheet_properties.page_set_up_pr = Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            });
        }
        writer.set_sheet_properties(sheet_properties);
    } else if let Some(outline_properties) = &sheet_data.outline_properties {
        let mut sheet_properties = ooxml_types::worksheet::SheetProperties {
            outline_pr: Some(outline_properties.clone()),
            ..Default::default()
        };
        if let Some(print_settings) = &sheet_data.print_settings
            && let Some(page_setup_properties) = &print_settings.page_setup_properties
        {
            sheet_properties.page_set_up_pr = Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            });
        }
        writer.set_sheet_properties(sheet_properties);
    } else if let Some(print_settings) = &sheet_data.print_settings
        && let Some(page_setup_properties) = &print_settings.page_setup_properties
    {
        writer.set_sheet_properties(ooxml_types::worksheet::SheetProperties {
            page_set_up_pr: Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            }),
            ..Default::default()
        });
    }
}

fn apply_sheet_format(writer: &mut SheetWriter, sheet_data: &SheetData) {
    let dims = &sheet_data.dimensions;
    let mut fmt = SheetFormatPr::default();
    if let Some(h) = dims.default_row_height {
        fmt.default_row_height = h;
    }
    fmt.custom_height = dims.custom_height;
    if let Some(w) = dims.default_col_width {
        fmt.default_col_width = Some(w);
    }
    if let Some(d) = dims.default_row_descent {
        fmt.default_row_descent = Some(d);
    }
    fmt.base_col_width = dims.base_col_width;
    fmt.zero_height = dims.zero_height;
    fmt.thick_top = dims.thick_top;
    fmt.thick_bottom = dims.thick_bottom;
    fmt.outline_level_row = dims.outline_level_row;
    fmt.outline_level_col = dims.outline_level_col;
    writer.set_sheet_format_pr(fmt);
}

fn apply_merges(writer: &mut SheetWriter, sheet_data: &SheetData) {
    for merge in &sheet_data.merges {
        writer.add_merge(
            merge.start_row,
            merge.start_col,
            merge.end_row,
            merge.end_col,
        );
    }
}

#[cfg(test)]
pub(super) fn convert_cell(
    cell: &domain_types::CellData,
    shared_strings: &mut SharedStringsWriter,
) -> crate::write::sheet::CellData {
    sheet_cells::convert_cell(cell, shared_strings)
}

pub(super) fn apply_outline_groups_rows_only(writer: &mut SheetWriter, groups: &[OutlineGroup]) {
    sheet_outlines::apply_outline_groups_rows_only(writer, groups);
}
