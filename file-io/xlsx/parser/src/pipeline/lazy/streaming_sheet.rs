use crate::pipeline::streaming::{DEFAULT_BUFFER_SIZE, StreamingCellParser, StreamingDeflate};
use crate::zip::constants::MAX_WORKSHEET_CELLS;
use crate::zip::{CompressedEntry, ZipError};

use super::cells::{estimated_cells, estimated_strings, fill_materialized_cells};
use super::features::hydrate_sheet_features;
use super::limits::{count_worksheet_cell_elements, ensure_lazy_limit};
use super::{LazyWorkbook, ParseError, ParsedSheet};

pub(super) fn get_sheet_streaming<F>(
    workbook: &mut LazyWorkbook<'_>,
    index: usize,
    chunk_size: usize,
    mut on_progress: F,
) -> Result<ParsedSheet, ParseError>
where
    F: FnMut(usize, usize),
{
    if workbook.should_stop() {
        return Err(ParseError::ParseFailed(
            "Parsing stopped due to previous errors".to_string(),
        ));
    }

    if index >= workbook.sheet_metadata.len() {
        return Err(ParseError::SheetNotFound(index));
    }

    let sheet_num = index + 1;
    let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);
    workbook.context.set_current_part(&sheet_path);

    let compressed_entry: CompressedEntry =
        match workbook.archive.get_worksheet_compressed(sheet_num) {
            Ok(entry) => entry,
            Err(e) => {
                let error_msg = format!("Failed to get compressed worksheet {}: {}", sheet_num, e);
                return Err(ParseError::ParseFailed(error_msg));
            }
        };

    let metadata = &workbook.sheet_metadata[index];
    let mut parsed =
        ParsedSheet::with_capacity(estimated_cells(metadata), estimated_strings(metadata));

    if compressed_entry.is_stored() {
        parse_stored_entry(workbook, sheet_num, metadata, &mut parsed, &mut on_progress)?;
    } else if compressed_entry.is_deflate() {
        parse_deflated_entry(
            compressed_entry,
            chunk_size,
            &workbook.shared_string_refs,
            &mut parsed,
            &mut on_progress,
        )?;
    } else {
        return Err(ParseError::ParseFailed(format!(
            "Unsupported compression method: {}",
            compressed_entry.compression_method
        )));
    }

    let worksheet_xml = match workbook.archive.get_worksheet(sheet_num) {
        Ok(xml) => Some(xml),
        Err(ZipError::FileNotFound(_)) => None,
        Err(e) => return Err(ParseError::ParseFailed(e.to_string())),
    };
    if let Some(worksheet_xml) = worksheet_xml {
        ensure_lazy_limit(
            "worksheet cell",
            count_worksheet_cell_elements(&worksheet_xml),
            MAX_WORKSHEET_CELLS,
        )?;
        hydrate_sheet_features(&mut parsed, &worksheet_xml)?;
    }

    Ok(parsed)
}

fn parse_stored_entry<F>(
    workbook: &LazyWorkbook<'_>,
    sheet_num: usize,
    metadata: &super::SheetMetadata,
    parsed: &mut ParsedSheet,
    on_progress: &mut F,
) -> Result<(), ParseError>
where
    F: FnMut(usize, usize),
{
    let stored_xml = workbook
        .archive
        .get_worksheet(sheet_num)
        .map_err(|e| ParseError::ParseFailed(e.to_string()))?;
    ensure_lazy_limit(
        "worksheet cell",
        count_worksheet_cell_elements(&stored_xml),
        MAX_WORKSHEET_CELLS,
    )?;
    on_progress(stored_xml.len(), stored_xml.len());

    fill_materialized_cells(
        parsed,
        &stored_xml,
        sheet_num,
        estimated_cells(metadata),
        &workbook.shared_string_refs,
    )
}

fn parse_deflated_entry<F>(
    compressed_entry: CompressedEntry<'_>,
    chunk_size: usize,
    shared_string_refs: &[String],
    parsed: &mut ParsedSheet,
    on_progress: &mut F,
) -> Result<(), ParseError>
where
    F: FnMut(usize, usize),
{
    let buffer_size = if chunk_size == 0 {
        DEFAULT_BUFFER_SIZE
    } else {
        chunk_size
    };
    let total_compressed = compressed_entry.data.len();

    let mut decompressor = StreamingDeflate::new(
        compressed_entry.data,
        buffer_size,
        compressed_entry.uncompressed_size,
        compressed_entry.output_limit,
        compressed_entry.crc32,
    )
    .map_err(|e| ParseError::ParseFailed(e.to_string()))?;
    let shared_string_refs: Vec<&str> = shared_string_refs.iter().map(|s| s.as_str()).collect();
    let mut cell_parser = StreamingCellParser::new(&shared_string_refs);

    while let Some(chunk) = decompressor
        .next_chunk()
        .map_err(|e| ParseError::ParseFailed(e.to_string()))?
    {
        cell_parser.process_chunk(chunk, &mut parsed.cells, &mut parsed.strings);
        ensure_lazy_limit("worksheet cell", parsed.cells.len(), MAX_WORKSHEET_CELLS)?;
        on_progress(decompressor.bytes_consumed(), total_compressed);
    }

    cell_parser.finish(&mut parsed.cells, &mut parsed.strings);
    parsed.cell_count = parsed.cells.len();

    on_progress(total_compressed, total_compressed);
    Ok(())
}
