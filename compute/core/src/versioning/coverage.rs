use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Number, Value};
use snapshot_types::versioning::{SemanticObjectDigest, SemanticObjectKind, canonical_digest};

use crate::storage::engine::ComputeEngine;

use super::SemanticStateReadError;

mod records;

use records::semantic_coverage_records;

pub(super) const DATA_VALIDATION_DOMAIN: &str = "data-validation";
pub(super) const CONDITIONAL_FORMATTING_DOMAIN: &str = "conditional-formatting";
pub(super) const SCHEMA_COVERAGE_DOMAIN: &str = "schema-coverage";
const SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION: &str = "native-semantic-coverage-record.v2";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize)]
pub(super) enum SemanticCoverageScope {
    #[serde(rename = "topLevel")]
    TopLevel,
    #[serde(rename = "workbook")]
    Workbook,
    #[serde(rename = "sheet")]
    Sheet,
    #[serde(rename = "cell")]
    Cell,
    #[serde(rename = "cellProperties")]
    CellProperties,
    #[serde(rename = "rowColumn")]
    RowColumn,
    #[serde(rename = "range")]
    Range,
    #[serde(rename = "metadata")]
    Metadata,
    #[serde(rename = "identity")]
    Identity,
}

impl SemanticCoverageScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::TopLevel => "topLevel",
            Self::Workbook => "workbook",
            Self::Sheet => "sheet",
            Self::Cell => "cell",
            Self::CellProperties => "cellProperties",
            Self::RowColumn => "rowColumn",
            Self::Range => "range",
            Self::Metadata => "metadata",
            Self::Identity => "identity",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(super) enum SemanticCoverageClassification {
    #[serde(rename = "includedAuthored")]
    IncludedAuthored,
    #[serde(rename = "derivedExcluded")]
    DerivedExcluded,
    #[serde(rename = "viewExcluded")]
    ViewExcluded,
    #[serde(rename = "opaqueDigest")]
    OpaqueDigest,
    #[serde(rename = "unsupportedDiagnostic")]
    UnsupportedDiagnostic,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(super) enum SemanticCoverageDigestPart {
    #[serde(rename = "authored")]
    Authored,
    #[serde(rename = "opaque")]
    Opaque,
    #[serde(rename = "coverageOnly")]
    CoverageOnly,
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub(super) enum SemanticCoverageStatusEffect {
    #[serde(rename = "clean")]
    Clean,
    #[serde(rename = "partial")]
    Partial,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(super) struct SemanticCoverageRecord {
    pub schema_version: &'static str,
    pub scope: SemanticCoverageScope,
    pub source_path: String,
    pub domain_owner: &'static str,
    pub classification: SemanticCoverageClassification,
    pub digest_part: SemanticCoverageDigestPart,
    pub status_effect: SemanticCoverageStatusEffect,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<&'static str>,
    pub fixture_id: &'static str,
}

impl SemanticCoverageRecord {
    fn object_id(&self) -> String {
        format!(
            "semantic-coverage:{}:{}:{}",
            self.scope.as_str(),
            self.source_path,
            self.domain_owner
        )
    }
}

pub(super) fn semantic_coverage_record_objects(
    engine: &ComputeEngine,
) -> Result<BTreeMap<String, SemanticObjectDigest>, SemanticStateReadError> {
    let mut objects = BTreeMap::new();
    for record in semantic_coverage_records(engine) {
        let object_id = record.object_id();
        objects.insert(
            object_id.clone(),
            SemanticObjectDigest {
                object_id,
                object_kind: SemanticObjectKind::DomainAttachment,
                domain_id: SCHEMA_COVERAGE_DOMAIN.to_string(),
                digest: canonical_digest(&record)?,
            },
        );
    }
    Ok(objects)
}

pub(super) fn record_data_validation_presence(
    engine: &ComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    let Some(metadata) = engine.storage().sheet_metadata.get(sheet_id) else {
        return Ok(());
    };
    let validation = &metadata.validations;
    let specs: Vec<_> = validation.rules.iter().map(|entry| &entry.spec).collect();
    let entry_count = specs.len()
        + usize::from(validation.disable_prompts)
        + usize::from(validation.x_window.is_some())
        + usize::from(validation.y_window.is_some())
        + usize::from(validation.declared_count.is_some());
    if entry_count == 0 {
        return Ok(());
    }
    record_presence_detector_row(
        objects,
        DATA_VALIDATION_DOMAIN,
        sheet_key,
        "native-data-validation-presence",
        entry_count,
        specs.len(),
        &(
            specs,
            validation.disable_prompts,
            validation.x_window,
            validation.y_window,
            validation.declared_count,
        ),
    )
}

pub(super) fn record_conditional_formatting_presence(
    engine: &ComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    let conditional_formats = engine.get_all_cf_rules(sheet_id);
    if conditional_formats.is_empty() {
        return Ok(());
    }
    record_presence_detector_row(
        objects,
        CONDITIONAL_FORMATTING_DOMAIN,
        sheet_key,
        "native-conditional-format-presence",
        conditional_formats.len(),
        conditional_formats.len(),
        &conditional_formats,
    )
}

fn record_presence_detector_row<T: Serialize>(
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
    domain_id: &str,
    sheet_key: &str,
    detector_id: &str,
    raw_entry_count: usize,
    typed_entry_count: usize,
    typed_entries: T,
) -> Result<(), SemanticStateReadError> {
    let object_id = format!("domain-presence:{domain_id}:{sheet_key}");
    let mut payload = serde_json::Map::new();
    payload.insert(
        "detectorId".to_string(),
        Value::String(detector_id.to_string()),
    );
    payload.insert("domainId".to_string(), Value::String(domain_id.to_string()));
    payload.insert("sheetId".to_string(), Value::String(sheet_key.to_string()));
    payload.insert("present".to_string(), Value::Bool(true));
    payload.insert(
        "rawEntryCount".to_string(),
        Value::Number(Number::from(raw_entry_count as u64)),
    );
    payload.insert(
        "typedEntryCount".to_string(),
        Value::Number(Number::from(typed_entry_count as u64)),
    );
    payload.insert(
        "typedEntries".to_string(),
        canonicalize_json_value(serde_json::to_value(typed_entries)?),
    );
    let payload = canonicalize_json_value(Value::Object(payload));

    objects.insert(
        object_id.clone(),
        SemanticObjectDigest {
            object_id,
            object_kind: SemanticObjectKind::DomainAttachment,
            domain_id: domain_id.to_string(),
            digest: canonical_digest(&payload)?,
        },
    );
    Ok(())
}

fn canonicalize_json_value(value: Value) -> Value {
    match value {
        Value::Array(items) => {
            Value::Array(items.into_iter().map(canonicalize_json_value).collect())
        }
        Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            for (key, value) in map {
                sorted.insert(key, canonicalize_json_value(value));
            }
            Value::Object(sorted)
        }
        other => other,
    }
}
