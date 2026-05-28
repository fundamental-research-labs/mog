//! Yrs schema for [`PrintSettings`] — flat Y.Map with sub-structures as JSON.
//!
//! [`PageMargins`] and [`HeaderFooter`] are stored as JSON strings since they are
//! tightly coupled sub-objects that are always read/written together.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::print::{
    HeaderFooter, ImportedPrinterSettingsIdentity, PageMargins, PageSetupProperties, PrintSettings,
};

pub const KEY_PAPER_SIZE: &str = "paperSize";
pub const KEY_PAPER_WIDTH: &str = "paperWidth";
pub const KEY_PAPER_HEIGHT: &str = "paperHeight";
pub const KEY_ORIENTATION: &str = "orientation";
pub const KEY_SCALE: &str = "scale";
pub const KEY_FIT_TO_WIDTH: &str = "fitToWidth";
pub const KEY_FIT_TO_HEIGHT: &str = "fitToHeight";
pub const KEY_GRIDLINES: &str = "gridlines";
pub const KEY_HEADINGS: &str = "headings";
pub const KEY_H_CENTERED: &str = "hCentered";
pub const KEY_V_CENTERED: &str = "vCentered";
pub const KEY_MARGINS: &str = "margins";
pub const KEY_HEADER_FOOTER: &str = "headerFooter";
pub const KEY_BLACK_AND_WHITE: &str = "blackAndWhite";
pub const KEY_DRAFT: &str = "draft";
pub const KEY_FIRST_PAGE_NUMBER: &str = "firstPageNumber";
pub const KEY_IMPORTED_PRINTER_SETTINGS: &str = "importedPrinterSettings";
pub const KEY_PAGE_SETUP_PROPERTIES: &str = "pageSetupProperties";

/// Convert a [`PrintSettings`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(settings: &PrintSettings) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_GRIDLINES, Any::Bool(settings.gridlines)),
        (KEY_HEADINGS, Any::Bool(settings.headings)),
        (KEY_H_CENTERED, Any::Bool(settings.h_centered)),
        (KEY_V_CENTERED, Any::Bool(settings.v_centered)),
        (KEY_BLACK_AND_WHITE, Any::Bool(settings.black_and_white)),
        (KEY_DRAFT, Any::Bool(settings.draft)),
    ];
    if let Some(paper_size) = settings.paper_size {
        entries.push((KEY_PAPER_SIZE, Any::Number(paper_size as f64)));
    }
    if let Some(paper_width) = &settings.paper_width {
        entries.push((
            KEY_PAPER_WIDTH,
            Any::String(Arc::from(paper_width.as_str())),
        ));
    }
    if let Some(paper_height) = &settings.paper_height {
        entries.push((
            KEY_PAPER_HEIGHT,
            Any::String(Arc::from(paper_height.as_str())),
        ));
    }
    if let Some(orientation) = &settings.orientation {
        entries.push((
            KEY_ORIENTATION,
            Any::String(Arc::from(orientation.as_str())),
        ));
    }
    if let Some(scale) = settings.scale {
        entries.push((KEY_SCALE, Any::Number(scale as f64)));
    }
    if let Some(fit_to_width) = settings.fit_to_width {
        entries.push((KEY_FIT_TO_WIDTH, Any::Number(fit_to_width as f64)));
    }
    if let Some(fit_to_height) = settings.fit_to_height {
        entries.push((KEY_FIT_TO_HEIGHT, Any::Number(fit_to_height as f64)));
    }
    if let Some(first_page_number) = settings.first_page_number {
        entries.push((KEY_FIRST_PAGE_NUMBER, Any::Number(first_page_number as f64)));
    }
    // Sub-structures as JSON
    if let Some(margins) = &settings.margins
        && let Ok(json) = serde_json::to_string(margins)
    {
        entries.push((KEY_MARGINS, Any::String(Arc::from(json))));
    }
    if let Some(hf) = &settings.header_footer
        && let Ok(json) = serde_json::to_string(hf)
    {
        entries.push((KEY_HEADER_FOOTER, Any::String(Arc::from(json))));
    }
    if let Some(page_order) = &settings.page_order {
        entries.push(("pageOrder", Any::String(Arc::from(page_order.as_str()))));
    }
    if let Some(upd) = settings.use_printer_defaults {
        entries.push(("usePrinterDefaults", Any::Bool(upd)));
    }
    if let Some(hdpi) = settings.horizontal_dpi {
        entries.push(("horizontalDpi", Any::Number(hdpi as f64)));
    }
    if let Some(vdpi) = settings.vertical_dpi {
        entries.push(("verticalDpi", Any::Number(vdpi as f64)));
    }
    if let Some(r_id) = &settings.r_id {
        entries.push(("rId", Any::String(Arc::from(r_id.as_str()))));
    }
    if let Some(imported) = &settings.imported_printer_settings
        && let Ok(json) = serde_json::to_string(imported)
    {
        entries.push((KEY_IMPORTED_PRINTER_SETTINGS, Any::String(Arc::from(json))));
    }
    if settings.use_first_page_number {
        entries.push(("useFirstPageNumber", Any::Bool(true)));
    }
    if settings.has_print_options {
        entries.push(("hasPrintOptions", Any::Bool(true)));
    }
    if settings.has_page_setup {
        entries.push(("hasPageSetup", Any::Bool(true)));
    }
    if let Some(copies) = settings.copies {
        entries.push(("copies", Any::Number(copies as f64)));
    }
    if !settings.grid_lines_set {
        entries.push(("gridLinesSet", Any::Bool(false)));
    }
    if let Some(page_setup_properties) = &settings.page_setup_properties
        && let Ok(json) = serde_json::to_string(page_setup_properties)
    {
        entries.push((KEY_PAGE_SETUP_PROPERTIES, Any::String(Arc::from(json))));
    }
    if let Some(ref cc) = settings.cell_comments {
        entries.push(("cellComments", Any::String(Arc::from(cc.as_str()))));
    }
    if let Some(ref pe) = settings.print_errors {
        entries.push(("printErrors", Any::String(Arc::from(pe.as_str()))));
    }
    entries
}

