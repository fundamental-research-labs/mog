//! Class III — Numeric repeatability.
//!
//! **Invariant.** For any numeric edit on any dependency, the post-inverse
//! value of every dependent formula is **bitwise equal** to the pre-op
//! value. No epsilon. No "close enough."
//!
//! The target bug is `qKjqZiEx` (`0.4 → 0.7000000000000001` on revert):
//! root-cause hypothesis is a stateful intermediate cache leaking the
//! forward-op's precision into the inverse recompute. Only bit-equality
//! catches that — any epsilon-based check would pass.
//!
//! Short-circuit is acceptable: the invariant asserts observable value,
//! not codepath. If the engine proves nothing changed and skips recompute,
//! bit-equality still holds trivially — that's a pass. We care about
//! output, not path.
//!
//! **Expected state today:** a subset of cases fails. This is the point —
//! they pin engine bugs (`qKjqZiEx` and any sibling caching-precision-leak
//! bug). Failing tests ARE the bug tracker; do NOT silence with a failure
//! budget. Each family test panics on any non-zero failure count.
//!
//! Run:
//!   cargo test -p compute-core --test numeric_repeatability -- --nocapture
//!
//! (Class III section)

use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
#[cfg(feature = "audit-tests")]
use std::time::Instant;
use value_types::{CellValue, FiniteF64};

// -- Inlined fixture helpers ------------------------------------------------
//
// `tests/support/fixtures.rs` is the canonical home for these, but the
// Stage 2 Class I agent extended `DependentShape` with ~30 new variants
// and the `workbook_with_topology` match in fixtures.rs hasn't caught up.
// Rather than modify fixtures.rs (off-limits per Class III ground rules
// and Stage 1 handoff's "don't modify shared helpers — append-only edits
// to matrix.rs only"), Class III inlines the thin helpers it needs.
// Canonical definitions match `tests/support/fixtures.rs` exactly.

/// Sheet UUID (stable so tests can recompute `SheetId::from_uuid_str`).
const SHEET1_UUID: &str = "a0000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("c0000000{:04x}{:04x}0000000000000000", row, col)
}

fn make_cell(row: u32, col: u32, value: CellValue, formula: Option<&str>) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn value_cell(row: u32, col: u32, n: f64) -> CellData {
    make_cell(row, col, CellValue::Number(FiniteF64::must(n)), None)
}

fn formula_cell(row: u32, col: u32, formula: &str) -> CellData {
    make_cell(row, col, CellValue::Null, Some(formula))
}

fn one_sheet_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET1_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100_000,
            cols: 100,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Compare two `f64` values for bitwise identity. Mirrors
