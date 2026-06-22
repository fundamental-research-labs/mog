//! pass 6 §9 — Collab Convergence Suite
//!
//! Verifies that two peers editing cells concurrently via Yrs CRDT converge
//! to a consistent state after exchanging updates.
//!
//! # Two-peer simulation
//!
//! 1. Build engine A from a snapshot.
//! 2. Clone A's full Yrs state into engine B via `encode_diff` / `from_yrs_state`.
//! 3. Both engines mutate independently (offline / partitioned).
//! 4. Exchange Yrs state diffs bidirectionally.
//! 5. Assert convergence: both engines report identical cell values.
//!
//! The tests exercise the cell-level convergence surface. Because cells
//! live in Yrs Map entries, concurrent writes to the SAME key resolve via
//! Yrs LWW (Last Writer Wins — higher `client_id * clock` wins). Writes
//! to DIFFERENT keys merge without conflict.

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::{NamedRangeDef, Scope};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

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

/// Baseline fixture: A1=10, B1=20, C1=`=A1+B1` (cached 30).
fn baseline_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Collab".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                value_cell(1, 0, 0, 10.0),             // A1 = 10
                value_cell(2, 0, 1, 20.0),             // B1 = 20
                formula_cell(3, 0, 2, "=A1+B1", 30.0), // C1 = =A1+B1
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Multi-cell fixture: A1..A5 = 1..5, B1=`=SUM(A1:A5)` (cached 15).
fn multi_cell_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Multi".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                value_cell(10, 0, 0, 1.0),                   // A1
                value_cell(11, 1, 0, 2.0),                   // A2
                value_cell(12, 2, 0, 3.0),                   // A3
                value_cell(13, 3, 0, 4.0),                   // A4
                value_cell(14, 4, 0, 5.0),                   // A5
                formula_cell(20, 0, 1, "=SUM(A1:A5)", 15.0), // B1
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Empty sheet fixture: no physical cells, so concurrent writes to A1 mint
/// competing CellIds for the same position.
fn empty_sheet_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Empty".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Clone engine A's full Yrs state into a new engine B.
///
/// Uses the `encode_diff(empty_sv)` -> `from_yrs_state` path, which is the
/// same path the production collab layer uses.
fn clone_engine(engine_a: &YrsComputeEngine) -> (YrsComputeEngine, cell_types::SheetId) {
    use yrs::updates::encoder::Encode;
    let empty_sv = yrs::StateVector::default().encode_v1();
    let full_state = engine_a
        .encode_diff(&empty_sv)
        .expect("encode_diff(empty) must succeed");
    let (engine_b, _) =
        YrsComputeEngine::from_yrs_state(&full_state).expect("from_yrs_state must succeed");
    let sid = *engine_b
        .mirror()
        .sheet_ids()
        .next()
        .expect("cloned engine must have at least one sheet");
    (engine_b, sid)
}

/// Exchange Yrs state diffs bidirectionally between two engines.
///
/// After this function returns, both engines have integrated each other's
/// changes and should be convergent.
fn sync_bidirectional(engine_a: &mut YrsComputeEngine, engine_b: &mut YrsComputeEngine) {
    // A -> B
    let sv_b = engine_b.encode_state_vector();
    let diff_a_to_b = engine_a
        .encode_diff(&sv_b)
        .expect("encode_diff A->B must succeed");
    engine_b
        .apply_sync_update_legacy(&diff_a_to_b)
        .expect("apply_sync_update A->B must succeed");

    // B -> A
    let sv_a = engine_a.encode_state_vector();
    let diff_b_to_a = engine_b
        .encode_diff(&sv_a)
        .expect("encode_diff B->A must succeed");
    engine_a
        .apply_sync_update_legacy(&diff_b_to_a)
        .expect("apply_sync_update B->A must succeed");
}

