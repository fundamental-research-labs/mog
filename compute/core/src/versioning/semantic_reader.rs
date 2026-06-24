use std::collections::{BTreeMap, BTreeSet};

use compute_document::hex::{id_to_hex, parse_cell_id};
use serde_json::{Number, Value};
use snapshot_types::versioning::{
    CanonicalDirectFormat, SemanticCellState, SemanticColumnState, SemanticDomainState,
    SemanticObjectDigest, SemanticObjectKind, SemanticRowState, SemanticSheetState,
    SemanticWorkbookState, VersionDomainCapabilityState, VersionDomainClass, canonical_digest,
};
use value_types::CellValue;

use crate::storage::{
    engine::YrsComputeEngine,
    properties,
    sheet::{dimensions, floating_objects},
    workbook::named_ranges,
};

use super::coverage::{
    CONDITIONAL_FORMATTING_DOMAIN, DATA_VALIDATION_DOMAIN, SCHEMA_COVERAGE_DOMAIN,
    UNCLASSIFIED_SCHEMA_KEYS_DOMAIN, record_conditional_formatting_presence,
    record_data_validation_presence, semantic_coverage_record_objects,
    unclassified_schema_key_objects,
};
use super::formula_reader::{
    UNSUPPORTED_CELL_FORMULAS_DOMAIN, canonical_formula, canonical_formula_ref,
    canonical_formula_ref_object_ids, record_unrepresented_persisted_formula,
};
use super::semantic_ids::{
    canonical_cell_key, canonical_column_key, canonical_row_key, canonical_sheet_key,
};
use super::{
    CELL_FORMULAS_DOMAIN, CELL_VALUES_DOMAIN, CHARTS_DOMAIN, DIRECT_FORMATS_DOMAIN,
    FLOATING_OBJECTS_DOMAIN, NAMED_RANGES_DOMAIN, ROWS_COLUMNS_DOMAIN, SHEETS_DOMAIN,
    SemanticStateReadError, SemanticWorkbookStateReader,
};
use value_provenance::{
    ambiguous_cell_value, canonical_cell_value, cell_value_provenance,
    opaque_cell_value_provenance_digest,
};

mod value_provenance;

const UNSUPPORTED_CELL_VALUES_DOMAIN: &str = "unsupported-cell-values";

impl SemanticWorkbookStateReader for YrsComputeEngine {
    fn read_semantic_workbook_state(
        &self,
    ) -> Result<SemanticWorkbookState, SemanticStateReadError> {
        read_engine_semantic_workbook_state(self)
    }
}