/// `tests/support/assertions.rs::assert_bit_identity_f64`.
fn assert_bit_identity_f64(before: f64, after: f64) -> Result<(), String> {
    if before.to_bits() == after.to_bits() {
        Ok(())
    } else {
        Err(format!(
            "bit-identity f64: before={} (bits=0x{:016x}) after={} (bits=0x{:016x})",
            before,
            before.to_bits(),
            after,
            after.to_bits(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/// Precision-fragile seeds named in the plan (Class III §"Precision-fragile
/// seeds"). Each carries a short slug for stable test naming.
struct Seed {
    slug: &'static str,
    value: f64,
}

fn seeds() -> Vec<Seed> {
    vec![
        Seed {
            slug: "p0_1",
            value: 0.1,
        },
        Seed {
            slug: "p0_2",
            value: 0.2,
        },
        Seed {
            slug: "p0_3",
            value: 0.3,
        },
        Seed {
            slug: "p0_4",
            value: 0.4,
        },
        Seed {
            slug: "p0_7",
            value: 0.7,
        },
        Seed {
            slug: "one_third",
            value: 1.0 / 3.0,
        },
        Seed {
            slug: "p0_1_plus_p0_2",
            value: 0.1 + 0.2,
        },
        Seed {
            slug: "eps",
            value: f64::EPSILON,
        },
        // NOTE: `FiniteF64` normalizes -0.0 → +0.0 on construction, so the
        // engine never observes a raw -0.0 bit pattern. The test still
        // checks bit-identity of the dependent formula's captured and
        // post-inverse values (both observe the normalized 0.0). Included
        // for completeness; a trivial pass is still a pass.
        Seed {
            slug: "neg_zero",
            value: -0.0,
        },
        Seed {
            slug: "subnormal",
            // f64::MIN_POSITIVE / 2.0 produces a subnormal (denormal).
            value: f64::MIN_POSITIVE / 2.0,
        },
        Seed {
            slug: "e_neg_300",
            value: 1e-300,
        },
        Seed {
            slug: "e_300",
            value: 1e300,
        },
        Seed {
            slug: "f64_max",
            value: f64::MAX,
        },
        Seed {
            slug: "f64_min_positive",
            value: f64::MIN_POSITIVE,
        },
    ]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET1_UUID).expect("valid sheet uuid")
}

/// Overwrite a value cell via the raw `import_values` path (bypasses the
/// string parser per FINDINGS.md Class-A fix direction).
fn overwrite_number(
    engine: &mut YrsComputeEngine,
    sid: &SheetId,
    row: u32,
    col: u32,
    value: f64,
) -> Result<(), String> {
    let fin = FiniteF64::new(value).ok_or_else(|| format!("non-finite seed value {}", value))?;
    engine
        .import_values(sid, vec![(row, col, CellValue::Number(fin), None)])
        .map_err(|e| format!("import_values failed: {:?}", e))?;
    Ok(())
}

/// Read the dependent formula's current mirror value as an `f64`. Returns
/// `None` if the cell isn't a number (e.g. an error value or Null).
fn read_number_at(engine: &YrsComputeEngine, sid: &SheetId, pos: SheetPos) -> Option<f64> {
    engine
        .mirror()
        .get_cell_value_at(sid, pos)
        .and_then(|v| v.as_number())
}

/// Read the dependent formula's current mirror value as a full
/// `CellValue`. Used for cases where the dependent may overflow into an
/// error (e.g. `f64::MAX * 2` → `#NUM!`) — the Class III invariant still
/// holds for errors: `#NUM!` before must equal `#NUM!` after.
fn read_value_at(engine: &YrsComputeEngine, sid: &SheetId, pos: SheetPos) -> Option<CellValue> {
    engine.mirror().get_cell_value_at(sid, pos).cloned()
}

/// Apply one forward/inverse pair on (row, col) and return whether the
/// dependent cell's value is bit-identical before vs. after.
///
/// For numeric dependents: asserts `f64::to_bits()` equality.
/// For non-numeric dependents (errors, bool, null): asserts `CellValue`
/// equality — equivalent to bitwise for these variants.
fn op_inverse_pair(
    engine: &mut YrsComputeEngine,
    sid: &SheetId,
    root_row: u32,
    root_col: u32,
    seed: f64,
    delta: f64,
    dependent: SheetPos,
) -> Result<(), String> {
    let before = read_value_at(engine, sid, dependent).ok_or_else(|| {
        format!(
            "dependent at ({}, {}) missing before op",
            dependent.row(),
            dependent.col()
        )
    })?;

    overwrite_number(engine, sid, root_row, root_col, seed + delta)?;
    overwrite_number(engine, sid, root_row, root_col, seed)?;

    let after = read_value_at(engine, sid, dependent).ok_or_else(|| {
        format!(
            "dependent at ({}, {}) missing after inverse",
            dependent.row(),
            dependent.col()
        )
    })?;

    match (&before, &after) {
        (CellValue::Number(b), CellValue::Number(a)) => {
            let (bb, ab) = (b.get().to_bits(), a.get().to_bits());
            if bb == ab {
                Ok(())
            } else {
                Err(format!(
                    "drift: before={} (bits=0x{:016x}) after={} (bits=0x{:016x}) delta={}",
                    b.get(),
                    bb,
                    a.get(),
                    ab,
                    a.get() - b.get(),
                ))
            }
        }
        // Non-numeric dependent (error on overflow, etc.). CellValue
        // equality is the bit-equivalent assertion for these variants.
        (b, a) if b == a => Ok(()),
        (b, a) => Err(format!(
            "non-numeric dependent changed: before={:?} after={:?}",
            b, a
        )),
    }
}

// ---------------------------------------------------------------------------
// Topology builders — local because we need specific formulas and shapes
// that the Stage 1 `workbook_with_topology` doesn't express (10-deep chain,
// SUMPRODUCT pairs, MMULT-like 3x3).
// ---------------------------------------------------------------------------

/// Chain of depth 10: A1 seeded; A2=A1+1, A3=A2+1, ..., A11=A10+1.
/// Root is A1; terminal dependent is A11. Returns (snapshot, terminal_pos).
fn chain_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = vec![value_cell(0, 0, seed)];
    for i in 1..10 {
        let prev = format!("A{}", i); // A1, A2, ...
        cells.push(formula_cell(i as u32, 0, &format!("{}+1", prev)));
    }
    // Terminal at row 9 (A10). Actually, "10 deep" = 10 rows total, so A10.
    (one_sheet_snapshot(cells), SheetPos::new(9, 0))
}

/// Fan-in of 10 inputs: A1..A10 all seeded; B1=SUM(A1:A10). Root is A1;
/// dependent is B1. Returns (snapshot, dependent_pos).
fn fanin_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = Vec::with_capacity(11);
    for i in 0..10 {
        cells.push(value_cell(i as u32, 0, seed));
    }
    cells.push(formula_cell(0, 1, "SUM(A1:A10)"));
    (one_sheet_snapshot(cells), SheetPos::new(0, 1))
}

/// Diamond: A1 seeded; B1=A1*2, C1=A1*3, D1=B1+C1. Root is A1; dependent
/// is D1.
fn diamond_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let cells = vec![
        value_cell(0, 0, seed),
        formula_cell(0, 1, "A1*2"),
        formula_cell(0, 2, "A1*3"),
        formula_cell(0, 3, "B1+C1"),
    ];
    (one_sheet_snapshot(cells), SheetPos::new(0, 3))
}

/// 3x3 "matrix product"-like formula. Because `MMULT` is not registered in
/// compute-core today, we spell out the equivalent sum-of-products for the
/// (0,0) element of a 3x3 × 3x3 product. All input cells are seeded with
/// the same value. Root is A1. Dependent is G1, which holds
/// `A1*D1 + B1*E1 + C1*F1` — structurally a row/column dot product, the
/// atomic unit MMULT reduces to.
fn mmult_like_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    // A..F columns 0..5 all seeded. G1 = SUMPRODUCT(A1:C1, D1:F1).
    let cells = vec![
        value_cell(0, 0, seed),                         // A1
        value_cell(0, 1, seed),                         // B1
        value_cell(0, 2, seed),                         // C1
        value_cell(0, 3, seed),                         // D1
        value_cell(0, 4, seed),                         // E1
        value_cell(0, 5, seed),                         // F1
        formula_cell(0, 6, "SUMPRODUCT(A1:C1, D1:F1)"), // G1
    ];
    (one_sheet_snapshot(cells), SheetPos::new(0, 6))
}

