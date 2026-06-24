use std::collections::BTreeMap;

use compute_document::schema::{
    KEY_ARRAY_REF, KEY_CELLS, KEY_FORMULA, KEY_FORMULA_AGGREGATE, KEY_FORMULA_DYNAMIC_ARRAY,
    KEY_FORMULA_METADATA, KEY_FORMULA_REFS, KEY_FORMULA_TEMPLATE, KEY_FORMULA_VOLATILE,
};
use serde::Serialize;
use serde_json::{Number, Value};
use snapshot_types::versioning::{
    CanonicalCellValue, SemanticObjectDigest, SemanticObjectKind, canonical_digest,
};
use value_types::CellValue;
use yrs::{Map, Out, Transact};

use crate::storage::{
    engine::YrsComputeEngine,
    infra::grid_helpers::{get_sheet_submap, sheet_id_to_hex},
    properties,
};

use super::{SemanticStateReadError, UNSUPPORTED_CELL_VALUES_DOMAIN, canonicalize_json_value};

const FORMULA_METADATA_CATEGORY: &str = "formula-metadata";
const RICH_STRING_CELL_KEY: &str = "rt";

#[derive(Clone, Debug, Default, Serialize)]
pub(super) struct CellValueProvenance {
    markers: BTreeMap<String, BTreeMap<String, Value>>,
}

impl CellValueProvenance {
    pub(super) fn is_empty(&self) -> bool {
        self.markers.is_empty()
    }

    pub(super) fn without_formula_metadata(&self) -> Self {
        let mut provenance = self.clone();
        provenance.markers.remove(FORMULA_METADATA_CATEGORY);
        provenance
    }

    fn insert_marker(&mut self, category: &str, key: &str, value: Value) {
        self.markers
            .entry(category.to_string())
            .or_default()
            .insert(key.to_string(), canonicalize_json_value(value));
    }

    fn categories(&self) -> impl Iterator<Item = &String> {
        self.markers.keys()
    }
}

pub(super) fn cell_value_provenance(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    cell_hex: &str,
    props: Option<&properties::CellProperties>,
) -> CellValueProvenance {
    let mut provenance = CellValueProvenance::default();
    record_property_value_provenance(props, &mut provenance);
    record_raw_cell_value_provenance(engine, sheet_id, cell_hex, &mut provenance);
    provenance
}

