//! Printing concerns on a sheet: page breaks (horizontal + vertical),
//! print area, repeat rows/cols titles, print settings, header/footer
//! images.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_RANGE_PAYLOADS, KEY_RANGES};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::print::{PageBreakEntry, PageBreaks};
use domain_types::domain::sheet::{PrintRange, PrintTitles};
use domain_types::yrs_schema::page_breaks as page_breaks_schema;
use domain_types::yrs_schema::print as print_schema;

use super::yrs_helpers::{
    KEY_HF_IMAGES, KEY_PRINT_SETTINGS, KEY_PRINT_TITLES, get_meta_map, meta_string,
};

// =========================================================================
// Page breaks
// =========================================================================

const MAX_COLUMN_INDEX: u32 = 16_383;
const MAX_ROW_INDEX: u32 = 1_048_575;

/// Get page breaks for a sheet.
///
/// Reads canonical `rowBreaks`/`colBreaks` keys via `page_breaks_schema`.
pub(crate) fn get_page_breaks(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> PageBreaks {
    let txn = doc.transact();
    let meta = match get_meta_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return PageBreaks::default(),
    };
    page_breaks_schema::from_yrs_map(&meta, &txn)
}

/// Add a horizontal page break at the given row.
pub(crate) fn add_horizontal_page_break(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, row: u32) {
    let mut breaks = get_page_breaks(doc, sheets, sheet_id);
    if breaks.row_breaks.iter().any(|e| e.id == row) {
        return;
    }
    breaks.row_breaks.push(PageBreakEntry {
        id: row,
        min: 0,
        max: MAX_COLUMN_INDEX,
        manual: true,
        pt: false,
    });
    breaks.row_breaks.sort_by_key(|e| e.id);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json = serde_json::to_string(&breaks.row_breaks).expect("serialize page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_ROW_BREAKS,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Remove a horizontal page break at the given row.
pub(crate) fn remove_horizontal_page_break(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
) {
    let mut breaks = get_page_breaks(doc, sheets, sheet_id);
    if !breaks.row_breaks.iter().any(|e| e.id == row) {
        return;
    }
    breaks.row_breaks.retain(|e| e.id != row);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json = serde_json::to_string(&breaks.row_breaks).expect("serialize page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_ROW_BREAKS,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Add a vertical page break at the given column.
pub(crate) fn add_vertical_page_break(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, col: u32) {
    let mut breaks = get_page_breaks(doc, sheets, sheet_id);
    if breaks.col_breaks.iter().any(|e| e.id == col) {
        return;
    }
    breaks.col_breaks.push(PageBreakEntry {
        id: col,
        min: 0,
        max: MAX_ROW_INDEX,
        manual: true,
        pt: false,
    });
    breaks.col_breaks.sort_by_key(|e| e.id);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json = serde_json::to_string(&breaks.col_breaks).expect("serialize page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_COL_BREAKS,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Remove a vertical page break at the given column.
pub(crate) fn remove_vertical_page_break(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, col: u32) {
    let mut breaks = get_page_breaks(doc, sheets, sheet_id);
    if !breaks.col_breaks.iter().any(|e| e.id == col) {
        return;
    }
    breaks.col_breaks.retain(|e| e.id != col);

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let json = serde_json::to_string(&breaks.col_breaks).expect("serialize page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_COL_BREAKS,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

/// Clear all page breaks (horizontal and vertical).
pub(crate) fn clear_all_page_breaks(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_ROW_BREAKS,
            Any::String(Arc::from("[]")),
        );
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_COL_BREAKS,
            Any::String(Arc::from("[]")),
        );
    }
}

/// Bulk-set all page breaks for a sheet (replaces both row and column breaks).
pub(crate) fn set_page_breaks(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, breaks: &PageBreaks) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let row_json =
            serde_json::to_string(&breaks.row_breaks).expect("serialize row page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_ROW_BREAKS,
            Any::String(Arc::from(row_json.as_str())),
        );
        // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
        let col_json =
            serde_json::to_string(&breaks.col_breaks).expect("serialize col page breaks");
        meta.insert(
            &mut txn,
            page_breaks_schema::KEY_COL_BREAKS,
            Any::String(Arc::from(col_json.as_str())),
        );
    }
}

// =========================================================================
// Print area
// =========================================================================

/// Get the print area for a sheet.
///
/// Reads from `RangeKind::PrintArea` ranges.
pub(crate) fn get_print_area(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Option<PrintRange> {
    let txn = doc.transact();
    read_print_area_from_ranges(&txn, sheets, sheet_id)
}

/// Get all print areas for a sheet (supports multiple print areas per sheet).
///
/// Reads from `RangeKind::PrintArea` ranges (one per print area).
#[allow(dead_code)] // Future-facing API; exercised by tests
pub(crate) fn get_print_areas(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<PrintRange> {
    let txn = doc.transact();
    read_print_areas_from_ranges(&txn, sheets, sheet_id)
}

/// Set the print area for a sheet (or clear with `None`).
///
/// Writes to the Range-backed `RangeKind::PrintArea` store.
pub(crate) fn set_print_area(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    area: Option<&PrintRange>,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));

    // Remove all existing PrintArea ranges.
    remove_all_print_area_ranges(&mut txn, sheets, sheet_id);

    // Create a new one if area is Some.
    if let Some(range) = area {
        create_print_area_range(&mut txn, sheets, sheet_id, range);
    }
}

// =========================================================================
// Range-backed print area helpers (Phase 5D)
// =========================================================================

/// Get the per-sheet sub-map by key.
fn get_sheet_sub_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sm = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sm.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Read a single print area from `RangeKind::PrintArea` ranges (first match).
fn read_print_area_from_ranges<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<PrintRange> {
    read_print_areas_from_ranges(txn, sheets_root, sheet_id)
        .into_iter()
        .next()
}

/// Read all print areas from `RangeKind::PrintArea` ranges.
fn read_print_areas_from_ranges<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Vec<PrintRange> {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return Vec::new();
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return Vec::new();
    };

    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let mut areas = Vec::new();
    for entry in &entries {
        if entry.metadata.kind == cell_types::RangeKind::PrintArea {
            // Extract the print range from the anchor.
            if let Some(pr) = print_range_from_anchor(&entry.metadata.anchor) {
                areas.push(pr);
            }
        }
    }
    areas
}

/// Convert a `RangeAnchor` to a `PrintRange` using row/col index positions.
///
/// For `PrintArea` ranges, the anchor stores the print area bounds. Since
/// `PrintRange` uses 0-based positional indices (not identity-based RowId/ColId),
/// we store the row/col index positions directly in `Strict` anchor's
/// raw values (see `create_print_area_range`).
fn print_range_from_anchor(anchor: &cell_types::RangeAnchor) -> Option<PrintRange> {
    match anchor {
        cell_types::RangeAnchor::Strict { row_ids, col_ids } => {
            // We encode the print range corners as synthetic row/col IDs
            // where the raw u128 value equals the 0-based index.
            if row_ids.len() == 2 && col_ids.len() == 2 {
                Some(PrintRange {
                    start_row: row_ids[0].as_u128() as u32,
                    end_row: row_ids[1].as_u128() as u32,
                    start_col: col_ids[0].as_u128() as u32,
                    end_col: col_ids[1].as_u128() as u32,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Create a `RangeKind::PrintArea` Range entry for the given print range.
fn create_print_area_range(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    range: &PrintRange,
) {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };

    let range_id = cell_types::RangeId::from_raw(uuid::Uuid::new_v4().as_u128());

    // Encode the print range corners as synthetic RowId/ColId values.
    // This is a positional encoding (not identity-based) since PrintRange
    // uses 0-based row/col indices.
    let metadata = compute_document::range::RangeMetadata {
        range_id,
        kind: cell_types::RangeKind::PrintArea,
        anchor: cell_types::RangeAnchor::Strict {
            row_ids: vec![
                cell_types::RowId::from_raw(range.start_row as u128),
                cell_types::RowId::from_raw(range.end_row as u128),
            ],
            col_ids: vec![
                cell_types::ColId::from_raw(range.start_col as u128),
                cell_types::ColId::from_raw(range.end_col as u128),
            ],
        },
        encoding: cell_types::PayloadEncoding::None,
        row_axis: None,
        col_axis: None,
        row_ids: Vec::new(),
        col_ids: Vec::new(),
    };

    compute_document::range::write_range_to_yrs(txn, &ranges_map, &payloads_map, &metadata, &[]);
}

/// Remove all `RangeKind::PrintArea` Range entries for the sheet.
fn remove_all_print_area_ranges(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) {
    let Some(ranges_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGES) else {
        return;
    };
    let Some(payloads_map) = get_sheet_sub_map(txn, sheets_root, sheet_id, KEY_RANGE_PAYLOADS)
    else {
        return;
    };

    let entries = compute_document::range::read_ranges_from_yrs(txn, &ranges_map, &payloads_map);
    let to_remove: Vec<cell_types::RangeId> = entries
        .iter()
        .filter(|e| e.metadata.kind == cell_types::RangeKind::PrintArea)
        .map(|e| e.metadata.range_id)
        .collect();

    for range_id in &to_remove {
        compute_document::range::remove_range_from_yrs(txn, &ranges_map, &payloads_map, range_id);
    }
}

// =========================================================================
// Print titles
// =========================================================================

/// Get print titles for a sheet.
pub(crate) fn get_print_titles(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> PrintTitles {
    let txn = doc.transact();
    let meta = match get_meta_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => {
            return PrintTitles {
                repeat_rows: None,
                repeat_cols: None,
            };
        }
    };
    meta_string(&txn, &meta, KEY_PRINT_TITLES)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(PrintTitles {
            repeat_rows: None,
            repeat_cols: None,
        })
}

/// Set print titles for a sheet.
pub(crate) fn set_print_titles(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    titles: &PrintTitles,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        if titles.repeat_rows.is_none() && titles.repeat_cols.is_none() {
            meta.remove(&mut txn, KEY_PRINT_TITLES);
        } else {
            // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
            let json = serde_json::to_string(titles).expect("serialize print titles");
            meta.insert(
                &mut txn,
                KEY_PRINT_TITLES,
                Any::String(Arc::from(json.as_str())),
            );
        }
    }
}

// =========================================================================
// Print settings (structured Y.Map)
// =========================================================================

/// Get sheet print settings.
///
/// Reads from structured Y.Map via `print_schema`.
pub(crate) fn get_print_settings(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> domain_types::domain::print::PrintSettings {
    let txn = doc.transact();
    let meta = match get_meta_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return domain_types::domain::print::PrintSettings::default(),
    };
    match meta.get(&txn, KEY_PRINT_SETTINGS) {
        Some(yrs::Out::YMap(sub_map)) => {
            print_schema::from_yrs_map(&sub_map, &txn).unwrap_or_default()
        }
        _ => domain_types::domain::print::PrintSettings::default(),
    }
}

/// Set sheet print settings.
pub(crate) fn set_print_settings(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    settings: &domain_types::domain::print::PrintSettings,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let entries = print_schema::to_yrs_prelim(settings);
        let ps_prelim: MapPrelim = entries.into_iter().collect();
        let _sub_map = meta.insert(&mut txn, KEY_PRINT_SETTINGS, ps_prelim);
    }
}

// =========================================================================
// Header/footer images
// =========================================================================

/// Get header/footer images for a sheet. Returns empty vec if none stored.
pub(crate) fn get_hf_images(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    let txn = doc.transact();
    let meta = match get_meta_map(&txn, sheets, sheet_id) {
        Some(m) => m,
        None => return Vec::new(),
    };
    match meta.get(&txn, KEY_HF_IMAGES) {
        Some(Out::Any(Any::String(json))) => {
            domain_types::yrs_schema::print::hf_images_from_json(&json)
        }
        _ => Vec::new(),
    }
}

/// Set header/footer images for a sheet (replaces entire list).
pub(crate) fn set_hf_images(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    images: &[domain_types::domain::print::HeaderFooterImageInfo],
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        let json = domain_types::yrs_schema::print::hf_images_to_json(images);
        meta.insert(
            &mut txn,
            KEY_HF_IMAGES,
            Any::String(Arc::from(json.as_str())),
        );
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_page_breaks() {
        let (storage, _mirror, sid) = setup();

        let pb = get_page_breaks(storage.doc(), storage.sheets(), &sid);
        assert!(pb.row_breaks.is_empty());
        assert!(pb.col_breaks.is_empty());

        add_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 10);
        add_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 5);
        let pb = get_page_breaks(storage.doc(), storage.sheets(), &sid);
        let ids: Vec<u32> = pb.row_breaks.iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![5, 10]); // sorted

        // Duplicate is no-op
        add_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 5);
        let ids: Vec<u32> = get_page_breaks(storage.doc(), storage.sheets(), &sid)
            .row_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![5, 10]);

        remove_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 5);
        let ids: Vec<u32> = get_page_breaks(storage.doc(), storage.sheets(), &sid)
            .row_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![10]);
    }

    #[test]
    fn test_vertical_page_breaks() {
        let (storage, _mirror, sid) = setup();

        add_vertical_page_break(storage.doc(), storage.sheets(), &sid, 3);
        add_vertical_page_break(storage.doc(), storage.sheets(), &sid, 7);
        let ids: Vec<u32> = get_page_breaks(storage.doc(), storage.sheets(), &sid)
            .col_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![3, 7]);

        remove_vertical_page_break(storage.doc(), storage.sheets(), &sid, 3);
        let ids: Vec<u32> = get_page_breaks(storage.doc(), storage.sheets(), &sid)
            .col_breaks
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ids, vec![7]);
    }

    #[test]
    fn test_clear_all_page_breaks() {
        let (storage, _mirror, sid) = setup();

        add_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 5);
        add_vertical_page_break(storage.doc(), storage.sheets(), &sid, 3);

        clear_all_page_breaks(storage.doc(), storage.sheets(), &sid);
        let pb = get_page_breaks(storage.doc(), storage.sheets(), &sid);
        assert!(pb.row_breaks.is_empty());
        assert!(pb.col_breaks.is_empty());
    }

    #[test]
    fn test_print_area() {
        let (storage, _mirror, sid) = setup();
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_none());

        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area));
        assert_eq!(
            get_print_area(storage.doc(), storage.sheets(), &sid),
            Some(area)
        );

        // Clear
        set_print_area(storage.doc(), storage.sheets(), &sid, None);
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_none());
    }

    #[test]
    fn test_print_titles() {
        let (storage, _mirror, sid) = setup();
        let titles = get_print_titles(storage.doc(), storage.sheets(), &sid);
        assert!(titles.repeat_rows.is_none());
        assert!(titles.repeat_cols.is_none());

        let new_titles = PrintTitles {
            repeat_rows: Some((0, 2)),
            repeat_cols: Some((0, 0)),
        };
        set_print_titles(storage.doc(), storage.sheets(), &sid, &new_titles);
        assert_eq!(
            get_print_titles(storage.doc(), storage.sheets(), &sid),
            new_titles
        );

        // Clear
        let empty = PrintTitles {
            repeat_rows: None,
            repeat_cols: None,
        };
        set_print_titles(storage.doc(), storage.sheets(), &sid, &empty);
        let result = get_print_titles(storage.doc(), storage.sheets(), &sid);
        assert!(result.repeat_rows.is_none());
    }

    #[test]
    fn test_print_settings() {
        let (storage, _mirror, sid) = setup();
        let ps = get_print_settings(storage.doc(), storage.sheets(), &sid);
        // Default orientation is None
        assert_eq!(ps.orientation, None);
        assert_eq!(ps.scale, None);

        let custom = domain_types::domain::print::PrintSettings {
            orientation: Some("landscape".to_string()),
            paper_size: Some(9), // a4
            scale: Some(75),
            fit_to_width: Some(1),
            fit_to_height: None,
            h_centered: true,
            v_centered: false,
            gridlines: true,
            headings: false,
            ..Default::default()
        };
        set_print_settings(storage.doc(), storage.sheets(), &sid, &custom);
        let read = get_print_settings(storage.doc(), storage.sheets(), &sid);
        assert_eq!(read.orientation, custom.orientation);
        assert_eq!(read.paper_size, custom.paper_size);
        assert_eq!(read.scale, custom.scale);
        assert_eq!(read.fit_to_width, custom.fit_to_width);
        assert_eq!(read.fit_to_height, custom.fit_to_height);
        assert_eq!(read.h_centered, custom.h_centered);
        assert_eq!(read.v_centered, custom.v_centered);
        assert_eq!(read.gridlines, custom.gridlines);
        assert_eq!(read.headings, custom.headings);
    }

    #[test]
    fn test_remove_nonexistent_page_break() {
        let (storage, _mirror, sid) = setup();
        // Should not panic
        remove_horizontal_page_break(storage.doc(), storage.sheets(), &sid, 99);
        remove_vertical_page_break(storage.doc(), storage.sheets(), &sid, 99);
    }

    #[test]
    fn test_print_settings_serde_roundtrip() {
        let settings = domain_types::domain::print::PrintSettings {
            orientation: Some("landscape".to_string()),
            paper_size: Some(9),
            scale: Some(85),
            fit_to_width: Some(2),
            fit_to_height: Some(1),
            h_centered: true,
            v_centered: true,
            gridlines: true,
            headings: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: domain_types::domain::print::PrintSettings =
            serde_json::from_str(&json).unwrap();
        assert_eq!(settings, deserialized);
    }

    // -----------------------------------------------------------------------
    // Phase 5D: Range-backed print area tests
    // -----------------------------------------------------------------------

    #[test]
    fn phase5d_print_area_set_and_get() {
        let (storage, _mirror, sid) = setup();
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_none());

        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 99,
            end_col: 25,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area));

        // Should be readable via get_print_area (dual-read path).
        let fetched = get_print_area(storage.doc(), storage.sheets(), &sid);
        assert_eq!(fetched, Some(area));
    }

    #[test]
    fn phase5d_print_area_clear() {
        let (storage, _mirror, sid) = setup();

        let area = PrintRange {
            start_row: 5,
            start_col: 2,
            end_row: 20,
            end_col: 10,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area));
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_some());

        set_print_area(storage.doc(), storage.sheets(), &sid, None);
        assert!(get_print_area(storage.doc(), storage.sheets(), &sid).is_none());
    }

    #[test]
    fn phase5d_print_area_overwrite() {
        let (storage, _mirror, sid) = setup();

        let area1 = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area1));

        let area2 = PrintRange {
            start_row: 5,
            start_col: 5,
            end_row: 50,
            end_col: 20,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area2));

        let fetched = get_print_area(storage.doc(), storage.sheets(), &sid);
        assert_eq!(fetched, Some(area2));
    }

    #[test]
    fn phase5d_get_print_areas_multiple() {
        let (storage, _mirror, sid) = setup();

        // Currently set_print_area replaces all, so get_print_areas
        // returns at most one. This test verifies the API shape.
        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area));

        let areas = get_print_areas(storage.doc(), storage.sheets(), &sid);
        assert!(!areas.is_empty());
        assert_eq!(areas[0], area);
    }

    #[test]
    fn phase5d_get_print_areas_empty() {
        let (storage, _mirror, sid) = setup();
        let areas = get_print_areas(storage.doc(), storage.sheets(), &sid);
        assert!(areas.is_empty());
    }

    #[test]
    fn phase5d_full_sheet_print_area() {
        let (storage, _mirror, sid) = setup();

        // Full-sheet print area (large range).
        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 999,
            end_col: 255,
        };
        set_print_area(storage.doc(), storage.sheets(), &sid, Some(&area));

        let fetched = get_print_area(storage.doc(), storage.sheets(), &sid);
        assert_eq!(fetched, Some(area));
    }
}
