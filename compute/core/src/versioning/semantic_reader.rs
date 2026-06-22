use std::collections::BTreeMap;

use serde_json::{Number, Value};
use snapshot_types::versioning::{
    CanonicalCellValue, CanonicalFormula, SemanticCellState, SemanticDomainState,
    SemanticObjectDigest, SemanticObjectKind, SemanticSheetState, SemanticWorkbookState,
    VersionDomainCapabilityState, VersionDomainClass, canonical_digest,
};
use value_types::CellValue;

use crate::storage::engine::YrsComputeEngine;

use super::{SemanticStateReadError, SemanticWorkbookStateReader};

const AUTHORED_GRID_DOMAIN: &str = "authored-grid";
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

    let mut unsupported_values = BTreeMap::new();
    for sheet_id in engine.storage().sheet_order() {
        let Some(sheet) = engine.mirror().get_sheet(&sheet_id) else {
            continue;
        };
        let sheet_key = sheet_id.to_uuid_string();
        let mut sheet_state = SemanticSheetState {
            sheet_id: sheet_key.clone(),
            name: sheet.name.clone(),
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
            if entry.is_ghost() {
                continue;
            }
            let Some(pos) = sheet.position_for_diagnostics(cell_id) else {
                unsupported_values.insert(
                    format!("cell:{}:{}", sheet_key, cell_id.to_uuid_string()),
                    opaque_cell_digest(&sheet_key, cell_id, "missing-position", &entry.value)?,
                );
                continue;
            };

            let cell_key = format!("cell:{}:{}", sheet_key, cell_id.to_uuid_string());
            let value = canonical_cell_value(&entry.value, &cell_key, &mut unsupported_values)?;
            let formula = entry.formula.as_deref().map(|formula| CanonicalFormula {
                normalized_formula: formula.template.clone(),
                dependency_object_ids: formula
                    .refs
                    .iter()
                    .enumerate()
                    .map(|(index, _)| format!("{cell_key}:ref:{index}"))
                    .collect(),
                volatile: formula.is_volatile,
                digest: None,
            });

            sheet_state.cells.insert(
                cell_key.clone(),
                SemanticCellState {
                    object_id: cell_key,
                    sheet_id: sheet_key.clone(),
                    row: pos.row(),
                    column: pos.col(),
                    value,
                    formula,
                    direct_format: None,
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

    Ok(state)
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

#[cfg(test)]
mod tests {
    use snapshot_types::versioning::{
        SemanticDiagnosticSeverity, SemanticDomainCoverageStatus, semantic_workbook_state_digest,
    };
    use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
    use value_types::{CellValue, FiniteF64};

    use crate::storage::engine::YrsComputeEngine;
    use crate::versioning::{
        SemanticWorkbookStateReader, coverage_for_states, diff_semantic_workbook_states,
    };

    fn workbook(cells: Vec<CellData>) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells,
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: FiniteF64::must(0.001),
            calculation_settings: None,
        }
    }

    fn cell(id_suffix: u32, row: u32, col: u32, value: CellValue) -> CellData {
        CellData {
            cell_id: format!("550e8400-e29b-41d4-a716-44665544{id_suffix:04}"),
            row,
            col,
            value,
            formula: None,
            identity_formula: None,
            array_ref: None,
        }
    }

    #[test]
    fn engine_semantic_reader_reads_ordered_authored_cells() {
        let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![
            cell(2, 1, 1, CellValue::from("beta")),
            cell(1, 0, 0, CellValue::number(42.0)),
        ]))
        .expect("engine");

        let state = engine.read_semantic_workbook_state().expect("state");
        let sheet = state
            .sheets
            .get("550e8400e29b41d4a716446655440000")
            .expect("sheet");
        let cell_ids: Vec<_> = sheet.cells.keys().cloned().collect();

        assert_eq!(
            cell_ids,
            vec![
                "cell:550e8400e29b41d4a716446655440000:550e8400e29b41d4a716446655440001",
                "cell:550e8400e29b41d4a716446655440000:550e8400e29b41d4a716446655440002",
            ]
        );
        assert_eq!(
            sheet.cells[&cell_ids[0]]
                .value
                .as_ref()
                .and_then(|value| value.canonical_value.as_ref()),
            Some(&serde_json::json!(42.0))
        );
        assert_eq!(
            sheet.cells[&cell_ids[1]]
                .value
                .as_ref()
                .and_then(|value| value.canonical_value.as_ref()),
            Some(&serde_json::json!("beta"))
        );
    }

    #[test]
    fn engine_semantic_reader_digest_changes_for_authored_cell_edit() {
        let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![cell(
            1,
            0,
            0,
            CellValue::from("alpha"),
        )]))
        .expect("before");
        let (after, _) =
            YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("beta"))]))
                .expect("after");
        let before_state = before.read_semantic_workbook_state().expect("before state");
        let after_state = after.read_semantic_workbook_state().expect("after state");

        assert_ne!(
            semantic_workbook_state_digest(&before_state).expect("before digest"),
            semantic_workbook_state_digest(&after_state).expect("after digest")
        );
        let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
        assert!(diff.changes.iter().any(|change| {
            change.kind == snapshot_types::versioning::SemanticChangeKind::Updated
                && change.object_kind == snapshot_types::versioning::SemanticObjectKind::Cell
        }));
    }

    #[test]
    fn engine_semantic_reader_marks_unsupported_arrays_opaque_blocking() {
        let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![cell(
            1,
            0,
            0,
            CellValue::array(vec![CellValue::number(1.0), CellValue::number(2.0)], 2),
        )]))
        .expect("engine");
        let state = engine.read_semantic_workbook_state().expect("state");
        let unsupported = state
            .domains
            .get(super::UNSUPPORTED_CELL_VALUES_DOMAIN)
            .expect("unsupported domain");

        assert_eq!(
            unsupported.capability_state,
            snapshot_types::versioning::VersionDomainCapabilityState::OpaqueBlocking
        );
        let coverage = coverage_for_states(&state, &state);
        let unsupported_coverage = coverage
            .iter()
            .find(|entry| entry.domain_id == super::UNSUPPORTED_CELL_VALUES_DOMAIN)
            .expect("unsupported coverage");
        assert_eq!(
            unsupported_coverage.status,
            SemanticDomainCoverageStatus::OpaqueBlocking
        );
        assert_eq!(
            unsupported_coverage.diagnostics[0].severity,
            SemanticDiagnosticSeverity::Error
        );
    }
}