pub(super) fn canonical_cell_value(
    value: &CellValue,
    cell_key: &str,
    provenance: &CellValueProvenance,
    unsupported_values: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<Option<CanonicalCellValue>, SemanticStateReadError> {
    if !provenance.is_empty() {
        return ambiguous_cell_value(value, cell_key, provenance, unsupported_values);
    }

    let (value_kind, canonical_value) = match value {
        CellValue::Null => return Ok(None),
        CellValue::Number(number) => (
            "number".to_string(),
            Some(Value::Number(
                Number::from_f64(number.get()).expect("FiniteF64 produces JSON-safe number"),
            )),
        ),
        CellValue::Text(text) => ("text".to_string(), Some(Value::String(text.to_string()))),
        CellValue::Boolean(value) => ("boolean".to_string(), Some(Value::Bool(*value))),
        CellValue::Error(error, _) => ("error".to_string(), Some(Value::String(error.to_string()))),
        CellValue::Array(_) => {
            return opaque_cell_value(cell_key, "array", value, unsupported_values);
        }
        CellValue::Control(_) => {
            return opaque_cell_value(cell_key, "control", value, unsupported_values);
        }
        CellValue::Image(_) => {
            return opaque_cell_value(cell_key, "image", value, unsupported_values);
        }
    };

    Ok(Some(CanonicalCellValue {
        value_kind,
        canonical_value,
        digest: None,
    }))
}

fn record_property_value_provenance(
    props: Option<&properties::CellProperties>,
    provenance: &mut CellValueProvenance,
) {
    let Some(props) = props else {
        return;
    };

    if let Some(value) = &props.provenance {
        provenance.insert_marker(
            "value-provenance-sidecar",
            "provenance",
            Value::String(value.clone()),
        );
    }
    if let Some(value) = &props.connection_id {
        provenance.insert_marker(
            "value-provenance-sidecar",
            "connectionId",
            Value::String(value.clone()),
        );
    }
    if let Some(value) = props.cell_metadata_index {
        provenance.insert_marker(
            "unsupported-value-metadata",
            "cellMetadataIndex",
            Value::Number(Number::from(value)),
        );
    }
    if let Some(value) = props.vm {
        provenance.insert_marker(
            "unsupported-value-metadata",
            "valueMetadataIndex",
            Value::Number(Number::from(value)),
        );
    }
    if props.phonetic {
        provenance.insert_marker("rich-value-metadata", "phonetic", Value::Bool(true));
    }
    if let Some(value) = &props.date_lexical_value {
        provenance.insert_marker(
            "preservation-sidecar",
            "dateLexicalValue",
            Value::String(value.clone()),
        );
    }
    if let Some(value) = props.formula_result_type {
        provenance.insert_marker(
            FORMULA_METADATA_CATEGORY,
            "formulaResultType",
            Value::Number(Number::from(value)),
        );
    }
    if props.has_empty_cached_value {
        provenance.insert_marker(
            FORMULA_METADATA_CATEGORY,
            "hasEmptyCachedValue",
            Value::Bool(true),
        );
    }
    let formula_cache_provenance_value = if props.formula_cache_provenance.is_absent_or_unknown() {
        None
    } else {
        serde_json::to_value(&props.formula_cache_provenance).ok()
    };
    if let Some(value) = formula_cache_provenance_value {
        provenance.insert_marker(FORMULA_METADATA_CATEGORY, "formulaCacheProvenance", value);
    }
    if let Some(value) = props.original_sst_index {
        provenance.insert_marker(
            "preservation-sidecar",
            "sstIndex",
            Value::Number(Number::from(value)),
        );
    }
    if let Some(value) = &props.original_value {
        provenance.insert_marker(
            "preservation-sidecar",
            "originalValue",
            Value::String(value.clone()),
        );
    }
    if props.is_array_formula {
        provenance.insert_marker("array-marker", "isArrayFormula", Value::Bool(true));
    }
    if props.is_cse_anchor {
        provenance.insert_marker("array-marker", "isCseAnchor", Value::Bool(true));
    }
}

fn record_raw_cell_value_provenance(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    cell_hex: &str,
    provenance: &mut CellValueProvenance,
) {
    let sheets = engine.storage().sheets_ref();
    let txn = engine.storage().doc().transact();
    let sheet_hex = sheet_id_to_hex(sheet_id);
    let Some(cells_map) = get_sheet_submap(&txn, &sheets, &sheet_hex, KEY_CELLS) else {
        return;
    };
    let Some(Out::YMap(cell_map)) = cells_map.get(&txn, cell_hex) else {
        return;
    };

    for key in [
        KEY_FORMULA,
        KEY_FORMULA_TEMPLATE,
        KEY_FORMULA_REFS,
        KEY_FORMULA_DYNAMIC_ARRAY,
        KEY_FORMULA_VOLATILE,
        KEY_FORMULA_AGGREGATE,
        KEY_FORMULA_METADATA,
    ] {
        if let Some(value) = raw_cell_marker_value(&cell_map, &txn, key) {
            provenance.insert_marker(FORMULA_METADATA_CATEGORY, key, value);
        }
    }
    if let Some(value) = raw_cell_marker_value(&cell_map, &txn, KEY_ARRAY_REF) {
        provenance.insert_marker("array-marker", KEY_ARRAY_REF, value);
    }
    if let Some(value) = raw_cell_marker_value(&cell_map, &txn, RICH_STRING_CELL_KEY) {
        provenance.insert_marker("rich-value-metadata", RICH_STRING_CELL_KEY, value);
    }
}

fn raw_cell_marker_value<T: yrs::ReadTxn>(
    cell_map: &yrs::MapRef,
    txn: &T,
    key: &str,
) -> Option<Value> {
    cell_map.get(txn, key).map(|value| match value {
        Out::Any(any) => Value::String(format!("{any:?}")),
        Out::YText(_) => Value::String("ytext".to_string()),
        Out::YArray(_) => Value::String("yarray".to_string()),
        Out::YMap(_) => Value::String("ymap".to_string()),
        Out::YXmlElement(_) => Value::String("yxml-element".to_string()),
        Out::YXmlFragment(_) => Value::String("yxml-fragment".to_string()),
        Out::YXmlText(_) => Value::String("yxml-text".to_string()),
        Out::YDoc(_) => Value::String("ydoc".to_string()),
        Out::UndefinedRef(_) => Value::String("undefined-ref".to_string()),
    })
}

pub(super) fn ambiguous_cell_value(
    value: &CellValue,
    cell_key: &str,
    provenance: &CellValueProvenance,
    unsupported_values: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<Option<CanonicalCellValue>, SemanticStateReadError> {
    if provenance.is_empty() {
        return Ok(None);
    }

    let digest = ambiguous_cell_value_digest(cell_key, value, provenance)?;
    for category in provenance.categories() {
        let object_id = format!("{cell_key}:unsupported:ambiguous-value-provenance:{category}");
        unsupported_values.insert(
            object_id.clone(),
            SemanticObjectDigest {
                object_id,
                object_kind: SemanticObjectKind::CellValue,
                domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
                digest: digest.clone(),
            },
        );
    }

    Ok(Some(CanonicalCellValue {
        value_kind: "unsupported:ambiguous-value-provenance".to_string(),
        canonical_value: None,
        digest: Some(digest),
    }))
}

fn opaque_cell_value(
    cell_key: &str,
    value_kind: &str,
    value: &CellValue,
    unsupported_values: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<Option<CanonicalCellValue>, SemanticStateReadError> {
    let digest = canonical_digest(value)?;
    unsupported_values.insert(
        format!("{cell_key}:unsupported:{value_kind}"),
        SemanticObjectDigest {
            object_id: format!("{cell_key}:unsupported:{value_kind}"),
            object_kind: SemanticObjectKind::CellValue,
            domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
            digest: digest.clone(),
        },
    );
    Ok(Some(CanonicalCellValue {
        value_kind: format!("unsupported:{value_kind}"),
        canonical_value: None,
        digest: Some(digest),
    }))
}

pub(super) fn opaque_cell_value_provenance_digest(
    cell_key: &str,
    value: &CellValue,
    provenance: &CellValueProvenance,
) -> Result<SemanticObjectDigest, SemanticStateReadError> {
    Ok(SemanticObjectDigest {
        object_id: format!("{cell_key}:unsupported:ambiguous-value-provenance"),
        object_kind: SemanticObjectKind::CellValue,
        domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
        digest: ambiguous_cell_value_digest(cell_key, value, provenance)?,
    })
}

fn ambiguous_cell_value_digest(
    cell_key: &str,
    value: &CellValue,
    provenance: &CellValueProvenance,
) -> Result<snapshot_types::versioning::ObjectDigest, SemanticStateReadError> {
    Ok(canonical_digest(&serde_json::json!({
        "cellId": cell_key,
        "value": value,
        "provenance": provenance,
    }))?)
}
