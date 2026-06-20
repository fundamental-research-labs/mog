use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

mod sha256;

pub const SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION: &str = "semantic-workbook-state.v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDigest {
    pub algorithm: VersionObjectDigestAlgorithm,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
}

impl ObjectDigest {
    pub fn sha256(bytes: &[u8]) -> Self {
        Self {
            algorithm: VersionObjectDigestAlgorithm::Sha256,
            value: sha256::hex_digest(bytes),
            byte_length: Some(bytes.len()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionObjectDigestAlgorithm {
    #[serde(rename = "sha256")]
    Sha256,
    #[serde(rename = "sha512")]
    Sha512,
    #[serde(rename = "blake3")]
    Blake3,
    #[serde(rename = "opaque")]
    Opaque,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionDomainClass {
    #[serde(rename = "authored")]
    Authored,
    #[serde(rename = "derived")]
    Derived,
    #[serde(rename = "transient")]
    Transient,
    #[serde(rename = "packageFidelity")]
    PackageFidelity,
    #[serde(rename = "secret")]
    Secret,
    #[serde(rename = "external")]
    External,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionDomainCapabilityState {
    #[serde(rename = "not-started")]
    NotStarted,
    #[serde(rename = "contracted")]
    Contracted,
    #[serde(rename = "supported")]
    Supported,
    #[serde(rename = "derived")]
    Derived,
    #[serde(rename = "excluded")]
    Excluded,
    #[serde(rename = "opaque-preserved")]
    OpaquePreserved,
    #[serde(rename = "opaque-blocking")]
    OpaqueBlocking,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticDomainCoverageStatus {
    Complete,
    Derived,
    Excluded,
    Transient,
    Unsupported,
    OpaquePreserved,
    OpaqueBlocking,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDomainCoverage {
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    pub status: SemanticDomainCoverageStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<SemanticCompletenessDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SemanticDiagnosticSeverity {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticCompletenessDiagnostic {
    pub severity: SemanticDiagnosticSeverity,
    pub code: String,
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    pub status: SemanticDomainCoverageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticObjectKind {
    Workbook,
    Sheet,
    Cell,
    CellValue,
    CellFormula,
    DirectFormat,
    DomainAttachment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticObjectDigest {
    pub object_id: String,
    pub object_kind: SemanticObjectKind,
    pub domain_id: String,
    pub digest: ObjectDigest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalCellValue {
    pub value_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFormula {
    pub normalized_formula: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependency_object_ids: Vec<String>,
    pub volatile: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalDirectFormat {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticCellState {
    pub object_id: String,
    pub sheet_id: String,
    pub row: u32,
    pub column: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<CanonicalCellValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<CanonicalFormula>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direct_format: Option<CanonicalDirectFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSheetState {
    pub sheet_id: String,
    pub name: String,
    #[serde(default)]
    pub cells: BTreeMap<String, SemanticCellState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDomainState {
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub objects: BTreeMap<String, SemanticObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookState {
    pub schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_id: Option<String>,
    #[serde(default)]
    pub domains: BTreeMap<String, SemanticDomainState>,
    #[serde(default)]
    pub sheets: BTreeMap<String, SemanticSheetState>,
}

impl Default for SemanticWorkbookState {
    fn default() -> Self {
        Self {
            schema_version: SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION.to_string(),
            workbook_id: None,
            domains: BTreeMap::new(),
            sheets: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookStateEnvelope {
    pub state: SemanticWorkbookState,
    pub state_digest: ObjectDigest,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub coverage: Vec<SemanticDomainCoverage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticChangeKind {
    Added,
    Removed,
    Updated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChange {
    pub change_id: String,
    pub kind: SemanticChangeKind,
    pub domain_id: String,
    pub object_id: String,
    pub object_kind: SemanticObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_digest: Option<ObjectDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookDiff {
    pub before_digest: ObjectDigest,
    pub after_digest: ObjectDigest,
    pub changes: Vec<SemanticChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub coverage: Vec<SemanticDomainCoverage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<SemanticCompletenessDiagnostic>,
}

pub fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    let value = serde_json::to_value(value)?;
    let mut out = Vec::new();
    write_canonical_json(&value, &mut out)?;
    Ok(out)
}

pub fn canonical_digest<T: Serialize>(value: &T) -> Result<ObjectDigest, serde_json::Error> {
    canonical_json_bytes(value).map(|bytes| ObjectDigest::sha256(&bytes))
}

pub fn semantic_workbook_state_digest(
    state: &SemanticWorkbookState,
) -> Result<ObjectDigest, serde_json::Error> {
    canonical_digest(state)
}

pub fn semantic_state_envelope(
    state: SemanticWorkbookState,
    coverage: Vec<SemanticDomainCoverage>,
) -> Result<SemanticWorkbookStateEnvelope, serde_json::Error> {
    let state_digest = semantic_workbook_state_digest(&state)?;
    Ok(SemanticWorkbookStateEnvelope {
        state,
        state_digest,
        coverage,
    })
}

fn write_canonical_json(value: &Value, out: &mut Vec<u8>) -> Result<(), serde_json::Error> {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(number) => out.extend_from_slice(number.to_string().as_bytes()),
        Value::String(string) => {
            let escaped = serde_json::to_string(string)?;
            out.extend_from_slice(escaped.as_bytes());
        }
        Value::Array(items) => {
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_canonical_json(item, out)?;
            }
            out.push(b']');
        }
        Value::Object(map) => {
            out.push(b'{');
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by_key(|(key, _)| *key);
            for (index, (key, item)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                let escaped = serde_json::to_string(key)?;
                out.extend_from_slice(escaped.as_bytes());
                out.push(b':');
                write_canonical_json(item, out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authored_domain() -> SemanticDomainState {
        SemanticDomainState {
            domain_id: "authored-grid".to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: BTreeMap::new(),
        }
    }

    fn workbook_with_value(value: &str) -> SemanticWorkbookState {
        let mut state = SemanticWorkbookState::default();
        state.workbook_id = Some("wb-1".to_string());
        state
            .domains
            .insert("authored-grid".to_string(), authored_domain());

        let cell = SemanticCellState {
            object_id: "cell:sheet-1:1:1".to_string(),
            sheet_id: "sheet-1".to_string(),
            row: 1,
            column: 1,
            value: Some(CanonicalCellValue {
                value_kind: "string".to_string(),
                canonical_value: Some(Value::String(value.to_string())),
                digest: None,
            }),
            formula: None,
            direct_format: None,
            digest: None,
        };
        let mut sheet = SemanticSheetState {
            sheet_id: "sheet-1".to_string(),
            name: "Sheet1".to_string(),
            cells: BTreeMap::new(),
            digest: None,
        };
        sheet.cells.insert(cell.object_id.clone(), cell);
        state.sheets.insert(sheet.sheet_id.clone(), sheet);
        state
    }

    #[test]
    fn versioning_canonical_json_orders_object_keys_stably() {
        let mut left = BTreeMap::new();
        left.insert("z".to_string(), Value::from(1));
        left.insert("a".to_string(), Value::from(2));

        let mut right = BTreeMap::new();
        right.insert("a".to_string(), Value::from(2));
        right.insert("z".to_string(), Value::from(1));

        let left_json = canonical_json_bytes(&left).expect("canonical json");
        let right_json = canonical_json_bytes(&right).expect("canonical json");

        assert_eq!(left_json, br#"{"a":2,"z":1}"#);
        assert_eq!(left_json, right_json);
    }

    #[test]
    fn versioning_digest_is_stable_and_sha256_shaped() {
        let state = workbook_with_value("alpha");

        let first = canonical_digest(&state).expect("digest");
        let second = canonical_digest(&state).expect("digest");
        let canonical_bytes = canonical_json_bytes(&state).expect("canonical json");

        assert_eq!(first, second);
        assert_eq!(first.algorithm, VersionObjectDigestAlgorithm::Sha256);
        assert_eq!(first.value.len(), 64);
        assert_eq!(first.byte_length, Some(canonical_bytes.len()));
    }

    #[test]
    fn versioning_digest_changes_for_authored_value_change() {
        let before = workbook_with_value("alpha");
        let after = workbook_with_value("beta");

        let before_digest = semantic_workbook_state_digest(&before).expect("before digest");
        let after_digest = semantic_workbook_state_digest(&after).expect("after digest");

        assert_ne!(before_digest.value, after_digest.value);
    }

    #[test]
    fn versioning_capability_state_does_not_serialize_expected_failing() {
        let states = [
            VersionDomainCapabilityState::NotStarted,
            VersionDomainCapabilityState::Contracted,
            VersionDomainCapabilityState::Supported,
            VersionDomainCapabilityState::Derived,
            VersionDomainCapabilityState::Excluded,
            VersionDomainCapabilityState::OpaquePreserved,
            VersionDomainCapabilityState::OpaqueBlocking,
        ];

        let json = serde_json::to_string(&states).expect("states serialize");

        assert!(!json.contains("expected-failing"));
        assert!(json.contains("opaque-preserved"));
        assert!(json.contains("opaque-blocking"));
    }
}
