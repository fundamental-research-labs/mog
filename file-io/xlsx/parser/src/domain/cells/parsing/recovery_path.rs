use super::super::adapters::{find_byte, find_sequence, skip_whitespace};
use super::super::helpers::{CellEnd, find_cell_end, find_sheet_data, parse_row_number};
use super::super::recovery::{CellParseResult, parse_cell_element_with_context};
use super::super::types::CellData;
use super::rows::apply_recovery_row_attrs;
use crate::infra::error::{ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail};
use ooxml_types::worksheet::RowHeight;

pub(super) fn parse_worksheet_with_context_impl(
    xml: &[u8],
    shared_strings: &[&str],
    cells: &mut [CellData],
    strings: &mut Vec<u8>,
    context: &mut ParseContext,
    row_heights: &mut Vec<RowHeight>,
    _col_styles: &[Option<u32>],
) -> (usize, usize) {
    let mut cell_idx = 0;
    let mut skipped_count = 0;
    let mut pos = 0;

    pos = match find_sheet_data(xml, pos) {
        Some(p) => p,
        None => {
            context.report_warning(
                ErrorCode::MissingAttribute,
                "No <sheetData> element found in worksheet",
            );
            return (0, 0);
        }
    };

    let sheet_data_end = find_sequence(xml, b"</sheetData>", pos).unwrap_or(xml.len());
    let mut current_row: u32 = 0;

    while pos < sheet_data_end && cell_idx < cells.len() {
        if context.should_stop() {
            break;
        }

        pos = skip_whitespace(xml, pos);
        if pos >= sheet_data_end {
            break;
        }

        if let Some(tag_start) = find_byte(xml, b'<', pos) {
            if tag_start >= sheet_data_end {
                break;
            }
            pos = tag_start + 1;

            if pos + 3 < xml.len()
                && xml[pos] == b'r'
                && xml[pos + 1] == b'o'
                && xml[pos + 2] == b'w'
            {
                if let Some(row_num) = parse_row_number(xml, pos) {
                    current_row = row_num.saturating_sub(1);
                }
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    apply_recovery_row_attrs(&xml[pos..gt], current_row, row_heights);
                    pos = gt + 1;
                }
            } else if xml[pos] == b'c'
                && (xml.get(pos + 1).map_or(true, |&c| c == b' ' || c == b'>'))
            {
                let cell_start = tag_start;
                let CellEnd {
                    end: cell_end,
                    is_self_closing,
                } =
                    match find_cell_end(xml, pos) {
                        Some(ce) => ce,
                        None => {
                            context.report_error_detail(
                                ParseErrorDetail::error(
                                    ErrorCode::MalformedXml,
                                    "Cannot find end of cell element",
                                )
                                .with_location(
                                    ErrorLocation::cell(&context.current_part, current_row + 1, 0),
                                ),
                            );
                            if context.should_stop() {
                                return (cell_idx, skipped_count);
                            }
                            skipped_count += 1;
                            if let Some(next_lt) = find_byte(xml, b'<', pos) {
                                pos = next_lt;
                                continue;
                            }
                            break;
                        }
                    };

                match parse_cell_element_with_context(
                    &xml[cell_start..cell_end],
                    current_row,
                    shared_strings,
                    strings,
                    context,
                    is_self_closing,
                ) {
                    CellParseResult::Success(cell_data) => {
                        cells[cell_idx] = cell_data;
                        cell_idx += 1;
                    }
                    CellParseResult::Skipped => {
                        skipped_count += 1;
                    }
                    CellParseResult::Stop => {
                        return (cell_idx, skipped_count);
                    }
                }

                pos = cell_end;
            } else if xml[pos] == b'/' {
                if let Some(gt) = find_byte(xml, b'>', pos) {
                    pos = gt + 1;
                }
            } else if let Some(gt) = find_byte(xml, b'>', pos) {
                pos = gt + 1;
            }
        } else {
            break;
        }
    }

    (cell_idx, skipped_count)
}
