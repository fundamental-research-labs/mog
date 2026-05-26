//! GridIndex migration Step C.3 — Relocation preserves CellId identity.
//!
//! `relocate_cells` (the cut-paste primitive) must:
//! - Leave every moved cell at its new (row, col) under the same CellId
//!   it had pre-move.
//! - Preserve each moved cell's value unchanged.
//! - Preserve formula references keyed by CellId: a formula that pointed
//!   at a moved cell still points at the same CellId, so its computed
//!   value tracks the moved cell to its new location.
//!
//! Covers both same-sheet and cross-sheet moves. This test exists to
//! guard the GridIndex-based relocation path introduced in GridIndex migration —
//! the invariant is the whole point of preserving CellId through cut-
//! paste, as opposed to copy-paste which creates fresh identities.

use std::collections::{HashMap, HashSet};

use cell_types::CellId;
use compute_core::storage::engine::YrsComputeEngine;
use formula_types::IdentityFormulaRef;
use proptest::prelude::*;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ============================================================================
// Helpers: deterministic UUID generation + snapshot construction
// ============================================================================

/// Deterministic dashed UUID. Using a fixed, structured layout keeps proptest
/// shrinking cheap — the shrinker will never try to mutate UUID bytes.
fn cell_uuid(tag: u8, idx: u32) -> String {
    // Tag byte goes in the leading field to keep seed classes (value vs
    // formula) visibly distinct in assertion output.
    format!("{:02x}000000-0000-0000-0000-{:012x}", tag, idx)
}

