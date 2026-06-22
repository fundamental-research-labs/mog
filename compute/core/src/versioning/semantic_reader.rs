use std::collections::BTreeMap;

use compute_document::hex::{id_to_hex, parse_cell_id};
use serde_json::{Number, Value};
use snapshot_types::versioning::{
    canonical_digest, CanonicalCellValue, CanonicalDirectFormat, SemanticCellState,
    SemanticColumnState, SemanticDomainState, SemanticObjectDigest, SemanticObjectKind,
    SemanticRowState, SemanticSheetState, SemanticWorkbookState, VersionDomainCapabilityState,
    VersionDomainClass,
};
use value_types::CellValue;

use crate::storage::{engine::YrsComputeEngine, properties, sheet::dimensions};

use super::formula_reader::{
    canonical_formula, record_unrepresented_persisted_formula, UNSUPPORTED_CELL_FORMULAS_DOMAIN,
};
use super::semantic_ids::{
    canonical_cell_key, canonical_column_key, canonical_row_key, canonical_sheet_key,
};
use super::{SemanticStateReadError, SemanticWorkbookStateReader};

const AUTHORED_GRID_DOMAIN: &str = "authored-grid";
const CELL_FORMULAS_DOMAIN: &str = "cells.formulas";
const ROWS_COLUMNS_DOMAIN: &str = "rows-columns";
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
    state.domains.insert(
        AUTHORED_GRID_DOMAIN.to_string(),
        SemanticDomainState {
            domain_id: AUTHORED_GRID_DOMAIN.to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: BTreeMap::new(),
        },
    );
    state.domains.insert(
        ROWS_COLUMNS_DOMAIN.to_string(),
        SemanticDomainState {
            domain_id: ROWS_COLUMNS_DOMAIN.to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: BTreeMap::new(),
        },
    );
    state.domains.insert(
        CELL_FORMULAS_DOMAIN.to_string(),
        SemanticDomainState {
            domain_id: CELL_FORMULAS_DOMAIN.to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: BTreeMap::new(),
        },
    );

    let mut unsupported_values = BTreeMap::new();
    let mut unsupported_formulas = BTreeMap::new();
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
            let direct_format = properties::get_cell_format(
                engine.storage().doc(),
                engine.storage().workbook_map(),
                engine.storage().sheets(),
                &sheet_id,
                &cell_hex,
            )
            .map(canonical_direct_format)
            .transpose()?;
            if entry.is_ghost() && direct_format.is_none() && !has_persisted_formula {
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
            let value = canonical_cell_value(&entry.value, &cell_key, &mut unsupported_values)?;
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
            let Some(format) = props.format else {
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

            sheet_state.cells.insert(
                cell_key.clone(),
                SemanticCellState {
                    object_id: cell_key,
                    sheet_id: sheet_key.clone(),
                    row,
                    column: col,
                    value: None,
                    formula: None,
                    direct_format: Some(canonical_direct_format(format)?),
                    digest: None,
                },
            );
        }

        state.sheets.insert(sheet_key, sheet_state);
    }

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

    Ok(state)
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

fn canonical_cell_value(
    value: &CellValue,
    cell_key: &str,
    unsupported_values: &mut BTreeMap<String, SemanticObjectDigest>,
) -> Result<Option<CanonicalCellValue>, SemanticStateReadError> {
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