pub fn read_engine_semantic_workbook_state(
    engine: &YrsComputeEngine,
) -> Result<SemanticWorkbookState, SemanticStateReadError> {
    let mut state = SemanticWorkbookState::default();
    for domain_id in [
        SHEETS_DOMAIN,
        ROWS_COLUMNS_DOMAIN,
        CELL_VALUES_DOMAIN,
        CELL_FORMULAS_DOMAIN,
        DIRECT_FORMATS_DOMAIN,
        NAMED_RANGES_DOMAIN,
    ] {
        state.domains.insert(
            domain_id.to_string(),
            SemanticDomainState {
                domain_id: domain_id.to_string(),
                domain_class: VersionDomainClass::Authored,
                capability_state: VersionDomainCapabilityState::Supported,
                objects: BTreeMap::new(),
            },
        );
    }

    state.domains.insert(
        SCHEMA_COVERAGE_DOMAIN.to_string(),
        SemanticDomainState {
            domain_id: SCHEMA_COVERAGE_DOMAIN.to_string(),
            domain_class: VersionDomainClass::Derived,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: semantic_coverage_record_objects()?,
        },
    );

    let mut unsupported_values = BTreeMap::new();
    let mut unsupported_formulas = BTreeMap::new();
    let unclassified_schema_keys = unclassified_schema_key_objects(engine)?;
    let mut data_validation_presence = BTreeMap::new();
    let mut conditional_formatting_presence = BTreeMap::new();
    let sheet_order = engine.storage().sheet_order();
    let sheet_keys: Vec<_> = sheet_order
        .iter()
        .enumerate()
        .map(|(sheet_index, sheet_id)| (*sheet_id, canonical_sheet_key(sheet_index)))
        .collect();
    for (sheet_index, sheet_id) in sheet_order.into_iter().enumerate() {
        let Some(sheet) = engine.mirror().get_sheet(&sheet_id) else {
            continue;
        };
        let sheet_key = canonical_sheet_key(sheet_index);
        let (row_count, column_count) = engine
            .grid_index(&sheet_id)
            .map(|grid| (grid.row_count(), grid.col_count()))
            .unwrap_or((0, 0));
        let mut sheet_state = SemanticSheetState {
            sheet_id: sheet_key.clone(),
            name: sheet.name.clone(),
            row_count,
            column_count,
            rows: canonical_rows(engine, &sheet_id, &sheet_key, row_count),
            columns: canonical_columns(engine, &sheet_id, &sheet_key, column_count),
            cells: BTreeMap::new(),
            digest: None,
        };

        let mut cells: Vec<_> = sheet.cells_iter().collect();
        cells.sort_by_key(|(cell_id, _)| {
            let pos = sheet.position_for_diagnostics(cell_id);
            (
                pos.map_or(u32::MAX, |pos| pos.row()),
                pos.map_or(u32::MAX, |pos| pos.col()),
                cell_id.as_u128(),
            )
        });

        for (cell_id, entry) in cells {
            let cell_hex = id_to_hex(cell_id.as_u128());
            let has_persisted_formula = engine
                .storage()
                .read_cell_from_yrs(&sheet_id, cell_id)
                .is_some_and(|(_, legacy_formula, identity_formula)| {
                    legacy_formula.is_some() || identity_formula.is_some()
                });
            let cell_properties = properties::get_properties(
                engine.storage().doc(),
                engine.storage().workbook_map(),
                engine.storage().sheets(),
                &sheet_id,
                &cell_hex,
            );
            let value_provenance =
                cell_value_provenance(engine, &sheet_id, &cell_hex, cell_properties.as_ref());
            let direct_format = cell_properties
                .as_ref()
                .and_then(|props| props.format.clone())
                .map(canonical_direct_format)
                .transpose()?;
            if entry.is_ghost()
                && direct_format.is_none()
                && !has_persisted_formula
                && value_provenance.is_empty()
            {
                continue;
            }
            let Some(pos) = sheet.position_for_diagnostics(cell_id) else {
                unsupported_values.insert(
                    format!("cell:{}:{}", sheet_key, cell_id.to_uuid_string()),
                    opaque_cell_digest(&sheet_key, cell_id, "missing-position", &entry.value)?,
                );
                continue;
            };

            let cell_key = canonical_cell_key(&sheet_key, pos.row(), pos.col());
            let formula = entry
                .formula
                .as_deref()
                .map(|formula| {
                    canonical_formula(
                        engine,
                        &sheet_keys,
                        &sheet_id,
                        &cell_key,
                        cell_id,
                        formula,
                        &mut unsupported_formulas,
                    )
                })
                .transpose()?;
            let value_provenance = if formula.is_some() {
                value_provenance.without_formula_metadata()
            } else {
                value_provenance
            };
            let value = canonical_cell_value(
                &entry.value,
                &cell_key,
                &value_provenance,
                &mut unsupported_values,
            )?;
            if formula.is_none() && has_persisted_formula {
                record_unrepresented_persisted_formula(
                    engine,
                    &sheet_id,
                    &cell_key,
                    cell_id,
                    &mut unsupported_formulas,
                )?;
            }

            sheet_state.cells.insert(
                cell_key.clone(),
                SemanticCellState {
                    object_id: cell_key,
                    sheet_id: sheet_key.clone(),
                    row: pos.row(),
                    column: pos.col(),
                    value,
                    formula,
                    direct_format,
                    digest: None,
                },
            );
        }

        for (cell_hex, props) in properties::iter_all_properties(
            engine.storage().doc(),
            engine.storage().workbook_map(),
            engine.storage().sheets(),
            &sheet_id,
        ) {
            let value_provenance =
                cell_value_provenance(engine, &sheet_id, &cell_hex, Some(&props));
            let Some(format) = props.format.clone() else {
                if value_provenance.is_empty() {
                    continue;
                }
                let Some(cell_id) = parse_cell_id(&cell_hex) else {
                    continue;
                };
                let Some((row, col)) = engine
                    .grid_index(&sheet_id)
                    .and_then(|grid| grid.cell_position(&cell_id))
                else {
                    unsupported_values.insert(
                        format!("cell:{sheet_key}:{cell_hex}:value-provenance:missing-position"),
                        opaque_cell_value_provenance_digest(
                            &format!("cell:{sheet_key}:{cell_hex}"),
                            &CellValue::Null,
                            &value_provenance,
                        )?,
                    );
                    continue;
                };
                let cell_key = canonical_cell_key(&sheet_key, row, col);
                if sheet_state.cells.contains_key(&cell_key) {
                    continue;
                }
                let value = ambiguous_cell_value(
                    &CellValue::Null,
                    &cell_key,
                    &value_provenance,
                    &mut unsupported_values,
                )?;
                sheet_state.cells.insert(
                    cell_key.clone(),
                    SemanticCellState {
                        object_id: cell_key,
                        sheet_id: sheet_key.clone(),
                        row,
                        column: col,
                        value,
                        formula: None,
                        direct_format: None,
                        digest: None,
                    },
                );
                continue;
            };
            let Some(cell_id) = parse_cell_id(&cell_hex) else {
                continue;
            };
            let Some((row, col)) = engine
                .grid_index(&sheet_id)
                .and_then(|grid| grid.cell_position(&cell_id))
            else {
                unsupported_values.insert(
                    format!(
                        "cell:{}:{}:direct-format:missing-position",
                        sheet_key, cell_hex
                    ),
                    opaque_direct_format_digest(
                        &sheet_key,
                        &cell_hex,
                        "missing-position",
                        &format,
                    )?,
                );
                continue;
            };

            let cell_key = canonical_cell_key(&sheet_key, row, col);
            if sheet_state.cells.contains_key(&cell_key) {
                continue;
            }

            let value = ambiguous_cell_value(
                &CellValue::Null,
                &cell_key,
                &value_provenance,
                &mut unsupported_values,
            )?;
            sheet_state.cells.insert(
                cell_key.clone(),
                SemanticCellState {
                    object_id: cell_key,
                    sheet_id: sheet_key.clone(),
                    row,
                    column: col,
                    value,
                    formula: None,
                    direct_format: Some(canonical_direct_format(format)?),
                    digest: None,
                },
            );
        }

        record_data_validation_presence(
            engine,
            &sheet_id,
            &sheet_key,
            &mut data_validation_presence,
        )?;
        record_conditional_formatting_presence(
            engine,
            &sheet_id,
            &sheet_key,
            &mut conditional_formatting_presence,
        )?;

        state.sheets.insert(sheet_key, sheet_state);
    }

    if let Some(domain) = state.domains.get_mut(NAMED_RANGES_DOMAIN) {
        domain.objects = canonical_named_ranges(engine, &sheet_keys)?;
    }
    let unsupported_floating_objects = canonical_floating_objects(engine, &sheet_keys)?;

    if !unsupported_values.is_empty() {
        state.domains.insert(
            UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
            SemanticDomainState {
                domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
                domain_class: VersionDomainClass::Authored,
                capability_state: VersionDomainCapabilityState::OpaqueBlocking,
                objects: unsupported_values,
            },
        );
    }
    if !unsupported_formulas.is_empty() {
        state.domains.insert(
            UNSUPPORTED_CELL_FORMULAS_DOMAIN.to_string(),
            SemanticDomainState {
                domain_id: UNSUPPORTED_CELL_FORMULAS_DOMAIN.to_string(),
                domain_class: VersionDomainClass::Authored,
                capability_state: VersionDomainCapabilityState::OpaqueBlocking,
                objects: unsupported_formulas,
            },
        );
    }
    insert_authored_opaque_blocking_domain(
        &mut state,
        DATA_VALIDATION_DOMAIN,
        data_validation_presence,
    );
    insert_authored_opaque_blocking_domain(
        &mut state,
        CONDITIONAL_FORMATTING_DOMAIN,
        conditional_formatting_presence,
    );
    insert_authored_opaque_blocking_domain(
        &mut state,
        UNCLASSIFIED_SCHEMA_KEYS_DOMAIN,
        unclassified_schema_keys,
    );
    if let Some((domain_id, domain_class, objects)) = unsupported_floating_objects.charts_domain() {
        state.domains.insert(
            domain_id.to_string(),
            SemanticDomainState {
                domain_id: domain_id.to_string(),
                domain_class,
                capability_state: VersionDomainCapabilityState::OpaqueBlocking,
                objects,
            },
        );
    }
    if let Some((domain_id, domain_class, objects)) =
        unsupported_floating_objects.floating_objects_domain()
    {
        state.domains.insert(
            domain_id.to_string(),
            SemanticDomainState {
                domain_id: domain_id.to_string(),
                domain_class,
                capability_state: VersionDomainCapabilityState::OpaqueBlocking,
                objects,
            },
        );
    }

    Ok(state)
}

