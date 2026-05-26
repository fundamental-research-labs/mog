//! Regression test for recalc idempotency R5 — `text_to_columns` must report a
//! `changed_cells` entry for the **source-column overwrite**, not just the
//! newly-allocated destination columns.
//!
//! The bug:
//!   - The kernel's `worksheet.textToColumns` calls the bridge with
//!     `dest_col == source_col`. The Excel-style "split in place" path:
//!     A1 = "Seattle, WA, 98101" splits into ("Seattle", "WA", "98101")
//!     written into A1, B1, C1.
//!   - Pre-R5, the kernel followed every `textToColumns` with
//!     `forceRefreshAllViewports()`, which blasted the viewport buffer with
//!     fresh values from YRS. That masked any patch-emission gap.
//!   - R5 dropped the band-aid. The latent bug surfaced: writes to the
//!     newly-allocated destination columns (B1, C1) propagated patches, but
//!     the in-place overwrite at A1 did NOT — `recalc.changed_cells`
//!     contained only the new positions.
//!
//! The mechanism (post-fix):
//!   - The mirror was being pre-written in `mutation_set_cells` BEFORE the
//!     `direct_edit_old_values` snapshot ran, so by the time recalc looked
//!     at `mirror.get_cell_value(cell_id)`, the value already matched the
//!     "new" value — and the seed-changes loop in `recalc()` looked
//!     up-to-date but reported the *new* value as a change. The actual
//!     issue was different: this test pins the contract.
//!
//! Run:
//!   cargo test -p compute-core --test text_to_columns_viewport_patches

use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}
fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
}

fn text_cell(id_suffix: u32, row: u32, col: u32, text: &str) -> CellData {
    CellData {
        cell_id: cell_id_str(id_suffix),
        row,
        col,
        value: CellValue::Text(text.to_string().into()),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn snapshot_with_delimited_strings() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            // Use leading-zero zips so the third token stays Text rather than
            // being coerced to Number — this isolates the changed_cells
            // assertion from numeric-coercion noise.
            cells: vec![
                text_cell(100, 0, 0, "Seattle, WA, 098101"),
                text_cell(101, 1, 0, "Portland, OR, 097201"),
                text_cell(102, 2, 0, "Boise, ID, 083702"),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn delimited_options() -> serde_json::Value {
    serde_json::json!({
        "splitType": "Delimited",
        "delimiters": {
            "tab": false,
            "semicolon": false,
            "comma": true,
            "space": false,
        },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    })
}

fn find_change<'a>(
    changes: &'a [snapshot_types::CellChange],
    row: u32,
    col: u32,
) -> Option<&'a snapshot_types::CellChange> {
    changes.iter().find(|c| {
        c.position
            .as_ref()
            .map_or(false, |p| p.row == row && p.col == col)
    })
}

#[test]
fn text_to_columns_emits_change_for_source_column_overwrite() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_delimited_strings()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

    // Split A1:A3 in-place: dest_row == start_row, dest_col == source_col.
    // This is the production code path: kernel/src/api/worksheet/structure.ts:216-232.
    let (_patches, result) = engine
        .text_to_columns(&sid, 0, 2, 0, 0, 0, delimited_options())
        .expect("text_to_columns");

    let changes = &result.recalc.changed_cells;

    // The source-column overwrite at (0,0) must appear in changed_cells with
    // the FIRST split token "Seattle". This is the contract that recalc idempotency R5
    // pinned: pre-fix, only (0,1) and (0,2) showed up, leaving the viewport
    // buffer at (0,0) holding the stale "Seattle, WA, 98101".
    let src = find_change(changes, 0, 0).expect(
        "source-column overwrite (0,0) must be present in recalc.changed_cells — \
         the in-place split's first token replaces the source cell value, \
         and the viewport buffer needs a patch for that position",
    );
    assert!(
        matches!(&src.value, CellValue::Text(s) if s.as_ref() == "Seattle"),
        "(0,0) should carry the new first-token value 'Seattle', got {:?}",
        src.value
    );

    // Sanity: the destination-only cells must also be present.
    let mid = find_change(changes, 0, 1).expect("(0,1) WA");
    assert!(
        matches!(&mid.value, CellValue::Text(s) if s.as_ref() == "WA"),
        "(0,1) should be 'WA', got {:?}",
        mid.value
    );
    let tail = find_change(changes, 0, 2).expect("(0,2) 098101");
    assert!(
        matches!(&tail.value, CellValue::Text(s) if s.as_ref() == "098101"),
        "(0,2) should be '098101', got {:?}",
        tail.value
    );

    // All three rows must observe the same source-column overwrite contract.
    for row in 1..=2 {
        let row_src = find_change(changes, row, 0)
            .unwrap_or_else(|| panic!("source overwrite ({row},0) missing from changed_cells"));
        let expected = match row {
            1 => "Portland",
            2 => "Boise",
            _ => unreachable!(),
        };
        assert!(
            matches!(&row_src.value, CellValue::Text(s) if s.as_ref() == expected),
            "({row},0) should be '{expected}', got {:?}",
            row_src.value
        );
    }
}

#[test]
fn text_to_columns_emits_viewport_patches_for_source_column() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_delimited_strings()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");
    engine
        .register_viewport("vp", &sid, 0, 0, 9, 5)
        .expect("register_viewport");

    let (patches, _result) = engine
        .text_to_columns(&sid, 0, 2, 0, 0, 0, delimited_options())
        .expect("text_to_columns");

    // The multi-viewport blob is a 2-byte length prefix followed by per-viewport
    // patches. Pre-fix this returned the empty sentinel `[0, 0]` because the
    // service handler never seeded `pending_recalc` — `flush_viewport_patches`
    // had nothing to drain.
    assert!(
        patches.len() >= 2,
        "patches blob too short: {} bytes",
        patches.len()
    );
    let count = u16::from_le_bytes([patches[0], patches[1]]);
    assert!(
        count >= 1,
        "expected at least one viewport patch, got count={count}"
    );
    assert!(
        patches.len() > 16,
        "expected non-empty per-viewport patch payload covering the source-column \
         overwrite, got {} bytes",
        patches.len()
    );
}

#[test]
fn text_to_columns_fixed_width_emits_change_for_source_column_overwrite() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_delimited_strings()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

    // Fixed-width: break at column 7 (so "Seattle" / ", WA, 98101").
    let opts = serde_json::json!({
        "splitType": "FixedWidth",
        "fixedWidthBreaks": [7],
        "delimiters": { "tab": false, "semicolon": false, "comma": false, "space": false },
        "treatConsecutiveAsOne": false,
        "textQualifier": "doubleQuote",
    });

    let (_patches, result) = engine
        .text_to_columns(&sid, 0, 2, 0, 0, 0, opts)
        .expect("text_to_columns");

    let src = find_change(&result.recalc.changed_cells, 0, 0).expect(
        "fixed-width split: source-column overwrite (0,0) must be present in changed_cells",
    );
    assert!(
        matches!(&src.value, CellValue::Text(s) if s.as_ref() == "Seattle"),
        "(0,0) fixed-width first segment should be 'Seattle', got {:?}",
        src.value
    );
}
