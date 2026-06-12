//! Typed helpers for reading/writing Range metadata and payload from/to Yrs sub-maps.

use std::sync::Arc;

use cell_types::{AxisIdentityRef, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use serde::{Deserialize, Serialize};
use yrs::{Any, Map, MapRef, Out, ReadTxn, TransactionMut};

use crate::hex::id_to_hex;

/// Metadata stored in the `ranges` Yrs sub-map (everything except the binary
/// payload, which lives in `rangePayloads`).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeMetadata {
    pub range_id: RangeId,
    pub kind: RangeKind,
    pub anchor: RangeAnchor,
    pub encoding: PayloadEncoding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_axis: Option<AxisIdentityRef<RowId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col_axis: Option<AxisIdentityRef<ColId>>,
    pub row_ids: Vec<RowId>,
    pub col_ids: Vec<ColId>,
}

/// Full Range entry (metadata + payload) for the write/read round-trip.
pub struct RangeEntry {
    pub metadata: RangeMetadata,
    pub payload: Vec<u8>,
}

/// Write a Range entry to the `ranges` + `rangePayloads` Yrs sub-maps.
///
/// Metadata is stored as a JSON string in `ranges[range_hex]`.
/// Payload bytes are stored as `Any::Buffer` in `rangePayloads[range_hex]`.
pub fn write_range_to_yrs(
    txn: &mut TransactionMut,
    ranges_map: &MapRef,
    payloads_map: &MapRef,
    metadata: &RangeMetadata,
    payload: &[u8],
) {
    let range_hex = id_to_hex(metadata.range_id.as_u128());
    let json = serde_json::to_string(metadata).expect("RangeMetadata must serialize");
    ranges_map.insert(txn, &*range_hex, Any::String(Arc::from(json)));
    payloads_map.insert(txn, &*range_hex, Any::Buffer(Arc::from(payload)));
}

/// Read all Range entries from the `ranges` + `rangePayloads` Yrs sub-maps.
pub fn read_ranges_from_yrs(
    txn: &impl ReadTxn,
    ranges_map: &MapRef,
    payloads_map: &MapRef,
) -> Vec<RangeEntry> {
    let mut entries = Vec::new();
    for (key, value) in ranges_map.iter(txn) {
        let json_str = match value {
            Out::Any(Any::String(s)) => s,
            _ => continue,
        };
        let metadata: RangeMetadata = serde_json::from_str(&json_str).unwrap_or_else(|err| {
            panic!("invalid RangeMetadata for range key {key}: {err}");
        });
        let payload = match payloads_map.get(txn, key) {
            Some(Out::Any(Any::Buffer(buf))) => buf.to_vec(),
            _ => Vec::new(),
        };
        entries.push(RangeEntry { metadata, payload });
    }
    entries
}

/// Remove a Range entry from the `ranges` + `rangePayloads` Yrs sub-maps.
pub fn remove_range_from_yrs(
    txn: &mut TransactionMut,
    ranges_map: &MapRef,
    payloads_map: &MapRef,
    range_id: &RangeId,
) {
    let range_hex = id_to_hex(range_id.as_u128());
    ranges_map.remove(txn, &range_hex);
    payloads_map.remove(txn, &range_hex);
}

// =========================================================================
// Bindings (per-sheet, keyed by range hex, stores raw bytes)
// =========================================================================

/// Write a binding entry to `rangeBindings[range_hex]`.
pub fn write_range_binding(
    txn: &mut TransactionMut,
    bindings_map: &MapRef,
    range_id: &RangeId,
    binding_data: &[u8],
) {
    let range_hex = id_to_hex(range_id.as_u128());
    bindings_map.insert(txn, &*range_hex, Any::Buffer(Arc::from(binding_data)));
}

/// Read a binding entry from `rangeBindings[range_hex]`.
pub fn read_range_binding(
    txn: &impl ReadTxn,
    bindings_map: &MapRef,
    range_id: &RangeId,
) -> Option<Vec<u8>> {
    let range_hex = id_to_hex(range_id.as_u128());
    match bindings_map.get(txn, &range_hex) {
        Some(Out::Any(Any::Buffer(buf))) => Some(buf.to_vec()),
        _ => None,
    }
}

/// Remove a binding entry from `rangeBindings[range_hex]`.
pub fn remove_range_binding(txn: &mut TransactionMut, bindings_map: &MapRef, range_id: &RangeId) {
    let range_hex = id_to_hex(range_id.as_u128());
    bindings_map.remove(txn, &range_hex);
}

// =========================================================================
// Formats
// =========================================================================

