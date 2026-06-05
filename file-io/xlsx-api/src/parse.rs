//! Full XLSX parse — bytes in, structured workbook data out.
//!
//! Two entry points:
//! - `parse()` — default options (Lenient, parse everything)
//! - `parse_with_options()` — configurable mode, profiling, etc.
//!
//! Returns `ParsedWorkbook` containing domain-typed `ParseOutput` and `ImportReport`.
//! The internal `FullParseResult` is no longer exposed.
//! Bridge/API output is a semantic workbook subset. Rust-internal package
//! fidelity sidecars may preserve additional OOXML during in-process export,
//! but those sidecars are not public editable API state.

use crate::error::{XlsxApiError, from_parse_string_error};
use crate::options::ParseOptions;
use domain_types::{ImportReport, ParseDiagnostics, ParseOutput};
pub use xlsx_parser::DeferredWorkbookMetadata;

/// Result of a successful parse. Contains domain-typed parse output.
#[derive(Debug)]
pub struct ParsedWorkbook {
    /// Semantic data: cells, merges, styles, domain objects.
    pub output: ParseOutput,
    /// Public import report with diagnostics, statistics, and recalc hints.
    pub import_report: ImportReport,
    pub diagnostics: ParseDiagnostics,
}

/// Parse an XLSX file with default options (Lenient mode, parse everything).
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
///
/// # Returns
/// * `Ok(ParsedWorkbook)` — Parsed workbook with domain-typed output.
/// * `Err(XlsxApiError)` — Fatal parse error.
///
/// # Example
/// ```ignore
/// let wb = xlsx_api::parse(&bytes)?;
/// println!("{} sheets", wb.output.sheets.len());
/// ```
pub fn parse(xlsx_data: &[u8]) -> Result<ParsedWorkbook, XlsxApiError> {
    parse_with_options(xlsx_data, &ParseOptions::new())
}

