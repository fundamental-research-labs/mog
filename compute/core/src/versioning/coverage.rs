use std::collections::BTreeMap;

use compute_document::schema::*;
use serde::Serialize;
use serde_json::{Number, Value};
use snapshot_types::versioning::{SemanticObjectDigest, SemanticObjectKind, canonical_digest};
use yrs::{Map, Out, ReadTxn, Transact};

use crate::storage::{
    engine::YrsComputeEngine,
    infra::grid_helpers::{get_sheet_submap, sheet_id_to_hex},
};

use super::SemanticStateReadError;

mod records;

use records::semantic_coverage_records;

pub(super) const DATA_VALIDATION_DOMAIN: &str = "data-validation";
pub(super) const CONDITIONAL_FORMATTING_DOMAIN: &str = "conditional-formatting";
pub(super) const SCHEMA_COVERAGE_DOMAIN: &str = "schema-coverage";
pub(super) const UNCLASSIFIED_SCHEMA_KEYS_DOMAIN: &str = "unclassified-schema-keys";
const SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION: &str = "semantic-coverage-record.v1";
const UNCLASSIFIED_SCHEMA_DIAGNOSTIC: &str = "VERSIONING_UNCLASSIFIED_SCHEMA_KEY";
const DATA_VALIDATION_METADATA_KEYS: &[&str] = &[
    "dataValidations",
    "dvDeclaredCount",
    "dvDisablePrompts",
    "dvXWindow",
    "dvYWindow",
    "x14DataValidations",
    "x14DvDeclaredCount",
];

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
    #[serde(rename = "bridgeOnly")]
    BridgeOnly,
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
            Self::BridgeOnly => "bridgeOnly",
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
    #[serde(rename = "blockingMalformed")]
    BlockingMalformed,
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
    #[serde(rename = "blocking")]
    Blocking,
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

