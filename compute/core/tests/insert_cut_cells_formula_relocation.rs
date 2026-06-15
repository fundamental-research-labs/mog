use cell_types::CellId;
use compute_core::storage::engine::YrsComputeEngine;
use compute_wire::constants::{MUTATION_HEADER_SIZE, PATCH_STRIDE};
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

#[derive(Debug, Clone)]
struct DecodedPatch {
    row: u32,
    col: u32,
    flags: u16,
    number_value: f64,
}

fn decode_patches(mutation_bytes: &[u8]) -> Vec<DecodedPatch> {
    if mutation_bytes.len() < MUTATION_HEADER_SIZE {
        return Vec::new();
    }
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    let mut out = Vec::with_capacity(patch_count);
    for i in 0..patch_count {
        let off = patches_start + i * PATCH_STRIDE;
        if off + PATCH_STRIDE > mutation_bytes.len() {
            break;
        }
        let row = u32::from_le_bytes([
            mutation_bytes[off],
            mutation_bytes[off + 1],
            mutation_bytes[off + 2],
            mutation_bytes[off + 3],
        ]);
        let col = u32::from_le_bytes([
            mutation_bytes[off + 4],
            mutation_bytes[off + 5],
            mutation_bytes[off + 6],
            mutation_bytes[off + 7],
        ]);
        let number_value = f64::from_le_bytes([
            mutation_bytes[off + 8],
            mutation_bytes[off + 9],
            mutation_bytes[off + 10],
            mutation_bytes[off + 11],
            mutation_bytes[off + 12],
            mutation_bytes[off + 13],
            mutation_bytes[off + 14],
            mutation_bytes[off + 15],
        ]);
        let flags = u16::from_le_bytes([mutation_bytes[off + 24], mutation_bytes[off + 25]]);
        out.push(DecodedPatch {
            row,
            col,
            flags,
            number_value,
        });
    }
    out
}

fn effective_value_type_at(mutation_bytes: &[u8], row: u32, col: u32) -> Option<u16> {
    decode_patches(mutation_bytes)
        .into_iter()
        .rfind(|patch| patch.row == row && patch.col == col)
        .map(|patch| patch.flags & VALUE_TYPE_MASK)
}

fn effective_number_at(mutation_bytes: &[u8], row: u32, col: u32) -> Option<f64> {
    decode_patches(mutation_bytes)
        .into_iter()
        .rfind(|patch| patch.row == row && patch.col == col)
        .map(|patch| patch.number_value)
}

fn viewport_bytes<'a>(packed: &'a [u8], vp_id: &str) -> Option<&'a [u8]> {
    if packed.len() < 2 {
        return None;
    }
    let count = u16::from_le_bytes([packed[0], packed[1]]) as usize;
    let mut offset = 2usize;
    for _ in 0..count {
        if offset >= packed.len() {
            return None;
        }
        let id_len = packed[offset] as usize;
        offset += 1;
        let id = std::str::from_utf8(&packed[offset..offset + id_len]).ok()?;
        offset += id_len;
        let patch_len = u32::from_le_bytes([
            packed[offset],
            packed[offset + 1],
            packed[offset + 2],
            packed[offset + 3],
        ]) as usize;
        offset += 4;
        if id == vp_id {
            return Some(&packed[offset..offset + patch_len]);
        }
        offset += patch_len;
    }
    None
}

#[test]
fn insert_cut_cells_right_preserves_formula_ref_to_moved_precedent() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

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

    let (patches, _result) = engine
        .relocate_cells_yrs(&sid, 20, 29, 20, 30, &sid, 20, 15)
        .expect("relocate shifted AD21:AE21 to P21:Q21");
    let patch = viewport_bytes(&patches, "vp").expect("vp patch");
    assert_eq!(
        effective_value_type_at(patch, 20, 16),
        Some(VALUE_TYPE_NUMBER),
        "Q21 moved formula target must emit a numeric patch even when the computed value is unchanged"
    );
    let q21_patch_value = effective_number_at(patch, 20, 16).expect("Q21 patch value");
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
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 40,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

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
        .relocate_cells_yrs(&sid, 16, 14, 16, 27, &sid, 20, 14)
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
