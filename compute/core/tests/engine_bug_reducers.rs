//! Pinned, corpus-file-free reducers for XLSX-export/re-import text-cell
//! corruption (surfaces as phantom "iterative-recalc drift" in formulas).
//!
//! ## Root cause
//!
//! The XLSX writer's `SharedStringsWriter::to_xml()` historically emitted
//! `<si>` entries in frequency-descending order, but cell `<v>` values
//! carry the **insertion-order** index returned by `add()`. When the
//! two orderings disagreed, every text cell silently read the wrong slot
//! on re-import. `SUMIFS(B:B, A:A, "USA")` evaluated to zero because the
//! criterion column no longer contained any "USA" text. The cached
//! result (`<v>350</v>`) survived the round-trip unchanged, so the
//! symptom only appeared when the engine re-evaluated — which looked
//! like iterative-recalc drift, not string scrambling.
//!
//! The `from_snapshot` path bypassed the bug because it never serializes
//! through the SST writer. That's why these reducers reproduced only
//! via the XLSX-hydration path.
//!
//! ## The corpus-free reducer pattern
//!
//! Build a minimal `WorkbookSnapshot` in code, go
//! `from_snapshot → export_to_xlsx_bytes → from_xlsx_bytes` to produce
//! the engine state a real XLSX import would produce, then run the
//! op+inverse pair. No committed XLSX binary needed. The synthetic
//! topology carries the bug.
//!
//! ## Known bug classes and their reducers
//!
//! ### Class 1 — text-criterion SUMIFS on the XLSX export path
//!
//! Empirically characterized and root-caused:
//! - **Required:** XLSX-hydration path; `from_snapshot` bypasses the
//!   SST writer entirely.
//! - **Required:** text criterion in SUMIFS; numeric criteria didn't
//!   fire it because numeric cells don't take SST slots.
//! - **Required:** the edited cell's value type changes
//!   (text → non-text → text). The type-change is incidental — it
//!   triggers a recompute, which is what surfaces the pre-existing
//!   string scrambling.
//! - **Not required:** full-column range — closed `B2:B5` fires too.
//! - **Not required:** input parser — inverse via `import_values` (raw
//!   `CellValue` path) also fires, ruling in the writer path
//!   as the only common factor.
//!
//! Reducers: `class1_sumifs_text_criterion_xlsx_reducer` and
//! `class1_sumifs_text_criterion_xlsx_reducer_import_values_inverse`.
//!
//! ### Classes 2+ — Ib6CYMnT / nxnOekSc / qKjqZiEx specifics
//!
//! Not explained by the SST-reorder root cause: real corpus files are
//! Excel-produced, so their SSTs are internally consistent and take
//! the round-trip (insertion-order) branch. Those bugs should be
//! re-investigated separately from this fix.
//!
//! ## Expected state (per `feedback_no_ignored_tests.md`)
//!
//! Both class1 reducers must pass with bit-identity (`pre == post`) — not just
//! "no drift within 1e-12".
//! A string scramble is a discrete lookup error, not a numerical one,
//! so the honest assertion is equality on `CellValue`.
//!
//! `control_*` tests pin the negative case: the bug requires the XLSX
//! path. They pass before and after the fix.
//!
//! Run:
//!   cargo test -p compute-core --test engine_bug_reducers -- --nocapture

