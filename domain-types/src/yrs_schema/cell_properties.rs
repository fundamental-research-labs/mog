//! Yrs schema for [`CellProperties`] — flat Y.Map merging CellFormat fields
//! with metadata keys.
//!
//! CellFormat fields are stored using `cell_format`'s existing 2-char keys
//! (ff, fs, fc, etc.). CellProperties metadata uses non-colliding keys.
//! Borders and gradient_fill (complex nested types) are stored as JSON strings.
//!
//! This flat layout avoids nested Y.Maps and gives field-level CRDT merges
//! for all format properties.
//!
//! Typed OOXML preservation: promoted the former `extra` JSON-blob bag to typed
//! fields (style_id / cm / vm / formula_result_type / has_empty_cached_value
//! / original_sst_index / original_value / ph / date lexical value). Each gets its
//! own short Yrs key rather than round-tripping through an `ex` JSON string.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::cell_format;
use super::helpers::*;
use crate::CellProperties;

// ---- Key constants for CellProperties metadata (non-colliding with cell_format) ----

const KEY_PROVENANCE: &str = "pv";
const KEY_VALIDATION: &str = "vl";
const KEY_CONNECTION_ID: &str = "ci";
const KEY_BORDERS: &str = "bd";
const KEY_GRADIENT_FILL: &str = "gf";
// Round-trip bookkeeping keys (promoted from the pre-typed-OOXML-preservation `ex` bag).
const KEY_STYLE_ID: &str = "si";
const KEY_CM: &str = "cm";
const KEY_VM: &str = "vm";
const KEY_PHONETIC: &str = "ph";
const KEY_DATE_LEXICAL_VALUE: &str = "dlv";
const KEY_FORMULA_RESULT_TYPE: &str = "frt";
const KEY_HAS_EMPTY_CACHED_VALUE: &str = "ecv";
const KEY_FORMULA_CACHE_PROVENANCE: &str = "fcp";
const KEY_ORIGINAL_SST_INDEX: &str = "sst";
const KEY_ORIGINAL_VALUE: &str = "ov";

/// Convert a [`CellProperties`] to Yrs prelim entries for a flat Y.Map.
///
/// CellFormat fields are emitted via `cell_format::to_yrs_prelim`, then
/// metadata fields are appended with distinct keys. Only present fields
/// are emitted.
pub fn to_yrs_prelim(props: &CellProperties) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = Vec::with_capacity(32);

    // CellFormat fields (reuse cell_format's serialization)
    if let Some(ref fmt) = props.format {
        entries.extend(cell_format::to_yrs_prelim(fmt));

        // borders and gradient_fill are not handled by cell_format — store as JSON
        if let Some(ref borders) = fmt.borders
            && let Ok(json) = serde_json::to_string(borders)
        {
            entries.push((KEY_BORDERS, Any::String(Arc::from(json.as_str()))));
        }
        if let Some(ref gf) = fmt.gradient_fill
            && let Ok(json) = serde_json::to_string(gf)
        {
            entries.push((KEY_GRADIENT_FILL, Any::String(Arc::from(json.as_str()))));
        }
    }

    // Metadata fields
    if let Some(ref pv) = props.provenance {
        entries.push((KEY_PROVENANCE, Any::String(Arc::from(pv.as_str()))));
    }
    if let Some(ref vl) = props.validation {
        entries.push((KEY_VALIDATION, Any::String(Arc::from(vl.as_str()))));
    }
    if let Some(ref ci) = props.connection_id {
        entries.push((KEY_CONNECTION_ID, Any::String(Arc::from(ci.as_str()))));
    }

    // Round-trip bookkeeping (typed, one key per field).
    if let Some(sid) = props.style_id {
        entries.push((KEY_STYLE_ID, Any::Number(sid as f64)));
    }
    if let Some(cm) = props.cell_metadata_index {
        entries.push((KEY_CM, Any::Number(cm as f64)));
    }
    if let Some(vm) = props.vm {
        entries.push((KEY_VM, Any::Number(vm as f64)));
    }
    if props.phonetic {
        entries.push((KEY_PHONETIC, Any::Bool(true)));
    }
    if let Some(ref date) = props.date_lexical_value {
        entries.push((
            KEY_DATE_LEXICAL_VALUE,
            Any::String(Arc::from(date.as_str())),
        ));
    }
    if let Some(frt) = props.formula_result_type {
        entries.push((KEY_FORMULA_RESULT_TYPE, Any::Number(frt as f64)));
    }
    if props.has_empty_cached_value {
        entries.push((KEY_HAS_EMPTY_CACHED_VALUE, Any::Bool(true)));
    }
    if !props.formula_cache_provenance.is_absent_or_unknown()
        && let Ok(json) = serde_json::to_string(&props.formula_cache_provenance)
    {
        entries.push((
            KEY_FORMULA_CACHE_PROVENANCE,
            Any::String(Arc::from(json.as_str())),
        ));
    }
    if let Some(sst) = props.original_sst_index {
        entries.push((KEY_ORIGINAL_SST_INDEX, Any::Number(sst as f64)));
    }
    if let Some(ref ov) = props.original_value {
        entries.push((KEY_ORIGINAL_VALUE, Any::String(Arc::from(ov.as_str()))));
    }

    entries
}