/// Read a [`PrintSettings`] from a Y.Map. Always returns Some (all fields have defaults).
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<PrintSettings> {
    Some(PrintSettings {
        paper_size: read_u32(map, txn, KEY_PAPER_SIZE),
        paper_width: read_string(map, txn, KEY_PAPER_WIDTH),
        paper_height: read_string(map, txn, KEY_PAPER_HEIGHT),
        orientation: read_string(map, txn, KEY_ORIENTATION),
        scale: read_u32(map, txn, KEY_SCALE),
        fit_to_width: read_u32(map, txn, KEY_FIT_TO_WIDTH),
        fit_to_height: read_u32(map, txn, KEY_FIT_TO_HEIGHT),
        gridlines: read_bool(map, txn, KEY_GRIDLINES).unwrap_or(false),
        headings: read_bool(map, txn, KEY_HEADINGS).unwrap_or(false),
        h_centered: read_bool(map, txn, KEY_H_CENTERED).unwrap_or(false),
        v_centered: read_bool(map, txn, KEY_V_CENTERED).unwrap_or(false),
        margins: read_string(map, txn, KEY_MARGINS)
            .and_then(|s| serde_json::from_str::<PageMargins>(&s).ok()),
        header_footer: read_string(map, txn, KEY_HEADER_FOOTER)
            .and_then(|s| serde_json::from_str::<HeaderFooter>(&s).ok()),
        black_and_white: read_bool(map, txn, KEY_BLACK_AND_WHITE).unwrap_or(false),
        draft: read_bool(map, txn, KEY_DRAFT).unwrap_or(false),
        first_page_number: read_u32(map, txn, KEY_FIRST_PAGE_NUMBER),
        page_order: read_string(map, txn, "pageOrder"),
        use_printer_defaults: read_bool(map, txn, "usePrinterDefaults"),
        horizontal_dpi: read_u32(map, txn, "horizontalDpi"),
        vertical_dpi: read_u32(map, txn, "verticalDpi"),
        r_id: read_string(map, txn, "rId"),
        imported_printer_settings: read_string(map, txn, KEY_IMPORTED_PRINTER_SETTINGS)
            .and_then(|s| serde_json::from_str::<ImportedPrinterSettingsIdentity>(&s).ok()),
        has_print_options: read_bool(map, txn, "hasPrintOptions").unwrap_or(false),
        has_page_setup: read_bool(map, txn, "hasPageSetup").unwrap_or(false),
        copies: read_u32(map, txn, "copies"),
        grid_lines_set: read_bool(map, txn, "gridLinesSet").unwrap_or(true),
        page_setup_properties: read_string(map, txn, KEY_PAGE_SETUP_PROPERTIES)
            .and_then(|s| serde_json::from_str::<PageSetupProperties>(&s).ok()),
        use_first_page_number: read_bool(map, txn, "useFirstPageNumber").unwrap_or(false),
        cell_comments: read_string(map, txn, "cellComments"),
        print_errors: read_string(map, txn, "printErrors"),
    })
}

/// Update a single field on an existing PrintSettings Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}

// =========================================================================
// Header/footer images — stored as JSON array in the sheet meta map
// =========================================================================

/// Serialize HF images to a JSON string for Yrs storage.
pub fn hf_images_to_json(images: &[crate::domain::print::HeaderFooterImageInfo]) -> String {
    serde_json::to_string(images).unwrap_or_else(|_| "[]".to_string())
}

/// Deserialize HF images from a JSON string.
pub fn hf_images_from_json(json: &str) -> Vec<crate::domain::print::HeaderFooterImageInfo> {
    serde_json::from_str(json).unwrap_or_default()
}