/// Write a format entry to `rangeFormats[range_hex]`.
pub fn write_range_format(
    txn: &mut TransactionMut,
    formats_map: &MapRef,
    range_id: &RangeId,
    format_data: &[u8],
) {
    let range_hex = id_to_hex(range_id.as_u128());
    formats_map.insert(txn, &*range_hex, Any::Buffer(Arc::from(format_data)));
}

/// Read a format entry from `rangeFormats[range_hex]`.
pub fn read_range_format(
    txn: &impl ReadTxn,
    formats_map: &MapRef,
    range_id: &RangeId,
) -> Option<Vec<u8>> {
    let range_hex = id_to_hex(range_id.as_u128());
    match formats_map.get(txn, &range_hex) {
        Some(Out::Any(Any::Buffer(buf))) => Some(buf.to_vec()),
        _ => None,
    }
}

/// Remove a format entry from `rangeFormats[range_hex]`.
pub fn remove_range_format(txn: &mut TransactionMut, formats_map: &MapRef, range_id: &RangeId) {
    let range_hex = id_to_hex(range_id.as_u128());
    formats_map.remove(txn, &range_hex);
}

// =========================================================================
// CF binding helpers
// =========================================================================

/// Binding payload for a `RangeKind::CondFormat` Range.
///
/// Stored as JSON in `rangeBindings[range_hex]`. The `rule_ref` field is the
/// key into the per-sheet `cfRules` map where the shared rule body lives.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfBinding {
    /// Key into the per-sheet `cfRules` map.
    pub rule_ref: String,
}

/// Write a `CfBinding` to `rangeBindings[range_hex]`.
pub fn write_cf_binding(
    txn: &mut TransactionMut,
    bindings_map: &MapRef,
    range_id: &RangeId,
    binding: &CfBinding,
) {
    let json = serde_json::to_vec(binding).expect("CfBinding must serialize");
    write_range_binding(txn, bindings_map, range_id, &json);
}

/// Read a `CfBinding` from `rangeBindings[range_hex]`.
pub fn read_cf_binding(
    txn: &impl ReadTxn,
    bindings_map: &MapRef,
    range_id: &RangeId,
) -> Option<CfBinding> {
    let bytes = read_range_binding(txn, bindings_map, range_id)?;
    serde_json::from_slice(&bytes).ok()
}

// =========================================================================
// cfRules shared rule body helpers
// =========================================================================

/// Write a CF rule body to the `cfRules` sub-map, keyed by `rule_key`.
pub fn write_cf_rule_body(
    txn: &mut TransactionMut,
    cf_rules_map: &MapRef,
    rule_key: &str,
    body_json: &str,
) {
    cf_rules_map.insert(txn, rule_key, Any::String(Arc::from(body_json)));
}

/// Read a CF rule body from the `cfRules` sub-map.
pub fn read_cf_rule_body(
    txn: &impl ReadTxn,
    cf_rules_map: &MapRef,
    rule_key: &str,
) -> Option<String> {
    match cf_rules_map.get(txn, rule_key) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

// =========================================================================
// Validation bindings (Phase 5D)
// =========================================================================

/// Binding payload for `RangeKind::Validation` ranges.
///
/// Each validation Range stores a `rule_ref` pointing into the per-sheet
/// `validationRules` map. Multiple Ranges may share the same `rule_ref`
/// when a single validation rule covers disjoint regions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationBinding {
    /// Key into the per-sheet `validationRules` map.
    pub rule_ref: String,
}

impl ValidationBinding {
    /// Serialize to JSON bytes for storage in `rangeBindings`.
    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("ValidationBinding must serialize")
    }

    /// Deserialize from JSON bytes read from `rangeBindings`.
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        serde_json::from_slice(data).ok()
    }
}

// =========================================================================
// Validation rules map helpers (Phase 5D)
// =========================================================================

/// Write a validation rule body to `validationRules[rule_id]`.
///
/// The rule body is stored as a JSON string (serialized `ValidationSpec`
/// minus the `ranges` field, since ranges are tracked by individual
/// `RangeKind::Validation` Ranges).
pub fn write_validation_rule(
    txn: &mut TransactionMut,
    rules_map: &MapRef,
    rule_id: &str,
    rule_json: &str,
) {
    rules_map.insert(txn, rule_id, Any::String(Arc::from(rule_json)));
}