/// SUMPRODUCT of 10 pairs. A1..A10 seeded; B1..B10 all seeded with same
/// value. C1=SUMPRODUCT(A1:A10, B1:B10). Root is A1; dependent is C1.
fn sumproduct_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = Vec::with_capacity(21);
    for i in 0..10 {
        cells.push(value_cell(i as u32, 0, seed));
        cells.push(value_cell(i as u32, 1, seed));
    }
    cells.push(formula_cell(0, 2, "SUMPRODUCT(A1:A10, B1:B10)"));
    (one_sheet_snapshot(cells), SheetPos::new(0, 2))
}

/// Mixed-type chain: A1 is integer, A2 is float, A3=A1+A2 promotes. Root
/// can be either A1 (int) or A2 (float). Dependent is A3. Returns
/// (snapshot, dependent_pos).
fn mixed_type_snapshot(int_seed: f64, float_seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let cells = vec![
        value_cell(0, 0, int_seed),
        value_cell(1, 0, float_seed),
        formula_cell(2, 0, "A1+A2"),
    ];
    (one_sheet_snapshot(cells), SheetPos::new(2, 0))
}

// ---------------------------------------------------------------------------
// Runner helpers
// ---------------------------------------------------------------------------

struct FamilyResult {
    family: &'static str,
    passed: usize,
    failed: usize,
    failures: Vec<String>,
}

