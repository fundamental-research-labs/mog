use std::collections::BTreeMap;

use compute_document::hex::{id_to_hex, parse_cell_id};
use serde_json::{Number, Value};
use snapshot_types::versioning::{
    canonical_digest, CanonicalCellValue, CanonicalDirectFormat, CanonicalFormula,
    SemanticCellState, SemanticColumnState, SemanticDomainState, SemanticObjectDigest,
    SemanticObjectKind, SemanticRowState, SemanticSheetState, SemanticWorkbookState,
    VersionDomainCapabilityState, VersionDomainClass,
};
use value_types::CellValue;

use crate::storage::{engine::YrsComputeEngine, properties, sheet::dimensions};

use super::{SemanticStateReadError, SemanticWorkbookStateReader};

const AUTHORED_GRID_DOMAIN: &str = "authored-grid";
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

    let mut unsupported_values = BTreeMap::new();
    for (sheet_index, sheet_id) in engine.storage().sheet_order().into_iter().enumerate() {
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
            let direct_format = properties::get_cell_format(
                engine.storage().doc(),
                engine.storage().workbook_map(),
                engine.storage().sheets(),
                &sheet_id,
                &cell_hex,
            )
            .map(canonical_direct_format)
            .transpose()?;
            if entry.is_ghost() && direct_format.is_none() {
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

    Ok(state)
}

fn canonical_sheet_key(sheet_index: usize) -> String {
    format!("sheet#{sheet_index}")
}

fn canonical_cell_key(sheet_key: &str, row: u32, column: u32) -> String {
    format!("cell:{sheet_key}:r{row}:c{column}")
}

fn canonical_row_key(sheet_key: &str, row: u32) -> String {
    format!("row:{sheet_key}:r{row}")
}

fn canonical_column_key(sheet_key: &str, column: u32) -> String {
    format!("column:{sheet_key}:c{column}")
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
mod tests {
    use cell_types::CellId;
    use domain_types::CellFormat;
    use formula_types::StructureChange;
    use snapshot_types::versioning::{
        semantic_workbook_state_digest, SemanticChangeKind, SemanticDiagnosticSeverity,
        SemanticDomainCoverageStatus, SemanticObjectKind,
    };
    use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
    use value_types::{CellValue, FiniteF64};

    use crate::storage::engine::YrsComputeEngine;
    use crate::versioning::{
        coverage_for_states, diff_semantic_workbook_states, SemanticWorkbookStateReader,
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
        let sheet = state.sheets.get("sheet#0").expect("sheet");
        let cell_ids: Vec<_> = sheet.cells.keys().cloned().collect();

        assert_eq!(cell_ids, vec!["cell:sheet#0:r0:c0", "cell:sheet#0:r1:c1"]);
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
    fn engine_semantic_reader_reads_row_column_axis_counts() {
        let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");

        let state = engine.read_semantic_workbook_state().expect("state");
        let sheet = state.sheets.get("sheet#0").expect("sheet");

        assert_eq!(sheet.row_count, 10);
        assert_eq!(sheet.column_count, 10);
        assert!(sheet.rows.is_empty());
        assert!(sheet.columns.is_empty());
    }

    #[test]
    fn engine_semantic_reader_reads_axis_dimensions_and_hidden_state() {
        let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("before");
        let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("after");

        let sheet_id = after.storage().sheet_order()[0];
        after
            .set_row_height(&sheet_id, 2, 40.0)
            .expect("set row height");
        after.hide_rows(&sheet_id, &[2]).expect("hide row");
        after
            .set_col_width_chars(&sheet_id, 3, 12.5)
            .expect("set column width");
        after.hide_columns(&sheet_id, &[3]).expect("hide column");

        let before_state = before.read_semantic_workbook_state().expect("before state");
        let after_state = after.read_semantic_workbook_state().expect("after state");
        let sheet = after_state.sheets.get("sheet#0").expect("sheet");
        let row = sheet.rows.get("row:sheet#0:r2").expect("row");
        let column = sheet.columns.get("column:sheet#0:c3").expect("column");

        assert_eq!(row.index, 2);
        assert_eq!(row.ordinal, 2);
        assert!(row.explicit_height_points.expect("height") > 0.0);
        assert!(row.effective_hidden);
        assert!(row.manual_hidden);
        assert!(!row.structural_hidden);
        assert!(!row.filter_hidden);
        assert!(!row.cache_hidden_without_owner);
        assert_eq!(column.index, 3);
        assert_eq!(column.ordinal, 3);
        assert_eq!(column.explicit_width_chars, Some(12.5));
        assert!(column.hidden);

        let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
        assert!(diff.changes.iter().any(|change| {
            change.kind == SemanticChangeKind::Added
                && change.object_kind == SemanticObjectKind::Row
                && change.object_id == "row:sheet#0:r2"
        }));
        assert!(diff.changes.iter().any(|change| {
            change.kind == SemanticChangeKind::Added
                && change.object_kind == SemanticObjectKind::Column
                && change.object_id == "column:sheet#0:c3"
        }));
    }

    #[test]
    fn engine_semantic_reader_digest_changes_for_row_insert() {
        let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("before");
        let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("after");

        let sheet_id = after.storage().sheet_order()[0];
        after
            .structure_change(
                &sheet_id,
                &StructureChange::InsertRows {
                    at: 1,
                    count: 2,
                    new_row_ids: vec![],
                },
            )
            .expect("insert rows");

        let before_state = before.read_semantic_workbook_state().expect("before state");
        let after_state = after.read_semantic_workbook_state().expect("after state");

        assert_eq!(before_state.sheets["sheet#0"].row_count, 10);
        assert_eq!(after_state.sheets["sheet#0"].row_count, 12);
        assert_ne!(
            semantic_workbook_state_digest(&before_state).expect("before digest"),
            semantic_workbook_state_digest(&after_state).expect("after digest")
        );

        let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
        assert!(diff.changes.iter().any(|change| {
            change.kind == SemanticChangeKind::Updated
                && change.object_kind == SemanticObjectKind::Sheet
                && change.object_id == "sheet:sheet#0"
        }));
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
    fn engine_semantic_reader_reads_direct_cell_format() {
        let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![cell(
            1,
            0,
            0,
            CellValue::from("alpha"),
        )]))
        .expect("before");
        let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![cell(
            1,
            0,
            0,
            CellValue::from("alpha"),
        )]))
        .expect("after");

        let sheet_id = after.storage().sheet_order()[0];
        let cell_id =
            CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").expect("cell id");
        after
            .set_cell_format(
                &sheet_id,
                &cell_id,
                &CellFormat {
                    bold: Some(true),
                    ..Default::default()
                },
            )
            .expect("set direct format");

        let before_state = before.read_semantic_workbook_state().expect("before state");
        let after_state = after.read_semantic_workbook_state().expect("after state");
        let cell_key = "cell:sheet#0:r0:c0";
        assert!(before_state.sheets["sheet#0"].cells[cell_key]
            .direct_format
            .is_none());
        let direct_format = after_state.sheets["sheet#0"].cells[cell_key]
            .direct_format
            .as_ref()
            .expect("direct format");

        assert_eq!(
            direct_format.properties.get("bold"),
            Some(&serde_json::json!(true))
        );
        assert_ne!(
            semantic_workbook_state_digest(&before_state).expect("before digest"),
            semantic_workbook_state_digest(&after_state).expect("after digest")
        );
        let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
        assert!(diff.changes.iter().any(|change| {
            change.kind == snapshot_types::versioning::SemanticChangeKind::Updated
                && change.object_kind == snapshot_types::versioning::SemanticObjectKind::Cell
                && change.object_id == cell_key
        }));
    }

    #[test]
    fn engine_semantic_reader_reads_format_only_cell() {
        let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("before");
        let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("after");

        let sheet_id = after.storage().sheet_order()[0];
        after
            .set_format_for_ranges(
                &sheet_id,
                &[(1, 1, 1, 1)],
                &CellFormat {
                    italic: Some(true),
                    font_color: Some("#FF0000".to_string()),
                    ..Default::default()
                },
            )
            .expect("set direct format on blank cell");

        let before_state = before.read_semantic_workbook_state().expect("before state");
        let after_state = after.read_semantic_workbook_state().expect("after state");
        let cell_key = "cell:sheet#0:r1:c1";

        assert!(!before_state.sheets["sheet#0"].cells.contains_key(cell_key));
        let cell_state = after_state.sheets["sheet#0"]
            .cells
            .get(cell_key)
            .expect("format-only cell state");
        assert!(cell_state.value.is_none());
        assert!(cell_state.formula.is_none());
        let direct_format = cell_state.direct_format.as_ref().expect("direct format");
        assert_eq!(
            direct_format.properties.get("fontColor"),
            Some(&serde_json::json!("#FF0000"))
        );
        assert_eq!(
            direct_format.properties.get("italic"),
            Some(&serde_json::json!(true))
        );
        assert_ne!(
            semantic_workbook_state_digest(&before_state).expect("before digest"),
            semantic_workbook_state_digest(&after_state).expect("after digest")
        );
        let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
        assert!(diff.changes.iter().any(|change| {
            change.kind == snapshot_types::versioning::SemanticChangeKind::Added
                && change.object_kind == snapshot_types::versioning::SemanticObjectKind::Cell
                && change.object_id == cell_key
        }));
    }

    #[test]
    fn engine_semantic_reader_digest_ignores_durable_id_allocation() {
        let (left, _) = YrsComputeEngine::from_snapshot(workbook(vec![
            cell(1, 0, 0, CellValue::from("alpha")),
            cell(2, 2, 1, CellValue::number(7.0)),
        ]))
        .expect("left");
        let (right, _) = YrsComputeEngine::from_snapshot(WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "660e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 10,
                cols: 10,
                cells: vec![
                    CellData {
                        cell_id: "660e8400-e29b-41d4-a716-446655440101".to_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::from("alpha"),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: "660e8400-e29b-41d4-a716-446655440102".to_string(),
                        row: 2,
                        col: 1,
                        value: CellValue::number(7.0),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
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
        })
        .expect("right");
        let left_state = left.read_semantic_workbook_state().expect("left state");
        let right_state = right.read_semantic_workbook_state().expect("right state");

        assert_eq!(
            semantic_workbook_state_digest(&left_state).expect("left digest"),
            semantic_workbook_state_digest(&right_state).expect("right digest")
        );
        assert_eq!(
            diff_semantic_workbook_states(&left_state, &right_state)
                .expect("diff")
                .changes,
            Vec::new()
        );
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
