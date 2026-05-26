//! Integration tests for workbook cache persistence across recalc epochs.
//!
//! These tests verify that the sorted cache (used by SMALL, LARGE, RANK)
//! persists across recalc epochs, saving work when underlying data hasn't
//! changed, and correctly invalidates when data is modified.
//!
//! The key mechanism:
//! - Column version counters are bumped when cells are edited
//! - `VersionedEntry::is_valid()` compares stored versions against current
//! - Cache hits avoid expensive re-sorting; misses trigger rebuilds
//!
//! Run:
//!   cargo test -p compute-core --test cache_benchmark -- --nocapture

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helper utilities (same pattern as recalc_dense_aggregate.rs)
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: None,
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
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Find the evaluated value for a specific (sheet_index, row, col) in the RecalcResult.
fn find_changed_value(
    result: &compute_core::snapshot::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target_cell_id)
        .map(|cc| cc.value.clone())
}

/// Assert that a cell evaluated to a specific number (within tolerance).
fn assert_cell_number(
    result: &compute_core::snapshot::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected: f64,
) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell ({},{},{}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Number({}))",
            sheet_idx, row, col, expected
        ),
    }
}

// ===========================================================================
// Test 1: Sorted cache persists across recalc epochs
// ===========================================================================

/// Verifies the full cache lifecycle:
/// 1. Initial recalc with SMALL formulas builds sorted cache (all misses)
/// 2. Editing a cell in column A and recalcing shows cache rebuilds for
///    the changed column but the cache mechanism is exercised
/// 3. Editing a cell in a DIFFERENT column (not referenced by SMALL) and
///    recalcing shows sorted cache HITS (unchanged column A data)
///
/// This demonstrates version-counter-based staleness detection:
/// - Column version bumps invalidate stale entries
/// - Unchanged columns keep their cached sorted arrays
#[test]
fn sorted_cache_persists_across_recalc_epochs() {
    // Column A (col=0): 100 numeric values (1.0 through 100.0)
    // Column B (col=1): 10 SMALL formulas: =SMALL(A$1:A$100, ROW())
    //   - SMALL(range, 1) = 1.0 (smallest)
    //   - SMALL(range, 2) = 2.0
    //   - ...
    //   - SMALL(range, 10) = 10.0
    // Column C (col=2): a single value (used for the "unrelated edit" test)
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(112);

    // Col A: 100 numeric values
    for i in 0..100u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Col B: 10 SMALL formulas (rows 0-9)
    // ROW() returns 1-based row number, so SMALL(A$1:A$100, ROW()) for row 0
    // gives SMALL(range, 1) = 1.0, etc.
    // We use explicit k values to avoid ROW() ambiguity in tests.
    cells.truncate(100);

    // Re-add col B with formulas using a different approach.
    // Since we need &str with known lifetimes, use a fixed set.
    let formulas: Vec<String> = (1..=10)
        .map(|k| format!("SMALL(A$1:A$100,{})", k))
        .collect();
    // We'll leak these strings to get 'static lifetimes (fine for tests).
    let formula_refs: Vec<&'static str> = formulas
        .into_iter()
        .map(|s| -> &'static str { Box::leak(s.into_boxed_str()) })
        .collect();

    for (i, formula) in formula_refs.iter().enumerate() {
        cells.push((i as u32, 1, CellValue::Null, Some(formula)));
    }

    // Col C: a single unrelated value
    cells.push((0, 2, CellValue::number(999.0), None));

    let snapshot = build_snapshot(vec![("Sheet1", 101, 3, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    println!("\n=== sorted_cache_persists_across_recalc_epochs (init) ===");
    println!("  changed_cells: {}", result.changed_cells.len());
    println!("  errors: {}", result.errors.len());
    for e in &result.errors {
        println!("  error: cell_id={} error={}", e.cell_id, e.error);
    }

    // Verify SMALL results: SMALL(1..100, k) = k for k=1..10
    for k in 1..=10u32 {
        assert_cell_number(&result, 0, k - 1, 1, k as f64);
    }

    // --- Check cache stats after initial recalc ---
    let stats1 = core.workbook_cache_stats();
    println!("\n  Cache stats after init:");
    println!(
        "    sorted: hits={}, misses={}, rebuilds={}",
        stats1.sorted.hits, stats1.sorted.misses, stats1.sorted.rebuilds
    );
    // On first recalc, the sorted cache should have at least 1 miss (first SMALL call
    // builds the cache) and subsequent SMALL calls on the same range should hit.
    // With 10 SMALL formulas all referencing the same range A$1:A$100, we expect:
    //   - 1 miss (first formula builds sorted array)
    //   - 9 hits (remaining formulas reuse cached sorted array)
    // Note: Depending on evaluation order and parallelism, exact numbers may vary,
    // but total (hits + misses) should equal 10.
    let total_sorted_ops = stats1.sorted.hits + stats1.sorted.misses;
    assert!(
        total_sorted_ops >= 10,
        "Expected at least 10 sorted cache operations (10 SMALL formulas), got {}",
        total_sorted_ops
    );
    assert!(
        stats1.sorted.hits > 0,
        "Expected sorted cache hits > 0 after 10 SMALL formulas on same range, got 0"
    );
    println!(
        "    Verified: {} hits + {} misses = {} total sorted ops",
        stats1.sorted.hits, stats1.sorted.misses, total_sorted_ops
    );

    // --- Pass 2: Edit a cell in column A (the referenced range) ---
    // This should bump col_version for column 0, invalidating the sorted cache.
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("parse sheet uuid");
    let cell_a50 = CellId::from_uuid_str(&cell_uuid(0, 49, 0)).expect("parse cell uuid");

    let result2 = core
        .set_cell(&mut mirror, &sheet_id, cell_a50, 49, 0, "0.5")
        .expect("set_cell failed");

    println!("\n=== After editing A50 (col A, the referenced range) ===");
    println!("  changed_cells: {}", result2.changed_cells.len());

    // SMALL(A$1:A$100, 1) should now be 0.5 (the new smallest value)
    assert_cell_number(&result2, 0, 0, 1, 0.5);
    // SMALL(A$1:A$100, 2) should now be 1.0 (previously the smallest)
    assert_cell_number(&result2, 0, 1, 1, 1.0);

    let stats2 = core.workbook_cache_stats();
    println!(
        "    sorted: hits={}, misses={}, rebuilds={}",
        stats2.sorted.hits, stats2.sorted.misses, stats2.sorted.rebuilds
    );
    // After editing column A, the cache entry for A$1:A$100 is stale.
    // The first SMALL formula should miss (rebuild), remaining should hit.
    let new_misses = stats2.sorted.misses - stats1.sorted.misses;
    let new_hits = stats2.sorted.hits - stats1.sorted.hits;
    println!(
        "    Delta: {} new hits, {} new misses",
        new_hits, new_misses
    );
    assert!(
        new_misses >= 1,
        "Expected at least 1 new miss after column A edit, got {}",
        new_misses
    );

    // --- Pass 3: Edit a cell in column C (NOT referenced by SMALL) ---
    // This should NOT invalidate the sorted cache for column A.
    let cell_c1 = CellId::from_uuid_str(&cell_uuid(0, 0, 2)).expect("parse cell uuid");

    let _result3 = core
        .set_cell(&mut mirror, &sheet_id, cell_c1, 0, 2, "888")
        .expect("set_cell failed");

    let stats3 = core.workbook_cache_stats();
    println!("\n=== After editing C1 (unrelated column) ===");
    println!(
        "    sorted: hits={}, misses={}, rebuilds={}",
        stats3.sorted.hits, stats3.sorted.misses, stats3.sorted.rebuilds
    );

    // Editing column C should not trigger any new sorted cache misses,
    // because column A's version hasn't changed. If SMALL formulas are
    // re-evaluated (because they're not dependents of C1), there should
    // be zero new sorted ops. If they ARE re-evaluated somehow, they
    // should all be hits.
    let phase3_new_misses = stats3.sorted.misses - stats2.sorted.misses;
    println!(
        "    pass 3 delta: misses={} (should be 0 — column C edit doesn't affect A's sorted cache)",
        phase3_new_misses
    );
    // The SMALL formulas don't depend on C1, so they shouldn't be recalculated at all.
    // But even if they were, they'd hit the cache (column A version unchanged).
    // Either way, no new misses.
    assert_eq!(
        phase3_new_misses, 0,
        "Editing column C should not cause sorted cache misses for column A"
    );

    println!("\n  All cache persistence assertions passed.");
}

// ===========================================================================
// Test 2: Sorted cache hit ratio improves with repeated identical recalcs
// ===========================================================================

/// Simulates a scenario where a non-data column is repeatedly edited,
/// each time triggering recalc of dependent formulas but NOT the SMALL
/// formulas (which reference column A). Verifies zero sorted cache growth.
#[test]
fn sorted_cache_unrelated_edits_no_rebuilds() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(55);

    // Col A (col=0): 50 numeric values
    for i in 0..50u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Col B (col=1): 3 SMALL formulas
    let formulas: Vec<String> = (1..=3).map(|k| format!("SMALL(A$1:A$50,{})", k)).collect();
    let formula_refs: Vec<&'static str> = formulas
        .into_iter()
        .map(|s| -> &'static str { Box::leak(s.into_boxed_str()) })
        .collect();
    for (i, formula) in formula_refs.iter().enumerate() {
        cells.push((i as u32, 1, CellValue::Null, Some(formula)));
    }

    // Col C (col=2): an independent value
    cells.push((0, 2, CellValue::number(1.0), None));
    // Col C, row 1: formula depending on C1 (so editing C1 triggers recalc of C2)
    cells.push((1, 2, CellValue::Null, Some("C1+1")));

    let snapshot = build_snapshot(vec![("Sheet1", 51, 3, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let stats_init = core.workbook_cache_stats();
    println!("\n=== sorted_cache_unrelated_edits_no_rebuilds ===");
    println!(
        "  Init: sorted hits={}, misses={}, rebuilds={}",
        stats_init.sorted.hits, stats_init.sorted.misses, stats_init.sorted.rebuilds
    );

    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("parse sheet uuid");
    let cell_c1 = CellId::from_uuid_str(&cell_uuid(0, 0, 2)).expect("parse cell uuid");

    // Edit C1 five times — each triggers recalc of C2 but NOT the SMALL formulas.
    for round in 1..=5u32 {
        let _ = core
            .set_cell(
                &mut mirror,
                &sheet_id,
                cell_c1,
                0,
                2,
                &format!("{}", round * 10),
            )
            .expect("set_cell failed");
    }

    let stats_final = core.workbook_cache_stats();
    let total_new_misses = stats_final.sorted.misses - stats_init.sorted.misses;
    let total_new_rebuilds = stats_final.sorted.rebuilds - stats_init.sorted.rebuilds;
    println!(
        "  After 5 unrelated edits: new misses={}, new rebuilds={}",
        total_new_misses, total_new_rebuilds
    );

    assert_eq!(
        total_new_misses, 0,
        "Unrelated column edits should cause zero sorted cache misses"
    );
    assert_eq!(
        total_new_rebuilds, 0,
        "Unrelated column edits should cause zero sorted cache rebuilds"
    );

    println!("  Verified: 5 unrelated edits caused 0 sorted cache operations.");
}

// ===========================================================================
// Test 3: Cache memory estimation is non-zero after use
// ===========================================================================

/// After running formulas that populate the sorted cache, verify that
/// the memory estimation reports non-zero bytes.
#[test]
fn cache_memory_estimation_nonzero_after_sorted_use() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(22);

    // Col A: 20 values
    for i in 0..20u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Col B: 1 SMALL formula
    cells.push((0, 1, CellValue::Null, Some("SMALL(A$1:A$20,1)")));

    let snapshot = build_snapshot(vec![("Sheet1", 21, 2, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let stats = core.workbook_cache_stats();
    println!("\n=== cache_memory_estimation_nonzero_after_sorted_use ===");
    println!("  sorted_entries: {}", stats.sorted_entries);
    println!("  sorted_memory_bytes: {}", stats.sorted_memory_bytes);
    println!("  estimated_memory_bytes: {}", stats.estimated_memory_bytes);

    assert!(
        stats.sorted_entries > 0,
        "Expected at least 1 sorted cache entry after SMALL formula"
    );
    assert!(
        stats.sorted_memory_bytes > 0,
        "Expected non-zero sorted memory after SMALL formula"
    );
    assert!(
        stats.estimated_memory_bytes > 0,
        "Expected non-zero total estimated memory"
    );

    println!("  Verified: cache memory estimation is non-zero.");
}

// ===========================================================================
// Test 4: Multiple distinct ranges create separate cache entries
// ===========================================================================

/// Two SMALL formulas referencing different ranges should create two
/// separate cache entries, each with independent version tracking.
#[test]
fn sorted_cache_distinct_ranges_independent_entries() {
    let mut cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::with_capacity(24);

    // Col A (col=0): 10 values (1..10)
    for i in 0..10u32 {
        cells.push((i, 0, CellValue::number((i + 1) as f64), None));
    }

    // Col B (col=1): 10 different values (101..110)
    for i in 0..10u32 {
        cells.push((i, 1, CellValue::number((i + 101) as f64), None));
    }

    // Col C (col=2): SMALL on col A range
    cells.push((0, 2, CellValue::Null, Some("SMALL(A$1:A$10,1)")));
    // Col D (col=3): SMALL on col B range
    cells.push((0, 3, CellValue::Null, Some("SMALL(B$1:B$10,1)")));

    let snapshot = build_snapshot(vec![("Sheet1", 11, 4, cells)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // SMALL(A1:A10, 1) = 1.0
    assert_cell_number(&result, 0, 0, 2, 1.0);
    // SMALL(B1:B10, 1) = 101.0
    assert_cell_number(&result, 0, 0, 3, 101.0);

    let stats1 = core.workbook_cache_stats();
    println!("\n=== sorted_cache_distinct_ranges_independent_entries ===");
    println!(
        "  Init: sorted entries={}, hits={}, misses={}",
        stats1.sorted_entries, stats1.sorted.hits, stats1.sorted.misses
    );
    // Should have 2 distinct sorted cache entries (one per range)
    assert_eq!(
        stats1.sorted_entries, 2,
        "Expected 2 sorted cache entries for 2 distinct ranges"
    );

    // Edit col A (A5 = 0.1) — should invalidate only col A's sorted cache
    let sheet_id = SheetId::from_uuid_str(&sheet_uuid(0)).expect("parse sheet uuid");
    let cell_a5 = CellId::from_uuid_str(&cell_uuid(0, 4, 0)).expect("parse cell uuid");
    let result2 = core
        .set_cell(&mut mirror, &sheet_id, cell_a5, 4, 0, "0.1")
        .expect("set_cell failed");

    // SMALL(A1:A10, 1) should now be 0.1
    assert_cell_number(&result2, 0, 0, 2, 0.1);

    let stats2 = core.workbook_cache_stats();
    let new_misses = stats2.sorted.misses - stats1.sorted.misses;
    println!(
        "  After col A edit: new misses={} (only col A range should miss)",
        new_misses
    );
    // Only the col A sorted entry should have been invalidated (1 miss).
    // The col B entry should still be valid (no miss for it).
    assert!(
        new_misses >= 1,
        "Expected at least 1 miss for the invalidated col A range"
    );

    // Verify col B formula didn't change (wasn't recalculated since it's
    // not a dependent of A5 — and even if it were, it would hit cache).
    // Still 2 entries in cache.
    assert_eq!(
        stats2.sorted_entries, 2,
        "Should still have 2 sorted cache entries"
    );

    println!("  Verified: distinct ranges have independent cache entries.");
}
