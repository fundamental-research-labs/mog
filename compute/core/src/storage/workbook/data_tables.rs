//! Canonical workbook-level storage for What-If Data Table regions.

use std::sync::Arc;

use compute_document::schema::KEY_DATA_TABLE_REGIONS;
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, Transact};

const KEY_SHEET: &str = "sheet";
const KEY_START_ROW: &str = "startRow";
const KEY_START_COL: &str = "startCol";
const KEY_END_ROW: &str = "endRow";
const KEY_END_COL: &str = "endCol";
const KEY_ROW_INPUT_REF: &str = "rowInputRef";
const KEY_COL_INPUT_REF: &str = "colInputRef";
const KEY_OOXML_ACA: &str = "ooxmlAca";
const KEY_OOXML_CA: &str = "ooxmlCa";
const KEY_OOXML_BX: &str = "ooxmlBx";
const KEY_OOXML_DT2D: &str = "ooxmlDt2d";
const KEY_OOXML_DTR: &str = "ooxmlDtr";
const KEY_OOXML_DEL1: &str = "ooxmlDel1";
const KEY_OOXML_DEL2: &str = "ooxmlDel2";
const KEY_OOXML_R1: &str = "ooxmlR1";
const KEY_OOXML_R2: &str = "ooxmlR2";

/// Stable storage key for the current snapshot-era region shape.
///
/// The durable map is keyed independently of vector position. A future
/// role-aware `DataTableRegionDef.region_id` field can replace this derived key
/// without changing the surrounding Yrs authority.
pub fn data_table_region_id(def: &DataTableRegionDef) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        def.sheet, def.start_row, def.start_col, def.end_row, def.end_col
    )
}

pub fn get_all_data_table_regions(doc: &Doc, workbook: &MapRef) -> Vec<DataTableRegionDef> {
    let txn = doc.transact();
    let Some(Out::YMap(regions_map)) = workbook.get(&txn, KEY_DATA_TABLE_REGIONS) else {
        return vec![];
    };

    let mut regions = Vec::new();
    for (_, value) in regions_map.iter(&txn) {
        if let Out::YMap(inner) = value
            && let Some(region) = data_table_region_from_yrs_map(&inner, &txn)
        {
            regions.push(region);
        }
    }
    regions
}

pub fn upsert_data_table_region(doc: &Doc, workbook: &MapRef, region: &DataTableRegionDef) {
    let mut txn = doc.transact_mut();
    let regions_map =
        crate::storage::ensure_workbook_child_map(workbook, &mut txn, KEY_DATA_TABLE_REGIONS);
    let prelim: MapPrelim = data_table_region_to_yrs_prelim(region)
        .into_iter()
        .collect();
    let key = data_table_region_id(region);
    regions_map.insert(&mut txn, &*key, prelim);
}

pub fn hydrate_data_table_regions(
    workbook: &MapRef,
    regions: &[DataTableRegionDef],
    txn: &mut yrs::TransactionMut<'_>,
) {
    if regions.is_empty() {
        return;
    }
    let regions_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_DATA_TABLE_REGIONS);
    for region in regions {
        let prelim: MapPrelim = data_table_region_to_yrs_prelim(region)
            .into_iter()
            .collect();
        let key = data_table_region_id(region);
        regions_map.insert(txn, &*key, prelim);
    }
}

