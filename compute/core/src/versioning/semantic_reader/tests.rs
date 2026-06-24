use cell_types::CellId;
use formula_types::{
    IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef,
    StructureChange,
};
use snapshot_types::versioning::{
    CanonicalFormulaRef, SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION, SemanticChangeKind,
    SemanticDiagnosticSeverity, SemanticDomainCoverageStatus, SemanticObjectKind,
    VersionDomainCapabilityState, VersionDomainClass, semantic_workbook_state_digest,
};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

use crate::storage::engine::YrsComputeEngine;
use crate::storage::sheet::floating_objects::set_floating_object;
use crate::versioning::{
    CELL_FORMULAS_DOMAIN, CELL_VALUES_DOMAIN, CHARTS_DOMAIN, FLOATING_OBJECTS_DOMAIN,
    NAMED_RANGES_DOMAIN, ROWS_COLUMNS_DOMAIN, SHEETS_DOMAIN, SemanticWorkbookStateReader,
    coverage_for_states, diff_semantic_workbook_states,
};

mod coverage;
mod direct_formats;
mod named_ranges;
mod presence_domains;
mod value_provenance;

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

fn formula_cell(id_suffix: u32, row: u32, col: u32, value: CellValue, template: &str) -> CellData {
    formula_cell_with_identity(
        id_suffix,
        row,
        col,
        value,
        template,
        identity_formula(template, vec![]),
    )
}

fn formula_cell_with_identity(
    id_suffix: u32,
    row: u32,
    col: u32,
    value: CellValue,
    formula_body: &str,
    identity_formula: IdentityFormula,
) -> CellData {
    CellData {
        cell_id: format!("550e8400-e29b-41d4-a716-44665544{id_suffix:04}"),
        row,
        col,
        value,
        formula: Some(format!("={formula_body}")),
        identity_formula: Some(identity_formula),
        array_ref: None,
    }
}

fn identity_formula(template: &str, refs: Vec<IdentityFormulaRef>) -> IdentityFormula {
    IdentityFormula {
        template: template.to_string(),
        refs,
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    }
}

#[test]
fn engine_semantic_reader_reads_ordered_cell_values() {
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
fn engine_semantic_reader_returns_digest_envelope() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");

    let envelope = engine
        .semantic_workbook_state_envelope()
        .expect("semantic state envelope");

    assert_eq!(
        envelope.state.schema_version,
        SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION
    );
    assert_eq!(
        envelope.state_digest,
        semantic_workbook_state_digest(&envelope.state).expect("state digest")
    );
}

