use super::*;

// -----------------------------------------------------------------------
// Init from snapshot with formulas
// -----------------------------------------------------------------------

#[test]
fn test_init_from_snapshot_basic() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let result = core
        .init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    // C1 = A1 + B1 = 10 + 20 = 30
    let c1_id = cid(0x12);
    let c1_val = core.get_cell_value(&mirror, &c1_id).unwrap();
    assert_eq!(*c1_val, CellValue::number(30.0));

    // Should report C1 as changed (from 0.0 to 30.0)
    assert!(!result.changed_cells.is_empty());
}

#[test]
fn test_init_from_snapshot_formula_stored() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
}

#[test]
fn test_no_recalc_init_does_not_apply_user_entry_rewrites_to_imported_formulas() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let formula_id = cid(0x12);
    let imported_formula = r#"=IFERROR(A1,{""})"#;
    let cached_value = CellValue::Text("cached".into());

    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid(1).to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: cid(0x10).to_uuid_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: formula_id.to_uuid_string(),
                    row: 0,
                    col: 1,
                    value: cached_value.clone(),
                    formula: Some(imported_formula.to_string()),
                    identity_formula: None,
                    array_ref: Some("B1".to_string()),
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
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    core.init_from_snapshot_no_recalc(&mut mirror, snap)
        .unwrap();

    assert_eq!(core.get_formula(&formula_id), Some(imported_formula));
    assert_eq!(
        *core.get_cell_value(&mirror, &formula_id).unwrap(),
        cached_value
    );
    assert!(
        core.ast_cache.contains_key(&formula_id),
        "imported formula should parse without user-entry normalization",
    );
}

