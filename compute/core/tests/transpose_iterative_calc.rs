//! Integration tests for TRANSPOSE spill behavior with iterative_calc enabled.
//!
//! These tests reproduce an imported-workbook bug where TRANSPOSE formulas compute correctly at the anchor
//! cell but fail to spill into adjacent cells. The key differentiator from the
//! passing tests in recalc_projection.rs is `iterative_calc: true` — the XLSX
//! workbook has `<calcPr iterate="1"/>`.
//!
//! Bug signature:
//!   P29 = TRANSPOSE('SourceB'!C5:C29) → anchor P29 = 197 (correct)
//!   Q29:AN29 remain null (should be 448, 475, 529, ...)
//!   → SUM(Q28:Q29) = 0 instead of 448
//!   → cascades to 25,000+ downstream mismatches
//!
//! XLSX metadata on TRANSPOSE cells:
//!   <c r="P28" s="322" cm="1">
//!     <f t="array" ref="P28:AN28">TRANSPOSE(...)</f>
//!     <v>0</v>
//!   </c>
//!
//! Run:
//!   cargo test -p compute-core --test transpose_iterative_calc -- --nocapture

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers (same UUID scheme as recalc_projection.rs)
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a WorkbookSnapshot with iterative_calc support and optional array_ref.
/// Each cell is (row, col, value, formula, array_ref).
fn build_snapshot_iterative(
    sheets: Vec<(
        &str,
        u32,
        u32,
        Vec<(u32, u32, CellValue, Option<&str>, Option<&str>)>,
    )>,
    iterative_calc: bool,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula, arr_ref)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn assert_mirror_number(mirror: &CellMirror, cell_id: &CellId, expected: f64, label: &str) {
    match mirror.get_cell_value(cell_id) {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "{}: expected {}, got {}",
                label,
                expected,
                n.get()
            );
        }
        Some(other) => panic!("{}: expected Number({}), got {:?}", label, expected, other),
        None => panic!(
            "{}: cell not found in mirror (expected Number({}))",
            label, expected
        ),
    }
}

fn assert_col_data_number(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    expected: f64,
    label: &str,
) {
    let sheet_mirror = mirror
        .get_sheet(sheet_id)
        .unwrap_or_else(|| panic!("{}: sheet not found", label));
    let col_slice = sheet_mirror
        .get_column_slice(col)
        .unwrap_or_else(|| panic!("{}: col_data for column {} not found", label, col));
    assert!(
        (row as usize) < col_slice.len(),
        "{}: row {} out of bounds (col_slice len={})",
        label,
        row,
        col_slice.len()
    );
    match &col_slice[row as usize] {
        CellValue::Number(n) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "{}: expected {}, got {}",
                label,
                expected,
                n.get()
            );
        }
        other => panic!(
            "{}: expected Number({}) at ({},{}), got {:?}",
            label, expected, row, col, other
        ),
    }
}

// ---------------------------------------------------------------------------
// Test 1: Single-sheet TRANSPOSE spill with iterative_calc=true
// ---------------------------------------------------------------------------

/// Basic TRANSPOSE spill with iterative_calc enabled.
/// This is the minimal repro: same as the passing test in recalc_projection.rs
/// but with iterative_calc=true.
#[test]
fn test_transpose_spill_iterative_calc_basic() {
    let snapshot = build_snapshot_iterative(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(10.0), None, None),
                (1, 0, CellValue::number(20.0), None, None),
                (2, 0, CellValue::number(30.0), None, None),
                (3, 0, CellValue::number(40.0), None, None),
                (4, 0, CellValue::number(50.0), None, None),
                // B1 = TRANSPOSE(A1:A5) — should spill B1:F1
                (0, 1, CellValue::Null, Some("TRANSPOSE(A1:A5)"), None),
                // G1 = SUM over spill range
                (0, 6, CellValue::Null, Some("SUM(B1:F1)"), None),
            ],
        )],
        true, // iterative_calc = true
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    assert_mirror_number(&mirror, &b1, 10.0, "B1 TRANSPOSE source");
    assert_col_data_number(&mirror, &sid, 0, 2, 20.0, "C1 spill");
    assert_col_data_number(&mirror, &sid, 0, 3, 30.0, "D1 spill");
    assert_col_data_number(&mirror, &sid, 0, 4, 40.0, "E1 spill");
    assert_col_data_number(&mirror, &sid, 0, 5, 50.0, "F1 spill");
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM over spill");
}