#[test]
fn engine_semantic_reader_registers_public_first_slice_domain_rows_for_supported_semantics() {
    let (engine, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
            .expect("engine");

    let state = engine.read_semantic_workbook_state().expect("state");

    for domain_id in [
        SHEETS_DOMAIN,
        ROWS_COLUMNS_DOMAIN,
        CELL_VALUES_DOMAIN,
        CELL_FORMULAS_DOMAIN,
        NAMED_RANGES_DOMAIN,
    ] {
        assert_eq!(
            state.domains[domain_id].capability_state,
            VersionDomainCapabilityState::Supported,
            "{domain_id} should be represented by its public first-slice row"
        );
    }
    assert!(
        !state.domains.contains_key("authored-grid"),
        "semantic reader should not emit the old broad authored-grid alias"
    );
}

#[test]
fn engine_semantic_reader_reads_formula_domain_objects_and_refs() {
    let (before, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::number(2.0))]))
            .expect("before");
    let (mut after, _) = YrsComputeEngine::from_snapshot(workbook(vec![
        cell(1, 0, 0, CellValue::number(2.0)),
        cell(2, 1, 1, CellValue::number(3.0)),
        cell(3, 2, 2, CellValue::number(5.0)),
    ]))
    .expect("after");

    let sheet_id = after.storage().sheet_order()[0];
    let cell_a1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").expect("a1 id");
    let cell_b2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").expect("b2 id");
    let formula_cell =
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").expect("formula id");
    let grid = after.grid_index(&sheet_id).expect("grid");
    let row_0 = grid.row_id(0).expect("row 0");
    let row_2 = grid.row_id(2).expect("row 2");
    let col_0 = grid.col_id(0).expect("col 0");
    let col_1 = grid.col_id(1).expect("col 1");
    let col_2 = grid.col_id(2).expect("col 2");
    let formula_identity = identity_formula(
        "{0}+SUM({1})+SUM({2})+SUM({3})+SUM({4})+SUM({5})+SUM({6})",
        vec![
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell_a1,
                row_absolute: true,
                col_absolute: false,
            }),
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell_a1,
                end_id: cell_b2,
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: true,
                end_col_absolute: true,
            }),
            IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                sheet_id,
                start_row_id: row_0,
                start_col_id: col_0,
                end_row_id: row_2,
                end_col_id: col_2,
                start_row_absolute: false,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: false,
            }),
            IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row_0,
                absolute: true,
            }),
            IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row_0,
                end_row_id: row_2,
                start_absolute: false,
                end_absolute: true,
            }),
            IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col_1,
                absolute: false,
            }),
            IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col_0,
                end_col_id: col_2,
                start_absolute: true,
                end_absolute: false,
            }),
        ],
    );
    after.with_storage_and_mirror_for_test(|storage, mirror| {
        storage.set_cell(
            mirror,
            &sheet_id,
            formula_cell,
            2,
            2,
            CellValue::number(5.0),
            Some("=A1+SUM(A1:B2)+SUM(A1:C3)+SUM(1:1)+SUM(1:3)+SUM(B:B)+SUM(A:C)".to_string()),
            Some(formula_identity),
        );
    });

    let before_state = before.read_semantic_workbook_state().expect("before state");
    let after_state = after.read_semantic_workbook_state().expect("after state");
    let formula = after_state.sheets["sheet#0"].cells["cell:sheet#0:r2:c2"]
        .formula
        .as_ref()
        .expect("formula");

    assert_eq!(
        formula.normalized_formula,
        "{0}+SUM({1})+SUM({2})+SUM({3})+SUM({4})+SUM({5})+SUM({6})"
    );
    assert!(!formula.volatile);
    assert_eq!(
        formula.dependency_object_ids,
        vec![
            "cell:sheet#0:r0:c0",
            "cell:sheet#0:r1:c1",
            "column:sheet#0:c0",
            "column:sheet#0:c1",
            "column:sheet#0:c2",
            "row:sheet#0:r0",
            "row:sheet#0:r2",
        ]
    );
    assert_eq!(
        formula.refs[0],
        CanonicalFormulaRef::Cell {
            object_id: "cell:sheet#0:r0:c0".to_string(),
            sheet_id: "sheet#0".to_string(),
            row: 0,
            column: 0,
            row_absolute: true,
            column_absolute: false,
        }
    );
    assert!(matches!(
        formula.refs[1],
        CanonicalFormulaRef::Range {
            start_row: 0,
            start_column: 0,
            end_row: 1,
            end_column: 1,
            ..
        }
    ));
    assert!(matches!(
        formula.refs[2],
        CanonicalFormulaRef::RectRange {
            start_row: 0,
            start_column: 0,
            end_row: 2,
            end_column: 2,
            ..
        }
    ));
    assert!(matches!(
        formula.refs[3],
        CanonicalFormulaRef::FullRow {
            row: 0,
            absolute: true,
            ..
        }
    ));
    assert!(matches!(
        formula.refs[4],
        CanonicalFormulaRef::RowRange {
            start_row: 0,
            end_row: 2,
            ..
        }
    ));
    assert!(matches!(
        formula.refs[5],
        CanonicalFormulaRef::FullColumn {
            column: 1,
            absolute: false,
            ..
        }
    ));
    assert!(matches!(
        formula.refs[6],
        CanonicalFormulaRef::ColumnRange {
            start_column: 0,
            end_column: 2,
            ..
        }
    ));
    assert_eq!(
        after_state.domains[CELL_FORMULAS_DOMAIN].capability_state,
        VersionDomainCapabilityState::Supported
    );

    let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Added
            && change.object_kind == SemanticObjectKind::CellFormula
            && change.domain_id == CELL_FORMULAS_DOMAIN
            && change.object_id == "formula:cell:sheet#0:r2:c2"
    }));
}

