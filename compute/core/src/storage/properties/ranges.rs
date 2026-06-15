use super::super::id_to_hex;
use super::merge::{merge_formats, normalize_format_patch};
use super::yrs::get_sheet_map;
use crate::mirror::SheetMirror;
use crate::storage::YrsStorage;
use cell_types::{IdAllocator, RangeId, SheetId};
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
    mirror.rebuild_format_range_spatial_index();
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
    mirror.rebuild_format_range_spatial_index();
    mirror.range_format_cache.remove(&range_id);
    mirror.range_xlsx_style_id_cache.remove(&range_id);
}

#[derive(Clone)]
struct ColFormatRangeRecord {
    id: RangeId,
    start_col: u32,
    end_col: u32,
    format: CellFormat,
    xlsx_style_id: Option<u32>,
}

fn write_col_format_range_record(
    txn: &mut yrs::TransactionMut,
    ranges_map: &yrs::MapRef,
    record: &ColFormatRangeRecord,
) {
    let mut entries = yrs_schema::cell_format::to_yrs_prelim(&record.format);
    entries.push(("_sc", Any::Number(record.start_col as f64)));
    entries.push(("_ec", Any::Number(record.end_col as f64)));
    if let Some(style_id) = record.xlsx_style_id {
        entries.push((
            yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
            Any::Number(style_id as f64),
        ));
    }
    let range_hex = id_to_hex(record.id.as_u128());
    let nested: MapPrelim = entries.into_iter().collect();
    ranges_map.insert(txn, range_hex.as_str(), nested);
}

fn read_col_format_range_records(
    txn: &yrs::Transaction,
    ranges_map: &yrs::MapRef,
) -> Vec<ColFormatRangeRecord> {
    let mut records = Vec::new();
    for (key, value) in ranges_map.iter(txn) {
        let Some(raw_id) = compute_document::hex::hex_to_id(key) else {
            continue;
        };
        let Out::YMap(nested) = value else {
            continue;
        };
        let start_col = match nested.get(txn, "_sc") {
            Some(Out::Any(Any::Number(n))) => n as u32,
            _ => continue,
        };
        let end_col = match nested.get(txn, "_ec") {
            Some(Out::Any(Any::Number(n))) => n as u32,
            _ => continue,
        };
        if start_col > end_col {
            continue;
        }
        let Some(format) = yrs_schema::cell_format::from_yrs_map(&nested, txn) else {
            continue;
        };
        let xlsx_style_id = match nested.get(txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID) {
            Some(Out::Any(Any::Number(n))) if n >= 0.0 => Some(n as u32),
            _ => None,
        };
        records.push(ColFormatRangeRecord {
            id: RangeId::from_raw(raw_id),
            start_col,
            end_col,
            format,
            xlsx_style_id,
        });
    }
    records
}

fn column_range_segments_for_patch(
    records: &[ColFormatRangeRecord],
    start_col: u32,
    end_col: u32,
    patch: &CellFormat,
) -> Vec<ColFormatRangeRecord> {
    let mut bounds = vec![start_col, end_col.saturating_add(1)];
    for record in records {
        if record.end_col < start_col || record.start_col > end_col {
            continue;
        }
        bounds.push(record.start_col.max(start_col));
        if record.end_col < end_col {
            bounds.push(record.end_col.saturating_add(1));
        }
    }
    bounds.sort_unstable();
    bounds.dedup();

    let mut segments: Vec<ColFormatRangeRecord> = Vec::new();
    for pair in bounds.windows(2) {
        let segment_start = pair[0];
        let segment_end = pair[1].saturating_sub(1);
        if segment_start > segment_end {
            continue;
        }

        let mut matching: Vec<_> = records
            .iter()
            .filter(|record| record.start_col <= segment_start && record.end_col >= segment_start)
            .collect();
        matching.sort_by_key(|record| record.id.as_u128());

        let mut merged = CellFormat::default();
        let mut has_base = false;
        for record in matching {
            merged = merge_formats(&merged, &record.format);
            has_base = true;
        }
        let format = if has_base {
            merge_formats(&merged, patch)
        } else {
            patch.clone()
        };

        if let Some(last) = segments.last_mut()
            && last.end_col.saturating_add(1) == segment_start
            && last.format == format
            && last.xlsx_style_id.is_none()
        {
            last.end_col = segment_end;
            continue;
        }

        segments.push(ColFormatRangeRecord {
            id: RangeId::from_raw(0),
            start_col: segment_start,
            end_col: segment_end,
            format,
            xlsx_style_id: None,
        });
    }

    segments
}