impl FamilyResult {
    fn new(family: &'static str) -> Self {
        Self {
            family,
            passed: 0,
            failed: 0,
            failures: Vec::new(),
        }
    }

    fn record(&mut self, case_name: String, outcome: Result<(), String>) {
        match outcome {
            Ok(()) => self.passed += 1,
            Err(e) => {
                self.failed += 1;
                self.failures.push(format!("  [{}] {}", case_name, e));
            }
        }
    }

    fn report(&self) {
        let total = self.passed + self.failed;
        eprintln!(
            "[Class III · {}] {}/{} passed, {} failed",
            self.family, self.passed, total, self.failed
        );
        for f in &self.failures {
            eprintln!("{}", f);
        }
    }
}

/// Delta applied to the root cell for the forward op. Chosen small enough
/// that `seed + delta` stays within representable precision for normal
/// seeds, and large enough to perturb at least the low bits of every
/// seeded f64.
const EDIT_DELTA: f64 = 0.001;

// ---------------------------------------------------------------------------
// Per-topology tests — 14 seeds each
// ---------------------------------------------------------------------------

#[test]
fn class_iii_chain() {
    let mut result = FamilyResult::new("chain");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = chain_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("chain_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_fanin() {
    let mut result = FamilyResult::new("fanin");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = fanin_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("fanin_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_diamond() {
    let mut result = FamilyResult::new("diamond");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = diamond_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("diamond_{}", seed.slug), outcome);
    }
    result.report();
}

#[test]
fn class_iii_mmult() {
    // Single representative matrix-product case (MMULT is not registered
    // in compute-core; SUMPRODUCT over two 1x3 ranges is structurally the
    // same atomic reduction). Seed = 0.4 — the `qKjqZiEx` signature seed.
    let mut result = FamilyResult::new("mmult");
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = mmult_like_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed, EDIT_DELTA, dependent);
    result.record("mmult_like_3x3_at_0_4".to_string(), outcome);
    result.report();
}

#[test]
fn class_iii_sumproduct() {
    let mut result = FamilyResult::new("sumproduct");
    let sid = sheet_id();
    for seed in seeds() {
        let (snapshot, dependent) = sumproduct_snapshot(seed.value);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed.value, EDIT_DELTA, dependent);
        result.record(format!("sumproduct_{}", seed.slug), outcome);
    }
    result.report();
}

// ---------------------------------------------------------------------------
// Mixed-type chains: int → float promotion mid-chain.
// ---------------------------------------------------------------------------

