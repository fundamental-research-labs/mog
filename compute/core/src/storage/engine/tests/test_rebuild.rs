//! Group 14: rebuild_compute_core, projections, CSE.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

#[test]
fn test_rebuild_compute_core_preserves_values_and_formulas() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify initial state: A1=10, B1=20, A2=A1+B1=30
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(10.0))
    );
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_b1()).unwrap(),
        CellValue::Number(FiniteF64::must(20.0))
    );
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(30.0))
    );

    // Rebuild the compute core
    let recalc = engine.rebuild_compute_core().unwrap();

    // All values should be preserved after rebuild
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a1()).unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "A1 value should survive rebuild"
    );
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_b1()).unwrap(),
        CellValue::Number(FiniteF64::must(20.0)),
        "B1 value should survive rebuild"
    );
    assert_eq!(
        *engine.mirror().get_cell_value(&cell_id_a2()).unwrap(),
        CellValue::Number(FiniteF64::must(30.0)),
        "A2 formula result should survive rebuild"
    );

    // The formula should still be tracked
    assert!(
        engine.compute().get_formula(&cell_id_a2()).is_some(),
        "A2 formula string should survive rebuild"
    );

    // Rebuild recomputes same values so changed_cells is correctly empty
    // (no actual value changes occurred).
}

#[test]
fn test_rebuild_compute_core_preserves_named_ranges() {
    use formula_types::{NamedRangeDef, Scope};

    let mut snap = simple_snapshot();
    snap.named_ranges.push(NamedRangeDef::from_expression(
        "TaxRate".to_string(),
        Scope::Workbook,
        "0.15".to_string(),
    ));

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify the named range exists in the compute core's mirror
    let nr_before = engine.mirror().get_named_range("TaxRate");
    assert!(
        nr_before.is_some(),
        "named range should exist before rebuild"
    );

    // Register the name via the engine's canonicalizing write path so it
    // survives rebuild (`build_workbook_snapshot` reads named ranges from
    // Yrs, and after typed formula boundary Yrs stores them as JSON `IdentityFormula`
    // only — the storage-layer `create_named_range` that writes raw A1
    // is no longer a direct rebuild-survival path). `set_named_range`
    // canonicalizes to JSON at the write boundary.
    let def =
        NamedRangeDef::from_expression("TaxRate".to_string(), Scope::Workbook, "0.15".to_string());
    engine.set_named_range("TaxRate".to_string(), def).unwrap();

    // Rebuild
    let _recalc = engine.rebuild_compute_core().unwrap();

    // Named range should still be resolvable after rebuild
    let nr_after = engine.mirror().get_named_range("TaxRate");
    assert!(nr_after.is_some(), "named range should survive rebuild");
}

#[test]
fn test_rebuild_compute_core_preserves_tables() {
    use formula_types::TableDef;

    let mut snap = simple_snapshot();
    snap.tables.push(TableDef {
        name: "Table1".to_string(),
        sheet: sheet_id(),
        start_row: 0,
        start_col: 0,
        end_row: 5,
        end_col: 2,
        columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
        has_headers: true,
        has_totals: false,
    });

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify table exists before rebuild
    assert_eq!(engine.mirror().all_tables().len(), 1);
    assert_eq!(engine.mirror().all_tables()[0].name, "Table1");

    // Rebuild
    let _recalc = engine.rebuild_compute_core().unwrap();

    // Table should be preserved
    assert_eq!(
        engine.mirror().all_tables().len(),
        1,
        "table count should survive rebuild"
    );
    assert_eq!(
        engine.mirror().all_tables()[0].name,
        "Table1",
        "table name should survive rebuild"
    );
}