/// Read a validation rule body from `validationRules[rule_id]`.
pub fn read_validation_rule(
    txn: &impl ReadTxn,
    rules_map: &MapRef,
    rule_id: &str,
) -> Option<String> {
    match rules_map.get(txn, rule_id) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Remove a CF rule body from the `cfRules` sub-map.
pub fn remove_cf_rule_body(txn: &mut TransactionMut, cf_rules_map: &MapRef, rule_key: &str) {
    cf_rules_map.remove(txn, rule_key);
}

/// List all rule keys in the `cfRules` sub-map.
pub fn list_cf_rule_keys(txn: &impl ReadTxn, cf_rules_map: &MapRef) -> Vec<String> {
    cf_rules_map.keys(txn).map(|k| k.to_string()).collect()
}

/// Check if any `rangeBindings` entry references the given `rule_ref`.
///
/// Used for orphan GC: when the last CondFormat Range for a rule is deleted,
/// we scan remaining bindings. If none reference the rule, we delete the
/// `cfRules` entry.
pub fn any_binding_references_rule(
    txn: &impl ReadTxn,
    bindings_map: &MapRef,
    rule_ref: &str,
) -> bool {
    for (_key, value) in bindings_map.iter(txn) {
        let bytes = match value {
            Out::Any(Any::Buffer(buf)) => buf,
            _ => continue,
        };
        if let Ok(binding) = serde_json::from_slice::<CfBinding>(&bytes)
            && binding.rule_ref == rule_ref
        {
            return true;
        }
    }
    false
}

/// Read all validation rule bodies from `validationRules`.
pub fn read_all_validation_rules(txn: &impl ReadTxn, rules_map: &MapRef) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (key, value) in rules_map.iter(txn) {
        if let Out::Any(Any::String(s)) = value {
            out.push((key.to_string(), s.to_string()));
        }
    }
    out
}

/// Remove a validation rule body from `validationRules[rule_id]`.
pub fn remove_validation_rule(txn: &mut TransactionMut, rules_map: &MapRef, rule_id: &str) {
    rules_map.remove(txn, rule_id);
}

