//! Yrs schema for [`StoredSlicer`] — flat Y.Map with native + JSON fields.
//!
//! Simple fields (String, Number, Bool) are stored as native Yrs types.
//! Complex fields (SlicerSource, SlicerStyle, position, selected_values)
//! are stored as JSON strings for forward compatibility.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Out, ReadTxn};

use super::helpers::*;
use crate::domain::floating_object::FloatingObjectAnchor;
use crate::domain::slicer::{SlicerSource, SlicerStyle, StoredSlicer};

// ── Short key constants (2-char mnemonics) ──────────────────────────

const KEY_ID: &str = "id";
const KEY_SHEET_ID: &str = "si";
const KEY_SOURCE: &str = "sr"; // JSON
const KEY_CACHE_NAME: &str = "cn";
const KEY_CACHE_UID: &str = "cu";
const KEY_CAPTION: &str = "ca";
const KEY_NAME: &str = "nm";
const KEY_STYLE: &str = "sy"; // JSON
const KEY_TABLE_COLUMN_INDEX: &str = "tc";
const KEY_PIVOT_CACHE_ID: &str = "pc";
const KEY_PIVOT_TABLE_TAB_ID: &str = "pt";
const KEY_PIVOT_TABULAR_ITEMS: &str = "pi"; // JSON
const KEY_ROW_HEIGHT: &str = "rh";
const KEY_LEVEL: &str = "lv";
const KEY_UID: &str = "ui";
const KEY_EXT_LST_XML: &str = "ex";
const KEY_CACHE_EXT_LST_XML: &str = "ce";
const KEY_POSITION: &str = "po"; // JSON
const KEY_ANCHOR_OBJECT_ID: &str = "ao";
const KEY_ANCHOR_MACRO_NAME: &str = "am";
const KEY_ANCHOR_NV_EXT_LST_XML: &str = "ax";
const KEY_Z_INDEX: &str = "zi";
const KEY_LOCKED: &str = "lk";
const KEY_SHOW_HEADER: &str = "sh";
const KEY_START_ITEM: &str = "ti";
const KEY_MULTI_SELECT: &str = "ms";
const KEY_SELECTED_VALUES: &str = "sv"; // JSON
const KEY_CREATED_AT: &str = "ct";
const KEY_UPDATED_AT: &str = "ut";

// ── to_yrs_prelim ──────────────────────────────────────────────────

/// Convert a [`StoredSlicer`] to Yrs prelim entries for Y.Map insertion.
///
/// All fields are emitted (StoredSlicer has no Option-heavy sparse layout
/// like CellFormat — every slicer has an id, source, style, etc.).
pub fn to_yrs_prelim(slicer: &StoredSlicer) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::with_capacity(15);

    // Native string fields
    entries.push((KEY_ID, Any::String(Arc::from(slicer.id.as_str()))));
    entries.push((
        KEY_SHEET_ID,
        Any::String(Arc::from(slicer.sheet_id.as_str())),
    ));
    entries.push((KEY_CAPTION, Any::String(Arc::from(slicer.caption.as_str()))));

    // Optional native string fields
    entries.push((KEY_NAME, option_string(&slicer.name)));
    entries.push((KEY_CACHE_NAME, option_string(&slicer.cache_name)));
    entries.push((KEY_CACHE_UID, option_string(&slicer.cache_uid)));
    entries.push((KEY_UID, option_string(&slicer.uid)));
    entries.push((KEY_EXT_LST_XML, option_string(&slicer.ext_lst_xml)));
    entries.push((
        KEY_CACHE_EXT_LST_XML,
        option_string(&slicer.cache_ext_lst_xml),
    ));

    // Native number fields
    entries.push((KEY_Z_INDEX, Any::Number(slicer.z_index as f64)));
    entries.push((KEY_LEVEL, Any::Number(slicer.level as f64)));

    // Native bool fields
    entries.push((KEY_LOCKED, Any::Bool(slicer.locked)));
    entries.push((KEY_SHOW_HEADER, Any::Bool(slicer.show_header)));
    entries.push((KEY_MULTI_SELECT, Any::Bool(slicer.multi_select)));

    // Optional number fields
    entries.push((KEY_START_ITEM, option_i32(&slicer.start_item)));
    entries.push((
        KEY_TABLE_COLUMN_INDEX,
        option_u32(&slicer.table_column_index),
    ));
    entries.push((KEY_PIVOT_CACHE_ID, option_u32(&slicer.pivot_cache_id)));
    entries.push((
        KEY_PIVOT_TABLE_TAB_ID,
        option_u32(&slicer.pivot_table_tab_id),
    ));
    entries.push((KEY_ROW_HEIGHT, option_u32(&slicer.row_height)));
    entries.push((KEY_ANCHOR_OBJECT_ID, option_u32(&slicer.anchor_object_id)));
    entries.push((
        KEY_ANCHOR_MACRO_NAME,
        option_string(&slicer.anchor_macro_name),
    ));
    entries.push((
        KEY_ANCHOR_NV_EXT_LST_XML,
        option_string(&slicer.anchor_nv_ext_lst_xml),
    ));
    entries.push((KEY_CREATED_AT, option_number(&slicer.created_at)));
    entries.push((KEY_UPDATED_AT, option_number(&slicer.updated_at)));

    // Complex fields as JSON strings
    let source_json = serde_json::to_string(&slicer.source).unwrap_or_else(|_| "{}".to_string());
    entries.push((KEY_SOURCE, Any::String(Arc::from(source_json.as_str()))));

    let style_json = serde_json::to_string(&slicer.style).unwrap_or_else(|_| "{}".to_string());
    entries.push((KEY_STYLE, Any::String(Arc::from(style_json.as_str()))));

    match &slicer.position {
        Some(pos) => {
            let pos_json = serde_json::to_string(pos).unwrap_or_else(|_| "null".to_string());
            entries.push((KEY_POSITION, Any::String(Arc::from(pos_json.as_str()))));
        }
        None => {
            entries.push((KEY_POSITION, Any::Null));
        }
    }

    if slicer.selected_values.is_empty() {
        entries.push((KEY_SELECTED_VALUES, Any::Null));
    } else {
        let sv_json =
            serde_json::to_string(&slicer.selected_values).unwrap_or_else(|_| "[]".to_string());
        entries.push((
            KEY_SELECTED_VALUES,
            Any::String(Arc::from(sv_json.as_str())),
        ));
    }
    if slicer.pivot_tabular_items.is_empty() {
        entries.push((KEY_PIVOT_TABULAR_ITEMS, Any::Null));
    } else {
        let pi_json =
            serde_json::to_string(&slicer.pivot_tabular_items).unwrap_or_else(|_| "[]".to_string());
        entries.push((
            KEY_PIVOT_TABULAR_ITEMS,
            Any::String(Arc::from(pi_json.as_str())),
        ));
    }

    entries
}