fn data_table_region_to_yrs_prelim(region: &DataTableRegionDef) -> Vec<(&'static str, Any)> {
    let mut entries = vec![
        (KEY_SHEET, Any::String(Arc::from(region.sheet.as_str()))),
        (KEY_START_ROW, Any::Number(region.start_row as f64)),
        (KEY_START_COL, Any::Number(region.start_col as f64)),
        (KEY_END_ROW, Any::Number(region.end_row as f64)),
        (KEY_END_COL, Any::Number(region.end_col as f64)),
    ];
    if let Some(row_input_ref) = &region.row_input_ref {
        entries.push((
            KEY_ROW_INPUT_REF,
            Any::String(Arc::from(cell_ref_json(row_input_ref).as_str())),
        ));
    }
    if let Some(col_input_ref) = &region.col_input_ref {
        entries.push((
            KEY_COL_INPUT_REF,
            Any::String(Arc::from(cell_ref_json(col_input_ref).as_str())),
        ));
    }
    if let Some(flags) = &region.ooxml_flags {
        if let Some(r1) = &flags.r1 {
            entries.push((KEY_OOXML_R1, Any::String(Arc::from(r1.as_str()))));
        }
        if let Some(r2) = &flags.r2 {
            entries.push((KEY_OOXML_R2, Any::String(Arc::from(r2.as_str()))));
        }
        entries.push((KEY_OOXML_ACA, Any::Bool(flags.aca)));
        entries.push((KEY_OOXML_CA, Any::Bool(flags.ca)));
        entries.push((KEY_OOXML_BX, Any::Bool(flags.bx)));
        entries.push((KEY_OOXML_DT2D, Any::Bool(flags.dt2d)));
        entries.push((KEY_OOXML_DTR, Any::Bool(flags.dtr)));
        entries.push((KEY_OOXML_DEL1, Any::Bool(flags.del1)));
        entries.push((KEY_OOXML_DEL2, Any::Bool(flags.del2)));
    }
    entries
}

fn data_table_region_from_yrs_map<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<DataTableRegionDef> {
    Some(DataTableRegionDef {
        sheet: read_string(map, txn, KEY_SHEET)?,
        start_row: read_u32(map, txn, KEY_START_ROW)?,
        start_col: read_u32(map, txn, KEY_START_COL)?,
        end_row: read_u32(map, txn, KEY_END_ROW)?,
        end_col: read_u32(map, txn, KEY_END_COL)?,
        row_input_ref: read_cell_ref(map, txn, KEY_ROW_INPUT_REF),
        col_input_ref: read_cell_ref(map, txn, KEY_COL_INPUT_REF),
        ooxml_flags: read_ooxml_flags(map, txn),
    })
}

fn read_string<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key) {
        Some(Out::Any(Any::String(value))) => Some(value.to_string()),
        _ => None,
    }
}

fn read_u32<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<u32> {
    match map.get(txn, key) {
        Some(Out::Any(Any::Number(value))) if value.is_finite() && value >= 0.0 => {
            Some(value as u32)
        }
        _ => None,
    }
}

fn read_bool<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key) {
        Some(Out::Any(Any::Bool(value))) => Some(value),
        _ => None,
    }
}

fn read_ooxml_flags<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<snapshot_types::DataTableOoxmlFlags> {
    let has_any = [
        KEY_OOXML_ACA,
        KEY_OOXML_CA,
        KEY_OOXML_BX,
        KEY_OOXML_DT2D,
        KEY_OOXML_DTR,
        KEY_OOXML_DEL1,
        KEY_OOXML_DEL2,
        KEY_OOXML_R1,
        KEY_OOXML_R2,
    ]
    .iter()
    .any(|key| map.get(txn, key).is_some());

    has_any.then(|| snapshot_types::DataTableOoxmlFlags {
        r1: read_string(map, txn, KEY_OOXML_R1),
        r2: read_string(map, txn, KEY_OOXML_R2),
        aca: read_bool(map, txn, KEY_OOXML_ACA).unwrap_or(false),
        ca: read_bool(map, txn, KEY_OOXML_CA).unwrap_or(false),
        bx: read_bool(map, txn, KEY_OOXML_BX).unwrap_or(false),
        dt2d: read_bool(map, txn, KEY_OOXML_DT2D).unwrap_or(false),
        dtr: read_bool(map, txn, KEY_OOXML_DTR).unwrap_or(false),
        del1: read_bool(map, txn, KEY_OOXML_DEL1).unwrap_or(false),
        del2: read_bool(map, txn, KEY_OOXML_DEL2).unwrap_or(false),
    })
}

fn read_cell_ref<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<CellRef> {
    let json = read_string(map, txn, key)?;
    serde_json::from_str(&json).ok()
}

fn cell_ref_json(cell_ref: &CellRef) -> String {
    serde_json::to_string(cell_ref).unwrap_or_else(|_| "null".to_string())
}
