//! A lookup (INDEX/HLOOKUP/...) whose range holds the result of ANOTHER lookup must end the
//! full recalc with the final value, not one read before the first lookup was fixed up.
//!
//! Selective range deps get no ordering barrier, so the main pass can evaluate a lookup before
//! the formula cells in its range; the selective fixup pass repairs that. When a lookup's range
//! holds a cell computed FROM another lookup, the outer lookup has to be re-read after that cell
//! is repaired, or it keeps the stale value (found on a 5,150-formula model where one stale
//! INDEX fed 967 downstream cells).
//!
//! Run:
//!   cargo test -p compute-core --test recalc_selective_chain -- --nocapture

#[path = "support/mod.rs"]
mod support;

use cell_types::{CellId, SheetId};
use compute_core::cells::CellStore;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{RecalcResult, WorkbookSnapshot};
use support::recalc_fixtures::{build_snapshot, cell_uuid, run_snapshot, sheet_uuid};
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

// ---------------------------------------------------------------------------
// The repair that follows the re-read: everything that depends on a repaired lookup is
// re-evaluated once, in dependency order, and a lookup's range orders the lookup.
// ---------------------------------------------------------------------------

type Cell = (u32, u32, CellValue, Option<&'static str>);

fn formula(row: u32, col: u32, text: &'static str) -> Cell {
    (row, col, CellValue::Null, Some(text))
}

fn number(row: u32, col: u32, value: f64) -> Cell {
    (row, col, n(value), None)
}

/// A loaded workbook whose cells can be read back and edited.
struct Book {
    core: ComputeCore,
    store: CellStore,
    /// The result of the recalc that loaded it.
    loaded: RecalcResult,
}

fn load(snapshot: WorkbookSnapshot) -> Book {
    let mut store = CellStore::new();
    let mut core = ComputeCore::new();
    let loaded = core
        .init_from_snapshot(&mut store, snapshot)
        .expect("init failed");
    Book {
        core,
        store,
        loaded,
    }
}

fn sheet1(cells: Vec<Cell>, rows: u32, cols: u32) -> Book {
    load(build_snapshot(vec![("Sheet1", rows, cols, cells)]))
}

impl Book {
    fn value(&self, row: u32, col: u32) -> CellValue {
        let id = CellId::from_uuid_str(&cell_uuid(0, row, col)).unwrap();
        self.store
            .get_cell_value(&id)
            .cloned()
            .unwrap_or(CellValue::Null)
    }

    fn number(&self, row: u32, col: u32) -> f64 {
        match self.value(row, col) {
            CellValue::Number(v) => v.get(),
            other => panic!("cell ({row},{col}) expected a number, got {other:?}"),
        }
    }

    fn edit(&mut self, row: u32, col: u32, text: &str) -> RecalcResult {
        let sheet = SheetId::from_uuid_str(&sheet_uuid(0)).unwrap();
        let id = CellId::from_uuid_str(&cell_uuid(0, row, col)).unwrap();
        self.core
            .set_cell(&mut self.store, &sheet, id, row, col, text)
            .expect("edit failed")
    }
}

fn reports_circular(result: &RecalcResult) -> bool {
    result.errors.iter().any(|e| e.error.contains("Circular"))
}

/// A lookup cell that also refers directly to a cell computed from another lookup is
/// re-evaluated after that cell is repaired (D1 = lookup = 10, E1 = D1*1, F1 = E1 + lookup),
/// and so is a lookup whose row argument is a repaired cell (H1 = INDEX(G1:G3, D1)).
#[test]
fn lookup_with_a_direct_reference_to_a_repaired_cell_is_final() {
    let book = sheet1(
        vec![
            number(0, 0, 2.0),                         // A1 = 2
            formula(0, 1, "=A1*1"),                    // B1 = 2
            formula(0, 3, "=INDEX($B$1:$C$1,1,1)"),    // D1 = 2
            formula(0, 4, "=D1*5"),                    // E1 = 10
            formula(0, 5, "=E1+INDEX($B$1:$C$1,1,1)"), // F1 = 12
            formula(0, 6, "=A1*10"),                   // G1 = 20
            formula(1, 6, "=A1*20"),                   // G2 = 40
            formula(2, 6, "=A1*30"),                   // G3 = 60
            formula(0, 7, "=INDEX($G$1:$G$3,D1)"),     // H1 = G2 = 40
        ],
        10,
        10,
    );
    assert_eq!(book.number(0, 5), 12.0);
    assert_eq!(book.number(0, 7), 40.0);
}

/// A range read in full is not expanded into cell references once it holds 256 cells; a SUM
/// over such a range is still re-evaluated when the fixup repairs one of its cells.
#[test]
fn sum_over_a_large_range_holding_a_repaired_cell_is_final() {
    let mut cells = vec![
        number(0, 0, 5.0),                      // A1 = 5
        formula(0, 1, "=A1*2"),                 // B1 = 10
        formula(0, 3, "=INDEX($B$1:$C$1,1,1)"), // D1 = 10
        formula(0, 8, "=SUM($G$1:$G$300)"),     // I1 = 299 + 10
    ];
    for row in 0..300 {
        cells.push(if row == 150 {
            formula(row, 6, "=D1*1")
        } else {
            number(row, 6, 1.0)
        });
    }
    let mut book = sheet1(cells, 400, 12);
    assert_eq!(book.number(0, 8), 309.0);
    book.edit(0, 0, "7");
    assert_eq!(book.number(0, 8), 313.0);
}

/// A spill whose size comes from a lookup is read, through a range, at its final size.
#[test]
fn lookup_over_a_spill_sized_by_a_lookup_is_final() {
    let book = sheet1(
        vec![
            number(0, 0, 1.5),                      // A1 = 1.5
            formula(0, 1, "=A1*2"),                 // B1 = 3
            formula(0, 3, "=INDEX($B$1:$C$1,1,1)"), // D1 = 3
            formula(0, 5, "=SEQUENCE(D1)"),         // F1:F3 = 1, 2, 3
            formula(0, 9, "=SUM(F1:F10)"),          // J1 = 6
            formula(1, 9, "=INDEX($F$1:$F$10,3)"),  // J2 = 3
        ],
        20,
        12,
    );
    assert_eq!(book.number(0, 9), 6.0);
    assert_eq!(book.number(1, 9), 3.0);
}

/// A volatile lookup whose range holds a cell computed from it is not a circular reference,
/// and the cells that read it agree with the value it ends with (A2 = C1*2, E5 reads A2 back
/// through a lookup), on load and after an edit.
#[test]
fn volatile_lookup_over_its_own_dependent_is_not_a_cycle() {
    for volatile in [
        "=INDEX($A$1:$A$3,1,1)+RAND()",
        "=INDEX($A$1:$A$3,1,1)+RANDBETWEEN(1,1000000)",
        "=INDEX($A$1:$A$3,1,1)+NOW()",
        "=INDEX($A$1:$A$3,1,1)+TODAY()",
        "=INDEX($A$1:$A$3,1,1)+OFFSET($Y$1,0,0)",
        "=INDEX($A$1:$A$3,1,1)+INDIRECT(\"Y1\")",
    ] {
        let mut book = sheet1(
            vec![
                number(0, 24, 7.0),                     // Y1 = 7
                formula(0, 0, "=Y1*1"),                 // A1 = 7
                formula(0, 2, volatile),                // C1
                formula(1, 0, "=C1*2"),                 // A2, inside C1's range
                formula(4, 4, "=INDEX($A$1:$A$3,2,1)"), // E5 = A2
            ],
            8,
            30,
        );
        assert!(
            !reports_circular(&book.loaded),
            "{volatile}: {:?}",
            book.loaded.errors
        );
        assert_eq!(book.number(1, 0), book.number(0, 2) * 2.0, "{volatile}");
        assert_eq!(book.number(4, 4), book.number(1, 0), "{volatile}");

        let edited = book.edit(0, 24, "8");
        assert!(
            !reports_circular(&edited),
            "{volatile}: {:?}",
            edited.errors
        );
        assert_eq!(book.number(1, 0), book.number(0, 2) * 2.0, "{volatile}");
        assert_eq!(book.number(4, 4), book.number(1, 0), "{volatile}");
    }
}

/// A spilling lookup whose range holds its own spill and a cell computed from it is not a
/// circular reference either (a spill is reported at every evaluation, changed or not).
#[test]
fn spilling_lookup_over_its_own_spill_is_not_a_cycle() {
    let book = sheet1(
        vec![
            number(0, 24, 7.0),                                 // Y1 = 7
            formula(0, 0, "=Y1*1"),                             // A1 = 7
            formula(0, 2, "=INDEX($A$1:$D$3,1,1)*SEQUENCE(2)"), // C1:C2 = 7, 14
            formula(2, 0, "=C2+1"),                             // A3 = 15
        ],
        5,
        30,
    );
    assert!(!reports_circular(&book.loaded), "{:?}", book.loaded.errors);
    assert_eq!(book.number(0, 2), 7.0);
    assert_eq!(book.number(2, 0), 15.0);
}

/// Column B: B1 = 1 and every cell below is the one named by `previous` plus one.
fn lookup_chain(rows: u32, previous: impl Fn(u32) -> String) -> Book {
    let mut cells = vec![number(0, 0, 1.0), formula(0, 1, "=A1*1")];
    for row in 1..rows {
        cells.push(formula(row, 1, Box::leak(previous(row).into_boxed_str())));
    }
    sheet1(cells, rows + 5, 5)
}

/// A chain of lookups, each reading the one above it, ends with final values at a cost that
/// grows with the length of the chain, not with its square: every cell is evaluated a handful
/// of times, whether each lookup's range stops above it (no cell depends on a lookup that may
/// read it) or is the whole column (every lookup's range holds all the others).
#[test]
fn chain_of_lookups_costs_a_few_evaluations_per_cell() {
    let rows = 600;
    for (shape, book) in [
        (
            "range above",
            lookup_chain(rows, |row| format!("=INDEX($B$1:$B${row},{row})+1")),
        ),
        (
            "whole column",
            lookup_chain(rows, |row| format!("=INDEX($B$1:$B${rows},{row})+1")),
        ),
    ] {
        assert_eq!(book.number(rows - 1, 1), f64::from(rows), "{shape}");
        assert!(
            !reports_circular(&book.loaded),
            "{shape}: {:?}",
            book.loaded.errors
        );
        let evaluations = book.loaded.metrics.cells_evaluated;
        assert!(
            evaluations <= 6 * u64::from(rows),
            "{shape}: {evaluations} evaluations for {rows} cells"
        );
    }
}

/// The same chain read against sheet order (each lookup reads the cell below it) also ends
/// with final values.
#[test]
fn chain_of_lookups_against_sheet_order_is_final() {
    let rows = 40;
    let mut cells = vec![number(0, 0, 1.0), formula(rows - 1, 1, "=A1*1")];
    for row in 0..rows - 1 {
        let text = format!("=INDEX($B$1:$B${rows},{})+1", row + 2);
        cells.push(formula(row, 1, Box::leak(text.into_boxed_str())));
    }
    let book = sheet1(cells, rows + 5, 5);
    assert_eq!(book.number(0, 1), f64::from(rows));
    assert!(!reports_circular(&book.loaded), "{:?}", book.loaded.errors);
}

/// A lookup that reads a cell computed from its own result is a cycle like any other: with
/// iterative calculation on it is solved (A1 = B1/2 + 1, B1 = A1: fixed point 2).
#[test]
fn lookup_cycle_is_solved_when_iterative_calculation_is_on() {
    let mut snapshot = build_snapshot(vec![(
        "Sheet1",
        5,
        5,
        vec![
            number(0, 3, 1.0),                             // D1 = 1
            formula(0, 0, "=INDEX($B$1:$B$1,1,1)*0.5+D1"), // A1
            formula(0, 1, "=A1*1"),                        // B1
        ],
    )]);
    snapshot.iterative_calc = true;
    let book = load(snapshot);
    assert!(
        (book.number(0, 0) - 2.0).abs() < 0.01,
        "{}",
        book.number(0, 0)
    );
    assert!(
        (book.number(0, 1) - 2.0).abs() < 0.01,
        "{}",
        book.number(0, 1)
    );
}

/// A cycle of direct references whose input is a lookup repaired by the fixup is solved again
/// on the repaired input (E1 = D1 + F1/2, F1 = E1, D1 = lookup = 10: fixed point 20).
#[test]
fn iterative_model_fed_by_a_repaired_lookup_is_solved() {
    let mut snapshot = build_snapshot(vec![(
        "Sheet1",
        5,
        8,
        vec![
            number(0, 0, 5.0),                      // A1 = 5
            formula(0, 1, "=A1*2"),                 // B1 = 10
            formula(0, 3, "=INDEX($B$1:$C$1,1,1)"), // D1 = 10
            formula(0, 4, "=D1+0.5*F1"),            // E1
            formula(0, 5, "=E1*1"),                 // F1
            formula(0, 6, "=F1+1"),                 // G1 = F1 + 1
        ],
    )]);
    snapshot.iterative_calc = true;
    let book = load(snapshot);
    assert!(
        (book.number(0, 4) - 20.0).abs() < 0.01,
        "{}",
        book.number(0, 4)
    );
    assert!(
        (book.number(0, 6) - 21.0).abs() < 0.01,
        "{}",
        book.number(0, 6)
    );
}