// ── from_yrs_map ───────────────────────────────────────────────────

/// Read a [`StoredSlicer`] from a Y.Map with structured fields.
///
/// Returns `None` if the map is missing required fields (id, source).
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<StoredSlicer> {
    let id = read_string(map, txn, KEY_ID)?;
    let sheet_id = read_string(map, txn, KEY_SHEET_ID).unwrap_or_default();

    let source: SlicerSource =
        read_string(map, txn, KEY_SOURCE).and_then(|s| serde_json::from_str(&s).ok())?;

    let caption = read_string(map, txn, KEY_CAPTION).unwrap_or_default();
    let name = read_string(map, txn, KEY_NAME);
    let cache_name = read_string(map, txn, KEY_CACHE_NAME);
    let cache_uid = read_string(map, txn, KEY_CACHE_UID);

    let style: SlicerStyle = read_string(map, txn, KEY_STYLE)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(SlicerStyle {
            preset: None,
            custom: None,
            column_count: 1,
            button_height: 20,
            show_selection_indicator: true,
            cross_filter: crate::domain::slicer::CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: crate::domain::slicer::SlicerSortOrder::Ascending,
        });

    let position: Option<FloatingObjectAnchor> =
        read_string(map, txn, KEY_POSITION).and_then(|s| serde_json::from_str(&s).ok());

    let z_index = read_i32(map, txn, KEY_Z_INDEX).unwrap_or(0);
    let level = read_u32(map, txn, KEY_LEVEL).unwrap_or(0);
    let locked = read_bool(map, txn, KEY_LOCKED).unwrap_or(false);
    let show_header = read_bool(map, txn, KEY_SHOW_HEADER).unwrap_or(true);
    let start_item = read_i32(map, txn, KEY_START_ITEM);
    let table_column_index = read_u32(map, txn, KEY_TABLE_COLUMN_INDEX);
    let pivot_cache_id = read_u32(map, txn, KEY_PIVOT_CACHE_ID);
    let pivot_table_tab_id = read_u32(map, txn, KEY_PIVOT_TABLE_TAB_ID);
    let row_height = read_u32(map, txn, KEY_ROW_HEIGHT);
    let uid = read_string(map, txn, KEY_UID);
    let ext_lst_xml = read_string(map, txn, KEY_EXT_LST_XML);
    let cache_ext_lst_xml = read_string(map, txn, KEY_CACHE_EXT_LST_XML);
    let anchor_object_id = read_u32(map, txn, KEY_ANCHOR_OBJECT_ID);
    let anchor_macro_name = read_string(map, txn, KEY_ANCHOR_MACRO_NAME);
    let anchor_nv_ext_lst_xml = read_string(map, txn, KEY_ANCHOR_NV_EXT_LST_XML);
    let multi_select = read_bool(map, txn, KEY_MULTI_SELECT).unwrap_or(true);

    let selected_values: Vec<value_types::CellValue> = read_string(map, txn, KEY_SELECTED_VALUES)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let pivot_tabular_items: Vec<ooxml_types::slicers::SlicerTabularItem> =
        read_string(map, txn, KEY_PIVOT_TABULAR_ITEMS)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

    let created_at = read_number(map, txn, KEY_CREATED_AT);
    let updated_at = read_number(map, txn, KEY_UPDATED_AT);

    Some(StoredSlicer {
        id,
        sheet_id,
        source,
        cache_name,
        cache_uid,
        caption,
        name,
        style,
        table_column_index,
        pivot_cache_id,
        pivot_table_tab_id,
        pivot_tabular_items,
        row_height,
        level,
        uid,
        ext_lst_xml,
        cache_ext_lst_xml,
        position,
        anchor_object_id,
        anchor_macro_name,
        anchor_nv_ext_lst_xml,
        z_index,
        locked,
        show_header,
        start_item,
        multi_select,
        selected_values,
        created_at,
        updated_at,
    })
}

/// Read a [`StoredSlicer`] from a workbook `slicers` map entry.
///
/// New runtime state uses the structured Y.Map shape emitted by
/// [`to_yrs_prelim`]. Older XLSX hydration stored a complete `StoredSlicer`
/// JSON string at the same map key. Keep the legacy reader here so all callers
/// consume one domain type while new writers converge on the structured shape.
pub fn from_yrs_out<T: ReadTxn>(value: Out, txn: &T) -> Option<StoredSlicer> {
    match value {
        Out::YMap(map) => from_yrs_map(&map, txn),
        Out::Any(Any::String(json)) => serde_json::from_str::<StoredSlicer>(&json).ok(),
        _ => None,
    }
}
