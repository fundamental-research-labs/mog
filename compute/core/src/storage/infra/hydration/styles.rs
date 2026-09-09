use std::collections::HashMap;

use domain_types::{CellData, DocumentFormat, SheetData, WorkbookStylesheet};

#[derive(Debug, Clone)]
pub(crate) struct ImportedRangeStyle {
    pub range_id: cell_types::RangeId,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub style_id: u32,
}

// ===========================================================================
// Row/Col style overrides
// ===========================================================================

/// Convert a `DocumentFormat` (nested, from parser) to a flat `CellFormat` (runtime).
pub(super) fn document_format_to_cell_format(doc: &DocumentFormat) -> domain_types::CellFormat {
    domain_types::CellFormat::from(doc)
}

pub(super) fn hydrate_style_palette(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    style_palette: &[DocumentFormat],
) {
    metadata.style_palette = style_palette
        .iter()
        .map(document_format_to_cell_format)
        .collect();
}

pub(super) fn hydrate_workbook_stylesheet(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    stylesheet: &Option<WorkbookStylesheet>,
) {
    metadata.stylesheet = stylesheet.as_ref().map(|stylesheet| {
        let mut stylesheet = stylesheet.normalized();
        // Custom table styles are owned by the editable native style registry.
        stylesheet.table_styles.clear();
        stylesheet
    });
}

/// Merge source style palette entries into the existing workbook palette.
/// Returns a remap: source_style_id -> new_palette_index.
/// Does NOT overwrite existing entries — only appends.
pub(crate) fn merge_style_palette_incremental(
    metadata: &mut crate::storage::workbook::WorkbookMetadata,
    source_palette: &[DocumentFormat],
) -> HashMap<u32, u32> {
    let start =
        u32::try_from(metadata.style_palette.len()).expect("style palette exceeds u32::MAX");
    metadata
        .style_palette
        .extend(source_palette.iter().map(document_format_to_cell_format));
    (0..source_palette.len() as u32)
        .map(|id| (id, start + id))
        .collect()
}

/// Remap style_id indices in a SheetData according to the merge remap.
pub(crate) fn remap_sheet_style_ids(sheet: &mut SheetData, remap: &HashMap<u32, u32>) {
    for cell in &mut sheet.cells {
        if let Some(sid) = cell.style_id {
            cell.style_id = remap.get(&sid).copied();
        }
    }
    for rs in &mut sheet.row_styles {
        if let Some(new_sid) = remap.get(&rs.style_id) {
            rs.style_id = *new_sid;
        }
    }
    for cs in &mut sheet.col_styles {
        if let Some(new_sid) = remap.get(&cs.style_id) {
            cs.style_id = *new_sid;
        }
    }
    for range in &mut sheet.col_style_ranges {
        if let Some(new_sid) = remap.get(&range.style_id) {
            range.style_id = *new_sid;
        }
    }
    for run in &mut sheet.authored_style_runs {
        if let Some(new_sid) = remap.get(&run.style_id) {
            run.style_id = *new_sid;
        }
    }
}

/// Hydrate typed properties against the identity allocation used for native cells.
pub(crate) fn hydrate_cell_styles(
    cells: &[CellData],
    cell_ids: &[cell_types::CellId],
    range_style_positions: &std::collections::HashSet<(u32, u32)>,
) -> rustc_hash::FxHashMap<cell_types::CellId, crate::storage::properties::StoredCellProperties> {
    cells
        .iter()
        .zip(cell_ids)
        .filter_map(|(cell, id)| {
            let props = crate::storage::properties::CellProperties {
                style_id: cell
                    .style_id
                    .filter(|_| !range_style_positions.contains(&(cell.row, cell.col))),
                cell_metadata_index: cell.cell_metadata_index,
                vm: cell.vm,
                imported_rich_error: cell.imported_rich_error,
                phonetic: cell.phonetic,
                date_lexical_value: cell.date_lexical_value.clone(),
                formula_result_type: cell.formula_result_type,
                has_empty_cached_value: cell.has_empty_cached_value,
                formula_cache_provenance: cell.formula_cache_provenance.clone(),
                original_sst_index: cell.original_sst_index,
                original_value: cell.original_value.clone(),
                ..Default::default()
            };
            crate::storage::properties::StoredCellProperties::from_properties(props)
                .map(|props| (*id, props))
        })
        .collect()
}