/// Server-style multi-peer sync: every engine flushes to an authoritative Yrs
/// doc, then every engine pulls from it. This mirrors the local colab eval
/// group sync path closely enough to catch multi-writer position conflicts.
fn sync_via_authoritative_doc(engines: &mut [YrsComputeEngine]) {
    use yrs::updates::encoder::Encode;

    let empty_sv = yrs::StateVector::default().encode_v1();
    let initial_state = engines[0]
        .encode_diff(&empty_sv)
        .expect("initial full state");
    let server = yrs::Doc::new();
    compute_collab::apply_update(&server, &initial_state).expect("seed server doc");

    for engine in engines.iter_mut() {
        let local_sv = engine.encode_state_vector();
        let server_sv = compute_collab::encode_state_vector(&server);
        let local_diff = engine.encode_diff(&server_sv).expect("local diff");
        compute_collab::apply_update(&server, &local_diff).expect("server apply local diff");
        let server_diff = compute_collab::encode_diff(&server, &local_sv).expect("server diff");
        engine
            .apply_sync_update_legacy(&server_diff)
            .expect("apply server diff to pusher");
    }

    for engine in engines.iter_mut() {
        let local_sv = engine.encode_state_vector();
        let server_diff = compute_collab::encode_diff(&server, &local_sv).expect("pull diff");
        engine
            .apply_sync_update_legacy(&server_diff)
            .expect("apply pulled server diff");
    }
}

/// Read a cell value via the engine's public `get_cell_value` API.
fn read_value(
    engine: &YrsComputeEngine,
    sid: &cell_types::SheetId,
    row: u32,
    col: u32,
) -> CellValue {
    engine.get_cell_value(sid, row, col)
}

// ---------------------------------------------------------------------------
// Test 1: same_cell_convergence
//
// Two peers concurrently edit the same cell. After state exchange, both
// peers see the same value (Yrs LWW resolves by client_id + clock).
// ---------------------------------------------------------------------------