#[test]
fn test_rebuild_compute_core_preserves_data_table_regions() {
    use crate::snapshot::DataTableRegionDef;
    use cell_types::SheetId;
    use formula_types::CellRef;

    // Typed data-table input refs: `row_input_ref` is now `Option<CellRef>` (was
    // `Option<String>` of `$A$1`-style A1 text). The snapshot rebuild
    // must preserve the typed identity unchanged.
    let row_input = CellRef::Positional {
        sheet: SheetId::from_raw(0),
        row: 0,
        col: 0,
    };

    let mut snap = simple_snapshot();
    snap.data_table_regions.push(DataTableRegionDef {
        sheet: "550e8400-e29b-41d4-a716-446655440000".to_string(),
        start_row: 2,
        start_col: 0,
        end_row: 5,
        end_col: 3,
        row_input_ref: Some(row_input),
        col_input_ref: None,
        ooxml_flags: None,
    });

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Verify data table region exists before rebuild
    assert_eq!(engine.mirror().all_data_table_regions().len(), 1);

    // Rebuild
    let _recalc = engine.rebuild_compute_core().unwrap();

    // Data table region should be preserved
    assert_eq!(
        engine.mirror().all_data_table_regions().len(),
        1,
        "data table region count should survive rebuild"
    );
    assert_eq!(
        engine.mirror().all_data_table_regions()[0].start_row,
        2,
        "data table region start_row should survive rebuild"
    );
    assert_eq!(
        engine.mirror().all_data_table_regions()[0].row_input_ref,
        Some(row_input),
        "data table region row_input_ref should survive rebuild"
    );
}

// -------------------------------------------------------------------
// Projection / dynamic array preservation tests
// -------------------------------------------------------------------

#[test]
fn test_rebuild_preserves_projections() {
    // Snapshot with a SEQUENCE(3) formula and array_ref declaring the spill extent
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("=SEQUENCE(3)".to_string()),
                identity_formula: None,
                // array_ref declares the spill extent so the projection is
                // pre-registered during snapshot hydration (like XLSX import)
                array_ref: Some("A1:A3".to_string()),
            }],
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

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Verify projection exists before rebuild
    assert!(
        engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "A1 should be a projection source before rebuild"
    );
    let proj = engine
        .mirror()
        .projection_registry
        .get(&cell_id_a1())
        .unwrap();
    assert_eq!(proj.rows, 3, "projection should span 3 rows");
    assert_eq!(proj.cols, 1, "projection should span 1 col");

    // Verify source + spill target values are materialized
    let a1_val = engine.mirror().get_cell_value(&cell_id_a1()).unwrap();
    assert_eq!(*a1_val, CellValue::Number(FiniteF64::must(1.0)), "A1=1");
    let col = engine
        .mirror()
        .get_sheet(&sid)
        .unwrap()
        .get_column_slice(0)
        .unwrap();
    assert_eq!(
        col[1],
        CellValue::Number(FiniteF64::must(2.0)),
        "A2=2 (spill target)"
    );
    assert_eq!(
        col[2],
        CellValue::Number(FiniteF64::must(3.0)),
        "A3=3 (spill target)"
    );

    // Rebuild the compute core
    let _recalc = engine.rebuild_compute_core().unwrap();

    // Projection should survive rebuild
    assert!(
        engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "A1 should still be a projection source after rebuild"
    );
    let proj_after = engine
        .mirror()
        .projection_registry
        .get(&cell_id_a1())
        .unwrap();
    assert_eq!(proj_after.rows, 3, "projection rows should survive rebuild");
    assert_eq!(proj_after.cols, 1, "projection cols should survive rebuild");

    // Source + spill target values should be correct (not #SPILL!)
    let a1_after = engine.mirror().get_cell_value(&cell_id_a1()).unwrap();
    assert_eq!(
        *a1_after,
        CellValue::Number(FiniteF64::must(1.0)),
        "A1=1 after rebuild"
    );
    let col_after = engine
        .mirror()
        .get_sheet(&sid)
        .unwrap()
        .get_column_slice(0)
        .unwrap();
    assert_eq!(
        col_after[1],
        CellValue::Number(FiniteF64::must(2.0)),
        "A2=2 after rebuild"
    );
    assert_eq!(
        col_after[2],
        CellValue::Number(FiniteF64::must(3.0)),
        "A3=3 after rebuild"
    );
}

