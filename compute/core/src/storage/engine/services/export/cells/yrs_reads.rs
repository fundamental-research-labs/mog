use cell_types::{CellId, SheetId};
use compute_document::hex::{id_to_hex, parse_cell_id};
use compute_document::schema::{KEY_ARRAY_REF, KEY_CELL_PROPERTIES, KEY_FORMULA_METADATA};
use rustc_hash::FxHashMap;
use yrs::{Any, Map, Out, Transact};

use crate::storage::engine::stores::EngineStores;
use crate::storage::properties::{self, CellProperties};

pub(super) fn batch_read_props_array_refs_and_formula_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> (
    FxHashMap<CellId, CellProperties>,
    FxHashMap<CellId, String>,
    FxHashMap<CellId, ooxml_types::worksheet::CellFormula>,
    FxHashMap<CellId, domain_types::RichSharedString>,
) {
    let doc = stores.storage.doc();
    let txn = doc.transact();

    // --- Properties ---
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut all_props = FxHashMap::default();

    // Navigate to the properties sub-map for this sheet
    let sheets = stores.storage.sheets();
    let workbook = stores.storage.workbook_map();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
        && let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES)
    {
        // Pre-size the map to eliminate rehashes during the fill loop.
        // For large sheets this is the dominant cost in export.
        all_props.reserve(props_map.len(&txn) as usize);
        for (key, value) in props_map.iter(&txn) {
            let cell_id = match parse_cell_id(key) {
                Some(id) => id,
                None => continue,
            };
            let props_opt = match value {
                Out::YMap(nested) => {
                    domain_types::yrs_schema::cell_properties::from_yrs_map(&nested, &txn)
                        .map(Into::into)
                }
                Out::Any(Any::String(ref json_str)) => {
                    properties::resolve_compact_props_with_txn(json_str, workbook, &txn)
                }
                _ => None,
            };
            if let Some(props) = props_opt {
                all_props.insert(cell_id, props);
            }
        }
    }

    // --- Array formula refs + formula metadata ---
    let mut array_refs = FxHashMap::default();
    let mut formula_metadata = FxHashMap::default();
    let mut rich_strings = FxHashMap::default();
    if let Some(cells_map) = crate::storage::infra::grid_helpers::get_cells_map(
        &txn,
        stores.storage.sheets(),
        &sheet_hex,
    ) {
        array_refs.reserve(cells_map.len(&txn) as usize);
        formula_metadata.reserve(cells_map.len(&txn) as usize);
        for (cell_hex, value) in cells_map.iter(&txn) {
            let Out::YMap(cell_map) = value else {
                continue;
            };
            let Some(cell_id) = parse_cell_id(cell_hex) else {
                continue;
            };
            if let Some(Out::Any(Any::String(array_ref))) = cell_map.get(&txn, KEY_ARRAY_REF) {
                array_refs.insert(cell_id, array_ref.to_string());
            }
            if let Some(cell_formula) = read_formula_metadata_from_yrs(&cell_map, &txn) {
                formula_metadata.insert(cell_id, cell_formula);
            }
            if let Some(rich_string) =
                compute_document::cell_serde::read_rich_string_from_yrs(&cell_map, &txn)
            {
                rich_strings.insert(cell_id, rich_string);
            }
        }
    }

    (all_props, array_refs, formula_metadata, rich_strings)
}

fn read_formula_metadata_from_yrs<T: yrs::ReadTxn>(
    cell_map: &yrs::MapRef,
    txn: &T,
) -> Option<ooxml_types::worksheet::CellFormula> {
    match cell_map.get(txn, KEY_FORMULA_METADATA) {
        Some(Out::Any(Any::String(json))) => serde_json::from_str(&json).ok(),
        _ => None,
    }
}