// ---------------------------------------------------------------------------
// Test 2: TRANSPOSE + array_ref + iterative_calc
// ---------------------------------------------------------------------------

/// TRANSPOSE with array_ref pre-registration AND iterative_calc=true.
/// This matches the exact XLSX metadata: cm="1", t="array", ref="B1:F1".
#[test]
fn test_transpose_array_ref_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![(
            "Sheet1",
            100,
            26,
            vec![
                (0, 0, CellValue::number(10.0), None, None),
                (1, 0, CellValue::number(20.0), None, None),
                (2, 0, CellValue::number(30.0), None, None),
                (3, 0, CellValue::number(40.0), None, None),
                (4, 0, CellValue::number(50.0), None, None),
                // B1: TRANSPOSE with array_ref (pre-registers projection)
                (
                    0,
                    1,
                    CellValue::number(10.0),
                    Some("TRANSPOSE(A1:A5)"),
                    Some("B1:F1"),
                ),
                // G1: SUM over the spill range
                (0, 6, CellValue::Null, Some("SUM(B1:F1)"), None),
            ],
        )],
        true, // iterative_calc
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid = SheetId::from_uuid_str(&sheet_uuid(0)).expect("sid");
    let b1 = CellId::from_uuid_str(&cell_uuid(0, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(0, 0, 6)).expect("g1");

    assert_mirror_number(
        &mirror,
        &b1,
        10.0,
        "B1 TRANSPOSE source (array_ref+iterative)",
    );
    assert_col_data_number(&mirror, &sid, 0, 2, 20.0, "C1 spill");
    assert_col_data_number(&mirror, &sid, 0, 3, 30.0, "D1 spill");
    assert_col_data_number(&mirror, &sid, 0, 4, 40.0, "E1 spill");
    assert_col_data_number(&mirror, &sid, 0, 5, 50.0, "F1 spill");
    assert_mirror_number(&mirror, &g1, 150.0, "G1 SUM (array_ref+iterative)");
}

// ---------------------------------------------------------------------------
// Test 3: Cross-sheet TRANSPOSE + iterative_calc
// ---------------------------------------------------------------------------

/// Cross-sheet TRANSPOSE with iterative_calc=true.
/// Source data on one sheet, TRANSPOSE + SUM on another.
#[test]
fn test_transpose_cross_sheet_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![
            (
                "Source",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(10.0), None, None),
                    (1, 2, CellValue::number(20.0), None, None),
                    (2, 2, CellValue::number(30.0), None, None),
                    (3, 2, CellValue::number(40.0), None, None),
                    (4, 2, CellValue::number(50.0), None, None),
                ],
            ),
            (
                "Output",
                100,
                100,
                vec![
                    // B1 = TRANSPOSE(Source!C1:C5) → spill B1:F1
                    (0, 1, CellValue::Null, Some("TRANSPOSE(Source!C1:C5)"), None),
                    // G1 = SUM(B1:F1)
                    (0, 6, CellValue::Null, Some("SUM(B1:F1)"), None),
                ],
            ),
        ],
        true,
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid1");
    let b1 = CellId::from_uuid_str(&cell_uuid(1, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(1, 0, 6)).expect("g1");

    assert_mirror_number(&mirror, &b1, 10.0, "Output B1 TRANSPOSE source");
    assert_col_data_number(&mirror, &sid1, 0, 2, 20.0, "Output C1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 3, 30.0, "Output D1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 4, 40.0, "Output E1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 5, 50.0, "Output F1 spill");
    assert_mirror_number(&mirror, &g1, 150.0, "Output G1 SUM");
}

// ---------------------------------------------------------------------------
// Test 4: Cross-sheet + array_ref + iterative_calc
// ---------------------------------------------------------------------------

/// Synthetic reproduction of the imported-workbook bug scenario:
/// - Cross-sheet TRANSPOSE with array_ref pre-registration
/// - iterative_calc=true
/// - Cached value on the anchor cell (as imported files provide)
///
/// Import metadata: <c cm="1"><f t="array" ref="B1:F1">TRANSPOSE(Source!C1:C5)</f><v>10</v></c>
#[test]
fn test_transpose_cross_sheet_array_ref_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![
            (
                "Source",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(10.0), None, None),
                    (1, 2, CellValue::number(20.0), None, None),
                    (2, 2, CellValue::number(30.0), None, None),
                    (3, 2, CellValue::number(40.0), None, None),
                    (4, 2, CellValue::number(50.0), None, None),
                ],
            ),
            (
                "Output",
                100,
                100,
                vec![
                    // B1: TRANSPOSE with array_ref + cached value (matches XLSX exactly)
                    (
                        0,
                        1,
                        CellValue::number(10.0),
                        Some("TRANSPOSE(Source!C1:C5)"),
                        Some("B1:F1"),
                    ),
                    // G1: SUM over the spill range
                    (0, 6, CellValue::Null, Some("SUM(B1:F1)"), None),
                ],
            ),
        ],
        true,
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid1 = SheetId::from_uuid_str(&sheet_uuid(1)).expect("sid1");
    let b1 = CellId::from_uuid_str(&cell_uuid(1, 0, 1)).expect("b1");
    let g1 = CellId::from_uuid_str(&cell_uuid(1, 0, 6)).expect("g1");

    assert_mirror_number(
        &mirror,
        &b1,
        10.0,
        "Output B1 TRANSPOSE source (cross-sheet+array_ref+iterative)",
    );
    assert_col_data_number(&mirror, &sid1, 0, 2, 20.0, "Output C1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 3, 30.0, "Output D1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 4, 40.0, "Output E1 spill");
    assert_col_data_number(&mirror, &sid1, 0, 5, 50.0, "Output F1 spill");
    assert_mirror_number(
        &mirror,
        &g1,
        150.0,
        "Output G1 SUM (cross-sheet+array_ref+iterative)",
    );
}

