use super::super::id_to_hex;
use super::merge::normalize_format_patch;
use super::yrs::get_sheet_map;
use crate::mirror::SheetMirror;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::{CellFormat, yrs_schema};
use yrs::{Any, Map, MapPrelim, Origin, Out, Transact};

/// Add or update a Format Range in the mirror and Yrs storage.
///
/// Creates a `rangeFormats[range_id]` entry in Yrs with the serialized
/// `CellFormat` and registers the range in the mirror's spatial index +
/// format cache.
pub fn add_format_range(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    mirror: &mut SheetMirror,
    range_id: crate::mirror::RangeId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    format: &CellFormat,
) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    let format = normalize_format_patch(format);

    // Write to Yrs
    let range_hex = id_to_hex(range_id.as_u128());
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id) {
        // Ensure rangeFormats sub-map exists
        let rf_map = match sheet_map.get(&txn, KEY_RANGE_FORMATS) {
            Some(Out::YMap(m)) => m,
            _ => {
                let empty = MapPrelim::from([] as [(&str, Any); 0]);
                sheet_map.insert(&mut txn, KEY_RANGE_FORMATS, empty)
            }
        };

        // Store format as a structured Y.Map (same encoding as rowFormats/colFormats)
        // plus bounds metadata.
        rf_map.remove(&mut txn, &range_hex);
        let mut entries = yrs_schema::cell_format::to_yrs_prelim(&format);
        entries.push(("_sr", Any::Number(start_row as f64)));
        entries.push(("_sc", Any::Number(start_col as f64)));
        entries.push(("_er", Any::Number(end_row as f64)));
        entries.push(("_ec", Any::Number(end_col as f64)));
        let nested: MapPrelim = entries.into_iter().collect();
        rf_map.insert(&mut txn, &*range_hex, nested);
    }
    drop(txn);

    // Update mirror
    // Remove existing entry if present (for update case)
    mirror.format_ranges.retain(|r| r.id != range_id);
    mirror.format_ranges.push(crate::mirror::FormatRange {
        id: range_id,
        start_row,
        start_col,
        end_row,
        end_col,
    });
    mirror.range_format_cache.insert(range_id, format);
}

/// Remove a Format Range from both mirror and Yrs storage.
pub fn remove_format_range(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    mirror: &mut SheetMirror,
    range_id: crate::mirror::RangeId,
) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    // Remove from Yrs
    let range_hex = id_to_hex(range_id.as_u128());
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id)
        && let Some(Out::YMap(rf_map)) = sheet_map.get(&txn, KEY_RANGE_FORMATS)
    {
        rf_map.remove(&mut txn, &range_hex);
    }
    drop(txn);

    // Remove from mirror
    mirror.format_ranges.retain(|r| r.id != range_id);
    mirror.range_format_cache.remove(&range_id);
    mirror.range_xlsx_style_id_cache.remove(&range_id);
}

/// Hydrate Format Ranges from the `rangeFormats` Yrs sub-map into a SheetMirror.
///
/// Called during document load after the Yrs document is populated.
/// Each entry in `rangeFormats[range_id_hex]` is a Y.Map containing:
/// - CellFormat fields (same encoding as rowFormats/colFormats)
/// - Bounds metadata: `_sr` (start_row), `_sc` (start_col), `_er` (end_row), `_ec` (end_col)
pub fn hydrate_format_ranges(storage: &YrsStorage, sheet_id: &SheetId, mirror: &mut SheetMirror) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    mirror.format_ranges.clear();
    mirror.range_format_cache.clear();
    mirror.range_xlsx_style_id_cache.clear();

    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();

    let sheet_map = match get_sheet_map(&txn, &sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let rf_map = match sheet_map.get(&txn, KEY_RANGE_FORMATS) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (hex_key, value) in rf_map.iter(&txn) {
        let raw_id = match compute_document::hex::hex_to_id(hex_key) {
            Some(id) => id,
            None => continue,
        };
        let range_id = crate::mirror::RangeId::from_raw(raw_id);

        if let Out::YMap(nested) = value {
            // Read bounds
            let start_row = match nested.get(&txn, "_sr") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let start_col = match nested.get(&txn, "_sc") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let end_row = match nested.get(&txn, "_er") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let end_col = match nested.get(&txn, "_ec") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };

            // Read CellFormat (ignoring the bounds keys). Imported authored
            // style-only runs on the lossless stylesheet path may only carry
            // the original XLSX style id (`xi`) plus bounds; keep those as
            // default-format ranges so export can stream the original `<c s>`
            // coverage back without densifying cells.
            let has_imported_style_id = nested
                .get(&txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID)
                .is_some();
            let imported_style_id =
                match nested.get(&txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID) {
                    Some(Out::Any(Any::Number(n))) if n >= 0.0 => Some(n as u32),
                    _ => None,
                };
            if let Some(fmt) = yrs_schema::cell_format::from_yrs_map(&nested, &txn)
                .or_else(|| has_imported_style_id.then(CellFormat::default))
            {
                mirror.format_ranges.push(crate::mirror::FormatRange {
                    id: range_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                });
                mirror.range_format_cache.insert(range_id, fmt);
                if let Some(style_id) = imported_style_id {
                    mirror.range_xlsx_style_id_cache.insert(range_id, style_id);
                }
            }
        }
    }
}
