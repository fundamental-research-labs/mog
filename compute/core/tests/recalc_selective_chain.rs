//! A lookup (INDEX/HLOOKUP/...) whose range holds the result of ANOTHER lookup must end the
//! full recalc with the final value, not one read before the first lookup was fixed up.
//!
//! Selective range deps get no ordering barrier, so the main pass can evaluate a lookup before
//! the formula cells in its range; the selective fixup pass repairs that. When a lookup's range
//! holds a cell computed FROM another lookup, the fixup must run again after that cell is
//! repaired, or the outer lookup keeps the stale value (found on a 5,150-formula model where one
//! stale INDEX fed 967 downstream cells).
//!
//! Run:
//!   cargo test -p compute-core --test recalc_selective_chain -- --nocapture

#[path = "support/mod.rs"]
mod support;

use support::recalc_fixtures::{build_snapshot, cell_uuid, run_snapshot};
use value_types::{CellValue, FiniteF64};

fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

/// The value a full recalc ends with: the LAST change recorded for the cell (a cell repaired by
/// the fixup pass is recorded once per evaluation that changed it).
fn final_value(
    result: &compute_core::snapshot::RecalcResult,
    sheet: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let id = cell_uuid(sheet, row, col);
    result
        .changed_cells
        .iter()
        .rev()
        .find(|c| c.cell_id == id)
        .map(|c| c.value.clone())
}

fn final_number(
    result: &compute_core::snapshot::RecalcResult,
    sheet: u32,
    row: u32,
    col: u32,
) -> f64 {
    match final_value(result, sheet, row, col) {
        Some(CellValue::Number(v)) => v.get(),
        other => panic!("cell ({sheet},{row},{col}) expected a number, got {other:?}"),
    }
}

/// Sheet1: A2=5, B2=A2*2 (X=10), D5=<hop1 over B2:C2>, D2=D5*1 (Y), H9=<hop2 over D2:E2>.
/// Every formula arrives with no cached value, as in an XLSX written without them.
fn two_hop_value(hop1: &str, hop2: &str) -> Option<CellValue> {
    let snap = build_snapshot(vec![(
        "Sheet1",
        20,
        10,
        vec![
            (0, 1, n(1.0), None),                   // B1 = 1 (HLOOKUP key row)
            (0, 3, n(1.0), None),                   // D1 = 1 (HLOOKUP key row)
            (1, 0, n(5.0), None),                   // A2 = 5
            (1, 1, CellValue::Null, Some("=A2*2")), // B2 = 10
            (4, 3, CellValue::Null, Some(hop1)),    // D5 = hop 1 -> 10
            (1, 3, CellValue::Null, Some("=D5*1")), // D2 = 10
            (8, 7, CellValue::Null, Some(hop2)),    // H9 = hop 2 -> 10
        ],
    )]);
    final_value(&run_snapshot(snap), 0, 8, 7)
}

fn two_hop(hop1: &str, hop2: &str) -> f64 {
    match two_hop_value(hop1, hop2) {
        Some(CellValue::Number(v)) => v.get(),
        other => panic!("H9 expected a number, got {other:?}"),
    }
}

#[test]
fn index_reading_an_index_result_is_final() {
    assert_eq!(
        two_hop("=INDEX($B$2:$C$2,1,1)", "=INDEX($D$2:$E$2,1,1)"),
        10.0
    );
}

#[test]
fn hlookup_reading_an_index_result_is_final() {
    assert_eq!(
        two_hop("=INDEX($B$2:$C$2,1,1)", "=HLOOKUP(1,$D$1:$D$2,2,FALSE)"),
        10.0
    );
}

#[test]
fn index_reading_an_hlookup_result_is_final() {
    assert_eq!(
        two_hop("=HLOOKUP(1,$B$1:$B$2,2,FALSE)", "=INDEX($D$2:$E$2,1,1)"),
        10.0
    );
}

/// Every function whose range argument is selective, as the lookup that reads a cell computed
/// from another lookup's result (D2 = D5*1, D5 = INDEX($B$2:$C$2,1,1) = 10; D1 = 1 is a key).
#[test]
fn every_selective_function_reads_the_final_value_of_a_lookup_result() {
    let cases: [(&str, f64); 9] = [
        ("=INDEX($D$2:$E$2,1,1)", 10.0),
        ("=CHOOSE(1,$D$2:$D$2)", 10.0),
        ("=XLOOKUP(1,$D$1:$D$1,$D$2:$D$2)", 10.0),
        ("=VLOOKUP(10,$D$2:$D$2,1,FALSE)", 10.0),
        ("=HLOOKUP(1,$D$1:$D$2,2,FALSE)", 10.0),
        ("=MATCH(10,$D$2:$E$2,0)", 1.0),
        ("=LOOKUP(1,$D$1:$D$1,$D$2:$D$2)", 10.0),
        ("=SWITCH(1,1,$D$2:$D$2,0)", 10.0),
        ("=IFS(TRUE,$D$2:$D$2)", 10.0),
    ];
    let wrong: Vec<String> = cases
        .iter()
        .filter_map(|(hop2, expected)| {
            let got = two_hop_value("=INDEX($B$2:$C$2,1,1)", hop2);
            let ok = matches!(&got, Some(CellValue::Number(v)) if v.get() == *expected);
            (!ok).then(|| format!("{hop2}: expected {expected}, got {got:?}"))
        })
        .collect();
    assert!(wrong.is_empty(), "{wrong:#?}");
}