/// Count how many range bindings reference a given `rule_ref`.
///
/// Used for orphan GC: when the last Validation Range for a rule is
/// deleted, the rule body should be cleaned up.
pub fn count_bindings_for_rule(txn: &impl ReadTxn, bindings_map: &MapRef, rule_id: &str) -> usize {
    let mut count = 0;
    for (_key, value) in bindings_map.iter(txn) {
        if let Out::Any(Any::Buffer(buf)) = value
            && let Some(binding) = ValidationBinding::from_bytes(&buf)
            && binding.rule_ref == rule_id
        {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Transact, WriteTxn};

    #[test]
    fn binding_write_read_roundtrip() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        let range_id = RangeId::from_raw(0x1234);
        let data = b"test-binding-data";

        write_range_binding(&mut txn, &map, &range_id, data);
        let result = read_range_binding(&txn, &map, &range_id);
        assert_eq!(result, Some(data.to_vec()));
    }

    #[test]
    fn read_ranges_preserves_legacy_dense_metadata_without_axis_refs() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let ranges_map = txn.get_or_insert_map("ranges");
        let payloads_map = txn.get_or_insert_map("rangePayloads");
        let metadata = RangeMetadata {
            range_id: RangeId::from_raw(0xD0E5E),
            kind: RangeKind::Data,
            anchor: RangeAnchor::Strict {
                row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
                col_ids: vec![ColId::from_raw(3)],
            },
            encoding: PayloadEncoding::F64Le,
            row_axis: None,
            col_axis: None,
            row_ids: vec![RowId::from_raw(1), RowId::from_raw(2)],
            col_ids: vec![ColId::from_raw(3)],
        };

        write_range_to_yrs(&mut txn, &ranges_map, &payloads_map, &metadata, &[1, 2, 3]);

        let entries = read_ranges_from_yrs(&txn, &ranges_map, &payloads_map);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].metadata.range_id, metadata.range_id);
        assert!(entries[0].metadata.row_axis.is_none());
        assert!(entries[0].metadata.col_axis.is_none());
        assert_eq!(entries[0].metadata.row_ids, metadata.row_ids);
        assert_eq!(entries[0].metadata.col_ids, metadata.col_ids);
        assert_eq!(entries[0].payload, vec![1, 2, 3]);
    }

    #[test]
    #[should_panic(expected = "invalid RangeMetadata for range key")]
    fn read_ranges_panics_on_unknown_compact_axis_variant() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let ranges_map = txn.get_or_insert_map("ranges");
        let payloads_map = txn.get_or_insert_map("rangePayloads");
        ranges_map.insert(
            &mut txn,
            "bad-range",
            Any::String(Arc::from(
                r#"{
                    "rangeId":"00000000000000000000000000000001",
                    "kind":"Data",
                    "anchor":{"Strict":{"rowIds":[],"colIds":[]}},
                    "encoding":"F64Le",
                    "rowAxis":{"CompactOnly":{"runId":1,"startOffset":0,"len":1}},
                    "rowIds":[],
                    "colIds":[]
                }"#,
            )),
        );

        let _ = read_ranges_from_yrs(&txn, &ranges_map, &payloads_map);
    }

    #[test]
    fn binding_remove_cleans_up() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        let range_id = RangeId::from_raw(0x5678);

        write_range_binding(&mut txn, &map, &range_id, b"data");
        remove_range_binding(&mut txn, &map, &range_id);
        let result = read_range_binding(&txn, &map, &range_id);
        assert_eq!(result, None);
    }

    #[test]
    fn format_write_read_roundtrip() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeFormats");
        let range_id = RangeId::from_raw(0xABCD);
        let data = b"test-format-data";

        write_range_format(&mut txn, &map, &range_id, data);
        let result = read_range_format(&txn, &map, &range_id);
        assert_eq!(result, Some(data.to_vec()));
    }

    #[test]
    fn format_remove_cleans_up() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeFormats");
        let range_id = RangeId::from_raw(0xEF01);

        write_range_format(&mut txn, &map, &range_id, b"fmt");
        remove_range_format(&mut txn, &map, &range_id);
        let result = read_range_format(&txn, &map, &range_id);
        assert_eq!(result, None);
    }

    #[test]
    fn read_nonexistent_returns_none() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("test");
        let range_id = RangeId::from_raw(0x9999);

        assert_eq!(read_range_binding(&txn, &map, &range_id), None);
        assert_eq!(read_range_format(&txn, &map, &range_id), None);
    }

    #[test]
    fn cf_binding_write_read_roundtrip() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        let range_id = RangeId::from_raw(0xCF01);
        let binding = CfBinding {
            rule_ref: "cf-rule-42".to_string(),
        };
        write_cf_binding(&mut txn, &map, &range_id, &binding);
        assert_eq!(read_cf_binding(&txn, &map, &range_id), Some(binding));
    }

    #[test]
    fn cf_binding_read_nonexistent_returns_none() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        assert_eq!(
            read_cf_binding(&txn, &map, &RangeId::from_raw(0xCF99)),
            None
        );
    }

    #[test]
    fn cf_binding_serde_roundtrip() {
        let binding = CfBinding {
            rule_ref: "my-rule-ref".to_string(),
        };
        let json = serde_json::to_string(&binding).unwrap();
        assert!(json.contains("ruleRef"));
        let deserialized: CfBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(binding, deserialized);
    }

    #[test]
    fn cf_rule_body_write_read_roundtrip() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("cfRules");
        let body = r#"{"id":"r1","priority":1}"#;
        write_cf_rule_body(&mut txn, &map, "rule-key-1", body);
        assert_eq!(
            read_cf_rule_body(&txn, &map, "rule-key-1"),
            Some(body.to_string())
        );
    }

    #[test]
    fn cf_rule_body_read_nonexistent_returns_none() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("cfRules");
        assert_eq!(read_cf_rule_body(&txn, &map, "nonexistent"), None);
    }

    #[test]
    fn cf_rule_body_remove_cleans_up() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("cfRules");
        write_cf_rule_body(&mut txn, &map, "rule-to-delete", "body");
        remove_cf_rule_body(&mut txn, &map, "rule-to-delete");
        assert_eq!(read_cf_rule_body(&txn, &map, "rule-to-delete"), None);
    }

    #[test]
    fn cf_rule_body_list_keys() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("cfRules");
        write_cf_rule_body(&mut txn, &map, "rule-a", "body-a");
        write_cf_rule_body(&mut txn, &map, "rule-b", "body-b");
        let mut keys = list_cf_rule_keys(&txn, &map);
        keys.sort();
        assert_eq!(keys, vec!["rule-a".to_string(), "rule-b".to_string()]);
    }

    #[test]
    fn any_binding_references_rule_found() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        let binding = CfBinding {
            rule_ref: "target-rule".to_string(),
        };
        write_cf_binding(&mut txn, &map, &RangeId::from_raw(0xAA), &binding);
        assert!(any_binding_references_rule(&txn, &map, "target-rule"));
    }

    #[test]
    fn any_binding_references_rule_not_found() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        let binding = CfBinding {
            rule_ref: "other-rule".to_string(),
        };
        write_cf_binding(&mut txn, &map, &RangeId::from_raw(0xBB), &binding);
        assert!(!any_binding_references_rule(&txn, &map, "target-rule"));
    }

    #[test]
    fn any_binding_references_rule_empty_map() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");
        assert!(!any_binding_references_rule(&txn, &map, "any-rule"));
    }

    #[test]
    fn multi_region_shared_rule_body() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let bindings_map = txn.get_or_insert_map("rangeBindings");
        let rules_map = txn.get_or_insert_map("cfRules");
        let shared_rule_key = "shared-rule-1";
        write_cf_rule_body(&mut txn, &rules_map, shared_rule_key, r#"{"id":"r1"}"#);
        let binding = CfBinding {
            rule_ref: shared_rule_key.to_string(),
        };
        write_cf_binding(&mut txn, &bindings_map, &RangeId::from_raw(0x100), &binding);
        write_cf_binding(&mut txn, &bindings_map, &RangeId::from_raw(0x200), &binding);
        assert!(any_binding_references_rule(
            &txn,
            &bindings_map,
            shared_rule_key
        ));
        remove_range_binding(&mut txn, &bindings_map, &RangeId::from_raw(0x100));
        assert!(any_binding_references_rule(
            &txn,
            &bindings_map,
            shared_rule_key
        ));
        remove_range_binding(&mut txn, &bindings_map, &RangeId::from_raw(0x200));
        assert!(!any_binding_references_rule(
            &txn,
            &bindings_map,
            shared_rule_key
        ));
        remove_cf_rule_body(&mut txn, &rules_map, shared_rule_key);
        assert_eq!(read_cf_rule_body(&txn, &rules_map, shared_rule_key), None);
    }

    // -- ValidationBinding tests -------------------------------------------

    #[test]
    fn validation_binding_serde_roundtrip() {
        let binding = ValidationBinding {
            rule_ref: "rule-42".to_string(),
        };
        let bytes = binding.to_bytes();
        let parsed = ValidationBinding::from_bytes(&bytes).unwrap();
        assert_eq!(binding, parsed);
    }

    #[test]
    fn validation_binding_from_invalid_bytes() {
        assert_eq!(ValidationBinding::from_bytes(b"not-json"), None);
        assert_eq!(ValidationBinding::from_bytes(b""), None);
    }

    // -- Validation rules map tests ----------------------------------------

    #[test]
    fn validation_rule_write_read_roundtrip() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("validationRules");

        write_validation_rule(&mut txn, &map, "rule-1", r#"{"type":"wholeNumber"}"#);
        let result = read_validation_rule(&txn, &map, "rule-1");
        assert_eq!(result, Some(r#"{"type":"wholeNumber"}"#.to_string()));
    }

    #[test]
    fn validation_rule_read_nonexistent() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("validationRules");

        assert_eq!(read_validation_rule(&txn, &map, "no-such-rule"), None);
    }

    #[test]
    fn validation_rule_remove() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("validationRules");

        write_validation_rule(&mut txn, &map, "rule-rm", r#"{"type":"list"}"#);
        assert!(read_validation_rule(&txn, &map, "rule-rm").is_some());

        remove_validation_rule(&mut txn, &map, "rule-rm");
        assert_eq!(read_validation_rule(&txn, &map, "rule-rm"), None);
    }

    #[test]
    fn validation_rule_read_all() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("validationRules");

        write_validation_rule(&mut txn, &map, "a", r#"{"rule":"a"}"#);
        write_validation_rule(&mut txn, &map, "b", r#"{"rule":"b"}"#);

        let all = read_all_validation_rules(&txn, &map);
        assert_eq!(all.len(), 2);
        let keys: Vec<&str> = all.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"a"));
        assert!(keys.contains(&"b"));
    }

    #[test]
    fn count_bindings_for_rule_counts_correctly() {
        let doc = Doc::new();
        let mut txn = doc.transact_mut();
        let map = txn.get_or_insert_map("rangeBindings");

        let r1 = RangeId::from_raw(0x1);
        let r2 = RangeId::from_raw(0x2);
        let r3 = RangeId::from_raw(0x3);

        let b1 = ValidationBinding {
            rule_ref: "rule-A".to_string(),
        };
        let b2 = ValidationBinding {
            rule_ref: "rule-A".to_string(),
        };
        let b3 = ValidationBinding {
            rule_ref: "rule-B".to_string(),
        };

        write_range_binding(&mut txn, &map, &r1, &b1.to_bytes());
        write_range_binding(&mut txn, &map, &r2, &b2.to_bytes());
        write_range_binding(&mut txn, &map, &r3, &b3.to_bytes());

        assert_eq!(count_bindings_for_rule(&txn, &map, "rule-A"), 2);
        assert_eq!(count_bindings_for_rule(&txn, &map, "rule-B"), 1);
        assert_eq!(count_bindings_for_rule(&txn, &map, "rule-C"), 0);
    }
}