#[test]
fn test_init_identity_formulas_dedupe_ghost_cells_by_sheet_and_position() {
    fn cell_ref_ids(mirror: &CellMirror, cell_id: CellId) -> Vec<CellId> {
        mirror
            .get_formula(&cell_id)
            .unwrap_or_else(|| panic!("cell {cell_id:?} should have an identity formula"))
            .refs
            .iter()
            .map(|r| match r {
                IdentityFormulaRef::Cell(cell) => cell.id,
                other => panic!("expected a cell identity ref, got {other:?}"),
            })
            .collect()
    }

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let sheet1 = sid(1);
    let sheet2 = sid(2);
    let a1 = cid(0x100);
    let s1_same_ref_twice = cid(0x200);
    let s1_same_ref_other_formula = cid(0x201);
    let s1_different_missing_positions = cid(0x202);
    let s1_explicit_sheet2_and_unqualified_sheet1 = cid(0x203);
    let s1_existing_real_cell = cid(0x204);
    let s2_unqualified_same_row_col = cid(0x300);
    let s2_explicit_sheet1_and_unqualified_sheet2 = cid(0x301);

    let snap = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet1.to_uuid_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: a1.to_uuid_string(),
                        row: 0,
                        col: 0,
                        value: CellValue::number(10.0),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_same_ref_twice.to_uuid_string(),
                        row: 0,
                        col: 3,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_same_ref_other_formula.to_uuid_string(),
                        row: 0,
                        col: 4,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_different_missing_positions.to_uuid_string(),
                        row: 0,
                        col: 5,
                        value: CellValue::number(0.0),
                        formula: Some("=B1+C1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_explicit_sheet2_and_unqualified_sheet1.to_uuid_string(),
                        row: 0,
                        col: 6,
                        value: CellValue::number(0.0),
                        formula: Some("=Sheet2!B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s1_existing_real_cell.to_uuid_string(),
                        row: 0,
                        col: 7,
                        value: CellValue::number(0.0),
                        formula: Some("=A1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet2.to_uuid_string(),
                name: "Sheet2".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    CellData {
                        cell_id: s2_unqualified_same_row_col.to_uuid_string(),
                        row: 0,
                        col: 3,
                        value: CellValue::number(0.0),
                        formula: Some("=B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                    CellData {
                        cell_id: s2_explicit_sheet1_and_unqualified_sheet2.to_uuid_string(),
                        row: 0,
                        col: 4,
                        value: CellValue::number(0.0),
                        formula: Some("=Sheet1!B1+B1".to_string()),
                        identity_formula: None,
                        array_ref: None,
                    },
                ],
                ranges: vec![],
            },
        ],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    core.init_from_snapshot(&mut mirror, snap)
        .expect("ghost identity snapshot should initialize");

    let same_ref_twice = cell_ref_ids(&mirror, s1_same_ref_twice);
    assert_eq!(same_ref_twice.len(), 2);
    assert_eq!(same_ref_twice[0], same_ref_twice[1]);

    let same_ref_other_formula = cell_ref_ids(&mirror, s1_same_ref_other_formula);
    assert_eq!(same_ref_twice[0], same_ref_other_formula[0]);

    let different_positions = cell_ref_ids(&mirror, s1_different_missing_positions);
    assert_ne!(different_positions[0], different_positions[1]);
    assert_eq!(different_positions[0], same_ref_twice[0]);

    let sheet2_unqualified = cell_ref_ids(&mirror, s2_unqualified_same_row_col);
    assert_ne!(same_ref_twice[0], sheet2_unqualified[0]);
    assert_eq!(
        mirror.resolve_position(&same_ref_twice[0]),
        Some(SheetPos::new(0, 1))
    );
    assert_eq!(mirror.sheet_for_cell(&same_ref_twice[0]), Some(sheet1));
    assert_eq!(
        mirror.resolve_position(&sheet2_unqualified[0]),
        Some(SheetPos::new(0, 1))
    );
    assert_eq!(mirror.sheet_for_cell(&sheet2_unqualified[0]), Some(sheet2));

    let explicit_sheet2 = cell_ref_ids(&mirror, s1_explicit_sheet2_and_unqualified_sheet1);
    assert_eq!(explicit_sheet2[0], sheet2_unqualified[0]);
    assert_eq!(explicit_sheet2[1], same_ref_twice[0]);

    let explicit_sheet1 = cell_ref_ids(&mirror, s2_explicit_sheet1_and_unqualified_sheet2);
    assert_eq!(explicit_sheet1[0], same_ref_twice[0]);
    assert_eq!(explicit_sheet1[1], sheet2_unqualified[0]);

    let existing_real_cell = cell_ref_ids(&mirror, s1_existing_real_cell);
    assert_eq!(existing_real_cell, vec![a1]);
}

#[test]
fn test_minimal_init_seeds_formula_readback_before_graph_build() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_minimal(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.is_empty(),
        "minimal init must not build the formula graph eagerly",
    );
    assert!(
        core.deferred_formula_cells.is_some(),
        "minimal init should still defer graph construction",
    );

    core.ensure_graph_built(&mut mirror).unwrap();
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.contains_key(&c1_id),
        "deferred graph build should consume the seeded formula source",
    );
}

#[test]
fn test_viewport_only_init_seeds_materialized_formula_readback() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_viewport_only(&mut mirror, basic_snapshot())
        .unwrap();

    let c1_id = cid(0x12);
    assert_eq!(core.get_formula(&c1_id), Some("=A1+B1"));
    assert!(
        core.ast_cache.is_empty(),
        "viewport-only init must keep dependency graph construction lazy",
    );
}

#[test]
fn test_viewport_only_init_rejects_partial_graph_build() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot_viewport_only(&mut mirror, basic_snapshot())
        .unwrap();

    let err = core.ensure_graph_built(&mut mirror).unwrap_err();
    assert!(
        err.to_string().contains("deferred XLSX hydration"),
        "viewport-only graph build must fail with a materialization error, got {err}",
    );
    assert_eq!(core.get_formula(&cid(0x12)), Some("=A1+B1"));
}

#[test]
fn test_init_empty_snapshot() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    let snap = WorkbookSnapshot {
        sheets: vec![],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let result = core.init_from_snapshot(&mut mirror, snap).unwrap();
    assert!(result.changed_cells.is_empty());
}