#[test]
fn same_cell_convergence() {
    // 1. Build engine A from fixture.
    let (mut engine_a, _) =
        YrsComputeEngine::from_snapshot(baseline_snapshot()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    // 2. Clone A's state into engine B.
    let (mut engine_b, sid_b) = clone_engine(&engine_a);

    // Sanity: both see A1 = 10.0.
    assert_eq!(
        read_value(&engine_a, &sid_a, 0, 0),
        CellValue::Number(FiniteF64::must(10.0)),
        "A baseline A1"
    );
    assert_eq!(
        read_value(&engine_b, &sid_b, 0, 0),
        CellValue::Number(FiniteF64::must(10.0)),
        "B baseline A1"
    );

    // 3. Both peers edit A1 concurrently (offline).
    engine_a
        .set_cell_value_parsed(&sid_a, 0, 0, "999")
        .expect("A set A1");
    engine_b
        .set_cell_value_parsed(&sid_b, 0, 0, "777")
        .expect("B set A1");

    // Verify divergence pre-sync.
    assert_eq!(
        read_value(&engine_a, &sid_a, 0, 0),
        CellValue::Number(FiniteF64::must(999.0)),
        "A sees own A1 edit"
    );
    assert_eq!(
        read_value(&engine_b, &sid_b, 0, 0),
        CellValue::Number(FiniteF64::must(777.0)),
        "B sees own A1 edit"
    );

    // 4. Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // 5. Convergence: both see the same value (LWW winner).
    let val_a = read_value(&engine_a, &sid_a, 0, 0);
    let val_b = read_value(&engine_b, &sid_b, 0, 0);
    assert_eq!(
        val_a, val_b,
        "After sync, A1 must converge. A={:?}, B={:?}",
        val_a, val_b
    );

    // The LWW winner is one of the two values (we don't control which
    // client_id yrs assigns, so we assert membership).
    let is_valid = val_a == CellValue::Number(FiniteF64::must(999.0))
        || val_a == CellValue::Number(FiniteF64::must(777.0));
    assert!(
        is_valid,
        "LWW winner must be either 999 or 777, got {:?}",
        val_a
    );
}

#[test]
fn concurrent_empty_position_writes_converge_to_pos_to_id_winner() {
    let (engine_a, _) =
        YrsComputeEngine::from_snapshot(empty_sheet_snapshot()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");
    let (engine_b, sid_b) = clone_engine(&engine_a);
    let (engine_c, sid_c) = clone_engine(&engine_a);
    let (engine_d, sid_d) = clone_engine(&engine_a);
    let mut engines = vec![engine_a, engine_b, engine_c, engine_d];
    let sheet_ids = [sid_a, sid_b, sid_c, sid_d];
    let inputs = ["101", "202", "303", "404"];

    for (i, engine) in engines.iter_mut().enumerate() {
        engine
            .set_cell_value_parsed(&sheet_ids[i], 0, 0, inputs[i])
            .expect("set A1");
    }

    sync_via_authoritative_doc(&mut engines);

    let values: Vec<CellValue> = engines
        .iter()
        .zip(sheet_ids.iter())
        .map(|(engine, sid)| read_value(engine, sid, 0, 0))
        .collect();
    assert!(
        values.iter().all(|value| *value == values[0]),
        "all peers must converge on the same A1 winner; got {values:?}",
    );
    assert!(
        [
            CellValue::Number(FiniteF64::must(101.0)),
            CellValue::Number(FiniteF64::must(202.0)),
            CellValue::Number(FiniteF64::must(303.0)),
            CellValue::Number(FiniteF64::must(404.0)),
        ]
        .contains(&values[0]),
        "winner must be one of the peer writes; got {:?}",
        values[0],
    );
}

#[test]
fn named_range_endpoint_ids_remain_partitioned_after_sync_rebuild() {
    use yrs::updates::encoder::Encode;

    let (seed, _) =
        YrsComputeEngine::from_snapshot(empty_sheet_snapshot()).expect("seed from_snapshot");
    let empty_sv = yrs::StateVector::default().encode_v1();
    let full_state = seed.encode_diff(&empty_sv).expect("seed full state");
    let (mut engine_a, _) =
        YrsComputeEngine::from_yrs_state(&full_state).expect("A from yrs state");
    let (mut engine_b, _) =
        YrsComputeEngine::from_yrs_state(&full_state).expect("B from yrs state");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");
    let sid_b = *engine_b.mirror().sheet_ids().next().expect("B has a sheet");

    // Replaying the baseline state exercises the sync rebuild path that used
    // to replace ComputeCore and drop the participant-partitioned allocator.
    engine_a
        .apply_sync_update_legacy(&full_state)
        .expect("A baseline replay");
    engine_b
        .apply_sync_update_legacy(&full_state)
        .expect("B baseline replay");

    engine_a
        .set_named_range(
            "SalesData".to_string(),
            NamedRangeDef::from_expression(
                "SalesData".to_string(),
                Scope::Workbook,
                "=Empty!A1:A10".to_string(),
            ),
        )
        .expect("A named range");
    for i in 0..10 {
        engine_a
            .set_cell_value_parsed(&sid_a, i, 0, &((i + 1) * 100).to_string())
            .expect("A value");
    }

    engine_b
        .set_named_range(
            "CostData".to_string(),
            NamedRangeDef::from_expression(
                "CostData".to_string(),
                Scope::Workbook,
                "=Empty!B1:B10".to_string(),
            ),
        )
        .expect("B named range");
    for i in 0..10 {
        engine_b
            .set_cell_value_parsed(&sid_b, i, 1, &((i + 1) * 50).to_string())
            .expect("B value");
    }

    let mut engines = vec![engine_a, engine_b];
    sync_via_authoritative_doc(&mut engines);

    assert_eq!(
        read_value(&engines[0], &sid_a, 0, 0),
        CellValue::Number(FiniteF64::must(100.0)),
        "A1 should keep SalesData value"
    );
    assert_eq!(
        read_value(&engines[0], &sid_a, 0, 1),
        CellValue::Number(FiniteF64::must(50.0)),
        "B1 should keep CostData value"
    );
    assert_eq!(
        read_value(&engines[1], &sid_b, 0, 0),
        CellValue::Number(FiniteF64::must(100.0)),
        "A1 should sync to peer"
    );
    assert_eq!(
        read_value(&engines[1], &sid_b, 0, 1),
        CellValue::Number(FiniteF64::must(50.0)),
        "B1 should not reuse SalesData's CellId"
    );
}

// ---------------------------------------------------------------------------
// Test 2: different_cell_independence
//
// Two peers concurrently edit different cells. After state exchange, both
// edits are present — neither is lost.
// ---------------------------------------------------------------------------

#[test]
fn different_cell_independence() {
    let (mut engine_a, _) =
        YrsComputeEngine::from_snapshot(baseline_snapshot()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    let (mut engine_b, sid_b) = clone_engine(&engine_a);

    // A edits A1, B edits B1 — different cells, no conflict.
    engine_a
        .set_cell_value_parsed(&sid_a, 0, 0, "111")
        .expect("A set A1");
    engine_b
        .set_cell_value_parsed(&sid_b, 0, 1, "222")
        .expect("B set B1");

    // Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // Both edits survive on both peers.
    for (label, engine, sid) in [("A", &engine_a, &sid_a), ("B", &engine_b, &sid_b)] {
        let a1 = read_value(engine, sid, 0, 0);
        let b1 = read_value(engine, sid, 0, 1);
        assert_eq!(
            a1,
            CellValue::Number(FiniteF64::must(111.0)),
            "{label}: A1 must be 111"
        );
        assert_eq!(
            b1,
            CellValue::Number(FiniteF64::must(222.0)),
            "{label}: B1 must be 222"
        );
    }

    // C1 = =A1+B1 should evaluate correctly on both peers after sync.
    let c1_a = read_value(&engine_a, &sid_a, 0, 2);
    let c1_b = read_value(&engine_b, &sid_b, 0, 2);
    assert_eq!(
        c1_a, c1_b,
        "C1 (=A1+B1) must converge: A={:?}, B={:?}",
        c1_a, c1_b
    );
    // Both peers edited different inputs to the formula, so C1 should be
    // 111 + 222 = 333 after sync (both edits survive).
    assert_eq!(
        c1_a,
        CellValue::Number(FiniteF64::must(333.0)),
        "C1 = A1+B1 = 111+222 = 333"
    );
}

// ---------------------------------------------------------------------------
// Test 3: edit_compaction_race
//
// Peer A edits a cell (creates an override). Peer B simultaneously edits
// a different cell in the same area. After state exchange, both edits
// survive — Yrs Map LWW per-key means independent keys don't conflict.
//
// (The original spec describes a "Range payload compaction" race. Since
// Range-first-class payload types are not yet in the codebase, this test
// exercises the underlying invariant: concurrent writes to different Yrs
// Map entries in the same sheet's cell store merge without data loss.)
// ---------------------------------------------------------------------------

#[test]
fn edit_compaction_race() {
    let (mut engine_a, _) =
        YrsComputeEngine::from_snapshot(multi_cell_snapshot()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    let (mut engine_b, sid_b) = clone_engine(&engine_a);

    // A edits A1 (cell override).
    engine_a
        .set_cell_value_parsed(&sid_a, 0, 0, "100")
        .expect("A set A1");

    // B edits A5 (different cell in the same region).
    engine_b
        .set_cell_value_parsed(&sid_b, 4, 0, "500")
        .expect("B set A5");

    // Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // Both overrides survive on both peers.
    for (label, engine, sid) in [("A", &engine_a, &sid_a), ("B", &engine_b, &sid_b)] {
        assert_eq!(
            read_value(engine, sid, 0, 0),
            CellValue::Number(FiniteF64::must(100.0)),
            "{label}: A1 override must survive"
        );
        assert_eq!(
            read_value(engine, sid, 4, 0),
            CellValue::Number(FiniteF64::must(500.0)),
            "{label}: A5 override must survive"
        );
        // Untouched cells must still be present.
        assert_eq!(
            read_value(engine, sid, 1, 0),
            CellValue::Number(FiniteF64::must(2.0)),
            "{label}: A2 must be unchanged"
        );
        assert_eq!(
            read_value(engine, sid, 2, 0),
            CellValue::Number(FiniteF64::must(3.0)),
            "{label}: A3 must be unchanged"
        );
        assert_eq!(
            read_value(engine, sid, 3, 0),
            CellValue::Number(FiniteF64::must(4.0)),
            "{label}: A4 must be unchanged"
        );
    }

    // B1 = SUM(A1:A5) should reflect both edits: 100+2+3+4+500 = 609.
    let sum_a = read_value(&engine_a, &sid_a, 0, 1);
    let sum_b = read_value(&engine_b, &sid_b, 0, 1);
    assert_eq!(
        sum_a, sum_b,
        "SUM(A1:A5) must converge: A={:?}, B={:?}",
        sum_a, sum_b
    );
    assert_eq!(
        sum_a,
        CellValue::Number(FiniteF64::must(609.0)),
        "SUM(A1:A5) = 100+2+3+4+500 = 609"
    );
}

// ---------------------------------------------------------------------------
// Test 4: edit_range_deletion_race
//
// Peer A edits a cell on sheet 1. Peer B simultaneously deletes sheet 2
// (a different sheet). After state exchange, Peer A's edit survives on
// sheet 1, and sheet 2 is deleted on both peers.
//
// (The original spec describes an edit-vs-Range-deletion race. Since
// Range-first-class deletion/folding is not yet implemented, this test
// exercises the analogous structural race: a cell edit on one sheet vs
// a sheet deletion on another sheet. The convergence invariant is the
// same — the edit must survive, the deletion must propagate.)
// ---------------------------------------------------------------------------

#[test]
fn edit_sheet_deletion_race() {
    // Build a two-sheet workbook.
    let snapshot = WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Keep".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    value_cell(1, 0, 0, 10.0), // A1 = 10
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: "660e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Delete".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![
                    value_cell(2, 0, 0, 99.0), // A1 = 99
                ],
                ranges: vec![],
            },
        ],
        ..Default::default()
    };

    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(snapshot).expect("A from_snapshot");
    let sheet_ids_a: Vec<_> = engine_a.mirror().sheet_ids().copied().collect();
    assert_eq!(sheet_ids_a.len(), 2, "A starts with 2 sheets");
    let keep_sid = sheet_ids_a[0];
    let delete_sid = sheet_ids_a[1];

    let (mut engine_b, _) = clone_engine(&engine_a);

    // A edits A1 on the "Keep" sheet.
    engine_a
        .set_cell_value_parsed(&keep_sid, 0, 0, "42")
        .expect("A set Keep.A1");

    // B deletes the "Delete" sheet.
    engine_b.delete_sheet(&delete_sid).expect("B delete_sheet");

    // Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // On both peers: the edit survives on the "Keep" sheet.
    for (label, engine) in [("A", &engine_a), ("B", &engine_b)] {
        let val = read_value(engine, &keep_sid, 0, 0);
        assert_eq!(
            val,
            CellValue::Number(FiniteF64::must(42.0)),
            "{label}: Keep.A1 must be 42 after sync"
        );
    }

    // On both peers: the "Delete" sheet is gone (only 1 sheet remains).
    let ids_a: Vec<_> = engine_a.get_all_sheet_ids();
    let ids_b: Vec<_> = engine_b.get_all_sheet_ids();
    assert_eq!(
        ids_a.len(),
        1,
        "A must have 1 sheet after sync (Delete removed)"
    );
    assert_eq!(
        ids_b.len(),
        1,
        "B must have 1 sheet after sync (Delete removed)"
    );
    assert_eq!(ids_a, ids_b, "Both peers must agree on remaining sheet IDs");
}

// ---------------------------------------------------------------------------
// Test 5: concurrent_import_convergence
//
// Two peers import data concurrently into the same workbook (both write
// to different cells). After state exchange, the workbook has a
// consistent state with all imported data present.
//
// This tests the "bulk write" convergence path — multiple cells set in
// one batch on each peer, then merged.
// ---------------------------------------------------------------------------

#[test]
fn concurrent_import_convergence() {
    // Start with an empty single-sheet workbook.
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Data".to_string(),
            rows: 1000,
            cols: 26,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };

    let (mut engine_a, _) = YrsComputeEngine::from_snapshot(snapshot).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    let (mut engine_b, sid_b) = clone_engine(&engine_a);

    // Peer A imports rows 0-4 (columns A and B): 5 rows of data.
    let mut updates_a = Vec::new();
    for row in 0..5u32 {
        let val = CellValue::Number(FiniteF64::must((row + 1) as f64 * 10.0));
        updates_a.push((row, 0u32, val, None));
    }
    engine_a
        .import_values(&sid_a, updates_a)
        .expect("A import_values");

    // Peer B imports rows 5-9 (columns A and B): 5 rows of data.
    let mut updates_b = Vec::new();
    for row in 5..10u32 {
        let val = CellValue::Number(FiniteF64::must((row + 1) as f64 * 100.0));
        updates_b.push((row, 0u32, val, None));
    }
    engine_b
        .import_values(&sid_b, updates_b)
        .expect("B import_values");

    // Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // Verify: all 10 rows are present on both peers.
    for (label, engine, sid) in [("A", &engine_a, &sid_a), ("B", &engine_b, &sid_b)] {
        // Peer A's data: rows 0-4.
        for row in 0..5u32 {
            let expected = CellValue::Number(FiniteF64::must((row + 1) as f64 * 10.0));
            let actual = read_value(engine, sid, row, 0);
            assert_eq!(
                actual, expected,
                "{label}: row {row} col 0 — A's import must survive sync"
            );
        }
        // Peer B's data: rows 5-9.
        for row in 5..10u32 {
            let expected = CellValue::Number(FiniteF64::must((row + 1) as f64 * 100.0));
            let actual = read_value(engine, sid, row, 0);
            assert_eq!(
                actual, expected,
                "{label}: row {row} col 0 — B's import must survive sync"
            );
        }
    }

    // Both peers must report identical cell values across the entire
    // imported region.
    for row in 0..10u32 {
        let a_val = read_value(&engine_a, &sid_a, row, 0);
        let b_val = read_value(&engine_b, &sid_b, row, 0);
        assert_eq!(
            a_val, b_val,
            "row {row} must converge: A={:?}, B={:?}",
            a_val, b_val
        );
    }
}