/// Parse an XLSX file with custom options.
///
/// Supports mode selection (Strict/Lenient/Permissive) and profiling.
/// Other options (skip_styles, max_cells, sheet_filter, values_only) are
/// validated but NOT yet enforced — setting them returns `UnsupportedOption`.
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
/// * `options` — Parse configuration (mode, profiling, etc.).
///
/// # Returns
/// * `Ok(ParsedWorkbook)` — Parsed workbook with domain-typed output.
/// * `Err(XlsxApiError)` — Fatal parse error or unsupported option.
pub fn parse_with_options(
    xlsx_data: &[u8],
    options: &ParseOptions,
) -> Result<ParsedWorkbook, XlsxApiError> {
    // Validate options — reject unsupported ones early
    if let Some(opt_name) = options.first_unsupported_option() {
        return Err(XlsxApiError::UnsupportedOption {
            option: opt_name.to_string(),
            reason: "parser pipeline does not yet enforce this option — see 02b-PARSE-OPTIONS-ENFORCEMENT.md".to_string(),
        });
    }

    // Route to max_sheets variant if set
    if let Some(max_sheets) = options.max_sheets {
        return parse_max_sheets(xlsx_data, max_sheets);
    }

    // Parse XLSX bytes directly into domain types via the unified pipeline.
    let (output, diagnostics) =
        xlsx_parser::parse_xlsx_to_output(xlsx_data).map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Parse XLSX with a limit on full sheet parsing.
pub fn parse_max_sheets(
    xlsx_data: &[u8],
    max_sheets: usize,
) -> Result<ParsedWorkbook, XlsxApiError> {
    let (output, diagnostics) = xlsx_parser::parse_xlsx_to_output_max_sheets(xlsx_data, max_sheets)
        .map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Parse XLSX with full worksheet parsing limited to explicit editable sheet
/// indices. Unselected worksheets get metadata-only sheet payloads.
pub fn parse_selected_sheets(
    xlsx_data: &[u8],
    selected_sheet_indices: &[usize],
) -> Result<ParsedWorkbook, XlsxApiError> {
    let (output, diagnostics) =
        xlsx_parser::parse_xlsx_to_output_selected_sheets(xlsx_data, selected_sheet_indices)
            .map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Read workbook-level metadata for deferred selected-sheet parsing without
/// parsing worksheet cell payloads.
pub fn parse_deferred_workbook_metadata(
    xlsx_data: &[u8],
) -> Result<DeferredWorkbookMetadata, XlsxApiError> {
    xlsx_parser::parse_deferred_workbook_metadata(xlsx_data).map_err(from_parse_string_error)
}

/// Select the workbook-order index for the initial visible editable worksheet.
pub fn select_initial_active_visible_workbook_index(
    metadata: &DeferredWorkbookMetadata,
) -> Result<u32, XlsxApiError> {
    xlsx_parser::select_initial_active_visible_workbook_index(metadata)
        .map_err(from_parse_string_error)
}

/// Parse XLSX with full worksheet parsing limited to explicit workbook-order
/// sheet indices. Unselected editable worksheets remain inventory-only and do
/// not get metadata-only `SheetData` placeholders.
pub fn parse_selected_workbook_sheets(
    xlsx_data: &[u8],
    selected_workbook_indices: &[u32],
    metadata: &DeferredWorkbookMetadata,
) -> Result<ParsedWorkbook, XlsxApiError> {
    let (output, diagnostics) = xlsx_parser::parse_xlsx_to_output_selected_workbook_sheets(
        xlsx_data,
        selected_workbook_indices,
        metadata,
    )
    .map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Parse XLSX with only the initial active visible worksheet fully parsed.
/// Other editable worksheets get metadata-only sheet payloads.
pub fn parse_initial_active_visible_sheet(
    xlsx_data: &[u8],
) -> Result<ParsedWorkbook, XlsxApiError> {
    let (output, diagnostics) =
        xlsx_parser::parse_xlsx_to_output_initial_active_visible_sheet(xlsx_data)
            .map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Return the editable sheet index that should be materialized for initial
/// workbook display.
pub fn initial_active_visible_sheet_index(output: &ParseOutput) -> Option<usize> {
    let active_workbook_order = output
        .workbook_views
        .first()
        .map(|view| view.active_tab as usize)
        .unwrap_or(0);

    let visible_editable = |entry: &&domain_types::WorkbookSheetPackageInfo| {
        entry.editable_sheet_index.is_some() && entry.visibility == Default::default()
    };

    if let Some(entry) = output.workbook_sheet_inventory.iter().find(|entry| {
        visible_editable(entry) && entry.workbook_order as usize == active_workbook_order
    }) {
        return entry.editable_sheet_index;
    }

    if let Some(entry) = output
        .workbook_sheet_inventory
        .iter()
        .find(visible_editable)
    {
        return entry.editable_sheet_index;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeSet, HashSet};

    fn two_sheet_fixture_xlsx(
        first_state: Option<&str>,
        second_state: Option<&str>,
        active_tab: u32,
    ) -> Vec<u8> {
        fn state_attr(state: Option<&str>) -> String {
            state
                .map(|state| format!(r#" state="{state}""#))
                .unwrap_or_default()
        }

        let workbook = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView activeTab="{active_tab}"/>
  </bookViews>
  <sheets>
    <sheet name="First" sheetId="1"{} r:id="rId1"/>
    <sheet name="Second" sheetId="2"{} r:id="rId2"/>
  </sheets>
</workbook>"#,
            state_attr(first_state),
            state_attr(second_state)
        );

        let sheet1 = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1"/>
  <sheetData><row r="1"><c r="A1"><v>11</v></c></row></sheetData>
</worksheet>"#;
        let sheet2 = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1"/>
  <sheetData><row r="1"><c r="A1"><v>22</v></c></row></sheetData>
</worksheet>"#;

        let mut zip = xlsx_parser::ZipWriter::new();
        zip.add_file(
            "[Content_Types].xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
                .to_vec(),
        );
        zip.add_file(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
                .to_vec(),
        );
        zip.add_file("xl/workbook.xml", workbook.into_bytes());
        zip.add_file(
            "xl/_rels/workbook.xml.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"#
                .to_vec(),
        );
        zip.add_file("xl/worksheets/sheet1.xml", sheet1.to_vec());
        zip.add_file("xl/worksheets/sheet2.xml", sheet2.to_vec());
        zip.finish().expect("two-sheet fixture xlsx")
    }

    fn three_sheet_fixture_xlsx(
        first_state: Option<&str>,
        second_state: Option<&str>,
        third_state: Option<&str>,
        active_tab: u32,
    ) -> Vec<u8> {
        fn state_attr(state: Option<&str>) -> String {
            state
                .map(|state| format!(r#" state="{state}""#))
                .unwrap_or_default()
        }

        let workbook = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView activeTab="{active_tab}"/>
  </bookViews>
  <sheets>
    <sheet name="First" sheetId="1"{} r:id="rId1"/>
    <sheet name="Second" sheetId="2"{} r:id="rId2"/>
    <sheet name="Third" sheetId="3"{} r:id="rId3"/>
  </sheets>
</workbook>"#,
            state_attr(first_state),
            state_attr(second_state),
            state_attr(third_state)
        );

        fn worksheet(value: u32) -> Vec<u8> {
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1"/>
  <sheetData><row r="1"><c r="A1"><v>{value}</v></c></row></sheetData>
</worksheet>"#
            )
            .into_bytes()
        }

        let mut zip = xlsx_parser::ZipWriter::new();
        zip.add_file(
            "[Content_Types].xml",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#
                .to_vec(),
        );
        zip.add_file(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#
                .to_vec(),
        );
        zip.add_file("xl/workbook.xml", workbook.into_bytes());
        zip.add_file(
            "xl/_rels/workbook.xml.rels",
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>"#
                .to_vec(),
        );
        zip.add_file("xl/worksheets/sheet1.xml", worksheet(11));
        zip.add_file("xl/worksheets/sheet2.xml", worksheet(22));
        zip.add_file("xl/worksheets/sheet3.xml", worksheet(33));
        zip.finish().expect("three-sheet fixture xlsx")
    }

    #[test]
    fn import_report_exposes_force_recalc_cells() {
        let diagnostics = ParseDiagnostics {
            errors: Vec::new(),
            stats: domain_types::ParseStats {
                total_cells: 1,
                total_sheets: 1,
                parse_time_us: 10,
            },
            force_recalc_cells: HashSet::from([(0, 4, 2)]),
            import_report: None,
        };

        let report = diagnostics.into_import_report();

        assert_eq!(report.force_recalc_cells.len(), 1);
        assert_eq!(report.force_recalc_cells[0].sheet_index, 0);
        assert_eq!(report.force_recalc_cells[0].row, 4);
        assert_eq!(report.force_recalc_cells[0].col, 2);
    }

    #[test]
    fn selected_workbook_sheets_are_compact_and_inventory_only_for_unselected_tabs() {
        let bytes = two_sheet_fixture_xlsx(Some("hidden"), None, 0);

        let metadata = parse_deferred_workbook_metadata(&bytes).expect("metadata");
        assert_eq!(metadata.workbook_sheet_inventory.len(), 2);
        assert_eq!(metadata.workbook_sheet_inventory[0].name, "First");
        assert_eq!(metadata.workbook_sheet_inventory[1].name, "Second");

        let selected_workbook_index =
            select_initial_active_visible_workbook_index(&metadata).expect("visible sheet");
        assert_eq!(selected_workbook_index, 1);

        let parsed = parse_selected_workbook_sheets(&bytes, &[selected_workbook_index], &metadata)
            .expect("strict selected parse");
        assert_eq!(parsed.output.sheets.len(), 1);
        assert_eq!(parsed.output.sheets[0].name, "Second");
        assert_eq!(parsed.output.workbook_sheet_inventory.len(), 2);
        assert_eq!(
            parsed.output.workbook_sheet_inventory[0].editable_sheet_index,
            None
        );
        assert_eq!(
            parsed.output.workbook_sheet_inventory[1].editable_sheet_index,
            Some(0)
        );
        assert_eq!(
            parsed.output.parsed_workbook_sheet_indices,
            BTreeSet::from([1])
        );

        let compatibility =
            parse_initial_active_visible_sheet(&bytes).expect("compatibility selected parse");
        assert_eq!(
            compatibility.output.sheets.len(),
            2,
            "compatibility path should retain metadata-only SheetData placeholders"
        );
        assert!(compatibility.output.sheets[0].cells.is_empty());
        assert!(!compatibility.output.sheets[1].cells.is_empty());
    }

    #[test]
    fn selected_workbook_metadata_rejects_no_visible_editable_sheet() {
        let bytes = two_sheet_fixture_xlsx(Some("hidden"), Some("veryHidden"), 0);

        let metadata = parse_deferred_workbook_metadata(&bytes).expect("metadata");
        let err = select_initial_active_visible_workbook_index(&metadata)
            .expect_err("no visible editable sheet should fail");
        assert!(err.to_string().contains("no visible editable worksheet"));
    }

    #[test]
    fn selected_workbook_metadata_out_of_range_active_tab_uses_first_visible_sheet() {
        let bytes = two_sheet_fixture_xlsx(None, None, 99);

        let metadata = parse_deferred_workbook_metadata(&bytes).expect("metadata");
        let selected_workbook_index =
            select_initial_active_visible_workbook_index(&metadata).expect("visible sheet");
        assert_eq!(selected_workbook_index, 0);
    }

    #[test]
    fn hidden_active_middle_tab_uses_first_visible_sheet_not_next_visible_sheet() {
        let bytes = three_sheet_fixture_xlsx(None, Some("hidden"), None, 1);

        let metadata = parse_deferred_workbook_metadata(&bytes).expect("metadata");
        let selected_workbook_index =
            select_initial_active_visible_workbook_index(&metadata).expect("visible sheet");
        assert_eq!(selected_workbook_index, 0);

        let compatibility =
            parse_initial_active_visible_sheet(&bytes).expect("compatibility selected parse");
        assert_eq!(
            initial_active_visible_sheet_index(&compatibility.output),
            Some(0)
        );
        assert!(!compatibility.output.sheets[0].cells.is_empty());
        assert!(compatibility.output.sheets[1].cells.is_empty());
        assert!(compatibility.output.sheets[2].cells.is_empty());
    }
}