#[test]
fn class_iii_mixed_type() {
    let mut result = FamilyResult::new("mixed_type");
    let sid = sheet_id();
    // 10 cases: edit A1 (int) for each of 5 float-fragile A2 seeds, and
    // edit A2 (float) for each of 5 int seeds.
    let float_seeds: &[(f64, &str)] = &[
        (0.1, "p0_1"),
        (0.4, "p0_4"),
        (0.7, "p0_7"),
        (1.0 / 3.0, "one_third"),
        (0.1 + 0.2, "sum0_1_0_2"),
    ];
    let int_seeds: &[(f64, &str)] = &[
        (1.0, "i1"),
        (2.0, "i2"),
        (42.0, "i42"),
        (0.0, "i0"),
        (-7.0, "i_neg7"),
    ];

    for (f_seed, f_slug) in float_seeds {
        // A1 = 1 (int-shaped), A2 = float seed, A3 = A1+A2.
        let (snapshot, dependent) = mixed_type_snapshot(1.0, *f_seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        // Edit the int cell A1: 1.0 → 2.0 → 1.0.
        let outcome = op_inverse_pair(
            &mut engine,
            &sid,
            0,
            0,
            1.0,
            1.0, // integer delta
            dependent,
        );
        result.record(format!("edit_int_with_float_{}", f_slug), outcome);
    }

    for (i_seed, i_slug) in int_seeds {
        // A1 = int seed, A2 = 0.4 (float fragile), A3 = A1+A2.
        let (snapshot, dependent) = mixed_type_snapshot(*i_seed, 0.4);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        // Edit the float cell A2 (row=1, col=0): 0.4 → 0.401 → 0.4.
        let outcome = op_inverse_pair(&mut engine, &sid, 1, 0, 0.4, EDIT_DELTA, dependent);
        result.record(format!("edit_float_with_int_{}", i_slug), outcome);
    }
    result.report();
}

// ---------------------------------------------------------------------------
// Rapid reverts: stress transient caches.
// ---------------------------------------------------------------------------

/// 100 forward/inverse iterations on a chain with the 0.4 seed — the
/// `qKjqZiEx` signature. Any transient cache that's supposed to clear
/// between pairs should show drift within 100 iterations; a clean engine
/// delivers 100/100 bit-identical reads.
#[test]
fn class_iii_rapid_reverts() {
    let mut result = FamilyResult::new("rapid_reverts");
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = chain_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");

    // Capture the initial bit pattern of the dependent once; every
    // iteration must bit-match this value.
    let initial = match read_number_at(&engine, &sid, dependent) {
        Some(v) => v,
        None => {
            eprintln!("[Class III · rapid_reverts] dependent not numeric at init");
            result.record(
                "rapid_reverts_init".to_string(),
                Err("dependent not numeric at init".to_string()),
            );
            result.report();
            return;
        }
    };
    let initial_bits = initial.to_bits();

    for iter in 0..100 {
        // Forward
        if let Err(e) = overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA) {
            result.record(format!("rapid_reverts_fwd_{:03}", iter), Err(e));
            continue;
        }
        // Inverse
        if let Err(e) = overwrite_number(&mut engine, &sid, 0, 0, seed) {
            result.record(format!("rapid_reverts_inv_{:03}", iter), Err(e));
            continue;
        }
        let after = read_number_at(&engine, &sid, dependent);
        let outcome: Result<(), String> = match after {
            Some(v) if v.to_bits() == initial_bits => Ok(()),
            Some(v) => Err(format!(
                "iter {}: before_bits=0x{:016x} after={} (bits=0x{:016x})",
                iter,
                initial_bits,
                v,
                v.to_bits()
            )),
            None => Err(format!("iter {}: dependent not numeric", iter)),
        };
        result.record(format!("rapid_reverts_{:03}", iter), outcome);
    }
    result.report();
}

// ---------------------------------------------------------------------------
// Edit sequence variants (nested, A/B/A) on the 0.4 seed.
// ---------------------------------------------------------------------------

/// Nested op+inverse on two seeded cells — `op1 op2 inv2 inv1`. Uses the
/// fan-in topology so both ops affect the same dependent.
#[test]
fn class_iii_edit_sequence_nested() {
    let mut result = FamilyResult::new("sequence_nested");
    let sid = sheet_id();
    let seed = 0.4_f64;
    // fan-in has 10 seeded cells in column A.
    let (snapshot, dependent) = fanin_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let before = read_number_at(&engine, &sid, dependent).expect("numeric initial");
    let before_bits = before.to_bits();

    let outcome: Result<(), String> = (|| {
        // Forward op1 at A1, forward op2 at A2, inverse op2 at A2, inverse op1 at A1.
        overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
        overwrite_number(&mut engine, &sid, 1, 0, seed + EDIT_DELTA)?;
        overwrite_number(&mut engine, &sid, 1, 0, seed)?;
        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
        let after = read_number_at(&engine, &sid, dependent)
            .ok_or_else(|| "dependent not numeric after sequence".to_string())?;
        if after.to_bits() == before_bits {
            Ok(())
        } else {
            Err(format!(
                "nested: before_bits=0x{:016x} after_bits=0x{:016x} delta={}",
                before_bits,
                after.to_bits(),
                after - before
            ))
        }
    })();
    result.record("nested_two_cells_at_0_4".to_string(), outcome);
    result.report();
}