#[test]
fn engine_semantic_reader_marks_legacy_formula_without_identity_opaque_blocking() {
    let formula_cell_id =
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").expect("formula id");
    let referenced_cell_id =
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").expect("a1 id");
    let formula_identity = identity_formula(
        "{0}+1",
        vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: referenced_cell_id,
            row_absolute: false,
            col_absolute: false,
        })],
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![
        cell(1, 0, 0, CellValue::number(2.0)),
        formula_cell_with_identity(
            2,
            0,
            1,
            CellValue::number(3.0),
            "A1+1",
            formula_identity.clone(),
        ),
    ]))
    .expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];

    engine.with_storage_and_mirror_for_test(|storage, mirror| {
        storage.set_cell(
            mirror,
            &sheet_id,
            formula_cell_id,
            0,
            1,
            CellValue::number(3.0),
            Some("=A1+1".to_string()),
            None,
        );
        assert!(mirror.set_formula(&formula_cell_id, Some(formula_identity)));
    });

    let state = engine.read_semantic_workbook_state().expect("state");
    let unsupported = state
        .domains
        .get(super::UNSUPPORTED_CELL_FORMULAS_DOMAIN)
        .expect("unsupported formulas");

    assert_eq!(
        unsupported.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    assert!(
        unsupported
            .objects
            .keys()
            .any(|object_id| object_id.ends_with(":legacy-without-identity"))
    );
    assert_eq!(
        coverage_for_states(&state, &state)
            .iter()
            .find(|entry| entry.domain_id == super::UNSUPPORTED_CELL_FORMULAS_DOMAIN)
            .expect("formula coverage")
            .status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
}

#[test]
fn engine_semantic_reader_accepts_formula_identity_from_public_position_write() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sheet_id,
                    0,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "1".to_string(),
                    },
                ),
                (
                    sheet_id,
                    1,
                    0,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "2".to_string(),
                    },
                ),
                (
                    sheet_id,
                    0,
                    1,
                    crate::storage::engine::mutation::CellInput::Parse {
                        text: "=A1+A2".to_string(),
                    },
                ),
            ],
            false,
        )
        .expect("public formula write");

    let formula_cell_id = engine
        .storage()
        .read_cell_id_at_pos(&sheet_id, 0, 1)
        .expect("formula cell id");
    let (_value, legacy_formula, persisted_identity) = engine
        .storage()
        .read_cell_from_yrs(&sheet_id, &formula_cell_id)
        .expect("formula cell");
    let state = engine.read_semantic_workbook_state().expect("state");
    let formula_cell = &state.sheets["sheet#0"].cells["cell:sheet#0:r0:c1"];

    assert_eq!(legacy_formula.as_deref(), Some("=A1+A2"));
    assert!(
        persisted_identity.is_some(),
        "public formula writes must persist identity metadata"
    );
    assert!(formula_cell.formula.is_some());
    assert!(
        !state
            .domains
            .contains_key(super::UNSUPPORTED_CELL_FORMULAS_DOMAIN),
        "public formula writes must not create unsupported formula coverage"
    );
}

#[test]
fn engine_semantic_reader_marks_unrepresented_persisted_formula_opaque_blocking() {
    let formula_cell_id =
        CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").expect("formula id");
    let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![
        cell(1, 0, 0, CellValue::number(2.0)),
        cell(2, 0, 1, CellValue::Null),
    ]))
    .expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];

    engine.with_storage_and_mirror_for_test(|storage, mirror| {
        storage.set_cell(
            mirror,
            &sheet_id,
            formula_cell_id,
            0,
            1,
            CellValue::Null,
            Some("=SUM(".to_string()),
            None,
        );
    });

    let state = engine.read_semantic_workbook_state().expect("state");
    let formula_cell = &state.sheets["sheet#0"].cells["cell:sheet#0:r0:c1"];
    let unsupported = state
        .domains
        .get(super::UNSUPPORTED_CELL_FORMULAS_DOMAIN)
        .expect("unsupported formulas");

    assert!(formula_cell.formula.is_none());
    assert_eq!(
        unsupported.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    assert!(
        unsupported
            .objects
            .keys()
            .any(|object_id| object_id.ends_with(":legacy-without-identity"))
    );
}

#[test]
fn engine_semantic_reader_digest_changes_for_formula_edit() {
    let (before, _) = YrsComputeEngine::from_snapshot(workbook(vec![formula_cell(
        1,
        0,
        0,
        CellValue::number(2.0),
        "1+1",
    )]))
    .expect("before");
    let (after, _) = YrsComputeEngine::from_snapshot(workbook(vec![formula_cell(
        1,
        0,
        0,
        CellValue::number(3.0),
        "1+2",
    )]))
    .expect("after");

    let before_state = before.read_semantic_workbook_state().expect("before state");
    let after_state = after.read_semantic_workbook_state().expect("after state");

    assert_ne!(
        semantic_workbook_state_digest(&before_state).expect("before digest"),
        semantic_workbook_state_digest(&after_state).expect("after digest")
    );
    let diff = diff_semantic_workbook_states(&before_state, &after_state).expect("diff");
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Updated
            && change.object_kind == SemanticObjectKind::CellFormula
            && change.domain_id == CELL_FORMULAS_DOMAIN
            && change.object_id == "formula:cell:sheet#0:r0:c0"
    }));
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
            && change.domain_id == ROWS_COLUMNS_DOMAIN
            && change.object_id == "row:sheet#0:r2"
    }));
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Added
            && change.object_kind == SemanticObjectKind::Column
            && change.domain_id == ROWS_COLUMNS_DOMAIN
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
            && change.domain_id == SHEETS_DOMAIN
            && change.object_id == "sheet:sheet#0"
    }));
}

