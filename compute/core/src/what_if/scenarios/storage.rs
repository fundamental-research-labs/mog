use std::sync::Arc;

use crate::snapshot::Scenario;
use yrs::{Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Out};

const KEY_ITEMS: &str = "items";
pub(super) const KEY_ACTIVE_SCENARIO_ID: &str = "activeScenarioId";

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get or create the "items" array inside the scenarios map.
///
/// The scenarios map lives at `workbook.scenarios`. Inside it we store:
/// - `items`: Y.Array of JSON-serialized scenario strings
pub(super) fn get_or_create_items_array(
    scenarios_map: &MapRef,
    txn: &mut yrs::TransactionMut,
) -> ArrayRef {
    match scenarios_map.get(txn, KEY_ITEMS) {
        Some(Out::YArray(arr)) => arr,
        _ => {
            let arr = ArrayPrelim::from([] as [Any; 0]);
            scenarios_map.insert(txn, KEY_ITEMS, arr)
        }
    }
}

/// Get the "items" array (read-only) if it exists.
pub(super) fn get_items_array<T: yrs::ReadTxn>(
    scenarios_map: &MapRef,
    txn: &T,
) -> Option<ArrayRef> {
    match scenarios_map.get(txn, KEY_ITEMS) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

/// Get the scenarios MapRef from the workbook map.
pub(super) fn get_scenarios_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, "scenarios") {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Get or create the scenarios MapRef from the workbook map.
pub(super) fn get_or_create_scenarios_map(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut,
) -> MapRef {
    match workbook.get(txn, "scenarios") {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(txn, "scenarios", empty)
        }
    }
}

/// Remove legacy persisted active-scenario state.
///
/// Active scenario/baseline state is session-scoped. Any existing
/// `activeScenarioId` key is ignored on reads and scrubbed on scenario writes.
pub(super) fn remove_legacy_active_scenario_id(
    scenarios_map: &MapRef,
    txn: &mut yrs::TransactionMut,
) {
    scenarios_map.remove(txn, KEY_ACTIVE_SCENARIO_ID);
}

// =============================================================================
// Structured Y.Map read/write for Scenario (inline, since the type lives in
// snapshot-types which depends on domain-types — can't import from domain-types)
// =============================================================================

pub(super) mod scenario_yrs {
    use super::*;
    use domain_types::yrs_schema::helpers::*;

    pub const KEY_ID: &str = "id";
    pub const KEY_NAME: &str = "name";
    pub const KEY_COMMENT: &str = "comment";
    pub const KEY_CHANGING_CELLS: &str = "changingCells";
    pub const KEY_VALUES: &str = "values";
    pub const KEY_CREATED_BY: &str = "createdBy";
    pub const KEY_CREATED_AT: &str = "createdAt";
    pub const KEY_MODIFIED_AT: &str = "modifiedAt";

    /// Convert a [`Scenario`] to Yrs prelim entries for initial hydration.
    ///
    /// Scalar fields → native Yrs keys. Array fields (`changing_cells`, `values`)
    /// use the JSON bridge pattern (serialized as JSON strings).
    pub fn to_yrs_prelim(s: &Scenario) -> Vec<(&str, Any)> {
        let mut entries: Vec<(&str, Any)> = vec![
            (KEY_ID, Any::String(Arc::from(s.id.as_str()))),
            (KEY_NAME, Any::String(Arc::from(s.name.as_str()))),
            (KEY_COMMENT, Any::String(Arc::from(s.comment.as_str()))),
            (KEY_CHANGING_CELLS, json_any(&s.changing_cells)),
            (KEY_VALUES, json_any(&s.values)),
            (KEY_CREATED_AT, Any::Number(s.created_at.get())),
        ];
        if let Some(ref by) = s.created_by {
            entries.push((KEY_CREATED_BY, Any::String(Arc::from(by.as_str()))));
        }
        if let Some(at) = s.modified_at {
            entries.push((KEY_MODIFIED_AT, Any::Number(at.get())));
        }
        entries
    }

    /// Read a [`Scenario`] from a structured Y.Map.
    pub fn from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<Scenario> {
        let id = read_string(map, txn, KEY_ID)?;
        // Timestamps stored in yrs come from `now_millis()` which is always
        // finite; on a non-finite read (corrupt storage) fall back to 0
        // rather than panicking on deserialize.
        let created_at =
            value_types::FiniteF64::new(read_number(map, txn, KEY_CREATED_AT).unwrap_or(0.0))
                .unwrap_or(value_types::FiniteF64::ZERO);
        let modified_at =
            read_number(map, txn, KEY_MODIFIED_AT).and_then(value_types::FiniteF64::new);
        Some(Scenario {
            id,
            name: read_string(map, txn, KEY_NAME).unwrap_or_default(),
            comment: read_string(map, txn, KEY_COMMENT).unwrap_or_default(),
            changing_cells: read_json(map, txn, KEY_CHANGING_CELLS).unwrap_or_default(),
            values: read_json(map, txn, KEY_VALUES).unwrap_or_default(),
            created_by: read_string(map, txn, KEY_CREATED_BY),
            created_at,
            modified_at,
        })
    }
}

/// Read all scenarios from the Yrs items array.
pub(super) fn read_all_scenarios<T: yrs::ReadTxn>(
    scenarios_map: &MapRef,
    txn: &T,
) -> Vec<Scenario> {
    let items_arr = match get_items_array(scenarios_map, txn) {
        Some(arr) => arr,
        None => return Vec::new(),
    };

    let len = items_arr.len(txn);
    let mut result = Vec::with_capacity(len as usize);

    for i in 0..len {
        if let Some(Out::YMap(map)) = items_arr.get(txn, i)
            && let Some(scenario) = scenario_yrs::from_yrs_map(&map, txn)
        {
            result.push(scenario);
        }
    }

    result
}