fn sheet_uuid(idx: u32) -> String {
    format!("550e8400-e29b-41d4-a716-{:012x}", idx)
}

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(0xa0, uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn sheet_snapshot(
    id: &str,
    name: &str,
    rows: u32,
    cols: u32,
    cells: Vec<CellData>,
) -> SheetSnapshot {
    SheetSnapshot {
        id: id.to_string(),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges: vec![],
    }
}

// ============================================================================
// Grid strategy: random populated cells within a bounded box, plus a
// random source rectangle + target offset such that the target rectangle
// fits inside the grid.
// ============================================================================

const GRID_ROWS: u32 = 8;
const GRID_COLS: u32 = 8;
const MAX_POPULATED: usize = 6;

#[derive(Debug, Clone)]
struct GridPlan {
    /// Populated value cells: (row, col, value). Positions are unique.
    cells: Vec<(u32, u32, f64)>,
    src_r1: u32,
    src_c1: u32,
    src_r2: u32,
    src_c2: u32,
    /// Top-left target position. Height/width derived from src rect.
    dst_r: u32,
    dst_c: u32,
}

/// Strategy: choose source rect, target offset, and populated cells.
///
/// We generate distinct (row, col) positions by picking unique linear
/// indices into the grid, then mapping each to (row, col).
fn grid_plan_strategy() -> impl Strategy<Value = GridPlan> {
    let total = (GRID_ROWS * GRID_COLS) as usize;
    (
        // Source rectangle.
        (
            0u32..GRID_ROWS,
            0u32..GRID_COLS,
            0u32..GRID_ROWS,
            0u32..GRID_COLS,
        ),
        // Target corner: independent; we'll clamp so rect fits.
        (0u32..GRID_ROWS, 0u32..GRID_COLS),
        // Populated cells: pick distinct linear indices + each a value.
        prop::collection::vec((0usize..total, -1000.0f64..1000.0f64), 0..=MAX_POPULATED),
    )
        .prop_map(|((a_r, a_c, b_r, b_c), (t_r, t_c), raw_cells)| {
            let src_r1 = a_r.min(b_r);
            let src_r2 = a_r.max(b_r);
            let src_c1 = a_c.min(b_c);
            let src_c2 = a_c.max(b_c);
            let h = src_r2 - src_r1;
            let w = src_c2 - src_c1;
            // Clamp target so target rect fits.
            let dst_r = t_r.min(GRID_ROWS - 1 - h);
            let dst_c = t_c.min(GRID_COLS - 1 - w);
            // Deduplicate positions while preserving the chosen value
            // for the first occurrence of each linear index.
            let mut seen = HashSet::new();
            let mut cells = Vec::new();
            for (lin, val) in raw_cells {
                if seen.insert(lin) {
                    let r = (lin as u32) / GRID_COLS;
                    let c = (lin as u32) % GRID_COLS;
                    cells.push((r, c, val));
                }
            }
            GridPlan {
                cells,
                src_r1,
                src_c1,
                src_r2,
                src_c2,
                dst_r,
                dst_c,
            }
        })
}

// Strategy for the formula-ref test: need exactly one value cell V and
// one formula cell F at distinct positions. Choose a random in-bounds
// target for V such that F is NOT inside the 1x1 source rect (trivially
// true since F and V are at distinct positions).
#[derive(Debug, Clone)]
struct FormulaPlan {
    v_row: u32,
    v_col: u32,
    v_val: f64,
    f_row: u32,
    f_col: u32,
    dst_r: u32,
    dst_c: u32,
}

fn formula_plan_strategy() -> impl Strategy<Value = FormulaPlan> {
    let total = (GRID_ROWS * GRID_COLS) as usize;
    (
        0usize..total,
        0usize..total,
        0u32..GRID_ROWS,
        0u32..GRID_COLS,
        -1000.0f64..1000.0f64,
    )
        .prop_filter_map(
            "V and F at distinct positions; dst != F; dst != V",
            |(v_lin, f_lin, dst_r, dst_c, val)| {
                if v_lin == f_lin {
                    return None;
                }
                let v_row = (v_lin as u32) / GRID_COLS;
                let v_col = (v_lin as u32) % GRID_COLS;
                let f_row = (f_lin as u32) / GRID_COLS;
                let f_col = (f_lin as u32) % GRID_COLS;
                // Moving V onto F would overwrite F; exclude that.
                if (dst_r, dst_c) == (f_row, f_col) {
                    return None;
                }
                Some(FormulaPlan {
                    v_row,
                    v_col,
                    v_val: val,
                    f_row,
                    f_col,
                    dst_r,
                    dst_c,
                })
            },
        )
}

// ============================================================================
// Cross-sheet plan: two sheets, random source rect on A, random target on B.
// ============================================================================

#[derive(Debug, Clone)]
struct CrossSheetPlan {
    a_cells: Vec<(u32, u32, f64)>,
    b_cells: Vec<(u32, u32, f64)>,
    src_r1: u32,
    src_c1: u32,
    src_r2: u32,
    src_c2: u32,
    dst_r: u32,
    dst_c: u32,
}

fn cross_sheet_plan_strategy() -> impl Strategy<Value = CrossSheetPlan> {
    let total = (GRID_ROWS * GRID_COLS) as usize;
    (
        (
            0u32..GRID_ROWS,
            0u32..GRID_COLS,
            0u32..GRID_ROWS,
            0u32..GRID_COLS,
        ),
        (0u32..GRID_ROWS, 0u32..GRID_COLS),
        prop::collection::vec((0usize..total, -1000.0f64..1000.0f64), 0..=MAX_POPULATED),
        prop::collection::vec((0usize..total, -1000.0f64..1000.0f64), 0..=MAX_POPULATED),
    )
        .prop_map(|((a_r, a_c, b_r, b_c), (t_r, t_c), raw_a, raw_b)| {
            let src_r1 = a_r.min(b_r);
            let src_r2 = a_r.max(b_r);
            let src_c1 = a_c.min(b_c);
            let src_c2 = a_c.max(b_c);
            let h = src_r2 - src_r1;
            let w = src_c2 - src_c1;
            let dst_r = t_r.min(GRID_ROWS - 1 - h);
            let dst_c = t_c.min(GRID_COLS - 1 - w);
            let dedup = |raw: Vec<(usize, f64)>| {
                let mut seen = HashSet::new();
                let mut out = Vec::new();
                for (lin, val) in raw {
                    if seen.insert(lin) {
                        let r = (lin as u32) / GRID_COLS;
                        let c = (lin as u32) % GRID_COLS;
                        out.push((r, c, val));
                    }
                }
                out
            };
            CrossSheetPlan {
                a_cells: dedup(raw_a),
                b_cells: dedup(raw_b),
                src_r1,
                src_c1,
                src_r2,
                src_c2,
                dst_r,
                dst_c,
            }
        })
}

// ============================================================================
// Property 1: Same-sheet relocation preserves CellIds and values.
// ============================================================================

fn run_same_sheet_property(plan: GridPlan) -> Result<(), TestCaseError> {
    // Build snapshot. Assign CellIds deterministically from the cell's
    // index in the ordered vec.
    let cells: Vec<CellData> = plan
        .cells
        .iter()
        .enumerate()
        .map(|(i, &(r, c, v))| value_cell(i as u32, r, c, v))
        .collect();
    let snapshot = WorkbookSnapshot {
        sheets: vec![sheet_snapshot(
            &sheet_uuid(1),
            "S",
            GRID_ROWS,
            GRID_COLS,
            cells,
        )],
        ..Default::default()
    };

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot must succeed");
    let sid = *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("exactly one sheet");

    // Pre-move snapshot: map every position in the grid to its CellId +
    // value. We scan the whole grid so unoccupied positions are recorded
    // as None.
    let mut pre_id: HashMap<(u32, u32), String> = HashMap::new();
    let mut pre_val: HashMap<(u32, u32), CellValue> = HashMap::new();
    for r in 0..GRID_ROWS {
        for c in 0..GRID_COLS {
            if let Some(id) = engine.get_cell_id_at(&sid, r, c) {
                pre_id.insert((r, c), id);
            }
            pre_val.insert((r, c), engine.get_cell_value(&sid, r, c));
        }
    }
    let pre_ids_set: HashSet<String> = pre_id.values().cloned().collect();

    let dr = plan.dst_r as i64 - plan.src_r1 as i64;
    let dc = plan.dst_c as i64 - plan.src_c1 as i64;

    // Source/target position sets. The cut-paste primitive clears the
    // ENTIRE target rect (regardless of whether the corresponding source
    // position held a cell) and then writes the moved cells in.
    let mut src_positions: HashSet<(u32, u32)> = HashSet::new();
    let mut tgt_positions: HashSet<(u32, u32)> = HashSet::new();
    let mut moved_ids: HashSet<String> = HashSet::new();
    for r in plan.src_r1..=plan.src_r2 {
        for c in plan.src_c1..=plan.src_c2 {
            src_positions.insert((r, c));
            let tr = (r as i64 + dr) as u32;
            let tc = (c as i64 + dc) as u32;
            tgt_positions.insert((tr, tc));
            if let Some(id) = pre_id.get(&(r, c)) {
                moved_ids.insert(id.clone());
            }
        }
    }
    // Displaced CellIds = pre-move CellIds that sat at any target
    // position and were NOT themselves moved. A CellId that moves from
    // one target-rect-overlapping source position to another position in
    // the target rect is NOT displaced — it survives. Empty-source
    // relocations (nothing moves) are no-ops: no blanket-clear occurs.
    let mut displaced_ids: HashSet<String> = HashSet::new();
    if !moved_ids.is_empty() {
        for pos in &tgt_positions {
            if let Some(pre_tgt_id) = pre_id.get(pos) {
                if !moved_ids.contains(pre_tgt_id) {
                    displaced_ids.insert(pre_tgt_id.clone());
                }
            }
        }
    }

    let _ = engine
        .relocate_cells_yrs(
            &sid,
            plan.src_r1,
            plan.src_c1,
            plan.src_r2,
            plan.src_c2,
            &sid,
            plan.dst_r,
            plan.dst_c,
        )
        .expect("relocate must succeed");

    // Post-move: gather all CellIds on the sheet.
    let mut post_ids_set: HashSet<String> = HashSet::new();
    for r in 0..GRID_ROWS {
        for c in 0..GRID_COLS {
            if let Some(id) = engine.get_cell_id_at(&sid, r, c) {
                post_ids_set.insert(id);
            }
        }
    }

    // Invariant A: same-sheet CellIds = pre_set \ displaced_ids. Moved
    // CellIds stay on the sheet (just at different positions); displaced
    // CellIds (those overwritten at a target position) disappear.
    let expected_post: HashSet<String> = pre_ids_set.difference(&displaced_ids).cloned().collect();
    prop_assert_eq!(
        &post_ids_set,
        &expected_post,
        "post-move CellId set should equal pre \\ displaced; plan={:?}",
        plan
    );

    // Invariant B: every cell that was at a source position pre-move is
    // at the corresponding target position post-move with the same
    // CellId; and values are preserved.
    for (r, c) in &src_positions {
        let Some(pre_id_at) = pre_id.get(&(*r, *c)) else {
            continue; // source position was empty pre-move
        };
        let tr = (*r as i64 + dr) as u32;
        let tc = (*c as i64 + dc) as u32;
        let post_id_at = engine.get_cell_id_at(&sid, tr, tc);
        prop_assert_eq!(
            post_id_at.as_deref(),
            Some(pre_id_at.as_str()),
            "CellId at pre-move ({}, {}) = {} should now sit at post-move ({}, {}); got {:?}",
            r,
            c,
            pre_id_at,
            tr,
            tc,
            post_id_at,
        );
        let post_val = engine.get_cell_value(&sid, tr, tc);
        let pre_cell_val = pre_val.get(&(*r, *c)).cloned().unwrap_or(CellValue::Null);
        prop_assert_eq!(
            &post_val,
            &pre_cell_val,
            "value at pre-move ({}, {}) should land at ({}, {}); pre={:?} post={:?}",
            r,
            c,
            tr,
            tc,
            pre_cell_val,
            post_val,
        );
    }

    // Invariant C: every source position that is NOT also a target
    // position is empty post-move.
    for (r, c) in src_positions.difference(&tgt_positions) {
        let still = engine.get_cell_id_at(&sid, *r, *c);
        prop_assert!(
            still.is_none(),
            "source-only position ({}, {}) must be empty post-move, still has {:?}",
            r,
            c,
            still
        );
    }

    Ok(())
}

// ============================================================================
// Property 2: Cross-sheet relocation preserves CellIds and values.
// ============================================================================

fn run_cross_sheet_property(plan: CrossSheetPlan) -> Result<(), TestCaseError> {
    let a_cells: Vec<CellData> = plan
        .a_cells
        .iter()
        .enumerate()
        .map(|(i, &(r, c, v))| value_cell(i as u32, r, c, v))
        .collect();
    // Offset sheet-B cell UUIDs so they don't collide with sheet-A.
    let b_cells: Vec<CellData> = plan
        .b_cells
        .iter()
        .enumerate()
        .map(|(i, &(r, c, v))| value_cell(1000 + i as u32, r, c, v))
        .collect();

    let snapshot = WorkbookSnapshot {
        sheets: vec![
            sheet_snapshot(&sheet_uuid(10), "A", GRID_ROWS, GRID_COLS, a_cells),
            sheet_snapshot(&sheet_uuid(11), "B", GRID_ROWS, GRID_COLS, b_cells),
        ],
        ..Default::default()
    };

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot must succeed");
    let sheet_ids: Vec<_> = engine.mirror().sheet_ids().copied().collect();
    prop_assert_eq!(sheet_ids.len(), 2);

    let mut a_sid = None;
    let mut b_sid = None;
    for sid in &sheet_ids {
        match engine.get_sheet_name(sid).as_deref() {
            Some("A") => a_sid = Some(*sid),
            Some("B") => b_sid = Some(*sid),
            _ => {}
        }
    }
    let a_sid = a_sid.expect("sheet A");
    let b_sid = b_sid.expect("sheet B");

    // Pre-move id maps on each sheet.
    let collect_ids = |engine: &YrsComputeEngine, sid: &_| {
        let mut map = HashMap::new();
        for r in 0..GRID_ROWS {
            for c in 0..GRID_COLS {
                if let Some(id) = engine.get_cell_id_at(sid, r, c) {
                    map.insert((r, c), id);
                }
            }
        }
        map
    };
    let pre_a = collect_ids(&engine, &a_sid);
    let pre_b = collect_ids(&engine, &b_sid);

    // Moved set: CellIds at source positions on A that actually hold a
    // cell pre-move. Empty source positions move nothing.
    let mut moved_ids: HashSet<String> = HashSet::new();
    let mut pre_a_val_at: HashMap<(u32, u32), CellValue> = HashMap::new();
    let dr = plan.dst_r as i64 - plan.src_r1 as i64;
    let dc = plan.dst_c as i64 - plan.src_c1 as i64;
    let mut tgt_positions_on_b: HashSet<(u32, u32)> = HashSet::new();
    for r in plan.src_r1..=plan.src_r2 {
        for c in plan.src_c1..=plan.src_c2 {
            pre_a_val_at.insert((r, c), engine.get_cell_value(&a_sid, r, c));
            let tr = (r as i64 + dr) as u32;
            let tc = (c as i64 + dc) as u32;
            tgt_positions_on_b.insert((tr, tc));
            if let Some(id) = pre_a.get(&(r, c)) {
                moved_ids.insert(id.clone());
            }
        }
    }
    // The cut-paste primitive clears the ENTIRE target rect on the
    // destination sheet (even positions where the corresponding source
    // cell is empty), then writes the moved cells in. Any pre-move cell
    // on B sitting inside the target rect is displaced — UNLESS the
    // whole operation is a no-op because nothing on A moves (empty
    // source set), in which case the engine leaves B untouched.
    let mut displaced_on_b: HashSet<String> = HashSet::new();
    if !moved_ids.is_empty() {
        for pos in &tgt_positions_on_b {
            if let Some(pre_b_id) = pre_b.get(pos) {
                displaced_on_b.insert(pre_b_id.clone());
            }
        }
    }

    let _ = engine
        .relocate_cells_yrs(
            &a_sid,
            plan.src_r1,
            plan.src_c1,
            plan.src_r2,
            plan.src_c2,
            &b_sid,
            plan.dst_r,
            plan.dst_c,
        )
        .expect("cross-sheet relocate must succeed");

    let post_a_set: HashSet<String> = collect_ids(&engine, &a_sid).values().cloned().collect();
    let post_b_set: HashSet<String> = collect_ids(&engine, &b_sid).values().cloned().collect();

    let pre_a_set: HashSet<String> = pre_a.values().cloned().collect();
    let pre_b_set: HashSet<String> = pre_b.values().cloned().collect();

    // Invariant A: sheet A post = sheet A pre \ moved_ids.
    let expected_a: HashSet<String> = pre_a_set.difference(&moved_ids).cloned().collect();
    prop_assert_eq!(
        &post_a_set,
        &expected_a,
        "sheet A post-move CellId set should equal pre \\ moved; plan={:?}",
        plan
    );

    // Invariant B: sheet B post = (pre_b \ displaced) ∪ moved_ids.
    let expected_b: HashSet<String> = pre_b_set
        .difference(&displaced_on_b)
        .cloned()
        .collect::<HashSet<_>>()
        .union(&moved_ids)
        .cloned()
        .collect();
    prop_assert_eq!(
        &post_b_set,
        &expected_b,
        "sheet B post-move CellId set should equal (pre \\ displaced) ∪ moved; plan={:?}",
        plan
    );

    // Invariant C: values preserved for each moved source position.
    for r in plan.src_r1..=plan.src_r2 {
        for c in plan.src_c1..=plan.src_c2 {
            let tr = (r as i64 + dr) as u32;
            let tc = (c as i64 + dc) as u32;
            let post_id = engine.get_cell_id_at(&b_sid, tr, tc);
            if let Some(pre_id_at) = pre_a.get(&(r, c)) {
                prop_assert_eq!(
                    post_id.as_deref(),
                    Some(pre_id_at.as_str()),
                    "CellId at A pre-move ({}, {}) = {} should be at B post-move ({}, {}); got {:?}",
                    r,
                    c,
                    pre_id_at,
                    tr,
                    tc,
                    post_id,
                );
                let post_val = engine.get_cell_value(&b_sid, tr, tc);
                let pre_val_at = pre_a_val_at
                    .get(&(r, c))
                    .cloned()
                    .unwrap_or(CellValue::Null);
                prop_assert_eq!(
                    &post_val,
                    &pre_val_at,
                    "value at A pre-move ({}, {}) should land at B ({}, {}); pre={:?} post={:?}",
                    r,
                    c,
                    tr,
                    tc,
                    pre_val_at,
                    post_val,
                );
            }
        }
    }

    // Invariant D: every source position on A whose target lies on B
    // (always, since this is cross-sheet) is empty on A post-move.
    for r in plan.src_r1..=plan.src_r2 {
        for c in plan.src_c1..=plan.src_c2 {
            let still = engine.get_cell_id_at(&a_sid, r, c);
            prop_assert!(
                still.is_none(),
                "source ({}, {}) on A must be empty after cross-sheet move, still has {:?}",
                r,
                c,
                still,
            );
        }
    }

    Ok(())
}

// ============================================================================
// Property 3: Formula reference by CellId survives the move.
// ============================================================================

fn run_formula_ref_property(plan: FormulaPlan) -> Result<(), TestCaseError> {
    // Construct F's formula text as "=<col-letter><row+1>" pointing at V.
    let col_letter = (b'A' + plan.v_col as u8) as char;
    let formula_text = format!("={}{}", col_letter, plan.v_row + 1);

    let v_uuid = cell_uuid(0xa0, 0);
    let f_uuid = cell_uuid(0xb0, 0);
    let v_cell_id = CellId::from_uuid_str(&v_uuid).expect("parse V CellId");
    let f_cell_id = CellId::from_uuid_str(&f_uuid).expect("parse F CellId");

    let v = CellData {
        cell_id: v_uuid,
        row: plan.v_row,
        col: plan.v_col,
        value: CellValue::Number(FiniteF64::must(plan.v_val)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    };
    let f = CellData {
        cell_id: f_uuid,
        row: plan.f_row,
        col: plan.f_col,
        value: CellValue::Number(FiniteF64::must(0.0)),
        formula: Some(formula_text.clone()),
        identity_formula: None,
        array_ref: None,
    };

    let snapshot = WorkbookSnapshot {
        sheets: vec![sheet_snapshot(
            &sheet_uuid(20),
            "S",
            GRID_ROWS,
            GRID_COLS,
            vec![v, f],
        )],
        ..Default::default()
    };

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot must succeed");
    let sid = *engine.mirror().sheet_ids().next().expect("sheet");

    // Sanity: F's formula pre-move references V by CellId.
    {
        let formula = engine
            .mirror()
            .get_formula(&f_cell_id)
            .expect("F must have a formula pre-move")
            .clone();
        prop_assert!(
            !formula.template.is_empty(),
            "F formula template should be non-empty pre-move"
        );
        // F must reference V by CellId.
        let refs_v_pre = formula.refs.iter().any(|r| {
            matches!(
                r,
                IdentityFormulaRef::Cell(cr) if cr.id == v_cell_id
            )
        });
        prop_assert!(
            refs_v_pre,
            "F's formula must reference V by CellId pre-move; refs={:?}",
            formula.refs
        );
    }

    // Move V (1x1) to (dst_r, dst_c).
    let _ = engine
        .relocate_cells_yrs(
            &sid, plan.v_row, plan.v_col, plan.v_row, plan.v_col, &sid, plan.dst_r, plan.dst_c,
        )
        .expect("relocate must succeed");

    // Assertion 1: F still has a formula (verify via IdentityFormula on
    // the mirror, NOT via cached value — a bug that silently strips a
    // formula but leaves a stale cached value must fail here).
    let post_formula = engine
        .mirror()
        .get_formula(&f_cell_id)
        .expect("F must still have a formula after V moves")
        .clone();
    prop_assert!(
        !post_formula.template.is_empty(),
        "F formula template should be non-empty post-move"
    );

    // Assertion 2: F's formula still references V's CellId (not stripped,
    // not rewritten to a different identity).
    let refs_v_post = post_formula.refs.iter().any(|r| {
        matches!(
            r,
            IdentityFormulaRef::Cell(cr) if cr.id == v_cell_id
        )
    });
    prop_assert!(
        refs_v_post,
        "F's formula must still reference V's CellId after V moves; refs={:?}",
        post_formula.refs
    );

    // Assertion 3 (sanity): F's evaluated value reflects V's value at its
    // new position.
    let f_val = engine.get_cell_value(&sid, plan.f_row, plan.f_col);
    match f_val {
        CellValue::Number(n) => {
            prop_assert!(
                (n.get() - plan.v_val).abs() < 1e-9,
                "F should evaluate to V's value {}; got {}",
                plan.v_val,
                n.get()
            );
        }
        other => prop_assert!(
            false,
            "F should evaluate to a number (V's value {}); got {:?}",
            plan.v_val,
            other
        ),
    }

    Ok(())
}

// ============================================================================
// proptest! entry points
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 64,
        max_shrink_iters: 200,
        .. ProptestConfig::default()
    })]

    /// Same-sheet relocate preserves CellId identity + values across a
    /// randomized grid / source rect / target offset.
    #[test]
    fn same_sheet_relocate_preserves_cell_ids_and_values(plan in grid_plan_strategy()) {
        run_same_sheet_property(plan)?;
    }

    /// Cross-sheet relocate: moved CellIds migrate from A to B exactly,
    /// with values preserved.
    #[test]
    fn cross_sheet_relocate_preserves_cell_ids_and_values(plan in cross_sheet_plan_strategy()) {
        run_cross_sheet_property(plan)?;
    }

    /// Formula that references V by CellId must still reference V (same
    /// CellId, same IdentityFormulaRef::Cell variant) after V is moved —
    /// verified against the IdentityFormula, not the cached value.
    #[test]
    fn formula_reference_survives_referenced_cell_move(plan in formula_plan_strategy()) {
        run_formula_ref_property(plan)?;
    }
}
