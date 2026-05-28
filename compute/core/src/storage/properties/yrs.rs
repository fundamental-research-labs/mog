use super::super::{KEY_STYLE_PALETTE, id_to_hex};
use crate::engine_types::formatting::*;
use cell_types::SheetId;
use domain_types::CellFormat;
use yrs::{Any, Map, MapRef, Out};

/// Get a per-sheet sub-map by key (read-only).
pub(in crate::storage::properties) fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Resolve a compact JSON string property entry (`{"s": N, ...}`) into full
/// `CellProperties` by looking up the style palette index in the
/// workbook-level `stylePalette` map.
///
/// The compact JSON is produced by `hydration::styles::hydrate_cell_styles`
/// during XLSX import. It deserializes directly into `CellProperties` via
/// the typed `style_id` / `cm` / `vm` / `formula_result_type` /
/// `has_empty_cached_value` / `original_sst_index` / `original_value` fields (serde renames keep the
/// wire shape at `{"s", "cm", "vm", "formulaResultType", "sstIndex",
/// "hasEmptyCachedValue", "originalValue"}`). The style palette stores pre-serialized `CellFormat`
/// JSON per index; we look it up here and hydrate `format`.
///
/// NOTE: `style_id` is intentionally preserved on the returned struct —
/// the export path reads it to recover the original cellXfs index for
/// lossless round-trip, even though we also use it above for palette lookup.
///
/// Public variant of `resolve_compact_props` for use by the combined
/// batch-read function in the export path (which shares a single Yrs
/// transaction across properties and raw formula reads).
pub(crate) fn resolve_compact_props_with_txn<T: yrs::ReadTxn>(
    json_str: &str,
    workbook: &MapRef,
    txn: &T,
) -> Option<CellProperties> {
    resolve_compact_props(json_str, workbook, txn)
}

pub(in crate::storage::properties) fn resolve_compact_props<T: yrs::ReadTxn>(
    json_str: &str,
    workbook: &MapRef,
    txn: &T,
) -> Option<CellProperties> {
    // Typed-field deserialize: the compact JSON's keys (s, cm, vm,
    // formulaResultType, sstIndex, originalValue) line up with the
    // serde renames on CellProperties, so this replaces the former
    // free-form HashMap<String, Value> bag.
    let mut props: CellProperties = serde_json::from_str(json_str).ok()?;

    // Look up the style palette index → CellFormat (inflates the compact
    // `{"s": N}` reference into the full format).
    if let Some(idx) = props.style_id {
        let palette_map = match workbook.get(txn, KEY_STYLE_PALETTE) {
            Some(Out::YMap(m)) => Some(m),
            _ => None,
        };
        if let Some(palette_map) = palette_map {
            let key = idx.to_string();
            if let Some(Out::Any(Any::String(ref fmt_json))) = palette_map.get(txn, &key) {
                props.format = serde_json::from_str::<CellFormat>(fmt_json).ok();
            }
        }
    }

    // Return None only if there is truly nothing
    if props.format.is_none() && props.metadata_is_empty() {
        return None;
    }

    Some(props)
}

/// Get a per-sheet map by SheetId (read-only, returns the sheet's top-level map).
pub(in crate::storage::properties) fn get_sheet_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}