use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn text_cell(id_suffix: u32, row: u32, col: u32, t: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Text(t.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
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

/// Minimal SUMIFS-with-text-criterion topology:
///
/// ```text
/// SourceData:
///   A1="Country" B1="Sales"
///   A2="USA"     B2=100
///   A3="USA"     B3=200
///   A4="CAN"     B4=300
///   A5="USA"     B5=50     ← edit target (criterion cell)
///
/// Summary:
///   A1 = SUMIFS(SourceData!B:B, SourceData!A:A, "USA")  → 350
/// ```
///
/// Op pair: set `SourceData!A5` to `"80"` (forward), then back to
/// `"USA"` (inverse). `Summary!A1` must equal `350` after the inverse.
fn sumifs_text_criterion_snapshot() -> WorkbookSnapshot {
    let src = SheetSnapshot {
        id: sheet_id_str(1),
        name: "SourceData".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![
            text_cell(100, 0, 0, "Country"),
            text_cell(101, 0, 1, "Sales"),
            text_cell(102, 1, 0, "USA"),
            number_cell(103, 1, 1, 100.0),
            text_cell(104, 2, 0, "USA"),
            number_cell(105, 2, 1, 200.0),
            text_cell(106, 3, 0, "CAN"),
            number_cell(107, 3, 1, 300.0),
            text_cell(108, 4, 0, "USA"),
            number_cell(109, 4, 1, 50.0),
        ],
        ranges: vec![],
    };
    let summary = SheetSnapshot {
        id: sheet_id_str(2),
        name: "Summary".to_string(),
        rows: 10,
        cols: 5,
        cells: vec![formula_cell(
            200,
            0,
            0,
            "SUMIFS(SourceData!B:B, SourceData!A:A, \"USA\")",
        )],
        ranges: vec![],
    };
    WorkbookSnapshot {
        sheets: vec![src, summary],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Op-pair drivers
// ---------------------------------------------------------------------------

/// Run the Class-1 forward/inverse op pair via `set_cell` both ways,
/// and return `(pre_op, post_inverse)` values of `Summary!A1`.
fn run_class1_op_pair_via_set_cell(engine: &mut YrsComputeEngine) -> (CellValue, CellValue) {
    let src_sid = engine
        .mirror()
        .sheet_by_name("SourceData")
        .expect("SourceData");
    let sum_sid = engine.mirror().sheet_by_name("Summary").expect("Summary");
    let edit_cid = engine
        .grid_index(&src_sid)
        .expect("SourceData grid")
        .cell_id_at(4, 0)
        .expect("A5 present");

    let pre = engine
        .mirror()
        .get_cell_value_at(&sum_sid, SheetPos::new(0, 0))
        .cloned()
        .unwrap_or(CellValue::Null);

    engine
        .set_cell(&src_sid, edit_cid, 4, 0, "80".into())
        .expect("forward");
    engine
        .set_cell(&src_sid, edit_cid, 4, 0, "USA".into())
        .expect("inverse");

    let post = engine
        .mirror()
        .get_cell_value_at(&sum_sid, SheetPos::new(0, 0))
        .cloned()
        .unwrap_or(CellValue::Null);

    (pre, post)
}

fn number(v: &CellValue) -> Option<f64> {
    match v {
        CellValue::Number(n) => Some(n.get()),
        _ => None,
    }
}

fn drifted(pre: &CellValue, post: &CellValue) -> bool {
    match (number(pre), number(post)) {
        (Some(a), Some(b)) => (a - b).abs() > 1e-12,
        _ => pre != post,
    }
}

// ---------------------------------------------------------------------------
// Class 1 — text-criterion SUMIFS reducer
// ---------------------------------------------------------------------------

/// Reducer: text-criterion SUMIFS returns the wrong value after a
/// type-changing op+inverse pair on the XLSX-hydration path.
///
/// Root cause (shared-string ordering): SST writer emitted `<si>` entries in
/// frequency-desc order while cells referenced them by insertion-order
/// index. After the fix, post-inverse `Summary!A1` must equal pre
/// exactly — a string scramble is a discrete lookup error, not
/// floating-point drift, so bit-identity is the honest assertion.
#[test]
fn class1_sumifs_text_criterion_xlsx_reducer() {
    let snap = sumifs_text_criterion_snapshot();
    let (engine0, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let xlsx_bytes = engine0
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes");

    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");

    let (pre, post) = run_class1_op_pair_via_set_cell(&mut engine);
    assert_eq!(
        pre, post,
        "[class1_text_criterion] SUMIFS result changed across op+inverse \
         on the XLSX-hydration path. If this fires, the SST writer is \
         reordering entries between add() and emission (see shared-string ordering)."
    );
}

/// Same reducer, but the inverse uses `engine.import_values` (raw
/// `CellValue`, lossless import lossless path). Rules out the input parser
/// as the cause: the XLSX writer is the common factor across both
/// variants.
#[test]
fn class1_sumifs_text_criterion_xlsx_reducer_import_values_inverse() {
    let snap = sumifs_text_criterion_snapshot();
    let (engine0, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let xlsx_bytes = engine0
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes");

    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&xlsx_bytes).expect("from_xlsx_bytes");
    let src_sid = engine
        .mirror()
        .sheet_by_name("SourceData")
        .expect("SourceData");
    let sum_sid = engine.mirror().sheet_by_name("Summary").expect("Summary");
    let edit_cid = engine
        .grid_index(&src_sid)
        .expect("SourceData grid")
        .cell_id_at(4, 0)
        .expect("A5 present");

    let pre = engine
        .mirror()
        .get_cell_value_at(&sum_sid, SheetPos::new(0, 0))
        .cloned()
        .unwrap_or(CellValue::Null);

    engine
        .set_cell(&src_sid, edit_cid, 4, 0, "80".into())
        .expect("forward");
    engine
        .import_values(
            &src_sid,
            vec![(4u32, 0u32, CellValue::Text("USA".to_string().into()), None)],
        )
        .expect("inverse via import_values");

    let post = engine
        .mirror()
        .get_cell_value_at(&sum_sid, SheetPos::new(0, 0))
        .cloned()
        .unwrap_or(CellValue::Null);

    assert_eq!(
        pre, post,
        "[class1_import_values_inverse] SUMIFS result changed across \
         op+inverse when the inverse used lossless `import_values`. \
         Rules out the input parser — if this fires, the SST writer \
         is scrambling entries (see shared-string ordering)."
    );
}

// ---------------------------------------------------------------------------
// Controls — must PASS today and after the fix
// ---------------------------------------------------------------------------

/// Control: same topology, same op pair, via `from_snapshot` (not the
/// XLSX-hydration path). Passes today and should continue to pass —
/// it pins the fact that the XLSX path is the specific trigger.
#[test]
fn control_class1_via_from_snapshot_passes() {
    let snap = sumifs_text_criterion_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let (pre, post) = run_class1_op_pair_via_set_cell(&mut engine);
    assert!(
        !drifted(&pre, &post),
        "[control_from_snapshot] unexpected drift via from_snapshot: pre={:?} post={:?}",
        pre,
        post,
    );
}

// ---------------------------------------------------------------------------
// nxnOekSc reducer (corpus-derived, op+inverse on real file)
// ---------------------------------------------------------------------------

#[cfg(feature = "corpus-tests")]
#[test]
fn nxnoeksc_sumifs_inverse_leaves_stale_result() {
    use compute_core::test_support::{DefaultIdAllocator, parse_output_to_workbook_snapshot};
    use xlsx_api::{ParseOptions, parse_with_options};
    let corpus_dir = std::env::var_os("MOG_XLSX_CORPUS_DIR")
        .expect("set MOG_XLSX_CORPUS_DIR to the XLSX corpus directory");
    let path =
        std::path::PathBuf::from(corpus_dir).join("nxnOekScUkRj7CWuBhws1Ta1nVdDSKZ1/latest.xlsx");
    let bytes = std::fs::read(&path).expect("read nxnOekSc XLSX");

    // Match the walk harness's init path exactly: parse → build snapshot →
    // from_snapshot. The walk uses this path (not from_xlsx_bytes) and the
    // drift signature is specific to it.
    let wb = parse_with_options(&bytes, &ParseOptions::new().profiled()).expect("parse");
    let mut allocator = DefaultIdAllocator::new();
    let snapshot = parse_output_to_workbook_snapshot(&wb.output, None, &mut allocator);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");

    // Walk log: edit target is parsed sheet index 9 = "Latest Periods by Item",
    // cell K40 (row 39, col 10), prior=28, new=80.
    let edit_sheet = engine
        .mirror()
        .sheet_by_name("Latest Periods by Item")
        .expect("Latest Periods by Item sheet");
    let dep_sheet = engine
        .mirror()
        .sheet_by_name("Breakouts vs. PP")
        .expect("Breakouts vs. PP sheet");

    let edit_cid = engine
        .grid_index(&edit_sheet)
        .expect("grid")
        .cell_id_at(39, 10)
        .expect("K40 exists");

    let pre = engine
        .mirror()
        .get_cell_value_at(&dep_sheet, SheetPos::new(18, 18))
        .cloned()
        .unwrap_or(CellValue::Null);
    eprintln!("pre S19 = {:?}", pre);
    eprintln!(
        "pre K40 = {:?}",
        engine
            .mirror()
            .get_cell_value_at(&edit_sheet, SheetPos::new(39, 10))
    );

    // Match walk's op pair exactly: forward via set_cell (input parser path),
    // inverse via import_values (Track 1a's lossless raw path).
    engine
        .set_cell(&edit_sheet, edit_cid, 39, 10, "80".into())
        .expect("forward via set_cell");
    engine
        .import_values(
            &edit_sheet,
            vec![(39u32, 10u32, CellValue::Number(FiniteF64::must(28.0)), None)],
        )
        .expect("inverse via import_values");

    let post = engine
        .mirror()
        .get_cell_value_at(&dep_sheet, SheetPos::new(18, 18))
        .cloned()
        .unwrap_or(CellValue::Null);
    eprintln!("post S19 = {:?}", post);
    eprintln!(
        "post K40 = {:?}",
        engine
            .mirror()
            .get_cell_value_at(&edit_sheet, SheetPos::new(39, 10))
    );

    assert_eq!(
        pre, post,
        "[nxnoeksc] Breakouts vs. PP!S19 drifted across op+inverse: pre={:?} post={:?} (Δ=+52 expected = 80-28)",
        pre, post,
    );
    let _ = edit_cid;
}