#[test]
fn engine_semantic_reader_digest_changes_for_cell_value_edit() {
    let (before, _) =
        YrsComputeEngine::from_snapshot(workbook(vec![cell(1, 0, 0, CellValue::from("alpha"))]))
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
            && change.domain_id == CELL_VALUES_DOMAIN
    }));
    assert!(diff.changes.iter().any(|change| {
        change.kind == SemanticChangeKind::Updated
            && change.object_kind == SemanticObjectKind::CellValue
            && change.domain_id == CELL_VALUES_DOMAIN
            && change.object_id == "value:cell:sheet#0:r0:c0"
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

#[test]
fn engine_semantic_reader_marks_present_charts_opaque_blocking() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];
    set_floating_object(
        engine.storage().doc(),
        engine.storage().sheets(),
        &sheet_id,
        "chart-sales",
        &serde_json::json!({
            "type": "chart",
            "chartType": "bar",
            "dataRange": "A1:B4"
        }),
    )
    .expect("set chart");

    let state = engine.read_semantic_workbook_state().expect("state");
    let domain = state.domains.get(CHARTS_DOMAIN).expect("charts domain");

    assert_eq!(domain.domain_class, VersionDomainClass::Authored);
    assert_eq!(
        domain.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    let object = domain
        .objects
        .get("chart:sheet#0:chart-sales")
        .expect("opaque chart object");
    assert_eq!(object.object_kind, SemanticObjectKind::DomainAttachment);
    assert_eq!(object.domain_id, CHARTS_DOMAIN);

    let coverage = coverage_for_states(&state, &state);
    let charts_coverage = coverage
        .iter()
        .find(|entry| entry.domain_id == CHARTS_DOMAIN)
        .expect("charts coverage");
    assert_eq!(
        charts_coverage.status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
    assert_eq!(
        charts_coverage.diagnostics[0].severity,
        SemanticDiagnosticSeverity::Error
    );
    assert_eq!(
        charts_coverage.diagnostics[0].object_ids,
        vec!["chart:sheet#0:chart-sales".to_string()]
    );
}

#[test]
fn engine_semantic_reader_marks_present_floating_objects_opaque_blocking() {
    let (engine, _) = YrsComputeEngine::from_snapshot(workbook(vec![])).expect("engine");
    let sheet_id = engine.storage().sheet_order()[0];
    set_floating_object(
        engine.storage().doc(),
        engine.storage().sheets(),
        &sheet_id,
        "shape-logo",
        &serde_json::json!({
            "type": "shape",
            "shapeType": "rect",
            "anchorRow": 1,
            "anchorCol": 2
        }),
    )
    .expect("set floating object");

    let state = engine.read_semantic_workbook_state().expect("state");
    let domain = state
        .domains
        .get(FLOATING_OBJECTS_DOMAIN)
        .expect("floating objects domain");

    assert_eq!(domain.domain_class, VersionDomainClass::Authored);
    assert_eq!(
        domain.capability_state,
        VersionDomainCapabilityState::OpaqueBlocking
    );
    let object = domain
        .objects
        .get("floating-object:sheet#0:shape-logo")
        .expect("opaque floating object");
    assert_eq!(object.object_kind, SemanticObjectKind::DomainAttachment);
    assert_eq!(object.domain_id, FLOATING_OBJECTS_DOMAIN);

    let coverage = coverage_for_states(&state, &state);
    let object_coverage = coverage
        .iter()
        .find(|entry| entry.domain_id == FLOATING_OBJECTS_DOMAIN)
        .expect("floating objects coverage");
    assert_eq!(
        object_coverage.status,
        SemanticDomainCoverageStatus::OpaqueBlocking
    );
    assert_eq!(
        object_coverage.diagnostics[0].severity,
        SemanticDiagnosticSeverity::Error
    );
    assert_eq!(
        object_coverage.diagnostics[0].object_ids,
        vec!["floating-object:sheet#0:shape-logo".to_string()]
    );
}