// ---------------------------------------------------------------------------
// Test 5: Three-sheet cascade (SourceA + SourceB → Output) + iterative_calc
// ---------------------------------------------------------------------------

/// Reproduces a synthetic three-sheet output pattern:
///   "SourceA":   C1:C5 = [0, 0, 1, 7, 192]
///   "SourceB":    C1:C5 = [197, 448, 475, 529, 377]
///   "Output":
///     P1 = TRANSPOSE(SourceA!C1:C5) with array_ref="P1:T1"
///     P2 = TRANSPOSE(SourceB!C1:C5)  with array_ref="P2:T2"
///     P3 = SUM(P1:P2), Q3 = SUM(Q1:Q2), ...
///
/// The bug: Q1:T1 and Q2:T2 remain null → SUM returns 0 instead of correct values.
#[test]
fn test_three_sheet_transpose_cascade_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![
            // Sheet 0: "SourceA"
            (
                "SourceA",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(0.0), None, None),
                    (1, 2, CellValue::number(0.0), None, None),
                    (2, 2, CellValue::number(1.0), None, None),
                    (3, 2, CellValue::number(7.0), None, None),
                    (4, 2, CellValue::number(192.0), None, None),
                ],
            ),
            // Sheet 1: "SourceB"
            (
                "SourceB",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(197.0), None, None),
                    (1, 2, CellValue::number(448.0), None, None),
                    (2, 2, CellValue::number(475.0), None, None),
                    (3, 2, CellValue::number(529.0), None, None),
                    (4, 2, CellValue::number(377.0), None, None),
                ],
            ),
            // Sheet 2: "Output"
            (
                "Output",
                100,
                100,
                vec![
                    // P1 = TRANSPOSE(SourceA!C1:C5) with array_ref P1:T1
                    (
                        0,
                        15,
                        CellValue::number(0.0),
                        Some("TRANSPOSE(SourceA!C1:C5)"),
                        Some("P1:T1"),
                    ),
                    // P2 = TRANSPOSE(SourceB!C1:C5) with array_ref P2:T2
                    (
                        1,
                        15,
                        CellValue::number(197.0),
                        Some("TRANSPOSE(SourceB!C1:C5)"),
                        Some("P2:T2"),
                    ),
                    // SUM row: P3 through T3
                    (2, 15, CellValue::Null, Some("SUM(P1:P2)"), None), // P3
                    (2, 16, CellValue::Null, Some("SUM(Q1:Q2)"), None), // Q3
                    (2, 17, CellValue::Null, Some("SUM(R1:R2)"), None), // R3
                    (2, 18, CellValue::Null, Some("SUM(S1:S2)"), None), // S3
                    (2, 19, CellValue::Null, Some("SUM(T1:T2)"), None), // T3
                ],
            ),
        ],
        true,
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Output");

    // TRANSPOSE anchors
    let p1 = CellId::from_uuid_str(&cell_uuid(2, 0, 15)).expect("p1");
    let p2 = CellId::from_uuid_str(&cell_uuid(2, 1, 15)).expect("p2");
    assert_mirror_number(&mirror, &p1, 0.0, "Output!P1 SourceA TRANSPOSE anchor");
    assert_mirror_number(&mirror, &p2, 197.0, "Output!P2 SourceB TRANSPOSE anchor");

    // SourceA spill (row 0): Q1=0, R1=1, S1=7, T1=192
    assert_col_data_number(&mirror, &sid2, 0, 16, 0.0, "Output!Q1 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 0, 17, 1.0, "Output!R1 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 0, 18, 7.0, "Output!S1 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 0, 19, 192.0, "Output!T1 SourceA spill");

    // SourceB spill (row 1): Q2=448, R2=475, S2=529, T2=377
    assert_col_data_number(&mirror, &sid2, 1, 16, 448.0, "Output!Q2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 17, 475.0, "Output!R2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 18, 529.0, "Output!S2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 19, 377.0, "Output!T2 SourceB spill");

    // SUM row: P3 through T3
    let p3 = CellId::from_uuid_str(&cell_uuid(2, 2, 15)).expect("p3");
    let q3 = CellId::from_uuid_str(&cell_uuid(2, 2, 16)).expect("q3");
    let r3 = CellId::from_uuid_str(&cell_uuid(2, 2, 17)).expect("r3");
    let s3 = CellId::from_uuid_str(&cell_uuid(2, 2, 18)).expect("s3");
    let t3 = CellId::from_uuid_str(&cell_uuid(2, 2, 19)).expect("t3");

    assert_mirror_number(&mirror, &p3, 197.0, "P3 SUM(P1:P2) = 0+197");
    assert_mirror_number(&mirror, &q3, 448.0, "Q3 SUM(Q1:Q2) = 0+448");
    assert_mirror_number(&mirror, &r3, 476.0, "R3 SUM(R1:R2) = 1+475");
    assert_mirror_number(&mirror, &s3, 536.0, "S3 SUM(S1:S2) = 7+529");
    assert_mirror_number(&mirror, &t3, 569.0, "T3 SUM(T1:T2) = 192+377");
}

// ---------------------------------------------------------------------------
// Test 6: Full 4-sheet cascade + iterative_calc (matches XLSX exactly)
// ---------------------------------------------------------------------------

/// Full reproduction of the imported-workbook cascade shape:
///   Sheet "SourceA":   C1:C5 = [0, 0, 1, 7, 192]
///   Sheet "SourceB":    C1:C5 = [197, 448, 475, 529, 377]
///   Sheet "Output":
///     B1 = TRANSPOSE(SourceA!C1:C5) with array_ref="B1:F1" → [0,0,1,7,192]
///     B2 = TRANSPOSE(SourceB!C1:C5)  with array_ref="B2:F2" → [197,448,475,529,377]
///     B3 = SUM(B1:B2), C3 = SUM(C1:C2), ...
///   Sheet "Projection":
///     A1 = TRANSPOSE('Output'!B2:F2) with array_ref="A1:A5"
///       → reads from Output spill targets → vertical [197,448,475,529,377]
///     B1:B5 = IF($A>0, $A*2, 0) — reads from A column spill
///
/// The bug: Output!C2:F2 are null → Projection!A2:A5 are null → IF returns 0.
#[test]
fn test_full_four_sheet_cascade_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![
            // Sheet 0: "SourceA"
            (
                "SourceA",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(0.0), None, None),
                    (1, 2, CellValue::number(0.0), None, None),
                    (2, 2, CellValue::number(1.0), None, None),
                    (3, 2, CellValue::number(7.0), None, None),
                    (4, 2, CellValue::number(192.0), None, None),
                ],
            ),
            // Sheet 1: "SourceB"
            (
                "SourceB",
                10,
                10,
                vec![
                    (0, 2, CellValue::number(197.0), None, None),
                    (1, 2, CellValue::number(448.0), None, None),
                    (2, 2, CellValue::number(475.0), None, None),
                    (3, 2, CellValue::number(529.0), None, None),
                    (4, 2, CellValue::number(377.0), None, None),
                ],
            ),
            // Sheet 2: "Output"
            (
                "Output",
                10,
                10,
                vec![
                    // B1 = TRANSPOSE(SourceA!C1:C5) with array_ref
                    (
                        0,
                        1,
                        CellValue::number(0.0),
                        Some("TRANSPOSE(SourceA!C1:C5)"),
                        Some("B1:F1"),
                    ),
                    // B2 = TRANSPOSE(SourceB!C1:C5) with array_ref
                    (
                        1,
                        1,
                        CellValue::number(197.0),
                        Some("TRANSPOSE(SourceB!C1:C5)"),
                        Some("B2:F2"),
                    ),
                    // SUM row
                    (2, 1, CellValue::Null, Some("SUM(B1:B2)"), None), // B3
                    (2, 2, CellValue::Null, Some("SUM(C1:C2)"), None), // C3
                    (2, 3, CellValue::Null, Some("SUM(D1:D2)"), None), // D3
                    (2, 4, CellValue::Null, Some("SUM(E1:E2)"), None), // E3
                    (2, 5, CellValue::Null, Some("SUM(F1:F2)"), None), // F3
                ],
            ),
            // Sheet 3: "Projection"
            (
                "Projection",
                10,
                10,
                vec![
                    // A1 = TRANSPOSE('Output'!B2:F2) with array_ref
                    (
                        0,
                        0,
                        CellValue::number(197.0),
                        Some("TRANSPOSE('Output'!B2:F2)"),
                        Some("A1:A5"),
                    ),
                    // IF formulas reading from A column spill targets
                    (0, 1, CellValue::Null, Some("IF($A1>0,$A1*2,0)"), None),
                    (1, 1, CellValue::Null, Some("IF($A2>0,$A2*2,0)"), None),
                    (2, 1, CellValue::Null, Some("IF($A3>0,$A3*2,0)"), None),
                    (3, 1, CellValue::Null, Some("IF($A4>0,$A4*2,0)"), None),
                    (4, 1, CellValue::Null, Some("IF($A5>0,$A5*2,0)"), None),
                ],
            ),
        ],
        true,
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Output");
    let sid3 = SheetId::from_uuid_str(&sheet_uuid(3)).expect("sid Projection");

    // === Output ===
    let rb_b1 = CellId::from_uuid_str(&cell_uuid(2, 0, 1)).expect("rb b1");
    let rb_b2 = CellId::from_uuid_str(&cell_uuid(2, 1, 1)).expect("rb b2");
    assert_mirror_number(&mirror, &rb_b1, 0.0, "Output!B1 SourceA anchor");
    assert_mirror_number(&mirror, &rb_b2, 197.0, "Output!B2 SourceB anchor");

    // SourceB spill: C2=448, D2=475, E2=529, F2=377
    assert_col_data_number(&mirror, &sid2, 1, 2, 448.0, "Output!C2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 3, 475.0, "Output!D2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 4, 529.0, "Output!E2 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 1, 5, 377.0, "Output!F2 SourceB spill");

    // SUM row
    let rb_b3 = CellId::from_uuid_str(&cell_uuid(2, 2, 1)).expect("rb b3");
    let rb_c3 = CellId::from_uuid_str(&cell_uuid(2, 2, 2)).expect("rb c3");
    let rb_d3 = CellId::from_uuid_str(&cell_uuid(2, 2, 3)).expect("rb d3");
    assert_mirror_number(&mirror, &rb_b3, 197.0, "Output!B3 SUM");
    assert_mirror_number(&mirror, &rb_c3, 448.0, "Output!C3 SUM");
    assert_mirror_number(&mirror, &rb_d3, 476.0, "Output!D3 SUM");

    // === Projection ===
    let fc_a1 = CellId::from_uuid_str(&cell_uuid(3, 0, 0)).expect("fc a1");
    assert_mirror_number(
        &mirror,
        &fc_a1,
        197.0,
        "Projection!A1 chained TRANSPOSE anchor",
    );

    // Chained spill targets: A2=448, A3=475, A4=529, A5=377
    assert_col_data_number(&mirror, &sid3, 1, 0, 448.0, "Projection!A2 chained spill");
    assert_col_data_number(&mirror, &sid3, 2, 0, 475.0, "Projection!A3 chained spill");
    assert_col_data_number(&mirror, &sid3, 3, 0, 529.0, "Projection!A4 chained spill");
    assert_col_data_number(&mirror, &sid3, 4, 0, 377.0, "Projection!A5 chained spill");

    // IF formulas
    let fc_b1 = CellId::from_uuid_str(&cell_uuid(3, 0, 1)).expect("fc b1");
    let fc_b2 = CellId::from_uuid_str(&cell_uuid(3, 1, 1)).expect("fc b2");
    let fc_b3 = CellId::from_uuid_str(&cell_uuid(3, 2, 1)).expect("fc b3");
    let fc_b4 = CellId::from_uuid_str(&cell_uuid(3, 3, 1)).expect("fc b4");
    let fc_b5 = CellId::from_uuid_str(&cell_uuid(3, 4, 1)).expect("fc b5");
    assert_mirror_number(&mirror, &fc_b1, 394.0, "Projection!B1 IF(A1>0) = 197*2");
    assert_mirror_number(&mirror, &fc_b2, 896.0, "Projection!B2 IF(A2>0) = 448*2");
    assert_mirror_number(&mirror, &fc_b3, 950.0, "Projection!B3 IF(A3>0) = 475*2");
    assert_mirror_number(&mirror, &fc_b4, 1058.0, "Projection!B4 IF(A4>0) = 529*2");
    assert_mirror_number(&mirror, &fc_b5, 754.0, "Projection!B5 IF(A5>0) = 377*2");
}