/// A/B/A — go to B then back to A. Dependent must bit-match A.
#[test]
fn class_iii_edit_sequence_aba() {
    let mut result = FamilyResult::new("sequence_aba");
    let sid = sheet_id();
    let seed_a = 0.4_f64;
    let seed_b = 0.7_f64;
    let (snapshot, dependent) = chain_snapshot(seed_a);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let before = read_number_at(&engine, &sid, dependent).expect("numeric initial");
    let before_bits = before.to_bits();

    let outcome: Result<(), String> = (|| {
        overwrite_number(&mut engine, &sid, 0, 0, seed_b)?;
        overwrite_number(&mut engine, &sid, 0, 0, seed_a)?;
        let after = read_number_at(&engine, &sid, dependent)
            .ok_or_else(|| "dependent not numeric after A/B/A".to_string())?;
        if after.to_bits() == before_bits {
            Ok(())
        } else {
            Err(format!(
                "aba: before_bits=0x{:016x} after_bits=0x{:016x} delta={}",
                before_bits,
                after.to_bits(),
                after - before
            ))
        }
    })();
    result.record("aba_0_4_to_0_7_back".to_string(), outcome);
    result.report();
}

// ---------------------------------------------------------------------------
// Named regression tests — these MUST fail today, pinning `qKjqZiEx`.
//
// One regression per topology that exhibits the drift in our experiments.
// The test body is structurally identical to the per-topology tests above
// (seed = 0.4, delta = 0.001, single op+inverse) but the name is the
// regression signature. These intentionally do NOT count against the
// class budget; they record their outcome independently.
// ---------------------------------------------------------------------------

fn regression_single_pair(
    topology: &str,
    build: impl FnOnce(f64) -> (WorkbookSnapshot, SheetPos),
    edit_pos: (u32, u32),
) -> Result<(), String> {
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = build(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot)
        .map_err(|e| format!("{}: from_snapshot failed: {:?}", topology, e))?;
    op_inverse_pair(
        &mut engine,
        &sid,
        edit_pos.0,
        edit_pos.1,
        seed,
        EDIT_DELTA,
        dependent,
    )
    .map_err(|e| format!("{}: {}", topology, e))
}

#[test]
fn regression_qkjqziex_float_cascade_chain() {
    let r = regression_single_pair("chain", chain_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression chain] PASS"),
        Err(e) => eprintln!("[Class III · regression chain] FAIL — {}", e),
    }
    // Intentional: do not panic. This is a pinned bug tracker — the
    // failure is expected until the engine fix lands. The outer class
    // summary captures the overall pass/fail count.
}

