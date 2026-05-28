use crate::domain::cells::{CellData, parse_worksheet_fast};
use crate::zip::constants::MAX_WORKSHEET_CELLS;
use ooxml_types::worksheet::RowHeight;

use super::limits::{count_worksheet_cell_elements, ensure_lazy_limit};
use super::{ParseError, ParsedSheet, SheetMetadata};

pub(super) fn parse_materialized_cells(
    worksheet_xml: &[u8],
    sheet_num: usize,
    metadata: &SheetMetadata,
    shared_string_refs: &[String],
) -> Result<ParsedSheet, ParseError> {
    ensure_lazy_limit(
        "worksheet cell",
        count_worksheet_cell_elements(worksheet_xml),
        MAX_WORKSHEET_CELLS,
    )?;

    let estimated_cells = estimated_cells(metadata);
    let estimated_strings = estimated_strings(metadata);
    let mut parsed = ParsedSheet::with_capacity(estimated_cells, estimated_strings);

    fill_materialized_cells(
        &mut parsed,
        worksheet_xml,
        sheet_num,
        estimated_cells,
        shared_string_refs,
    )?;

    Ok(parsed)
}

pub(super) fn estimated_cells(metadata: &SheetMetadata) -> usize {
    (metadata.uncompressed_size / 50)
        .max(1000)
        .min(MAX_WORKSHEET_CELLS)
}

pub(super) fn estimated_strings(metadata: &SheetMetadata) -> usize {
    metadata.uncompressed_size / 4
}

pub(super) fn fill_materialized_cells(
    parsed: &mut ParsedSheet,
    worksheet_xml: &[u8],
    sheet_num: usize,
    estimated_cells: usize,
    shared_string_refs: &[String],
) -> Result<(), ParseError> {
    let shared_string_refs: Vec<&str> = shared_string_refs.iter().map(|s| s.as_str()).collect();
    let mut buffer_size = estimated_cells;
    parsed.cells.resize(buffer_size, CellData::default());

    let mut row_heights_buf: Vec<RowHeight> = Vec::new();
    let mut cell_count = parse_worksheet_fast(
        worksheet_xml,
        &shared_string_refs,
        &mut parsed.cells,
        &mut parsed.strings,
        &mut row_heights_buf,
        &[],
    );

    while cell_count == buffer_size {
        if buffer_size >= MAX_WORKSHEET_CELLS {
            return Err(ParseError::ParseFailed(format!(
                "worksheet {} has more than {} cells",
                sheet_num, MAX_WORKSHEET_CELLS
            )));
        }
        buffer_size = buffer_size.saturating_mul(2).min(MAX_WORKSHEET_CELLS);
        parsed.cells.resize(buffer_size, CellData::default());
        parsed.strings.clear();
        row_heights_buf.clear();

        cell_count = parse_worksheet_fast(
            worksheet_xml,
            &shared_string_refs,
            &mut parsed.cells,
            &mut parsed.strings,
            &mut row_heights_buf,
            &[],
        );
    }

    parsed.cells.truncate(cell_count);
    parsed.cell_count = cell_count;

    Ok(())
}