fn insert_authored_opaque_blocking_domain(
    state: &mut SemanticWorkbookState,
    domain_id: &str,
    objects: BTreeMap<String, SemanticObjectDigest>,
) {
    if objects.is_empty() {
        return;
    }

    state.domains.insert(
        domain_id.to_string(),
        SemanticDomainState {
            domain_id: domain_id.to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::OpaqueBlocking,
            objects,
        },
    );
}

struct UnsupportedFloatingObjects {
    charts: BTreeMap<String, SemanticObjectDigest>,
    floating_objects: BTreeMap<String, SemanticObjectDigest>,
}

impl UnsupportedFloatingObjects {
    fn charts_domain(
        &self,
    ) -> Option<(
        &'static str,
        VersionDomainClass,
        BTreeMap<String, SemanticObjectDigest>,
    )> {
        if self.charts.is_empty() {
            return None;
        }
        Some((
            CHARTS_DOMAIN,
            VersionDomainClass::Authored,
            self.charts.clone(),
        ))
    }

    fn floating_objects_domain(
        &self,
    ) -> Option<(
        &'static str,
        VersionDomainClass,
        BTreeMap<String, SemanticObjectDigest>,
    )> {
        if self.floating_objects.is_empty() {
            return None;
        }
        Some((
            FLOATING_OBJECTS_DOMAIN,
            VersionDomainClass::Authored,
            self.floating_objects.clone(),
        ))
    }
}