pub(super) fn semantic_coverage_record_objects()
-> Result<BTreeMap<String, SemanticObjectDigest>, SemanticStateReadError> {
    let mut objects = BTreeMap::new();
    for record in semantic_coverage_records() {
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

pub(super) fn unclassified_schema_key_objects(
    engine: &YrsComputeEngine,
) -> Result<BTreeMap<String, SemanticObjectDigest>, SemanticStateReadError> {
    let records = semantic_coverage_records();
    let mut objects = BTreeMap::new();
    let txn = engine.storage().doc().transact();

    for (key, _) in txn.root_refs() {
        let source_path = format!("/{key}");
        record_unclassified_if_missing(
            &records,
            &mut objects,
            SemanticCoverageScope::TopLevel,
            &source_path,
        )?;
    }

    scan_workbook_map(
        &txn,
        engine.storage().workbook_map(),
        &records,
        &mut objects,
    )?;
    if let Some(security) = txn.get_map(KEY_SECURITY) {
        scan_security_map(&txn, &security, &records, &mut objects)?;
    }
    for (_, sheet_out) in engine.storage().sheets().iter(&txn) {
        if let Out::YMap(sheet_map) = sheet_out {
            scan_sheet_map(&txn, &sheet_map, &records, &mut objects)?;
        }
    }

    Ok(objects)
}

pub(super) fn record_data_validation_presence(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    let raw_entry_count = raw_sheet_submap_entry_count(engine, sheet_id, KEY_VALIDATION_RULES)
        + data_validation_metadata_entry_count(engine, sheet_id);
    if raw_entry_count == 0 {
        return Ok(());
    }

    let range_schemas = engine.get_range_schemas_for_sheet(sheet_id);
    record_presence_detector_row(
        objects,
        DATA_VALIDATION_DOMAIN,
        sheet_key,
        "yrs-data-validation-presence",
        raw_entry_count,
        range_schemas.len(),
        &range_schemas,
    )
}

pub(super) fn record_conditional_formatting_presence(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    let raw_entry_count = raw_sheet_submap_entry_count(engine, sheet_id, KEY_CONDITIONAL_FORMAT);
    if raw_entry_count == 0 {
        return Ok(());
    }

    let conditional_formats = engine.get_all_cf_rules(sheet_id);
    record_presence_detector_row(
        objects,
        CONDITIONAL_FORMATTING_DOMAIN,
        sheet_key,
        "yrs-conditional-format-presence",
        raw_entry_count,
        conditional_formats.len(),
        &conditional_formats,
    )
}

fn raw_sheet_submap_entry_count(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    submap_key: &str,
) -> usize {
    let sheets = engine.storage().sheets_ref();
    let txn = engine.storage().doc().transact();
    let sheet_hex = sheet_id_to_hex(sheet_id);
    get_sheet_submap(&txn, &sheets, &sheet_hex, submap_key)
        .map(|map| map.len(&txn) as usize)
        .unwrap_or(0)
}

fn data_validation_metadata_entry_count(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
) -> usize {
    let sheets = engine.storage().sheets_ref();
    let txn = engine.storage().doc().transact();
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let Some(meta_map) = get_sheet_submap(&txn, &sheets, &sheet_hex, KEY_PROPERTIES) else {
        return 0;
    };

    DATA_VALIDATION_METADATA_KEYS
        .iter()
        .filter(|key| meta_map.get(&txn, key).is_some())
        .count()
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

fn scan_workbook_map<T: ReadTxn>(
    txn: &T,
    workbook: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (key, _) in workbook.iter(txn) {
        let source_path = format!("/workbook/{key}");
        record_unclassified_if_missing(
            records,
            objects,
            SemanticCoverageScope::Workbook,
            &source_path,
        )?;
    }
    Ok(())
}

fn scan_security_map<T: ReadTxn>(
    txn: &T,
    security: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (key, _) in security.iter(txn) {
        let source_path = format!("/security/{key}");
        record_unclassified_if_missing(
            records,
            objects,
            SemanticCoverageScope::Metadata,
            &source_path,
        )?;
    }
    Ok(())
}

fn scan_sheet_map<T: ReadTxn>(
    txn: &T,
    sheet_map: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (key, value) in sheet_map.iter(txn) {
        let scope = sheet_scope_for_key(key);
        let source_path = format!("/sheets/{{sheetId}}/{key}");
        record_unclassified_if_missing(records, objects, scope, &source_path)?;

        match (key, value) {
            (KEY_CELLS, Out::YMap(cells)) => scan_cells_map(txn, &cells, records, objects)?,
            (KEY_CELL_PROPERTIES, Out::YMap(cell_properties)) => {
                scan_cell_properties_map(txn, &cell_properties, records, objects)?
            }
            (KEY_GRID_INDEX, Out::YMap(grid_index)) => {
                scan_grid_index_map(txn, &grid_index, records, objects)?
            }
            (KEY_PROPERTIES, Out::YMap(properties)) => {
                scan_sheet_properties_map(txn, &properties, records, objects)?
            }
            _ => {}
        }
    }
    Ok(())
}

fn scan_cells_map<T: ReadTxn>(
    txn: &T,
    cells: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (_, value) in cells.iter(txn) {
        let Out::YMap(cell_map) = value else {
            continue;
        };
        for (key, _) in cell_map.iter(txn) {
            let source_path = format!("/sheets/{{sheetId}}/cells/{{cellId}}/{key}");
            record_unclassified_if_missing(
                records,
                objects,
                SemanticCoverageScope::Cell,
                &source_path,
            )?;
        }
    }
    Ok(())
}

fn scan_cell_properties_map<T: ReadTxn>(
    txn: &T,
    cell_properties: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (_, value) in cell_properties.iter(txn) {
        let Out::YMap(properties) = value else {
            continue;
        };
        for (key, _) in properties.iter(txn) {
            let source_path = format!("/sheets/{{sheetId}}/cellProperties/{{cellId}}/{key}");
            record_unclassified_if_missing(
                records,
                objects,
                SemanticCoverageScope::CellProperties,
                &source_path,
            )?;
        }
    }
    Ok(())
}

fn scan_grid_index_map<T: ReadTxn>(
    txn: &T,
    grid_index: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (key, _) in grid_index.iter(txn) {
        let source_path = format!("/sheets/{{sheetId}}/gridIndex/{key}");
        record_unclassified_if_missing(
            records,
            objects,
            SemanticCoverageScope::BridgeOnly,
            &source_path,
        )?;
    }
    Ok(())
}

fn scan_sheet_properties_map<T: ReadTxn>(
    txn: &T,
    properties: &yrs::MapRef,
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<(), SemanticStateReadError> {
    for (key, _) in properties.iter(txn) {
        let source_path = format!("/sheets/{{sheetId}}/properties/{key}");
        record_unclassified_if_missing(
            records,
            objects,
            SemanticCoverageScope::Metadata,
            &source_path,
        )?;
    }
    Ok(())
}

fn record_unclassified_if_missing(
    records: &[SemanticCoverageRecord],
    objects: &mut BTreeMap<String, SemanticObjectDigest>,
    scope: SemanticCoverageScope,
    source_path: &str,
) -> Result<(), SemanticStateReadError> {
    if records
        .iter()
        .any(|record| record.scope == scope && record.source_path == source_path)
    {
        return Ok(());
    }

    let object_id = format!("unclassified-schema-key:{}:{source_path}", scope.as_str());
    let payload = UnclassifiedSchemaKeyRecord {
        schema_version: SEMANTIC_COVERAGE_RECORD_SCHEMA_VERSION,
        scope,
        source_path,
        domain_owner: UNCLASSIFIED_SCHEMA_KEYS_DOMAIN,
        classification: SemanticCoverageClassification::BlockingMalformed,
        digest_part: SemanticCoverageDigestPart::CoverageOnly,
        status_effect: SemanticCoverageStatusEffect::Blocking,
        diagnostic_code: UNCLASSIFIED_SCHEMA_DIAGNOSTIC,
        fixture_id: "vc03-schema-coverage-unclassified",
    };

    objects.insert(
        object_id.clone(),
        SemanticObjectDigest {
            object_id,
            object_kind: SemanticObjectKind::DomainAttachment,
            domain_id: UNCLASSIFIED_SCHEMA_KEYS_DOMAIN.to_string(),
            digest: canonical_digest(&payload)?,
        },
    );
    Ok(())
}

#[derive(Serialize)]
struct UnclassifiedSchemaKeyRecord<'a> {
    schema_version: &'static str,
    scope: SemanticCoverageScope,
    source_path: &'a str,
    domain_owner: &'static str,
    classification: SemanticCoverageClassification,
    digest_part: SemanticCoverageDigestPart,
    status_effect: SemanticCoverageStatusEffect,
    diagnostic_code: &'static str,
    fixture_id: &'static str,
}

fn sheet_scope_for_key(key: &str) -> SemanticCoverageScope {
    match key {
        KEY_ROW_ORDER
        | KEY_COL_ORDER
        | KEY_ROW_HEIGHTS
        | KEY_COL_WIDTHS
        | KEY_ROW_FORMATS
        | KEY_COL_FORMATS
        | KEY_COL_FORMAT_RANGES
        | KEY_HIDDEN_ROWS
        | KEY_HIDDEN_COLS
        | KEY_MANUAL_HIDDEN_ROWS
        | KEY_FILTER_HIDDEN_ROWS => SemanticCoverageScope::RowColumn,
        KEY_RANGES | KEY_RANGE_PAYLOADS | KEY_RANGE_FORMATS | KEY_RANGE_BINDINGS | KEY_MERGES
        | KEY_MERGE_BACKUPS => SemanticCoverageScope::Range,
        KEY_GRID_INDEX => SemanticCoverageScope::BridgeOnly,
        KEY_PROPERTIES
        | KEY_SCHEMAS
        | KEY_COMMENTS
        | KEY_FILTERS
        | KEY_FILTER_METADATA_BINDINGS
        | KEY_SPARKLINES
        | KEY_CONDITIONAL_FORMAT
        | KEY_BINDINGS
        | KEY_GROUPING
        | KEY_SORTING
        | KEY_FLOATING_OBJECTS
        | KEY_FLOATING_OBJECT_ORDER
        | KEY_FLOATING_OBJECT_GROUPS
        | KEY_PIVOT_TABLES
        | KEY_CF_RULES
        | KEY_VALIDATION_RULES => SemanticCoverageScope::Metadata,
        KEY_CELLS => SemanticCoverageScope::Cell,
        KEY_CELL_PROPERTIES => SemanticCoverageScope::CellProperties,
        _ => SemanticCoverageScope::Sheet,
    }
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
