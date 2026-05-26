//! Assert that `from_snapshot` and `from_xlsx_bytes` produce yrs state
//! that is equivalent (modulo yrs client-id metadata, row/col ID hex, and
//! CellId allocation differences) for equivalent input. Definitive
//! close-out for the silent-no-op class (R51 Turn N+6 / Step D.5).
//!
//! ## Fixture
//!
//! Three sheets built via `from_snapshot`, then mutated on the engine
//! instance to exercise features that only the engine API (not the
//! snapshot struct) can produce:
//!
//! * Sheet1 (20×10): A1=1, B1=2 (values); A2="hello" (text); A3=`=A1+B1`
//!   and A4=`=Sheet2!A1*2` (formulas, including a cross-sheet ref). A
//!   merge covers A6:C6.
//! * Sheet2 (10×5): A1=10, B2=5 (values). A hyperlink at A4.
//! * Sheet3 (10×5): A1=100, B1=200, C1=300 (values). A1 is formatted
//!   bold.
//!
//! ## Canonicalization
//!
//! Both engines are fed through
//! [`compute_core::test_support::yrs_canonical::canonicalize`], which produces a
//! `BTreeMap<sheet_name, CanonValue>` recursive tree covering every
//! per-sheet sub-map (cells, properties, rowOrder, colOrder,
//! gridIndex, meta, merges, etc.). Unstable identifiers (row/col ID
//! hex, cell_hex, `rowHex:colHex` composite keys) are rewritten to
//! position-based synthetic markers so the two paths are comparable.
//!
//! The entire trees are then asserted equal with `assert_eq!` — any
//! divergence anywhere in the per-sheet yrs state fails the test.

use compute_core::storage::engine::YrsComputeEngine;
use compute_core::test_support::yrs_canonical::{CanonValue, canonicalize};
use domain_types::CellFormat;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn text_cell(uuid_suffix: u32, row: u32, col: u32, s: &str) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Text(std::sync::Arc::from(s)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(uuid_suffix: u32, row: u32, col: u32, formula: &str, cached: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(cached)),
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

const SHEET1_ID: &str = "550e8400-e29b-41d4-a716-446655440001";
const SHEET2_ID: &str = "550e8400-e29b-41d4-a716-446655440002";
const SHEET3_ID: &str = "550e8400-e29b-41d4-a716-446655440003";

fn rich_fixture() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET1_ID.to_string(),
                name: "Sheet1".to_string(),
                rows: 20,
                cols: 10,
                cells: vec![
                    value_cell(1, 0, 0, 1.0),                    // A1 = 1
                    value_cell(2, 0, 1, 2.0),                    // B1 = 2
                    text_cell(3, 1, 0, "hello"),                 // A2 = "hello"
                    formula_cell(4, 2, 0, "=A1+B1", 3.0),        // A3 = =A1+B1
                    formula_cell(5, 3, 0, "=Sheet2!A1*2", 20.0), // A4 = cross-sheet
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET2_ID.to_string(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 5,
                cells: vec![
                    value_cell(11, 0, 0, 10.0), // A1 = 10
                    value_cell(12, 1, 1, 5.0),  // B2 = 5
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: SHEET3_ID.to_string(),
                name: "Sheet3".to_string(),
                rows: 10,
                cols: 5,
                cells: vec![
                    value_cell(21, 0, 0, 100.0), // A1 = 100
                    value_cell(22, 0, 1, 200.0), // B1 = 200
                    value_cell(23, 0, 2, 300.0), // C1 = 300
                ],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

#[test]
fn snapshot_and_xlsx_paths_produce_identical_yrs_state() {
    use cell_types::{CellId, SheetId};

    // -----------------------------------------------------------------
    // Path 1: from_snapshot hydration + engine-API mutations (merge,
    // hyperlink, cell format) that the snapshot struct can't express.
    // -----------------------------------------------------------------
    let (mut engine_snap, _) =
        YrsComputeEngine::from_snapshot(rich_fixture()).expect("from_snapshot");

    let sheet1 = SheetId::from_uuid_str(SHEET1_ID).expect("sheet1 id");
    let sheet2 = SheetId::from_uuid_str(SHEET2_ID).expect("sheet2 id");
    let sheet3 = SheetId::from_uuid_str(SHEET3_ID).expect("sheet3 id");

    // Sheet1: merge A6:C6 (row=5, cols 0..=2)
    engine_snap
        .merge_range(&sheet1, 5, 0, 5, 2)
        .expect("merge_range A6:C6");

    // Sheet2: hyperlink at A4 (row=3, col=0)
    engine_snap
        .set_hyperlink(&sheet2, 3, 0, "https://example.com")
        .expect("set_hyperlink A4");

    // Sheet3: bold format on A1. Look up the CellId the engine gave A1.
    let a1_hex = engine_snap
        .get_cell_id_at(&sheet3, 0, 0)
        .expect("Sheet3 A1 cell id hex");
    let a1_cell_id =
        CellId::from_raw(u128::from_str_radix(&a1_hex, 16).expect("cell id hex parses"));
    let bold = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine_snap
        .set_cell_format(&sheet3, &a1_cell_id, &bold)
        .expect("set_cell_format A1 bold");

    // -----------------------------------------------------------------
    // Path 2: round-trip the post-mutation engine through XLSX.
    // -----------------------------------------------------------------
    let bytes = engine_snap
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes");
    let (engine_xlsx, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");

    // -----------------------------------------------------------------
    // Canonicalize both engines and compare the full recursive trees.
    // -----------------------------------------------------------------
    let canon_snap = canonicalize(&engine_snap);
    let canon_xlsx = canonicalize(&engine_xlsx);

    // Sheet set must match first (clearer diagnostic than a tree diff).
    let snap_sheets: Vec<&String> = canon_snap.keys().collect();
    let xlsx_sheets: Vec<&String> = canon_xlsx.keys().collect();
    assert_eq!(
        snap_sheets, xlsx_sheets,
        "sheet set differs between hydration paths"
    );

    // Per-sheet structural comparison — cheaper-to-read failure output
    // than one giant `assert_eq!` when only one sheet diverges.
    for name in canon_snap.keys() {
        let s = canon_snap.get(name).unwrap();
        let x = canon_xlsx.get(name).unwrap();
        assert_eq!(
            s, x,
            "sheet '{}' canonical yrs state differs between from_snapshot and from_xlsx_bytes paths",
            name
        );
    }

    // Belt-and-braces: the whole workbook tree as one structure. If the
    // per-sheet loop passed, this is a tautology; if it didn't we never
    // reach here. This assertion is the one cited in the test header as
    // the definitive hydration-parity gate.
    assert_eq!(
        canon_snap, canon_xlsx,
        "hydration paths produced divergent yrs state"
    );

    // Sanity: the canonical form is non-empty and captures mutations.
    // (If canonicalize ever regresses into a no-op, the above assertions
    // trivially pass — so at minimum require that the top-level keys
    // exist and each sheet has a non-empty Map.)
    assert_eq!(
        canon_snap.len(),
        3,
        "expected three sheets in canonical form"
    );
    for (name, tree) in &canon_snap {
        match tree {
            CanonValue::Map(m) => {
                assert!(
                    !m.is_empty(),
                    "sheet '{}' canonical tree is empty — canonicalize broken?",
                    name
                )
            }
            other => panic!("sheet '{}' canonical tree is not a Map: {:?}", name, other),
        }
    }
}
