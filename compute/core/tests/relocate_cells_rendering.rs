//! Relocation updates values, formulas, identities, and explicit viewport renders.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use compute_wire::constants::{CELL_STRIDE, OFF_FLAGS, OFF_NUMBER_VALUE, VIEWPORT_HEADER_SIZE};
use compute_wire::flags::{VALUE_TYPE_MASK, VALUE_TYPE_NULL, VALUE_TYPE_NUMBER};
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

fn formula_cell(id_suffix: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_two_sheets() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: sheet_id_str(1),
                name: "S1".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![
                    number_cell(100, 0, 0, 10.0),
                    number_cell(101, 0, 1, 20.0),
                    number_cell(102, 1, 0, 30.0),
                    number_cell(103, 1, 1, 40.0),
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: sheet_id_str(2),
                name: "S2".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn snapshot_single_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                number_cell(100, 0, 0, 10.0),
                number_cell(101, 0, 1, 20.0),
                number_cell(102, 1, 0, 30.0),
                number_cell(103, 1, 1, 40.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}
fn snapshot_a1_a3_column() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                number_cell(200, 0, 0, 1.0),
                number_cell(201, 1, 0, 2.0),
                number_cell(202, 2, 0, 3.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn register_viewport(engine: &mut ComputeEngine, sheet_id: &SheetId, vp_id: &str) {
    engine
        .register_viewport(vp_id, sheet_id, 0, 0, 9, 5)
        .expect("register_viewport");
}

fn full_viewport_cell_offset(viewport_bytes: &[u8], row: u32, col: u32) -> Option<usize> {
    if viewport_bytes.len() < VIEWPORT_HEADER_SIZE {
        return None;
    }
    let start_row = u32::from_le_bytes([
        viewport_bytes[0],
        viewport_bytes[1],
        viewport_bytes[2],
        viewport_bytes[3],
    ]);
    let start_col = u32::from_le_bytes([
        viewport_bytes[4],
        viewport_bytes[5],
        viewport_bytes[6],
        viewport_bytes[7],
    ]);
    let cell_count = u32::from_le_bytes([
        viewport_bytes[8],
        viewport_bytes[9],
        viewport_bytes[10],
        viewport_bytes[11],
    ]) as usize;
    let viewport_cols = u16::from_le_bytes([viewport_bytes[22], viewport_bytes[23]]) as u32;
    if row < start_row || col < start_col || viewport_cols == 0 {
        return None;
    }
    let rel_row = row - start_row;
    let rel_col = col - start_col;
    if rel_col >= viewport_cols {
        return None;
    }
    let index = rel_row.checked_mul(viewport_cols)?.checked_add(rel_col)? as usize;
    if index >= cell_count {
        return None;
    }
    let offset = VIEWPORT_HEADER_SIZE + index * CELL_STRIDE;
    (offset + CELL_STRIDE <= viewport_bytes.len()).then_some(offset)
}

fn full_viewport_value_type_at(viewport_bytes: &[u8], row: u32, col: u32) -> Option<u16> {
    let offset = full_viewport_cell_offset(viewport_bytes, row, col)?;
    let flags = u16::from_le_bytes([
        viewport_bytes[offset + OFF_FLAGS],
        viewport_bytes[offset + OFF_FLAGS + 1],
    ]);
    Some(flags & VALUE_TYPE_MASK)
}

fn full_viewport_number_at(viewport_bytes: &[u8], row: u32, col: u32) -> Option<f64> {
    let offset = full_viewport_cell_offset(viewport_bytes, row, col)?;
    Some(f64::from_le_bytes([
        viewport_bytes[offset + OFF_NUMBER_VALUE],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 1],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 2],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 3],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 4],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 5],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 6],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 7],
    ]))
}