fn canonical_floating_objects(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
) -> Result<UnsupportedFloatingObjects, SemanticStateReadError> {
    let mut unsupported = UnsupportedFloatingObjects {
        charts: BTreeMap::new(),
        floating_objects: BTreeMap::new(),
    };

    for (sheet_id, sheet_key) in sheet_keys {
        for (raw_object_id, object) in floating_objects::get_all_floating_objects(
            engine.storage().doc(),
            engine.storage().sheets(),
            sheet_id,
        ) {
            let object_type = object.get("type").and_then(Value::as_str);
            let (domain_id, object_id, objects) = if object_type == Some("chart") {
                (
                    CHARTS_DOMAIN,
                    format!("chart:{sheet_key}:{raw_object_id}"),
                    &mut unsupported.charts,
                )
            } else {
                (
                    FLOATING_OBJECTS_DOMAIN,
                    format!("floating-object:{sheet_key}:{raw_object_id}"),
                    &mut unsupported.floating_objects,
                )
            };
            let payload = canonicalize_json_value(serde_json::json!({
                "sheetId": sheet_key,
                "objectId": raw_object_id,
                "object": object,
            }));
            objects.insert(
                object_id.clone(),
                SemanticObjectDigest {
                    object_id,
                    object_kind: SemanticObjectKind::DomainAttachment,
                    domain_id: domain_id.to_string(),
                    digest: canonical_digest(&payload)?,
                },
            );
        }
    }

    Ok(unsupported)
}

