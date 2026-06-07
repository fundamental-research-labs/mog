use crate::domain::content_types::read::ContentTypes;
use crate::domain::workbook::read as workbook;
use crate::zip::{XlsxArchive, ZipError};

/// Workbook-level metadata needed to choose and selectively parse deferred
/// sheets without parsing worksheet cell payloads.
#[derive(Debug, Clone, PartialEq)]
pub struct DeferredWorkbookMetadata {
    pub workbook_sheet_inventory: Vec<domain_types::WorkbookSheetPackageInfo>,
    pub workbook_views: Vec<domain_types::domain::workbook::WorkbookView>,
}

pub(super) fn parse_deferred_workbook_metadata_impl(
    xlsx_data: &[u8],
) -> Result<DeferredWorkbookMetadata, String> {
    if xlsx_data.is_empty() {
        return Err("Empty XLSX data".to_string());
    }
    if crate::zip::is_encrypted_office_package(xlsx_data) {
        return Err("Encrypted XLSX files are not supported".to_string());
    }
    if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
        return Err("Invalid XLSX file: not a valid ZIP archive".to_string());
    }

    let archive =
        XlsxArchive::new(xlsx_data).map_err(|e| format!("Failed to open XLSX archive: {e}"))?;
    let workbook_xml = archive
        .get_workbook()
        .map_err(|e| format!("Failed to read xl/workbook.xml: {e}"))?;
    let workbook_relationships = match archive.read_file("xl/_rels/workbook.xml.rels") {
        Ok(xml) => workbook::parse_all_rels(&xml),
        Err(ZipError::FileNotFound(_)) => Vec::new(),
        Err(e) => return Err(format!("Failed to read xl/_rels/workbook.xml.rels: {e}")),
    };
    let content_types = archive
        .get_content_types()
        .ok()
        .and_then(|xml| ContentTypes::parse(&xml).ok());
    let sheet_infos = workbook::parse_workbook(&workbook_xml);
    let workbook_sheet_inventory = workbook::build_workbook_sheet_inventory(
        &sheet_infos,
        &workbook_relationships,
        content_types.as_ref(),
        &archive,
    );
    let workbook_views = workbook::parse_workbook_views(&workbook_xml)
        .into_iter()
        .map(domain_types::domain::workbook::WorkbookView::from)
        .collect();

    Ok(DeferredWorkbookMetadata {
        workbook_sheet_inventory,
        workbook_views,
    })
}

pub(super) fn select_initial_active_visible_workbook_index_impl(
    metadata: &DeferredWorkbookMetadata,
) -> Result<u32, String> {
    let active_workbook_order = metadata
        .workbook_views
        .first()
        .map(|view| view.active_tab)
        .unwrap_or(0);

    let visible_editable = |entry: &&domain_types::WorkbookSheetPackageInfo| {
        entry.editable_sheet_index.is_some()
            && entry.visibility == ooxml_types::workbook::SheetState::Visible
    };

    if let Some(entry) = metadata
        .workbook_sheet_inventory
        .iter()
        .find(|entry| visible_editable(entry) && entry.workbook_order == active_workbook_order)
    {
        return Ok(entry.workbook_order);
    }

    metadata
        .workbook_sheet_inventory
        .iter()
        .find(visible_editable)
        .map(|entry| entry.workbook_order)
        .ok_or_else(|| "XLSX workbook has no visible editable worksheet for deferred import".into())
}