/// Apply a format patch to a sparse whole-column range.
///
/// Existing inherited column defaults inside the span are split out, merged
/// with the patch per segment, and rewritten as sparse `colFormatRanges`.
pub(crate) fn set_col_format_range_with_alloc(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
    format: &CellFormat,
    id_alloc: &IdAllocator,
) {
    if start_col > end_col {
        return;
    }

    use compute_document::schema::KEY_COL_FORMAT_RANGES;

    let records = {
        let sheets = storage.sheets_ref();
        let txn = storage.doc().transact();
        let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id) else {
            return;
        };
        match sheet_map.get(&txn, KEY_COL_FORMAT_RANGES) {
            Some(Out::YMap(ranges_map)) => read_col_format_range_records(&txn, &ranges_map),
            _ => Vec::new(),
        }
    };

    let patch = normalize_format_patch(format);
    let mut segments = column_range_segments_for_patch(&records, start_col, end_col, &patch);
    clear_col_format_ranges_in_span(storage, sheet_id, start_col, end_col, id_alloc);

    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id) else {
        return;
    };
    let ranges_map = match sheet_map.get(&txn, KEY_COL_FORMAT_RANGES) {
        Some(Out::YMap(map)) => map,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            sheet_map.insert(&mut txn, KEY_COL_FORMAT_RANGES, empty)
        }
    };

    for segment in &mut segments {
        segment.id = id_alloc.next_range_id();
        write_col_format_range_record(&mut txn, &ranges_map, segment);
    }
}

/// Remove inherited column-default formatting from a column span.
///
/// This subtracts the span from `colFormatRanges`, splitting affected sparse
/// ranges where needed. Explicit `colFormats` remain the caller's
/// responsibility because they are keyed by materialized `ColId`s.
pub(crate) fn clear_col_format_ranges_in_span(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
    id_alloc: &IdAllocator,
) {
    if start_col > end_col {
        return;
    }

    use compute_document::schema::KEY_COL_FORMAT_RANGES;

    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id) else {
        return;
    };
    let Some(Out::YMap(ranges_map)) = sheet_map.get(&txn, KEY_COL_FORMAT_RANGES) else {
        return;
    };

    let mut remove_keys = Vec::new();
    let mut fragments = Vec::new();

    for (key, value) in ranges_map.iter(&txn) {
        let Some(raw_id) = compute_document::hex::hex_to_id(key) else {
            continue;
        };
        let Out::YMap(nested) = value else {
            continue;
        };
        let range_start = match nested.get(&txn, "_sc") {
            Some(Out::Any(Any::Number(n))) => n as u32,
            _ => continue,
        };
        let range_end = match nested.get(&txn, "_ec") {
            Some(Out::Any(Any::Number(n))) => n as u32,
            _ => continue,
        };
        if range_start > range_end || range_end < start_col || range_start > end_col {
            continue;
        }

        let Some(format) = yrs_schema::cell_format::from_yrs_map(&nested, &txn) else {
            continue;
        };
        let xlsx_style_id = match nested.get(&txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID) {
            Some(Out::Any(Any::Number(n))) if n >= 0.0 => Some(n as u32),
            _ => None,
        };

        remove_keys.push(key.to_string());

        let original_id = RangeId::from_raw(raw_id);
        let mut original_id_available = true;
        if range_start < start_col {
            fragments.push(ColFormatRangeRecord {
                id: original_id,
                start_col: range_start,
                end_col: start_col.saturating_sub(1),
                format: format.clone(),
                xlsx_style_id,
            });
            original_id_available = false;
        }
        if range_end > end_col {
            fragments.push(ColFormatRangeRecord {
                id: if original_id_available {
                    original_id
                } else {
                    id_alloc.next_range_id()
                },
                start_col: end_col.saturating_add(1),
                end_col: range_end,
                format,
                xlsx_style_id,
            });
        }
    }

    for key in remove_keys {
        ranges_map.remove(&mut txn, key.as_str());
    }
    for fragment in fragments {
        write_col_format_range_record(&mut txn, &ranges_map, &fragment);
    }
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
    mirror.rebuild_format_range_spatial_index();
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
    mirror.rebuild_format_range_spatial_index();
}

/// Hydrate sparse whole-column default format ranges from Yrs into a SheetMirror.
pub fn hydrate_col_format_ranges(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    mirror: &mut SheetMirror,
) {
    use compute_document::schema::KEY_COL_FORMAT_RANGES;

    mirror.col_format_ranges.clear();
    mirror.rebuild_col_format_range_spatial_index();
    mirror.col_format_range_cache.clear();
    mirror.col_range_xlsx_style_id_cache.clear();

    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();

    let sheet_map = match get_sheet_map(&txn, &sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let ranges_map = match sheet_map.get(&txn, KEY_COL_FORMAT_RANGES) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (hex_key, value) in ranges_map.iter(&txn) {
        let raw_id = match compute_document::hex::hex_to_id(hex_key) {
            Some(id) => id,
            None => continue,
        };
        let range_id = crate::mirror::RangeId::from_raw(raw_id);

        if let Out::YMap(nested) = value {
            let start_col = match nested.get(&txn, "_sc") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let end_col = match nested.get(&txn, "_ec") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            if start_col > end_col {
                continue;
            }

            let imported_style_id =
                match nested.get(&txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID) {
                    Some(Out::Any(Any::Number(n))) if n >= 0.0 => Some(n as u32),
                    _ => None,
                };

            if let Some(fmt) = yrs_schema::cell_format::from_yrs_map(&nested, &txn) {
                mirror
                    .col_format_ranges
                    .push(crate::mirror::ColumnFormatRange {
                        id: range_id,
                        start_col,
                        end_col,
                    });
                mirror.col_format_range_cache.insert(range_id, fmt);
                if let Some(style_id) = imported_style_id {
                    mirror
                        .col_range_xlsx_style_id_cache
                        .insert(range_id, style_id);
                }
            }
        }
    }
    mirror.rebuild_col_format_range_spatial_index();
}