fn canonical_named_ranges(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
) -> Result<BTreeMap<String, SemanticObjectDigest>, SemanticStateReadError> {
    let mut objects = BTreeMap::new();
    for defined_name in
        named_ranges::get_all_named_ranges(engine.storage().doc(), engine.storage().workbook_map())
    {
        let object_id = canonical_named_range_key(&defined_name, sheet_keys);
        let payload = canonical_named_range_payload(engine, sheet_keys, &defined_name);
        objects.insert(
            object_id.clone(),
            SemanticObjectDigest {
                object_id,
                object_kind: SemanticObjectKind::DomainAttachment,
                domain_id: NAMED_RANGES_DOMAIN.to_string(),
                digest: canonical_digest(&payload)?,
            },
        );
    }
    Ok(objects)
}

fn canonical_named_range_key(
    defined_name: &domain_types::DefinedName,
    sheet_keys: &[(cell_types::SheetId, String)],
) -> String {
    format!(
        "named-range:{}:{}",
        canonical_named_range_scope(defined_name.scope.as_deref(), sheet_keys),
        defined_name.name.to_uppercase()
    )
}

fn canonical_named_range_scope(
    scope: Option<&str>,
    sheet_keys: &[(cell_types::SheetId, String)],
) -> String {
    let Some(scope) = scope else {
        return "workbook".to_string();
    };
    if let Some(sheet_key) = cell_types::SheetId::from_uuid_str(scope)
        .ok()
        .and_then(|sheet_id| {
            sheet_keys
                .iter()
                .find(|(candidate_sheet_id, _)| candidate_sheet_id == &sheet_id)
                .map(|(_, sheet_key)| sheet_key.clone())
        })
    {
        return sheet_key;
    }
    format!("unresolved-sheet:{scope}")
}

fn canonical_named_range_payload(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
    defined_name: &domain_types::DefinedName,
) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("name".to_string(), Value::String(defined_name.name.clone()));
    payload.insert(
        "normalizedName".to_string(),
        Value::String(defined_name.name.to_uppercase()),
    );
    payload.insert(
        "scope".to_string(),
        Value::String(canonical_named_range_scope(
            defined_name.scope.as_deref(),
            sheet_keys,
        )),
    );
    payload.insert(
        "refersTo".to_string(),
        canonical_named_range_refers_to(engine, sheet_keys, defined_name),
    );
    insert_optional_string(&mut payload, "rawRefersTo", &defined_name.raw_refers_to);
    insert_optional_string(&mut payload, "comment", &defined_name.comment);
    insert_optional_string(&mut payload, "customMenu", &defined_name.custom_menu);
    insert_optional_string(&mut payload, "description", &defined_name.description);
    insert_optional_string(&mut payload, "help", &defined_name.help);
    insert_optional_string(&mut payload, "statusBar", &defined_name.status_bar);
    payload.insert("visible".to_string(), Value::Bool(defined_name.visible));
    payload.insert("xlm".to_string(), Value::Bool(defined_name.xlm));
    payload.insert("function".to_string(), Value::Bool(defined_name.function));
    payload.insert(
        "vbProcedure".to_string(),
        Value::Bool(defined_name.vb_procedure),
    );
    payload.insert(
        "publishToServer".to_string(),
        Value::Bool(defined_name.publish_to_server),
    );
    payload.insert(
        "workbookParameter".to_string(),
        Value::Bool(defined_name.workbook_parameter),
    );
    payload.insert(
        "xmlSpacePreserve".to_string(),
        Value::Bool(defined_name.xml_space_preserve),
    );
    if let Some(order) = defined_name.order {
        payload.insert("order".to_string(), Value::Number(Number::from(order)));
    }

    canonicalize_json_value(Value::Object(payload))
}