// ---------------------------------------------------------------------------
// Test 7: 25-element TRANSPOSE at high row/col offset + iterative_calc
// ---------------------------------------------------------------------------

/// Uses 25 elements placed at high row/col positions (row 27-28, col 15 = "P").
/// This tests scale + position sensitivity with iterative_calc.
#[test]
fn test_transpose_25_elements_high_offset_iterative_calc() {
    // Source data: 25 values for the synthetic high-offset spill case.
    let annual_data: Vec<f64> = vec![
        197.0, 448.0, 475.0, 529.0, 377.0, 273.0, 354.0, 328.0, 323.0, 444.0, 398.0, 1187.0,
        1264.0, 993.0, 876.0, 875.0, 1149.0, 1194.0, 777.0, 1125.0, 850.0, 893.0, 895.0, 1514.0,
        4305.0,
    ];
    let monthly_data: Vec<f64> = vec![
        0.0, 0.0, 0.0, 1.0, 7.0, 192.0, 276.0, 268.0, 265.0, 284.0, 366.0, 579.0, 805.0, 838.0,
        811.0, 719.0, 713.0, 691.0, 512.0, 610.0, 570.0, 511.0, 641.0, 644.0, 962.0,
    ];

    // Build source cells for SourceA (col C = col 2, rows 4-28 = C5:C29)
    let mut monthly_cells: Vec<(u32, u32, CellValue, Option<&str>, Option<&str>)> = Vec::new();
    for (i, &v) in monthly_data.iter().enumerate() {
        monthly_cells.push((4 + i as u32, 2, CellValue::number(v), None, None));
    }

    let mut annual_cells: Vec<(u32, u32, CellValue, Option<&str>, Option<&str>)> = Vec::new();
    for (i, &v) in annual_data.iter().enumerate() {
        annual_cells.push((4 + i as u32, 2, CellValue::number(v), None, None));
    }

    // Output: TRANSPOSE at row 27 (P28) and row 28 (P29), col 15 (P)
    // array_ref: P28:AN28 (col 15 to col 39)
    let mut rev_build_cells: Vec<(u32, u32, CellValue, Option<&str>, Option<&str>)> = vec![
        // P28 = TRANSPOSE(SourceA!C5:C29) with array_ref="P28:AN28"
        (
            27,
            15,
            CellValue::number(monthly_data[0]),
            Some("TRANSPOSE(SourceA!C5:C29)"),
            Some("P28:AN28"),
        ),
        // P29 = TRANSPOSE(SourceB!C5:C29) with array_ref="P29:AN29"
        (
            28,
            15,
            CellValue::number(annual_data[0]),
            Some("TRANSPOSE(SourceB!C5:C29)"),
            Some("P29:AN29"),
        ),
    ];
    // SUM row: P22 = SUM(P28:P29), Q22 = SUM(Q28:Q29), ...
    // Using row 21 (row 22 in A1), cols 15-39 (P through AN)
    for col_offset in 0..25u32 {
        let col = 15 + col_offset;
        let col_letter = if col < 26 {
            format!("{}", (b'A' + col as u8) as char)
        } else {
            format!("A{}", (b'A' + (col - 26) as u8) as char)
        };
        let _formula = format!("SUM({}28:{}29)", col_letter, col_letter);
        rev_build_cells.push((21, col, CellValue::Null, None, None));
        // Can't use &formula directly since it's temporary — store formula in cell
        // We'll add the SUM formulas separately
    }

    // Build SUM formulas manually with static strings
    // We need to be careful with lifetime of formula strings
    // Use a different approach: build all SUM formulas as part of the cells vec
    let mut rev_build_cells: Vec<(u32, u32, CellValue, Option<String>, Option<&str>)> = vec![
        (
            27,
            15,
            CellValue::number(monthly_data[0]),
            Some("TRANSPOSE(SourceA!C5:C29)".to_string()),
            Some("P28:AN28"),
        ),
        (
            28,
            15,
            CellValue::number(annual_data[0]),
            Some("TRANSPOSE(SourceB!C5:C29)".to_string()),
            Some("P29:AN29"),
        ),
    ];

    let col_names = [
        "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF",
        "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN",
    ];
    for (i, col_name) in col_names.iter().enumerate() {
        let formula = format!("SUM({}28:{}29)", col_name, col_name);
        rev_build_cells.push((21, 15 + i as u32, CellValue::Null, Some(formula), None));
    }

    // Build the snapshot manually to avoid lifetime issues
    let sheets = vec![
        {
            let si = 0u32;
            let cell_data: Vec<CellData> = monthly_cells
                .into_iter()
                .map(|(row, col, value, formula, arr_ref)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: "SourceA".to_string(),
                rows: 30,
                cols: 10,
                cells: cell_data,
                ranges: vec![],
            }
        },
        {
            let si = 1u32;
            let cell_data: Vec<CellData> = annual_cells
                .into_iter()
                .map(|(row, col, value, formula, arr_ref)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: "SourceB".to_string(),
                rows: 30,
                cols: 10,
                cells: cell_data,
                ranges: vec![],
            }
        },
        {
            let si = 2u32;
            let cell_data: Vec<CellData> = rev_build_cells
                .into_iter()
                .map(|(row, col, value, formula, arr_ref)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula,
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: "Output".to_string(),
                rows: 300,
                cols: 100,
                cells: cell_data,
                ranges: vec![],
            }
        },
    ];

    let snapshot = WorkbookSnapshot {
        sheets,
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: true,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    let sid2 = SheetId::from_uuid_str(&sheet_uuid(2)).expect("sid Output");

    // Verify TRANSPOSE anchors
    let p28 = CellId::from_uuid_str(&cell_uuid(2, 27, 15)).expect("p28");
    let p29 = CellId::from_uuid_str(&cell_uuid(2, 28, 15)).expect("p29");
    assert_mirror_number(&mirror, &p28, monthly_data[0], "P28 SourceA anchor");
    assert_mirror_number(&mirror, &p29, annual_data[0], "P29 SourceB anchor");

    // Verify spill targets for row 28 (SourceA): Q28=0, R28=0, S28=1, T28=7, U28=192
    assert_col_data_number(&mirror, &sid2, 27, 16, monthly_data[1], "Q28 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 27, 17, monthly_data[2], "R28 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 27, 18, monthly_data[3], "S28 SourceA spill");
    assert_col_data_number(&mirror, &sid2, 27, 19, monthly_data[4], "T28 SourceA spill");

    // Verify spill targets for row 29 (SourceB): Q29=448, R29=475, S29=529, T29=377
    assert_col_data_number(&mirror, &sid2, 28, 16, annual_data[1], "Q29 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 28, 17, annual_data[2], "R29 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 28, 18, annual_data[3], "S29 SourceB spill");
    assert_col_data_number(&mirror, &sid2, 28, 19, annual_data[4], "T29 SourceB spill");

    // Verify SUM row (row 21): P22 through T22
    let p22 = CellId::from_uuid_str(&cell_uuid(2, 21, 15)).expect("p22");
    let q22 = CellId::from_uuid_str(&cell_uuid(2, 21, 16)).expect("q22");
    let r22 = CellId::from_uuid_str(&cell_uuid(2, 21, 17)).expect("r22");
    let s22 = CellId::from_uuid_str(&cell_uuid(2, 21, 18)).expect("s22");
    let t22 = CellId::from_uuid_str(&cell_uuid(2, 21, 19)).expect("t22");

    // P22 = SUM(P28:P29) = monthly[0] + annual[0] = 0 + 197 = 197
    assert_mirror_number(&mirror, &p22, 197.0, "P22 SUM(P28:P29)");
    // Q22 = SUM(Q28:Q29) = monthly[1] + annual[1] = 0 + 448 = 448
    assert_mirror_number(&mirror, &q22, 448.0, "Q22 SUM(Q28:Q29)");
    // R22 = SUM(R28:R29) = monthly[2] + annual[2] = 0 + 475 = 475
    assert_mirror_number(&mirror, &r22, 475.0, "R22 SUM(R28:R29)");
    // S22 = SUM(S28:S29) = monthly[3] + annual[3] = 1 + 529 = 530
    assert_mirror_number(&mirror, &s22, 530.0, "S22 SUM(S28:S29)");
    // T22 = SUM(T28:T29) = monthly[4] + annual[4] = 7 + 377 = 384
    assert_mirror_number(&mirror, &t22, 384.0, "T22 SUM(T28:T29)");

    // Verify further spill targets (checking the 25-element range)
    let an29 = 28u32; // row 28 (0-indexed)
    let an_col = 39u32; // AN = col 39 (0-indexed)
    assert_col_data_number(
        &mirror,
        &sid2,
        an29,
        an_col,
        annual_data[24],
        "AN29 SourceB spill (last element = 4305)",
    );
}

// ---------------------------------------------------------------------------
// Test 8: INDEX reading TRANSPOSE spill targets + iterative_calc
// ---------------------------------------------------------------------------

/// INDEX formula reading from column populated by TRANSPOSE spill,
/// with iterative_calc enabled.
#[test]
fn test_index_reads_transpose_spill_iterative_calc() {
    let snapshot = build_snapshot_iterative(
        vec![
            (
                "Source",
                10,
                10,
                vec![
                    (0, 0, CellValue::number(10.0), None, None),
                    (0, 1, CellValue::number(20.0), None, None),
                    (0, 2, CellValue::number(30.0), None, None),
                    (0, 3, CellValue::number(40.0), None, None),
                    (0, 4, CellValue::number(50.0), None, None),
                ],
            ),
            (
                "Projection",
                10,
                10,
                vec![
                    // A1 = TRANSPOSE(Source!A1:E1) → vertical A1:A5 with array_ref
                    (
                        0,
                        0,
                        CellValue::number(10.0),
                        Some("TRANSPOSE(Source!A1:E1)"),
                        Some("A1:A5"),
                    ),
                ],
            ),
            (
                "Output",
                10,
                10,
                vec![
                    // INDEX reading from Projection column A (spill targets)
                    (
                        0,
                        0,
                        CellValue::Null,
                        Some("INDEX(Projection!$A:$A,1)"),
                        None,
                    ),
                    (
                        1,
                        0,
                        CellValue::Null,
                        Some("INDEX(Projection!$A:$A,2)"),
                        None,
                    ),
                    (
                        2,
                        0,
                        CellValue::Null,
                        Some("INDEX(Projection!$A:$A,3)"),
                        None,
                    ),
                    (
                        3,
                        0,
                        CellValue::Null,
                        Some("INDEX(Projection!$A:$A,4)"),
                        None,
                    ),
                    (
                        4,
                        0,
                        CellValue::Null,
                        Some("INDEX(Projection!$A:$A,5)"),
                        None,
                    ),
                ],
            ),
        ],
        true,
    );
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    core.init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let rb_a1 = CellId::from_uuid_str(&cell_uuid(2, 0, 0)).expect("rb a1");
    let rb_a2 = CellId::from_uuid_str(&cell_uuid(2, 1, 0)).expect("rb a2");
    let rb_a3 = CellId::from_uuid_str(&cell_uuid(2, 2, 0)).expect("rb a3");
    let rb_a4 = CellId::from_uuid_str(&cell_uuid(2, 3, 0)).expect("rb a4");
    let rb_a5 = CellId::from_uuid_str(&cell_uuid(2, 4, 0)).expect("rb a5");

    assert_mirror_number(&mirror, &rb_a1, 10.0, "INDEX(A:A,1)");
    assert_mirror_number(&mirror, &rb_a2, 20.0, "INDEX(A:A,2)");
    assert_mirror_number(&mirror, &rb_a3, 30.0, "INDEX(A:A,3)");
    assert_mirror_number(&mirror, &rb_a4, 40.0, "INDEX(A:A,4)");
    assert_mirror_number(&mirror, &rb_a5, 50.0, "INDEX(A:A,5)");
}
