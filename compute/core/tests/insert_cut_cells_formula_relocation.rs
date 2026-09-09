use cell_types::CellId;
use compute_core::storage::engine::ComputeEngine;
use compute_wire::flags::{VALUE_TYPE_MASK, VALUE_TYPE_NUMBER};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(id_suffix: u32, row: u32, col: u32, formula: &str, value: f64) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(value)),
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

#[test]
fn insert_cut_cells_right_preserves_formula_ref_to_moved_precedent() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 40,
            cells: vec![
                number_cell(100, 20, 15, 6026.0),
                formula_cell(101, 20, 16, "=16088-P21", 10062.0),
                formula_cell(102, 20, 17, "=25000-P21-Q21", 8912.0),
                number_cell(103, 20, 27, 6732.0),
                formula_cell(104, 20, 28, "=14241-AB21", 7509.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");

    engine
        .register_viewport("vp", &sid, 18, 8, 36, 28)
        .expect("register viewport");

    engine
        .insert_cells_with_shift(&sid, 20, 15, 1, 2, true)
        .expect("insert P21:Q21 shift right");
    let shifted = engine.query_range(&sid, 20, 29, 20, 30);
    let shifted_formula = shifted
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 30)
        .expect("AE21 shifted formula");
    assert_eq!(shifted_formula.formula.as_deref(), Some("=14241-AD21"));
    assert_eq!(
        shifted_formula.value,
        CellValue::Number(FiniteF64::must(7509.0))
    );

    let _result = engine
        .relocate_cells(&sid, 20, 29, 20, 30, &sid, 20, 15)
        .expect("relocate shifted AD21:AE21 to P21:Q21");
    let rendered = engine.build_viewport_render_data(&sid, 20, 16, 21, 17);
    let cell = rendered.cells.first().expect("rendered Q21");
    assert_eq!(
        Some(cell.flags & VALUE_TYPE_MASK),
        Some(VALUE_TYPE_NUMBER),
        "Q21 moved formula target must emit a numeric patch even when the computed value is unchanged"
    );
    let q21_patch_value = Some(cell.number_value).expect("Q21 patch value");
    assert!(
        (q21_patch_value - 7509.0).abs() < f64::EPSILON,
        "Q21 patch expected 7509, got {q21_patch_value}"
    );

    let q_id = engine.get_cell_id_at(&sid, 20, 16).expect("Q21 id");
    let q_cell_id = CellId::from_uuid_str(&q_id).expect("Q21 cell id");

    let after = engine.query_range(&sid, 20, 15, 20, 17);
    let p21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 15)
        .expect("P21 moved value");
    let q21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 16)
        .expect("Q21 moved formula");
    let r21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 17)
        .expect("R21 shifted original P21");

    assert_eq!(p21.value, CellValue::Number(FiniteF64::must(6732.0)));
    assert_eq!(q21.formula.as_deref(), Some("=14241-P21"));
    assert_eq!(
        engine.get_formula(&q_cell_id).as_deref(),
        Some("=14241-P21")
    );
    assert_eq!(q21.value, CellValue::Number(FiniteF64::must(7509.0)));
    assert_eq!(r21.value, CellValue::Number(FiniteF64::must(6026.0)));
}

#[test]
fn insert_cut_cells_down_preserves_formula_refs_to_moved_row_precedents() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 40,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");

    engine
        .set_cell_value_parsed(&sid, 16, 15, "24336")
        .expect("seed source P17");
    engine
        .set_cell_value_parsed(&sid, 16, 16, "=49790-P17")
        .expect("seed source Q17 formula");
    engine
        .set_cell_value_parsed(&sid, 16, 17, "=75195-P17-Q17")
        .expect("seed source R17 formula");
    engine
        .set_cell_value_parsed(&sid, 16, 27, "23958")
        .expect("seed source AB17");
    engine
        .set_cell_value_parsed(&sid, 20, 15, "6026")
        .expect("seed destination P21");

    engine
        .insert_cells_with_shift(&sid, 20, 14, 1, 14, false)
        .expect("insert O21:AB21 shift down");
    engine
        .relocate_cells(&sid, 16, 14, 16, 27, &sid, 20, 14)
        .expect("relocate O17:AB17 to O21:AB21");

    let q_id = engine.get_cell_id_at(&sid, 20, 16).expect("Q21 id");
    let r_id = engine.get_cell_id_at(&sid, 20, 17).expect("R21 id");
    let q_cell_id = CellId::from_uuid_str(&q_id).expect("Q21 cell id");
    let r_cell_id = CellId::from_uuid_str(&r_id).expect("R21 cell id");

    let after = engine.query_range(&sid, 20, 14, 20, 27);
    let p21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 15)
        .expect("P21 moved value");
    let q21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 16)
        .expect("Q21 moved formula");
    let r21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 17)
        .expect("R21 moved formula");
    let ab21 = after
        .cells
        .iter()
        .find(|cell| cell.row == 20 && cell.col == 27)
        .expect("AB21 moved value");

    assert_eq!(p21.value, CellValue::Number(FiniteF64::must(24336.0)));
    assert_eq!(q21.formula.as_deref(), Some("=49790-P21"));
    assert_eq!(
        engine.get_formula(&q_cell_id).as_deref(),
        Some("=49790-P21")
    );
    assert_eq!(q21.value, CellValue::Number(FiniteF64::must(25454.0)));
    assert_eq!(r21.formula.as_deref(), Some("=75195-P21-Q21"));
    assert_eq!(
        engine.get_formula(&r_cell_id).as_deref(),
        Some("=75195-P21-Q21")
    );
    assert_eq!(r21.value, CellValue::Number(FiniteF64::must(25405.0)));
    assert_eq!(ab21.value, CellValue::Number(FiniteF64::must(23958.0)));

    let source = engine.query_range(&sid, 16, 14, 16, 27);
    assert!(
        source.cells.is_empty(),
        "source O17:AB17 must be empty after relocate: {:?}",
        source.cells
    );
}