// ---------------------------------------------------------------------------
// Test 6: formula_dependency_convergence
//
// Two peers edit different cells that are both inputs to the same formula.
// After state exchange, the formula evaluates correctly on both peers,
// reflecting both edits.
// ---------------------------------------------------------------------------

#[test]
fn formula_dependency_convergence() {
    // A1=10, B1=20, C1=`=A1+B1`.
    let (mut engine_a, _) =
        YrsComputeEngine::from_snapshot(baseline_snapshot()).expect("A from_snapshot");
    let sid_a = *engine_a.mirror().sheet_ids().next().expect("A has a sheet");

    let (mut engine_b, sid_b) = clone_engine(&engine_a);

    // A edits A1 (first input to formula).
    engine_a
        .set_cell_value_parsed(&sid_a, 0, 0, "50")
        .expect("A set A1");

    // B edits B1 (second input to formula).
    engine_b
        .set_cell_value_parsed(&sid_b, 0, 1, "70")
        .expect("B set B1");

    // Pre-sync: each peer only sees its own edit in the formula result.
    let c1_a_pre = read_value(&engine_a, &sid_a, 0, 2);
    let c1_b_pre = read_value(&engine_b, &sid_b, 0, 2);
    // A sees: A1=50, B1=20 (old), C1=50+20=70.
    assert_eq!(
        c1_a_pre,
        CellValue::Number(FiniteF64::must(70.0)),
        "A pre-sync: C1 = 50+20 = 70"
    );
    // B sees: A1=10 (old), B1=70, C1=10+70=80.
    assert_eq!(
        c1_b_pre,
        CellValue::Number(FiniteF64::must(80.0)),
        "B pre-sync: C1 = 10+70 = 80"
    );

    // Exchange state.
    sync_bidirectional(&mut engine_a, &mut engine_b);

    // Post-sync: both see A1=50, B1=70, C1=50+70=120.
    for (label, engine, sid) in [("A", &engine_a, &sid_a), ("B", &engine_b, &sid_b)] {
        let a1 = read_value(engine, sid, 0, 0);
        let b1 = read_value(engine, sid, 0, 1);
        let c1 = read_value(engine, sid, 0, 2);
        assert_eq!(
            a1,
            CellValue::Number(FiniteF64::must(50.0)),
            "{label}: A1 must be 50"
        );
        assert_eq!(
            b1,
            CellValue::Number(FiniteF64::must(70.0)),
            "{label}: B1 must be 70"
        );
        assert_eq!(
            c1,
            CellValue::Number(FiniteF64::must(120.0)),
            "{label}: C1 = 50+70 = 120"
        );
    }
}