/// Read a [`CellProperties`] from a flat Y.Map with structured fields.
///
/// Reads CellFormat via `cell_format::from_yrs_map` on the same map, then
/// reads metadata keys. Returns `None` only if the map is completely empty.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<CellProperties> {
    // Read CellFormat fields from the same flat map
    let mut format = cell_format::from_yrs_map(map, txn);

    // Read borders and gradient_fill (JSON strings) into the format
    let borders: Option<crate::CellBorders> =
        read_string(map, txn, KEY_BORDERS).and_then(|s| serde_json::from_str(&s).ok());
    let gradient_fill: Option<crate::GradientFillFormat> =
        read_string(map, txn, KEY_GRADIENT_FILL).and_then(|s| serde_json::from_str(&s).ok());

    if borders.is_some() || gradient_fill.is_some() {
        let fmt = format.get_or_insert_with(Default::default);
        if borders.is_some() {
            fmt.borders = borders;
        }
        if gradient_fill.is_some() {
            fmt.gradient_fill = gradient_fill;
        }
    }

    // Read metadata
    let provenance = read_string(map, txn, KEY_PROVENANCE);
    let validation = read_string(map, txn, KEY_VALIDATION);
    let connection_id = read_string(map, txn, KEY_CONNECTION_ID);

    // Read typed round-trip bookkeeping
    let style_id = read_u32(map, txn, KEY_STYLE_ID);
    let cell_metadata_index = read_u32(map, txn, KEY_CM)
        .or_else(|| read_bool(map, txn, KEY_CM).and_then(|present| present.then_some(1)));
    let vm = read_u32(map, txn, KEY_VM);
    let phonetic = read_bool(map, txn, KEY_PHONETIC).unwrap_or(false);
    let date_lexical_value = read_string(map, txn, KEY_DATE_LEXICAL_VALUE);
    let formula_result_type = read_u32(map, txn, KEY_FORMULA_RESULT_TYPE).map(|n| n as u8);
    let has_empty_cached_value = read_bool(map, txn, KEY_HAS_EMPTY_CACHED_VALUE).unwrap_or(false);
    let formula_cache_provenance = read_string(map, txn, KEY_FORMULA_CACHE_PROVENANCE)
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    let original_sst_index = read_u32(map, txn, KEY_ORIGINAL_SST_INDEX);
    let original_value = read_string(map, txn, KEY_ORIGINAL_VALUE);

    let props = CellProperties {
        format,
        provenance,
        validation,
        connection_id,
        style_id,
        cell_metadata_index,
        vm,
        phonetic,
        date_lexical_value,
        formula_result_type,
        has_empty_cached_value,
        formula_cache_provenance,
        original_sst_index,
        original_value,
        // CSE flags are runtime-only — derived from the projection
        // registry / `mirror.cse_anchors`, not persisted in Yrs
        // properties.
        is_array_formula: false,
        is_cse_anchor: false,
    };

    // Return None if everything is empty
    if props.format.is_none() && props.metadata_is_empty() {
        return None;
    }

    Some(props)
}

/// Write all fields of a [`CellProperties`] into an existing Y.Map.
pub fn write_to_map(map: &MapRef, txn: &mut TransactionMut, props: &CellProperties) {
    for (key, value) in to_yrs_prelim(props) {
        map.insert(txn, key, value);
    }
}