#[test]
fn test_rebuild_preserves_cse_single_cell() {
    // Create a snapshot with values in A1:A2 and B1:B2, and a CSE formula in C1
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(2.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(3.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                // C1: CSE single-cell array formula {=SUM(A1:A2*B1:B2)}
                // array_ref = "C1:C1" marks it as 1x1 CSE
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440006".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=SUM(A1:A2*B1:B2)".to_string()),
                    identity_formula: None,
                    array_ref: Some("C1:C1".to_string()),
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

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let c1_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440006").unwrap();

    // C1 = SUM(A1:A2*B1:B2) = 2*10 + 3*20 = 80
    let c1_val = engine.mirror().get_cell_value(&c1_id).unwrap();
    assert_eq!(
        *c1_val,
        CellValue::Number(FiniteF64::must(80.0)),
        "C1 CSE formula should evaluate to 80 before rebuild"
    );

    // Rebuild
    let _recalc = engine.rebuild_compute_core().unwrap();

    // CSE result should survive
    let c1_after = engine.mirror().get_cell_value(&c1_id).unwrap();
    assert_eq!(
        *c1_after,
        CellValue::Number(FiniteF64::must(80.0)),
        "C1 CSE formula should still evaluate to 80 after rebuild"
    );

    // Formula should still be tracked
    assert!(
        engine.compute().get_formula(&c1_id).is_some(),
        "C1 formula string should survive rebuild"
    );
}

#[test]
fn test_structure_change_reregisters_projections() {
    // Verify that structure_change() + full_recalc re-registers projections
    // after they are cleared. This tests the CRDT structural sync path where
    // projection_registry.clear() is called before structure_change().
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("=SEQUENCE(3)".to_string()),
                identity_formula: None,
                array_ref: Some("A1:A3".to_string()),
            }],
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

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Verify projection exists before
    assert!(
        engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "A1 should be a projection source before structure_change"
    );

    // Simulate what CRDT structural sync does: clear projections, then structure_change
    engine.mirror.projection_registry.clear();
    assert!(
        !engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "projection should be gone after clear"
    );

    let _recalc = engine
        .stores
        .compute
        .structure_change(&mut engine.mirror, None)
        .unwrap();

    // full_recalc inside structure_change re-evaluates SEQUENCE(3) and the spill
    // handler should re-register the projection
    assert!(
        engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "A1 projection should be re-registered after structure_change"
    );
    let proj = engine
        .mirror()
        .projection_registry
        .get(&cell_id_a1())
        .unwrap();
    assert_eq!(proj.rows, 3, "projection rows should be 3");
    assert_eq!(proj.cols, 1, "projection cols should be 1");

    // Source + spill target values should be correct
    let a1_val = engine.mirror().get_cell_value(&cell_id_a1()).unwrap();
    assert_eq!(*a1_val, CellValue::Number(FiniteF64::must(1.0)), "A1=1");
    let col = engine
        .mirror()
        .get_sheet(&sid)
        .unwrap()
        .get_column_slice(0)
        .unwrap();
    assert_eq!(
        col[1],
        CellValue::Number(FiniteF64::must(2.0)),
        "A2=2 (spill target)"
    );
    assert_eq!(
        col[2],
        CellValue::Number(FiniteF64::must(3.0)),
        "A3=3 (spill target)"
    );
}

#[test]
fn test_recalculate_preserves_projections() {
    // Verify that recalculate() (the new wb.calculate() path) preserves projections
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![CellData {
                cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Null,
                formula: Some("=SEQUENCE(3)".to_string()),
                identity_formula: None,
                array_ref: Some("A1:A3".to_string()),
            }],
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

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    // Call recalculate() -- the new non-destructive wb.calculate() path
    let _recalc = engine.recalculate().unwrap();

    // Projection should survive
    assert!(
        engine.mirror().projection_registry.is_source(&cell_id_a1()),
        "A1 should still be a projection source after recalculate()"
    );
    let proj = engine
        .mirror()
        .projection_registry
        .get(&cell_id_a1())
        .unwrap();
    assert_eq!(
        proj.rows, 3,
        "projection rows should be 3 after recalculate()"
    );

    // Source + spill target values should be correct
    let a1_val = engine.mirror().get_cell_value(&cell_id_a1()).unwrap();
    assert_eq!(*a1_val, CellValue::Number(FiniteF64::must(1.0)), "A1=1");
    let col = engine
        .mirror()
        .get_sheet(&sid)
        .unwrap()
        .get_column_slice(0)
        .unwrap();
    assert_eq!(
        col[1],
        CellValue::Number(FiniteF64::must(2.0)),
        "A2=2 after recalculate()"
    );
    assert_eq!(
        col[2],
        CellValue::Number(FiniteF64::must(3.0)),
        "A3=3 after recalculate()"
    );
}
