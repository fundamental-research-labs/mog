use std::collections::HashMap;

use crate::domain::strings::read::SharedStrings;
use crate::domain::workbook::read::parse_workbook;
use crate::infra::error::ParseContext;
use crate::zip::constants::MAX_SHARED_STRINGS;
use crate::zip::{XlsxArchive, ZipError};

use super::limits::ensure_lazy_limit;
use super::{ParseError, ParsedSheet, SheetMetadata};

pub(super) struct LazyWorkbookParts<'a> {
    pub(super) archive: XlsxArchive<'a>,
    pub(super) shared_strings: SharedStrings,
    pub(super) shared_string_refs: Vec<String>,
    pub(super) sheet_metadata: Vec<SheetMetadata>,
    pub(super) parsed_sheets: HashMap<usize, ParsedSheet>,
    pub(super) context: ParseContext,
}

pub(super) fn initialize_workbook<'a>(
    xlsx_data: &'a [u8],
    mut context: ParseContext,
) -> Result<LazyWorkbookParts<'a>, ParseError> {
    context.set_current_part("initialization");

    if xlsx_data.is_empty() {
        return Err(ParseError::InvalidArchive("Empty XLSX data".to_string()));
    }

    if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
        return Err(ParseError::InvalidArchive(
            "Not a valid ZIP archive".to_string(),
        ));
    }

    let archive = XlsxArchive::new(xlsx_data)
        .map_err(|e| ParseError::InvalidArchive(format!("Failed to open archive: {}", e)))?;

    context.set_current_part("xl/sharedStrings.xml");
    let shared_strings_xml = match archive.get_shared_strings() {
        Ok(xml) => xml,
        Err(ZipError::FileNotFound(_)) => Vec::new(),
        Err(e) => {
            return Err(ParseError::ParseFailed(format!(
                "Failed to read xl/sharedStrings.xml: {}",
                e
            )));
        }
    };
    let mut shared_strings = SharedStrings::parse(shared_strings_xml);

    let string_count = shared_strings.len();
    ensure_lazy_limit("shared string", string_count, MAX_SHARED_STRINGS)?;
    let mut shared_string_refs: Vec<String> = Vec::with_capacity(string_count);
    for i in 0..string_count {
        let bytes = shared_strings.get(i);
        let s = std::str::from_utf8(bytes).map_err(|err| {
            ParseError::ParseFailed(format!(
                "xl/sharedStrings.xml contains malformed UTF-8 in shared string {} at byte {}",
                i,
                err.valid_up_to()
            ))
        })?;
        shared_string_refs.push(s.to_owned());
    }

    context.set_current_part("xl/workbook.xml");
    let sheet_metadata = collect_sheet_metadata(&archive);

    Ok(LazyWorkbookParts {
        archive,
        shared_strings,
        shared_string_refs,
        sheet_metadata,
        parsed_sheets: HashMap::new(),
        context,
    })
}

fn collect_sheet_metadata(archive: &XlsxArchive<'_>) -> Vec<SheetMetadata> {
    let mut metadata = Vec::new();

    let sheet_names: Vec<String> = if let Ok(workbook_xml) = archive.get_workbook() {
        let sheets = parse_workbook(&workbook_xml);
        sheets.into_iter().map(|s| s.name).collect()
    } else {
        Vec::new()
    };

    let worksheet_count = archive.worksheet_count();

    for i in 0..worksheet_count {
        let sheet_num = i + 1;
        let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);

        let uncompressed_size = archive
            .find_entry(&sheet_path)
            .map(|e| e.uncompressed_size)
            .unwrap_or(0);

        let name = sheet_names
            .get(i)
            .cloned()
            .unwrap_or_else(|| format!("Sheet{}", sheet_num));

        metadata.push(SheetMetadata::new(i, name, uncompressed_size));
    }

    metadata
}

#[cfg(test)]
mod tests {
    use super::super::LazyWorkbook;
    use super::*;
    use crate::infra::error::ParseMode;

    #[test]
    fn test_lazy_workbook_empty_data() {
        let result = LazyWorkbook::new(&[]);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_invalid_signature() {
        let result = LazyWorkbook::new(b"not a zip file");
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_too_short() {
        let result = LazyWorkbook::new(b"PK");
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_strict_mode() {
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Strict);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_lenient_mode() {
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Lenient);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_permissive_mode() {
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Permissive);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_context() {
        let context = ParseContext::strict();
        let result = LazyWorkbook::with_context(b"not a zip", context);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }
}
