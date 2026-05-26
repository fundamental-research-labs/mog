//! # Cell Iterator Call-Site Audit
//!
//! This test exists to document which consumers of SheetMirror cell iteration
//! will need updates when Range-backed cells exist. Each entry is a call site
//! classified as:
//!   COLUMN_ALIGNED — reads via get_column_slice, automatically Range-aware
//!   FULL_SHEET    — needs iter_anchored_cells() + iter_ranges()
//!   SPARSE_ONLY   — intentionally walks only per-cell entries (dep extraction, anchors)
//!   IDENTITY_LOOKUP — point lookup by CellId, Range-safe after virtual id materialization
//!   VERIFIED      — manually verified Range-safe
//!
//! If a new call site is added and this test doesn't cover it, grep will find it.

/// Audit of every `cells_iter()` / `cell_ids()` / `.cells.iter()` / `.cells.keys()`
/// call site in compute-core.
///
/// This is a documentation audit -- no runtime assertions. It belongs to the
/// opt-in audit lane because it validates manual coverage bookkeeping, not
/// production behavior.
#[cfg(feature = "audit-tests")]
#[test]
fn cell_iterator_call_site_audit() {
    // ═══════════════════════════════════════════════════════════════════════
    //  METHOD DEFINITIONS (mirror/types.rs) — not call sites, but matched
    //  by the grep pattern. Included for completeness.
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  1. mirror/types.rs:218 — VERIFIED (method definition)
    //     `pub fn cell_ids()` — defines the cell_ids() accessor
    //
    //  2. mirror/types.rs:219 — VERIFIED (method body)
    //     `self.cells.keys()` — implementation of cell_ids()
    //
    //  3. mirror/types.rs:223 — VERIFIED (method definition)
    //     `pub fn cells_iter()` — defines the cells_iter() accessor
    //
    //  4. mirror/types.rs:224 — VERIFIED (method body)
    //     `self.cells.iter()` — implementation of cells_iter()
    //
    // ═══════════════════════════════════════════════════════════════════════
    //  cells_iter() call sites on SheetMirror
    // ═══════════════════════════════════════════════════════════════════════
    //
    //  5. scheduler/edit.rs:906 — SPARSE_ONLY
    //     regenerate_formula_strings: walks cells with IdentityFormulas to
    //     convert back to A1 notation. Only needs anchored per-cell formulas.
    //
    //  6. scheduler/schema_validation.rs:134 — FULL_SHEET
    //     Schema validation pass 2: iterates all cells in a column to check
    //     values against schema constraints. Must see Range-backed cells too.
    //
    //  7. storage/engine/construction.rs:299 — FULL_SHEET
    //     build_sheet_snapshot: serialises every cell to SheetSnapshot for
    //     rebuild. Must include Range-backed cells to avoid data loss.
    //
    //  8. storage/cells/formula_updater.rs:583 — SPARSE_ONLY
    //     rename_in_formulas: scans cells for formula template references to
    //     a named range. Only anchored cells can have formulas.
    //
    //  9. storage/engine/search.rs:136 — FULL_SHEET
    //     find_cells_by_value: searches for cells matching a value within a
    //     region. Must see Range-backed cells to return complete results.
    //
    // 10. storage/engine/search.rs:178 — FULL_SHEET
    //     find_cells_by_formula: searches for cells whose formula matches a
    //     regex. Range-backed cells don't have per-cell formulas but may
    //     need to surface the Range's formula.
    //
    // 11. storage/engine/services/mutation_handlers/sheet_mutations.rs:308 — FULL_SHEET
    //     Duplicate-sheet handler: registers cells into new GridIndex for
    //     the cloned sheet. Must include Range-backed cells.
    //
    // 12. storage/engine/services/queries.rs:190 — FULL_SHEET
    //     get_data_bounds: computes min/max row/col across all cells.
    //     Must see Range-backed cells to report correct bounds.
    //
    // 13. storage/engine/services/queries.rs:1113 — FULL_SHEET
    //     find_last_row (ColumnEdge): finds last data row in a column.
    //     Must see Range-backed cells to avoid truncating data.
    //
    // 14. storage/engine/services/queries.rs:1176 — FULL_SHEET
    //     find_last_column (RowEdge): finds last data column in a row.
    //     Must see Range-backed cells to avoid truncating data.
    //
    // 15. storage/engine/services/structural.rs:817 — SPARSE_ONLY
    //     invalidate_stale_yrs_formulas: walks formula cells to sync
    //     shifted formulas back to Yrs. Only anchored cells have formulas.
    //
    // 16. storage/engine/services/structural.rs:1126 — SPARSE_ONLY
    //     pre_delete_re_anchor_range_refs: walks formula cells to update
    //     IdentityFormulaRefs when rows/cols are deleted. Only anchored
    //     cells own formulas.
    //
    // ═══════════════════════════════════════════════════════════════════════
    //  cell_ids() call sites on SheetMirror
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 17. scheduler/mod.rs:397 — FULL_SHEET
    //     remove_sheet: collects all CellIds to remove from dep graph and
    //     recalc dependents. Must include Range-backed virtual CellIds.
    //
    // ═══════════════════════════════════════════════════════════════════════
    //  .cells.keys() direct access (within mirror module, pub(super))
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 18. mirror/sheet.rs:14 — SPARSE_ONLY
    //     remove_sheet: iterates cell_ids to remove cell_to_sheet entries.
    //     Cleanup of identity bookkeeping; Range removal handled separately.
    //
    // 19. mirror/snapshot.rs:339 — VERIFIED (test-only)
    //     add_sheet_mirror (#[cfg(test)]): populates cell_to_sheet for a
    //     pre-built SheetMirror in tests. Test-only, not production code.
    //
    // ═══════════════════════════════════════════════════════════════════════
    //  Non-SheetMirror matches (different `.cells` struct — snapshot, etc.)
    //  Included because the grep pattern matches them.
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 20. import/parse_output_to_snapshot/tests.rs:330 — VERIFIED (not SheetMirror)
    //     Test: iterates SheetSnapshot.cells (Vec<CellData>) to find a cell.
    //
    // 21. import/parse_output_to_snapshot/tests.rs:340 — VERIFIED (not SheetMirror)
    //     Test: iterates SheetSnapshot.cells (Vec<CellData>) to find a cell.
    //
    // 22. scheduler/init.rs:176 — VERIFIED (not SheetMirror)
    //     Snapshot init: iterates sheet_snap.cells (Vec<CellData>) to extract
    //     formulas for pre-parse. Operates on import snapshot, not mirror.
    //
    // 23. scheduler/init.rs:192 — VERIFIED (not SheetMirror)
    //     Snapshot init: counts formula cells in snapshot for capacity hint.
    //     Operates on SheetSnapshot.cells (Vec<CellData>).
    //
    // 24. storage/engine/tests/test_queries.rs:65 — VERIFIED (not SheetMirror)
    //     Test: iterates range result cells to find cell by column.
    //
    // 25. storage/engine/tests/test_queries.rs:68 — VERIFIED (not SheetMirror)
    //     Test: iterates range result cells to find cell by column.
    //
    // 26. storage/engine/tests/test_xlsx_export.rs:111 — VERIFIED (not SheetMirror)
    //     Test: maps SheetSnapshot.cells to a lookup by (row, col).
    //
    // 27. storage/engine/tests/test_xlsx_export.rs:184 — VERIFIED (not SheetMirror)
    //     Test: maps SheetSnapshot.cells to a lookup by (row, col).
    //
    // ═══════════════════════════════════════════════════════════════════════
    //  False positives (comment or function name, not an actual call)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // 28. storage/engine/services/structural.rs:765 — VERIFIED (doc comment)
    //     Comment referencing cells_iter() in doc string, not a call site.
    //
    // 29. storage/sheet/sorting.rs:1694 — VERIFIED (function name)
    //     `fn test_sort_preserves_cell_ids()` — name contains `cell_ids(`,
    //     not a call to the method.
    //
    // 30. mirror/types.rs:405 — VERIFIED (method body)
    //     `iter_anchored_cells()` intentionally exposes only anchored
    //     per-cell entries. Range-backed values are exposed separately via
    //     `iter_ranges()`.
    //
    // 31. import/parse_output_to_snapshot/tests.rs:646 — VERIFIED (not SheetMirror)
    //     Test: iterates SheetSnapshot.cells to collect anchored rows.
    //
    // 32. storage/properties.rs:452 — VERIFIED (function name)
    //     `iter_formatted_property_cell_ids()` name contains `cell_ids(`,
    //     not a call to `SheetMirror::cell_ids`.
    //
    // 33. storage/engine/mod.rs:1094 — VERIFIED (not SheetMirror)
    //     Observer change collection iterates `DocumentChanges.cells`.
    //
    // 34. storage/engine/tests/test_deferred_xlsx_import.rs:239 — VERIFIED (not SheetMirror)
    //     Test: iterates query result cells.
    //
    // 35. storage/engine/tests/test_deferred_xlsx_import.rs:248 — VERIFIED (not SheetMirror)
    //     Test: iterates query result cells.
    //
    // 36. storage/engine/tests/test_deferred_xlsx_import.rs:257 — VERIFIED (not SheetMirror)
    //     Test: iterates query result cells.
    //
    // 37. storage/engine/construction.rs:1406 — VERIFIED (not SheetMirror)
    //     Deferred import snapshot bookkeeping over SheetSnapshot.cells.
    //
    // 38. storage/engine/construction.rs:1606 — VERIFIED (not SheetMirror)
    //     Deferred hydration snapshot bookkeeping over SheetSnapshot.cells.
    //
    // 39. storage/engine/construction.rs:2148 — VERIFIED (not SheetMirror)
    //     Snapshot rebuild bookkeeping over SheetSnapshot.cells.
    //
    // 40. import/parse_output_to_snapshot/classifier.rs:106 — VERIFIED (not SheetMirror)
    //     Parse-output classifier iterates SheetSnapshot.cells.
    //
    // 41. import/parse_output_to_snapshot/classifier.rs:876 — VERIFIED (not SheetMirror)
    //     Classifier test iterates SheetSnapshot.cells.
    //
    // 42. storage/engine/services/queries.rs:234 — VERIFIED (helper false positive)
    //     Calls `iter_formatted_property_cell_ids()`; not SheetMirror iteration.
    //
    // 43. storage/engine/services/queries.rs:1156 — VERIFIED (helper false positive)
    //     Calls `iter_formatted_property_cell_ids()`; not SheetMirror iteration.
    //
    // 44. storage/engine/services/queries.rs:1215 — VERIFIED (helper false positive)
    //     Calls `iter_formatted_property_cell_ids()`; not SheetMirror iteration.

    // Count of call sites by category (SheetMirror iteration sites only, #5-#19):
    //
    // FULL_SHEET:       8  (#6, #7, #9, #10, #11, #12, #13, #14, #17)
    //                      — but #10 (find_cells_by_formula) may stay SPARSE_ONLY
    //                        since Range cells don't own per-cell formulas
    // SPARSE_ONLY:      5  (#5, #8, #15, #16, #18)
    // VERIFIED:         2  (#19 test-only, plus method defs #1-#4)
    //
    // Non-SheetMirror / false positives (grep noise): 24 (#20-#29, #31-#44)
    //
    // ─── Summary ───
    // COLUMN_ALIGNED:   0
    // FULL_SHEET:       8
    // SPARSE_ONLY:      5
    // IDENTITY_LOOKUP:  0
    // VERIFIED:        31  (5 method defs + 2 SheetMirror + 19 non-mirror + 5 false positives)
    // TOTAL:           44  (grep matches)
}

