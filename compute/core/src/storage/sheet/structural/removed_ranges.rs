use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use cell_types::{RangeId, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::range::{remove_range_binding, remove_range_format, remove_range_from_yrs};
use compute_document::schema::{
    KEY_RANGE_BINDINGS, KEY_RANGE_FORMATS, KEY_RANGE_PAYLOADS, KEY_RANGES,
};
use compute_document::undo::ORIGIN_STRUCTURAL;

/// Clean up Yrs `ranges`, `rangePayloads`, `rangeBindings`, and `rangeFormats`
/// entries for Ranges that were structurally removed (all their rows or columns
/// were deleted). Without this cleanup, orphaned entries persist in the Yrs
/// document indefinitely and re-appear on reload.
pub(super) fn cleanup_removed_ranges_from_yrs(
    doc: &Doc,
    sheets_map: &MapRef,
    sheet_id: &SheetId,
    removed_range_ids: &[RangeId],
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_STRUCTURAL));
    let Some(Out::YMap(sheet_map)) = sheets_map.get(&txn, &sheet_hex) else {
        return;
    };

    let ranges_map = match sheet_map.get(&txn, KEY_RANGES) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    };
    let payloads_map = match sheet_map.get(&txn, KEY_RANGE_PAYLOADS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    };
    let bindings_map = match sheet_map.get(&txn, KEY_RANGE_BINDINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    };
    let formats_map = match sheet_map.get(&txn, KEY_RANGE_FORMATS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    };

    for range_id in removed_range_ids {
        if let (Some(rm), Some(pm)) = (&ranges_map, &payloads_map) {
            remove_range_from_yrs(&mut txn, rm, pm, range_id);
        }
        if let Some(bm) = &bindings_map {
            remove_range_binding(&mut txn, bm, range_id);
        }
        if let Some(fm) = &formats_map {
            remove_range_format(&mut txn, fm, range_id);
        }
    }
}