fn canonical_named_range_refers_to(
    engine: &YrsComputeEngine,
    sheet_keys: &[(cell_types::SheetId, String)],
    defined_name: &domain_types::DefinedName,
) -> Value {
    let Ok(identity_formula) =
        serde_json::from_str::<formula_types::IdentityFormula>(&defined_name.refers_to)
    else {
        return canonicalize_json_value(serde_json::json!({
            "kind": "raw",
            "formula": defined_name.refers_to,
        }));
    };

    let mut refs = Vec::with_capacity(identity_formula.refs.len());
    let mut dependency_object_ids = BTreeSet::new();
    let mut unsupported_refs = Vec::new();
    for (index, formula_ref) in identity_formula.refs.iter().enumerate() {
        match canonical_formula_ref(engine, sheet_keys, formula_ref) {
            Ok(canonical_ref) => {
                dependency_object_ids.extend(canonical_formula_ref_object_ids(&canonical_ref));
                refs.push(canonical_ref);
            }
            Err(reason) => unsupported_refs.push(serde_json::json!({
                "index": index,
                "reason": reason.code,
            })),
        }
    }

    let mut refers_to = serde_json::Map::new();
    refers_to.insert(
        "kind".to_string(),
        Value::String("identity-formula".to_string()),
    );
    refers_to.insert(
        "normalizedFormula".to_string(),
        Value::String(identity_formula.template),
    );
    refers_to.insert(
        "dependencyObjectIds".to_string(),
        Value::Array(
            dependency_object_ids
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    refers_to.insert(
        "refs".to_string(),
        serde_json::to_value(refs).unwrap_or_else(|_| Value::Array(Vec::new())),
    );
    refers_to.insert(
        "dynamicArray".to_string(),
        Value::Bool(identity_formula.is_dynamic_array),
    );
    refers_to.insert(
        "volatile".to_string(),
        Value::Bool(identity_formula.is_volatile),
    );
    refers_to.insert(
        "aggregate".to_string(),
        Value::Bool(identity_formula.is_aggregate),
    );
    if !unsupported_refs.is_empty() {
        refers_to.insert(
            "unsupportedRefs".to_string(),
            Value::Array(unsupported_refs),
        );
    }

    canonicalize_json_value(Value::Object(refers_to))
}

fn insert_optional_string(
    payload: &mut serde_json::Map<String, Value>,
    key: &str,
    value: &Option<String>,
) {
    if let Some(value) = value {
        payload.insert(key.to_string(), Value::String(value.clone()));
    }
}

fn canonical_rows(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    row_count: u32,
) -> BTreeMap<String, SemanticRowState> {
    let mut rows = BTreeMap::new();
    let grid = engine.grid_index(sheet_id);

    for row in 0..row_count {
        let explicit_height_points = dimensions::get_row_height_explicit(
            engine.storage().doc(),
            engine.storage().sheets(),
            sheet_id,
            row,
            grid,
        )
        .map(|height| height.0);
        let visibility = dimensions::get_row_visibility_ownership(
            engine.storage().doc(),
            engine.storage().sheets(),
            sheet_id,
            row,
            grid,
        );
        let filter_hidden = !visibility.filter_owner_ids.is_empty();

        if explicit_height_points.is_none()
            && !visibility.effective_hidden
            && !visibility.manual
            && !visibility.structural
            && !filter_hidden
            && !visibility.cache_hidden_without_owner
        {
            continue;
        }

        let object_id = canonical_row_key(sheet_key, row);
        rows.insert(
            object_id.clone(),
            SemanticRowState {
                object_id,
                sheet_id: sheet_key.to_string(),
                index: row,
                ordinal: row,
                explicit_height_points,
                effective_hidden: visibility.effective_hidden,
                manual_hidden: visibility.manual,
                structural_hidden: visibility.structural,
                filter_hidden,
                cache_hidden_without_owner: visibility.cache_hidden_without_owner,
                digest: None,
            },
        );
    }

    rows
}

fn canonical_columns(
    engine: &YrsComputeEngine,
    sheet_id: &cell_types::SheetId,
    sheet_key: &str,
    column_count: u32,
) -> BTreeMap<String, SemanticColumnState> {
    let mut columns = BTreeMap::new();
    let grid = engine.grid_index(sheet_id);

    for column in 0..column_count {
        let explicit_width_chars = dimensions::get_col_width_explicit(
            engine.storage().doc(),
            engine.storage().sheets(),
            sheet_id,
            column,
            grid,
        )
        .map(|width| width.0);
        let hidden = dimensions::is_column_hidden(
            engine.storage().doc(),
            engine.storage().sheets(),
            sheet_id,
            column,
        );

        if explicit_width_chars.is_none() && !hidden {
            continue;
        }

        let object_id = canonical_column_key(sheet_key, column);
        columns.insert(
            object_id.clone(),
            SemanticColumnState {
                object_id,
                sheet_id: sheet_key.to_string(),
                index: column,
                ordinal: column,
                explicit_width_chars,
                hidden,
                digest: None,
            },
        );
    }

    columns
}

fn canonical_direct_format(
    format: domain_types::CellFormat,
) -> Result<CanonicalDirectFormat, SemanticStateReadError> {
    let value = canonicalize_json_value(serde_json::to_value(format)?);
    let properties = match value {
        Value::Object(properties) => properties.into_iter().collect(),
        _ => BTreeMap::new(),
    };

    Ok(CanonicalDirectFormat {
        properties,
        digest: None,
    })
}

fn canonicalize_json_value(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(canonicalize_json_value)
                .collect::<Vec<_>>(),
        ),
        Value::Object(map) => {
            let mut entries = map.into_iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));

            let mut sorted = serde_json::Map::new();
            for (key, value) in entries {
                sorted.insert(key, canonicalize_json_value(value));
            }
            Value::Object(sorted)
        }
        scalar => scalar,
    }
}

fn opaque_cell_digest(
    sheet_key: &str,
    cell_id: &cell_types::CellId,
    reason: &str,
    value: &CellValue,
) -> Result<SemanticObjectDigest, SemanticStateReadError> {
    Ok(SemanticObjectDigest {
        object_id: format!(
            "cell:{}:{}:unsupported:{}",
            sheet_key,
            cell_id.to_uuid_string(),
            reason
        ),
        object_kind: SemanticObjectKind::Cell,
        domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
        digest: canonical_digest(&(reason, value))?,
    })
}

fn opaque_direct_format_digest(
    sheet_key: &str,
    cell_hex: &str,
    reason: &str,
    format: &domain_types::CellFormat,
) -> Result<SemanticObjectDigest, SemanticStateReadError> {
    Ok(SemanticObjectDigest {
        object_id: format!("cell:{sheet_key}:{cell_hex}:direct-format:unsupported:{reason}"),
        object_kind: SemanticObjectKind::Cell,
        domain_id: UNSUPPORTED_CELL_VALUES_DOMAIN.to_string(),
        digest: canonical_digest(&(reason, format))?,
    })
}

#[cfg(test)]
mod tests;