#[test]
fn relocate_same_sheet_renders_cleared_sources_and_moved_values() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp-s1");
    let _result = engine
        .relocate_cells(&sid, 0, 0, 1, 1, &sid, 4, 3)
        .expect("relocate_cells");
    let grid = engine.cell_store().get_sheet(&sid).expect("grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, c)).is_none(),
            "source GridIndex pos ({},{}) should be empty post-relocate",
            r,
            c
        );
    }
    for (r, c) in [(4u32, 3u32), (4, 4), (5, 3), (5, 4)] {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, c)).is_some(),
            "target GridIndex pos ({},{}) should hold moved CellId",
            r,
            c
        );
    }
    let bytes = &engine.get_viewport_binary(&sid, 0, 0, 30, 30, false);
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        let vt = full_viewport_value_type_at(bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no patch covers source ({},{}); without a Null patch the \
                 viewport buffer would keep the stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "source ({},{}) must replay as Null in the patch stream; got value_type={}",
            r, c, vt
        );
    }
    for (r, c, expected) in [
        (4u32, 3u32, 10.0f64),
        (4, 4, 20.0),
        (5, 3, 30.0),
        (5, 4, 40.0),
    ] {
        let vt = full_viewport_value_type_at(bytes, r, c)
            .unwrap_or_else(|| panic!("no patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "target ({},{}) must replay as Number; got value_type={}",
            r, c, vt
        );
        let n = full_viewport_number_at(bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "target ({},{}) value: expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }
}

#[test]
fn relocate_cross_sheet_renders_both_sheets() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_two_sheets()).expect("from_snapshot");
    let s1 = engine.cell_store().sheet_by_name("S1").expect("S1");
    let s2 = engine.cell_store().sheet_by_name("S2").expect("S2");
    register_viewport(&mut engine, &s1, "vp-s1");
    register_viewport(&mut engine, &s2, "vp-s2");
    let _result = engine
        .relocate_cells(&s1, 0, 0, 1, 1, &s2, 0, 0)
        .expect("relocate_cells");
    let s1_grid = engine.cell_store().get_sheet(&s1).expect("s1 grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            s1_grid
                .cell_id_at(cell_types::SheetPos::new(r, c))
                .is_none(),
            "source S1!({},{}) GridIndex empty post-cross-sheet relocate",
            r,
            c
        );
    }
    let s2_grid = engine.cell_store().get_sheet(&s2).expect("s2 grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            s2_grid
                .cell_id_at(cell_types::SheetPos::new(r, c))
                .is_some(),
            "target S2!({},{}) GridIndex carries moved CellId",
            r,
            c
        );
    }
    let s1_bytes = &engine.get_viewport_binary(&s1, 0, 0, 30, 30, false);
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        let vt = full_viewport_value_type_at(s1_bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no S1 patch covers source ({},{}) — viewport buffer would \
                 keep stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "S1!({},{}) must replay as Null after cross-sheet move; got {}",
            r, c, vt
        );
    }
    let s2_bytes = &engine.get_viewport_binary(&s2, 0, 0, 30, 30, false);
    for (r, c, expected) in [
        (0u32, 0u32, 10.0f64),
        (0, 1, 20.0),
        (1, 0, 30.0),
        (1, 1, 40.0),
    ] {
        let vt = full_viewport_value_type_at(s2_bytes, r, c)
            .unwrap_or_else(|| panic!("no S2 patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "S2!({},{}) must replay as Number; got value_type={}",
            r, c, vt
        );
        let n = full_viewport_number_at(s2_bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "S2!({},{}): expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }
}
#[test]
fn relocate_writes_all_target_positions_not_just_last() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");
    let _ = engine
        .relocate_cells(&sid, 0, 0, 1, 1, &sid, 4, 3)
        .expect("relocate_cells");
    let grid = engine.cell_store().get_sheet(&sid).expect("grid");
    for (r, c) in [(4u32, 3u32), (4, 4), (5, 3), (5, 4)] {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, c)).is_some(),
            "target ({},{}) populated post-relocate",
            r,
            c
        );
    }
}
#[test]
fn cut_clears_source_on_paste_only() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_a1_a3_column()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");
    let _result = engine
        .relocate_cells(&sid, 0, 0, 2, 0, &sid, 0, 2)
        .expect("relocate_cells");

    let bytes = &engine.get_viewport_binary(&sid, 0, 0, 30, 30, false);
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        let vt = full_viewport_value_type_at(bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no patch covers source ({},{}) — without a Null patch the \
                 viewport buffer keeps showing the stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "source ({},{}) must replay as Null; got value_type={}",
            r, c, vt
        );
    }
    for (r, c, expected) in [(0u32, 2u32, 1.0f64), (1, 2, 2.0), (2, 2, 3.0)] {
        let vt = full_viewport_value_type_at(bytes, r, c)
            .unwrap_or_else(|| panic!("no patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "target ({},{}) must replay as Number",
            r, c
        );
        let n = full_viewport_number_at(bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "target ({},{}): expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }
    let grid = engine.cell_store().get_sheet(&sid).expect("grid");
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, c)).is_none(),
            "GridIndex source ({},{}) should be empty",
            r,
            c
        );
    }
    for (r, c) in [(0u32, 2u32), (1, 2), (2, 2)] {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, c)).is_some(),
            "GridIndex target ({},{}) should be populated",
            r,
            c
        );
    }
    let qr = engine.query_range(&sid, 0, 0, 2, 2);
    let cells_at = |r: u32, c: u32| qr.cells.iter().find(|cd| cd.row == r && cd.col == c);
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        assert!(
            cells_at(r, c).is_none(),
            "query_range source ({},{}) must be empty after relocate; got {:?}",
            r,
            c,
            cells_at(r, c),
        );
    }
    for (r, c, expected) in [(0u32, 2u32, 1.0), (1, 2, 2.0), (2, 2, 3.0)] {
        let entry =
            cells_at(r, c).unwrap_or_else(|| panic!("query_range target ({},{}) missing", r, c));
        match &entry.value {
            value_types::CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < f64::EPSILON,
                "query_range target ({},{}): expected {}, got {}",
                r,
                c,
                expected,
                n.get(),
            ),
            other => panic!(
                "query_range target ({},{}) expected Number, got {:?}",
                r, c, other
            ),
        }
    }
}
#[test]
fn relocate_formula_cell_after_insert_down_writes_target_patch_when_source_offscreen() {
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
                number_cell(200, 6, 23, 10.0),
                number_cell(201, 6, 24, 20.0),
                number_cell(202, 6, 25, 30.0),
                formula_cell(203, 6, 26, "=1000-Z7-Y7-X7"),
                number_cell(204, 6, 27, 123.0),
                number_cell(205, 6, 12, 505.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");

    let before = engine.query_range(&sid, 6, 26, 6, 27);
    let aa7 = before
        .cells
        .iter()
        .find(|cell| cell.row == 6 && cell.col == 26)
        .expect("AA7 formula before cut");
    assert_eq!(aa7.value, CellValue::Number(FiniteF64::must(940.0)));
    assert_eq!(aa7.formula.as_deref(), Some("=1000-Z7-Y7-X7"));

    engine
        .register_viewport("vp", &sid, 0, 0, 20, 15)
        .expect("register destination viewport");

    engine
        .insert_cells_with_shift(&sid, 6, 11, 1, 2, false)
        .expect("insert L7:M7 shift down");
    let _result = engine
        .relocate_cells(&sid, 6, 26, 6, 27, &sid, 6, 11)
        .expect("relocate AA7:AB7 to L7:M7");
    let bytes = &engine.get_viewport_binary(&sid, 0, 0, 30, 30, false);

    let l7_vt = full_viewport_value_type_at(bytes, 6, 11).expect("patch at target L7");
    assert_eq!(
        l7_vt, VALUE_TYPE_NUMBER,
        "target L7 must replay as Number for the moved offscreen formula; got value_type={}",
        l7_vt
    );
    let l7_number = full_viewport_number_at(bytes, 6, 11).expect("L7 number");
    assert!(
        (l7_number - 940.0).abs() < f64::EPSILON,
        "target L7 expected evaluated formula value 940, got {}",
        l7_number
    );

    let m7_vt = full_viewport_value_type_at(bytes, 6, 12).expect("patch at target M7");
    assert_eq!(
        m7_vt, VALUE_TYPE_NUMBER,
        "target M7 must replay as Number for the moved value"
    );
    let m7_number = full_viewport_number_at(bytes, 6, 12).expect("M7 number");
    assert!(
        (m7_number - 123.0).abs() < f64::EPSILON,
        "target M7 expected moved value 123, got {}",
        m7_number
    );

    let after = engine.query_range(&sid, 6, 11, 6, 12);
    let l7 = after
        .cells
        .iter()
        .find(|cell| cell.row == 6 && cell.col == 11)
        .expect("L7 formula cell");
    assert_eq!(l7.value, CellValue::Number(FiniteF64::must(940.0)));
    assert_eq!(l7.formula.as_deref(), Some("=1000-Z7-Y7-X7"));

    let full_viewport = engine.get_viewport_binary(&sid, 0, 0, 20, 15, false);
    let full_l7_vt =
        full_viewport_value_type_at(&full_viewport, 6, 11).expect("full viewport L7 record");
    assert_eq!(
        full_l7_vt, VALUE_TYPE_NUMBER,
        "full viewport rebuild must serialize L7 as Number after relocate; got value_type={}",
        full_l7_vt
    );
    let full_l7_number =
        full_viewport_number_at(&full_viewport, 6, 11).expect("full viewport L7 number");
    assert!(
        (full_l7_number - 940.0).abs() < f64::EPSILON,
        "full viewport rebuild expected L7 value 940, got {}",
        full_l7_number
    );
}
#[test]
fn relocate_overlap_keeps_destination_writes() {
    let (mut engine, _) =
        ComputeEngine::from_snapshot(snapshot_a1_a3_column()).expect("from_snapshot");
    let sid = engine.cell_store().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");
    let _result = engine
        .relocate_cells(&sid, 0, 0, 2, 0, &sid, 1, 0)
        .expect("relocate_cells");

    let bytes = &engine.get_viewport_binary(&sid, 0, 0, 30, 30, false);
    let a1 = full_viewport_value_type_at(bytes, 0, 0).expect("patch at A1");
    assert_eq!(
        a1, VALUE_TYPE_NULL,
        "A1 must replay as Null after overlap move; got value_type={}",
        a1
    );
    for (r, expected) in [(1u32, 1.0f64), (2, 2.0), (3, 3.0)] {
        let vt = full_viewport_value_type_at(bytes, r, 0)
            .unwrap_or_else(|| panic!("no patch covers ({}, 0)", r));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "({}, 0) must replay as Number after overlap move; got value_type={} \
             (overlap filter broken — source-clear pass shadowed the destination write)",
            r, vt
        );
        let n = full_viewport_number_at(bytes, r, 0).expect("number at overlap target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "({}, 0): expected {}, got {}",
            r,
            expected,
            n
        );
    }
    let grid = engine.cell_store().get_sheet(&sid).expect("grid");
    assert!(
        grid.cell_id_at(cell_types::SheetPos::new(0, 0)).is_none(),
        "A1 GridIndex empty post-overlap-move"
    );
    for r in 1u32..=3 {
        assert!(
            grid.cell_id_at(cell_types::SheetPos::new(r, 0)).is_some(),
            "({}, 0) GridIndex populated post-overlap-move",
            r
        );
    }
}
