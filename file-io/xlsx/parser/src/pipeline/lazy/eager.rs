use crate::infra::error::{ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail, ParseMode};

use super::cells::{estimated_cells, parse_materialized_cells};
use super::features::hydrate_sheet_features;
use super::{LazyWorkbook, ParseError, ParsedSheet};

pub(super) fn parse_sheet_internal(
    workbook: &mut LazyWorkbook<'_>,
    index: usize,
) -> Result<ParsedSheet, ParseError> {
    let sheet_num = index + 1;
    let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);

    workbook.context.set_current_part(&sheet_path);

    let worksheet_xml = match workbook.archive.get_worksheet(sheet_num) {
        Ok(xml) => xml,
        Err(e) => {
            return handle_missing_worksheet(&mut workbook.context, sheet_num, &sheet_path, e);
        }
    };

    let metadata = &workbook.sheet_metadata[index];
    let expected_cells = estimated_cells(metadata);
    let mut parsed = parse_materialized_cells(
        &worksheet_xml,
        sheet_num,
        metadata,
        &workbook.shared_string_refs,
    )?;

    if parsed.cell_count < expected_cells / 2 {
        let warning_msg = format!(
            "Sheet {} parsed {} cells (estimated {}); some cells may have been skipped",
            index, parsed.cell_count, expected_cells
        );
        workbook
            .context
            .report_warning(ErrorCode::InvalidCellValue, &warning_msg);
        parsed.errors.push(
            ParseErrorDetail::warning(ErrorCode::InvalidCellValue, &warning_msg)
                .with_location(ErrorLocation::new(&sheet_path)),
        );
    }

    hydrate_sheet_features(&mut parsed, &worksheet_xml)?;

    if workbook.should_stop() {
        parsed.errors.push(
            ParseErrorDetail::error(
                ErrorCode::DataCorruption,
                "Parsing stopped due to errors in strict mode",
            )
            .with_location(ErrorLocation::new(&sheet_path)),
        );
    }

    Ok(parsed)
}

fn handle_missing_worksheet(
    context: &mut ParseContext,
    sheet_num: usize,
    sheet_path: &str,
    error: crate::zip::ZipError,
) -> Result<ParsedSheet, ParseError> {
    let error_msg = format!("Failed to read worksheet {}: {}", sheet_num, error);
    let detail = ParseErrorDetail::error(ErrorCode::MissingPart, &error_msg)
        .with_location(ErrorLocation::new(sheet_path));
    context.report_error_detail(detail);

    if context.mode == ParseMode::Strict {
        Err(ParseError::ParseFailed(error_msg))
    } else {
        let mut parsed = ParsedSheet::new();
        parsed.errors.push(
            ParseErrorDetail::error(ErrorCode::MissingPart, &error_msg)
                .with_location(ErrorLocation::new(sheet_path)),
        );
        Ok(parsed)
    }
}