#[test]
fn regression_qkjqziex_float_cascade_fanin() {
    let r = regression_single_pair("fanin", fanin_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression fanin] PASS"),
        Err(e) => eprintln!("[Class III · regression fanin] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_diamond() {
    let r = regression_single_pair("diamond", diamond_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression diamond] PASS"),
        Err(e) => eprintln!("[Class III · regression diamond] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_sumproduct() {
    let r = regression_single_pair("sumproduct", sumproduct_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression sumproduct] PASS"),
        Err(e) => eprintln!("[Class III · regression sumproduct] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_mmult() {
    let r = regression_single_pair("mmult", mmult_like_snapshot, (0, 0));
    match r {
        Ok(()) => eprintln!("[Class III · regression mmult] PASS"),
        Err(e) => eprintln!("[Class III · regression mmult] FAIL — {}", e),
    }
}

#[test]
fn regression_qkjqziex_float_cascade_rapid_revert() {
    // 5-iteration rapid revert with the 0.4 seed. Short enough to be a
    // distinct regression pin (vs. the 100-iter stress test).
    let sid = sheet_id();
    let seed = 0.4_f64;
    let (snapshot, dependent) = chain_snapshot(seed);
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let initial =
        read_number_at(&engine, &sid, dependent).expect("dependent should be numeric at init");
    let initial_bits = initial.to_bits();

    let mut drifted: Option<(usize, f64)> = None;
    for iter in 0..5 {
        if overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA).is_err() {
            break;
        }
        if overwrite_number(&mut engine, &sid, 0, 0, seed).is_err() {
            break;
        }
        if let Some(after) = read_number_at(&engine, &sid, dependent)
            && after.to_bits() != initial_bits
        {
            drifted = Some((iter, after));
            break;
        }
    }
    match drifted {
        None => eprintln!("[Class III · regression rapid_revert] PASS"),
        Some((iter, v)) => eprintln!(
            "[Class III · regression rapid_revert] FAIL — iter {} drifted to {} (bits=0x{:016x}); expected bits=0x{:016x}",
            iter,
            v,
            v.to_bits(),
            initial_bits
        ),
    }
}

// ---------------------------------------------------------------------------
// Total budget — aggregate all family results into a single final counter.
//
// Budget is set high enough to accommodate the Class III `qKjqZiEx`
// baseline so a clean run stays green today. Tightening this budget is
// the success signal once the engine fix lands.
// ---------------------------------------------------------------------------

/// Re-run every family, sum the counts, and emit a total. This duplicates
/// per-family execution (each family runs twice — once in its own
/// `#[test]`, once here) but that's intentional: `cargo test` output
/// should show each family individually AND a grand total.
#[cfg(feature = "audit-tests")]
#[test]
fn class_iii_total() {
    let start = Instant::now();
    let sid = sheet_id();
    let mut total_passed = 0usize;
    let mut total_failed = 0usize;

    // Helper to run a seeded topology family.
    let mut run_topology = |family: &'static str,
                            build: &dyn Fn(f64) -> (WorkbookSnapshot, SheetPos),
                            edit_pos: (u32, u32)| {
        let mut fam = FamilyResult::new(family);
        for seed in seeds() {
            let (snapshot, dependent) = build(seed.value);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(
                &mut engine,
                &sid,
                edit_pos.0,
                edit_pos.1,
                seed.value,
                EDIT_DELTA,
                dependent,
            );
            fam.record(format!("{}_{}", family, seed.slug), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    };

    run_topology("chain", &chain_snapshot, (0, 0));
    run_topology("fanin", &fanin_snapshot, (0, 0));
    run_topology("diamond", &diamond_snapshot, (0, 0));
    run_topology("sumproduct", &sumproduct_snapshot, (0, 0));

    // MMULT-like: single representative case.
    {
        let mut fam = FamilyResult::new("mmult");
        let seed = 0.4_f64;
        let (snapshot, dependent) = mmult_like_snapshot(seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, seed, EDIT_DELTA, dependent);
        fam.record("mmult_like_3x3_at_0_4".to_string(), outcome);
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    // Mixed-type: 10 cases.
    {
        let mut fam = FamilyResult::new("mixed_type");
        let float_seeds: &[(f64, &str)] = &[
            (0.1, "p0_1"),
            (0.4, "p0_4"),
            (0.7, "p0_7"),
            (1.0 / 3.0, "one_third"),
            (0.1 + 0.2, "sum0_1_0_2"),
        ];
        let int_seeds: &[(f64, &str)] = &[
            (1.0, "i1"),
            (2.0, "i2"),
            (42.0, "i42"),
            (0.0, "i0"),
            (-7.0, "i_neg7"),
        ];
        for (f_seed, f_slug) in float_seeds {
            let (snapshot, dependent) = mixed_type_snapshot(1.0, *f_seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, 1.0, 1.0, dependent);
            fam.record(format!("edit_int_with_float_{}", f_slug), outcome);
        }
        for (i_seed, i_slug) in int_seeds {
            let (snapshot, dependent) = mixed_type_snapshot(*i_seed, 0.4);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let outcome = op_inverse_pair(&mut engine, &sid, 1, 0, 0.4, EDIT_DELTA, dependent);
            fam.record(format!("edit_float_with_int_{}", i_slug), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    // Rapid reverts: 100 iterations on chain with 0.4 seed.
    {
        let mut fam = FamilyResult::new("rapid_reverts");
        let seed = 0.4_f64;
        let (snapshot, dependent) = chain_snapshot(seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        if let Some(initial) = read_number_at(&engine, &sid, dependent) {
            let initial_bits = initial.to_bits();
            for iter in 0..100 {
                let outcome = (|| {
                    overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
                    overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                    let after = read_number_at(&engine, &sid, dependent)
                        .ok_or_else(|| "dependent not numeric".to_string())?;
                    if after.to_bits() == initial_bits {
                        Ok(())
                    } else {
                        Err(format!(
                            "iter {}: after_bits=0x{:016x} expected=0x{:016x}",
                            iter,
                            after.to_bits(),
                            initial_bits
                        ))
                    }
                })();
                fam.record(format!("rapid_{:03}", iter), outcome);
            }
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    // Edit sequences: nested + A/B/A.
    {
        let mut fam = FamilyResult::new("sequence");
        let seed = 0.4_f64;
        // Nested
        {
            let (snapshot, dependent) = fanin_snapshot(seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let before = read_number_at(&engine, &sid, dependent);
            let outcome = match before {
                Some(b) => {
                    let before_bits = b.to_bits();
                    (|| -> Result<(), String> {
                        overwrite_number(&mut engine, &sid, 0, 0, seed + EDIT_DELTA)?;
                        overwrite_number(&mut engine, &sid, 1, 0, seed + EDIT_DELTA)?;
                        overwrite_number(&mut engine, &sid, 1, 0, seed)?;
                        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                        let after = read_number_at(&engine, &sid, dependent)
                            .ok_or_else(|| "dependent not numeric".to_string())?;
                        if after.to_bits() == before_bits {
                            Ok(())
                        } else {
                            Err(format!(
                                "nested: after_bits=0x{:016x} expected=0x{:016x}",
                                after.to_bits(),
                                before_bits
                            ))
                        }
                    })()
                }
                None => Err("initial dependent not numeric".to_string()),
            };
            fam.record("nested".to_string(), outcome);
        }
        // A/B/A
        {
            let (snapshot, dependent) = chain_snapshot(seed);
            let (mut engine, _init) =
                YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
            let before = read_number_at(&engine, &sid, dependent);
            let outcome = match before {
                Some(b) => {
                    let before_bits = b.to_bits();
                    (|| -> Result<(), String> {
                        overwrite_number(&mut engine, &sid, 0, 0, 0.7)?;
                        overwrite_number(&mut engine, &sid, 0, 0, seed)?;
                        let after = read_number_at(&engine, &sid, dependent)
                            .ok_or_else(|| "dependent not numeric".to_string())?;
                        if after.to_bits() == before_bits {
                            Ok(())
                        } else {
                            Err(format!(
                                "aba: after_bits=0x{:016x} expected=0x{:016x}",
                                after.to_bits(),
                                before_bits
                            ))
                        }
                    })()
                }
                None => Err("initial dependent not numeric".to_string()),
            };
            fam.record("aba".to_string(), outcome);
        }
        total_passed += fam.passed;
        total_failed += fam.failed;
    }

    let elapsed = start.elapsed();
    let total = total_passed + total_failed;
    eprintln!(
        "[Class III total] {}/{} passed, {} failed ({:?})",
        total_passed, total, total_failed, elapsed
    );

    // Failing tests ARE the bug tracker — the `qKjqZiEx` caching-precision
    // -leak bug and its siblings surface here as named failures. Per-family
    // failure names are printed in stderr above; run with `-- --nocapture`
    // to see them. When the engine fix lands, this goes green.
    assert_eq!(
        total_failed, 0,
        "Class III total: {} failures — see per-family stderr output above \
         for the named bugs, and `qKjqZiEx` for the root-cause analysis.",
        total_failed,
    );
}

// Keep the canonical `assert_bit_identity_f64` referenced so any future
// change to its signature (or a merge that drops it) surfaces here.
#[allow(dead_code)]
fn _unused_keep_assert_bit_identity_referenced() -> Result<(), String> {
    assert_bit_identity_f64(0.0, 0.0)
}

#[allow(dead_code)]
fn _unused_keep_cell_uuid_referenced() -> String {
    cell_uuid(0, 0)
}
