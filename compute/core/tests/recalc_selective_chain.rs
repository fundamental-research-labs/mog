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
use compute_core::bridge_types::CellInput;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CalcMode, RecalcResult, WorkbookSnapshot};
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
/// cell, is not circular (the reason selective ranges get no ordering edges): it ends with the
/// value it reads, what refers to it follows, and no circular reference is reported.
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
    store: CellMirror,
    /// The result of the recalc that loaded it.
    loaded: RecalcResult,
}

fn load(snapshot: WorkbookSnapshot) -> Book {
    let mut store = CellMirror::new();
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

    /// Several cells written as one edit.
    fn edit_all(&mut self, edits: &[(u32, u32, &str)]) -> RecalcResult {
        let sheet = SheetId::from_uuid_str(&sheet_uuid(0)).unwrap();
        let edits: Vec<_> = edits
            .iter()
            .map(|&(row, col, text)| {
                let id = CellId::from_uuid_str(&cell_uuid(0, row, col)).unwrap();
                (sheet, id, row, col, CellInput::from(text))
            })
            .collect();
        self.core
            .set_cells(&mut self.store, &edits, false)
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
/// and the cell that reads it agrees with the value it ends with (A2 = C1*2), on load and
/// after an edit.
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
                number(0, 24, 7.0),      // Y1 = 7
                formula(0, 0, "=Y1*1"),  // A1 = 7
                formula(0, 2, volatile), // C1
                formula(1, 0, "=C1*2"),  // A2, inside C1's range
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

        let edited = book.edit(0, 24, "8");
        assert!(
            !reports_circular(&edited),
            "{volatile}: {:?}",
            edited.errors
        );
        assert_eq!(book.number(1, 0), book.number(0, 2) * 2.0, "{volatile}");
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

/// A chain of lookups, each reading the one above it through a range that stops above it,
/// ends with final values at a cost that grows with the length of the chain, not with its
/// square: the main pass, the re-read, and one more evaluation of each cell in order.
#[test]
fn chain_of_lookups_costs_a_few_evaluations_per_cell() {
    let rows = 600;
    let book = lookup_chain(rows, |row| format!("=INDEX($B$1:$B${row},{row})+1"));
    assert_eq!(book.number(rows - 1, 1), f64::from(rows));
    let evaluations = book.loaded.metrics.cells_evaluated;
    assert!(
        evaluations <= 4 * u64::from(rows),
        "{evaluations} evaluations for {rows} cells"
    );
}

/// The same chain through the whole column: every lookup's range holds all the others, so
/// there is no order in which each comes after the cells of its range. The fixup leaves such
/// cells as it always did (the re-read, and one evaluation of what refers to a changed cell);
/// it does not repeat over them, whichever way the chain runs, and reports no cycle.
#[test]
fn lookups_over_their_own_dependents_cost_no_more_than_before() {
    let rows = 600;
    for (shape, book) in [
        (
            "reads the cell above",
            lookup_chain(rows, |row| format!("=INDEX($B$1:$B${rows},{row})+1")),
        ),
        (
            "reads the cell below",
            lookup_chain(rows, |row| {
                format!("=INDEX($B$1:$B${rows},{})+1", (row + 2).min(rows))
            }),
        ),
    ] {
        assert!(
            !reports_circular(&book.loaded),
            "{shape}: {:?}",
            book.loaded.errors
        );
        let evaluations = book.loaded.metrics.cells_evaluated;
        assert!(
            evaluations <= 4 * u64::from(rows),
            "{shape}: {evaluations} evaluations for {rows} cells"
        );
    }
}

/// In manual calculation mode an edit evaluates the edited formulas and nothing else: what
/// depends on them waits for an explicit calculate. The fixup keeps to that. Three lookups in a
/// row written in one edit all end final, and I1 = H4*10 and the SUM over column H still show
/// what they showed before.
#[test]
fn manual_mode_repairs_the_edited_lookups_and_leaves_their_dependents_pending() {
    let mut book = sheet1(
        vec![
            number(0, 0, 1.0),                      // A1 = 1
            formula(0, 1, "=A1*2"),                 // B1 = 2
            formula(1, 3, "=INDEX($B$1:$C$1,1,1)"), // D2 = 2
            formula(0, 3, "=D2*1"),                 // D1 = 2
            formula(2, 5, "=INDEX($D$1:$E$1,1,1)"), // F3 = 2
            formula(0, 5, "=F3*1"),                 // F1 = 2
            formula(3, 7, "=INDEX($F$1:$G$1,1,1)"), // H4 = 2
            formula(0, 8, "=H4*10"),                // I1 = 20
            formula(0, 9, "=SUM($H$1:$H$300)"),     // J1 = 2
        ],
        400,
        12,
    );
    assert_eq!(book.number(0, 8), 20.0);
    assert_eq!(book.number(0, 9), 2.0);

    book.core.set_calc_mode(CalcMode::Manual);
    book.edit_all(&[
        (3, 7, "=INDEX($F$1:$G$1,1,1)+0"),
        (0, 5, "=F3*1+0"),
        (2, 5, "=INDEX($D$1:$E$1,1,1)+0"),
        (0, 3, "=D2*1+0"),
        (1, 3, "=INDEX($B$1:$C$1,1,1)+0"),
        (0, 1, "=A1*7"),
    ]);
    for (row, col) in [(0, 1), (1, 3), (0, 3), (2, 5), (0, 5), (3, 7)] {
        assert_eq!(book.number(row, col), 7.0, "edited cell ({row},{col})");
    }
    assert_eq!(book.number(0, 8), 20.0, "I1 waits for a calculate");
    assert_eq!(book.number(0, 9), 2.0, "J1 waits for a calculate");

    book.core.set_calc_mode(CalcMode::Auto);
    book.edit(0, 0, "1");
    assert_eq!(book.number(0, 8), 70.0);
    assert_eq!(book.number(0, 9), 7.0);
}

/// A cell behind a lookup whose range holds its own dependents (G1, behind J2 and H1) has no
/// place in the fixup's order and keeps the old cascade. That cascade still follows every cell
/// it used to evaluate itself, also one that now has a place in the order (E1): G1 ends with
/// the final E1.
#[test]
fn cell_without_a_level_follows_an_ordered_cell_it_refers_to() {
    let book = sheet1(
        vec![
            number(0, 0, 5.0),                      // A1 = 5
            formula(1, 0, "=A1+0"),                 // A2 = 5
            formula(1, 1, "=A2*2"),                 // B2 = 10
            formula(4, 3, "=INDEX($B$2:$C$2,1,1)"), // D5 = 10
            formula(0, 4, "=D5*2"),                 // E1 = 20
            number(0, 9, 7.0),                      // J1 = 7
            formula(0, 7, "=INDEX($J$1:$J$3,1,1)"), // H1 = 7, over J2
            formula(1, 9, "=H1+1+D5*0"),            // J2 = 8
            formula(0, 6, "=E1+J2"),                // G1 = 28
        ],
        10,
        12,
    );
    assert_eq!(book.number(0, 4), 20.0);
    assert_eq!(book.number(0, 6), 28.0);
}

/// A cell without a place in the fixup's order (I1: J1 looks up a range that holds it) is left
/// to the old cascade alone. H1 has a place and is repaired after the cascade: it adds a SUM
/// over a large range holding a repaired cell, which the cascade does not follow. I1 = H1 - J1
/// is not evaluated again from the repaired H1 while J1 has not followed, and keeps 0, the
/// value it ends with.
#[test]
fn cell_without_a_level_keeps_what_the_cascade_gave_it() {
    let mut cells = vec![
        number(0, 0, 5.0),                      // A1 = 5
        formula(1, 0, "=A1+0"),                 // A2 = 5
        formula(1, 1, "=A2*2"),                 // B2 = 10
        formula(4, 3, "=INDEX($B$2:$C$2,1,1)"), // D5 = 10
        formula(0, 5, "=SUM($G$1:$G$300)"),     // F1 = 299 + 10
        formula(0, 7, "=D5*0+F1"),              // H1 = 309
        formula(0, 9, "=INDEX($H$1:$I$1,1,1)"), // J1, over I1
        formula(0, 8, "=H1-J1"),                // I1 = 0
    ];
    for row in 0..300 {
        cells.push(if row == 150 {
            formula(row, 6, "=D5*1")
        } else {
            number(row, 6, 1.0)
        });
    }
    let book = sheet1(cells, 400, 12);
    assert_eq!(book.number(0, 7), 309.0);
    assert_eq!(book.number(0, 8), 0.0);
}
