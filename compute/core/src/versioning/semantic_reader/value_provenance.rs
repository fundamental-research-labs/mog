use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Number, Value};
use snapshot_types::versioning::{
    CanonicalCellValue, SemanticObjectDigest, SemanticObjectKind, canonical_digest,
};
use value_types::CellValue;

use crate::storage::{engine::ComputeEngine, properties};

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
    engine: &ComputeEngine,
    _sheet_id: &cell_types::SheetId,
    cell_hex: &str,
    props: Option<&properties::CellProperties>,
) -> CellValueProvenance {
    let mut provenance = CellValueProvenance::default();
    record_property_value_provenance(props, &mut provenance);
    record_native_cell_value_provenance(engine, cell_hex, &mut provenance);
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

fn record_native_cell_value_provenance(
    engine: &ComputeEngine,
    cell_hex: &str,
    provenance: &mut CellValueProvenance,
) {
    let Ok(cell_id) = cell_types::CellId::from_uuid_str(cell_hex) else {
        return;
    };
    if let Some(formula) = engine.cell_store().get_formula(&cell_id) {
        provenance.insert_marker(
            FORMULA_METADATA_CATEGORY,
            "identityFormula",
            serde_json::to_value(formula).expect("typed formula serializes"),
        );
    } else if let Some(formula) = engine.compute().get_formula(&cell_id) {
        provenance.insert_marker(
            FORMULA_METADATA_CATEGORY,
            "formula",
            Value::String(formula.to_string()),
        );
    }
    let Some(metadata) = engine.storage().cell_metadata(&cell_id) else {
        return;
    };
    if let Some(formula) = &metadata.formula {
        provenance.insert_marker(
            FORMULA_METADATA_CATEGORY,
            "formulaMetadata",
            serde_json::to_value(formula).expect("typed formula metadata serializes"),
        );
    }
    if let Some(array_ref) = &metadata.array_ref {
        provenance.insert_marker("array-marker", "arrayRef", Value::String(array_ref.clone()));
    }
    if let Some(rich_string) = &metadata.rich_string {
        provenance.insert_marker(
            "rich-value-metadata",
            RICH_STRING_CELL_KEY,
            serde_json::to_value(rich_string).expect("typed rich string serializes"),
        );
    }
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