/// An array-valued calculation over a cell repaired by the fixup is recomputed, not served from
/// the value cached before the repair (D2 = D5*1 with D5 a lookup; K1 sums |D2:D3| via ABS).
#[test]
fn array_subexpression_over_a_repaired_cell_is_final() {
    let snap = build_snapshot(vec![(
        "Sheet1",
        20,
        12,
        vec![
            (1, 0, n(5.0), None),                                          // A2 = 5
            (1, 1, CellValue::Null, Some("=A2*2")),                        // B2 = 10
            (4, 3, CellValue::Null, Some("=INDEX($B$2:$C$2,1,1)")),        // D5 = 10
            (1, 3, CellValue::Null, Some("=D5*1")),                        // D2 = 10
            (2, 3, n(-3.0), None),                                         // D3 = -3
            (0, 10, CellValue::Null, Some("=SUMPRODUCT(ABS($D$2:$D$3))")), // K1 = 13
        ],
    )]);
    assert_eq!(final_number(&run_snapshot(snap), 0, 0, 10), 13.0);
}

/// Controls: one lookup hop was already right before the fix and must stay right.
#[test]
fn single_lookup_hop_controls() {
    assert_eq!(two_hop("=B2", "=INDEX($D$2:$E$2,1,1)"), 10.0);
    assert_eq!(two_hop("=INDEX($B$2:$C$2,1,1)", "=SUM($D$2:$D$2)"), 10.0);
}

/// Three lookups in a chain across sheets, with plain formulas between them (the real model's
/// shape: Annual -> INDEX -> FAM chain -> INDEX -> Ops).
#[test]
fn three_lookup_chain_across_sheets_is_final() {
    let snap = build_snapshot(vec![
        (
            "A",
            10,
            10,
            vec![
                (0, 0, n(3.0), None),                   // A!A1 = 3
                (0, 1, CellValue::Null, Some("=A1*2")), // A!B1 = 6
            ],
        ),
        (
            "B",
            10,
            10,
            vec![
                (5, 0, CellValue::Null, Some("=INDEX(A!$B$1:$C$1,1,1)")), // B!A6 = 6
                (5, 1, CellValue::Null, Some("=A6+1")),                   // B!B6 = 7
                (0, 0, CellValue::Null, Some("=B6*10")),                  // B!A1 = 70
            ],
        ),
        (
            "C",
            10,
            10,
            vec![
                (6, 0, CellValue::Null, Some("=INDEX(B!$A$1:$B$1,1,1)")), // C!A7 = 70
                (0, 2, CellValue::Null, Some("=A7-5")),                   // C!C1 = 65
                (9, 9, CellValue::Null, Some("=INDEX($C$1:$D$1,1,1)")),   // C!J10 = 65
            ],
        ),
    ]);
    let r = run_snapshot(snap);
    assert_eq!(final_number(&r, 1, 0, 0), 70.0);
    assert_eq!(final_number(&r, 2, 6, 0), 70.0);
    assert_eq!(final_number(&r, 2, 9, 9), 65.0);
}

/// A lookup whose range holds its own cell and a cell computed from it, but which reads another
/// cell, is not circular (the reason selective ranges get no ordering edges): it settles, and no
/// circular reference is reported.
#[test]
fn lookup_over_its_own_dependents_is_not_a_cycle() {
    let snap = build_snapshot(vec![(
        "Sheet1",
        5,
        5,
        vec![
            (0, 0, n(7.0), None),                                   // A1 = 7
            (2, 0, CellValue::Null, Some("=INDEX($A$1:$A$3,1,1)")), // A3 = A1 = 7
            (1, 0, CellValue::Null, Some("=A3+1")),                 // A2 = 8
        ],
    )]);
    let r = run_snapshot(snap);
    assert_eq!(final_number(&r, 0, 2, 0), 7.0);
    assert_eq!(final_number(&r, 0, 1, 0), 8.0);
    assert!(
        r.errors.iter().all(|e| !e.error.contains("Circular")),
        "false cycle reported: {:?}",
        r.errors
    );
}

/// A lookup that really reads a cell computed from its own result (A1 = INDEX(B1:B1,1,1),
/// B1 = A1 + 1) is a circular reference: it is reported like any other, and the recalc ends.
#[test]
fn lookup_reading_its_own_result_is_reported_as_circular() {
    let snap = build_snapshot(vec![(
        "Sheet1",
        5,
        5,
        vec![
            (0, 0, CellValue::Null, Some("=INDEX($B$1:$B$1,1,1)")), // A1
            (0, 1, CellValue::Null, Some("=A1+1")),                 // B1
        ],
    )]);
    let r = run_snapshot(snap);
    let a1 = cell_uuid(0, 0, 0);
    assert!(
        r.errors
            .iter()
            .any(|e| e.cell_id == a1 && e.error == "Circular reference detected"),
        "lookup cycle not reported: {:?}",
        r.errors
    );
}