/// Verifies that the call-site count matches the audit.
/// Fails if a new `cells_iter` / `cell_ids` / `.cells.iter()` / `.cells.keys()`
/// / `.cells.values()` call site was added without updating the audit above.
#[cfg(feature = "audit-tests")]
#[test]
fn cell_iterator_call_site_count_matches_audit() {
    use std::process::Command;

    let workspace_root = env!("CARGO_MANIFEST_DIR").replace("/compute/core", "");
    let pattern = r"cell_ids\(|cells_iter\(|\.cells\.iter\(|\.cells\.keys\(|\.cells\.values\(";

    // Try rg first, fall back to grep if rg is unavailable.
    let output = Command::new("rg")
        .args(["-c", pattern, "compute/core/src/", "--type", "rust"])
        .current_dir(&workspace_root)
        .output()
        .or_else(|_| {
            Command::new("grep")
                .args(["-rEc", pattern, "compute/core/src/", "--include=*.rs"])
                .current_dir(&workspace_root)
                .output()
        });

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let total: usize = stdout
                .lines()
                .filter_map(|line| line.rsplit(':').next()?.parse::<usize>().ok())
                .sum();

            // UPDATE THIS CONSTANT when adding/removing call sites.
            // Then update the audit comments in `cell_iterator_call_site_audit`.
            const AUDITED_CALL_SITES: usize = 44;

            assert_eq!(
                total, AUDITED_CALL_SITES,
                "Cell iterator call-site count changed! \
                 Found {} sites but audit documents {}. \
                 Re-run the grep and update range_cell_iterator_audit.rs.",
                total, AUDITED_CALL_SITES,
            );
        }
        Err(_) => {
            // Neither rg nor grep available -- skip this check
            eprintln!(
                "WARN: neither ripgrep nor grep found, skipping call-site count verification"
            );
        }
    }
}
