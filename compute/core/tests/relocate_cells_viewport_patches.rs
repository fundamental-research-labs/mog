//! Regression tests for filter viewport R5.3 — `relocate_cells_yrs` emits
//! clear-patches for source cells AND write-patches for every target.
//!
//! Before R5.3:
//!   - `relocate_cells_yrs` returned `serialize_multi_viewport_patches(&[])` —
//!     no viewport patches at all.
//!   - `mutation_relocate_cells` swallowed the source-clear via
//!     `let _ = stores.compute.clear_cells(...)`, never appending the
//!     null entries to the recalc result.
//!   - The kernel's `paste-integration.ts` was forced to fall back to
//!     `executePaste` (creates new CellIds, breaks formula refs) for
//!     same-sheet cuts because the viewport buffer didn't update.
//!
//! After R5.3:
//!   - The clear pass propagates into `recalc.changed_cells` (Null entries
//!     for vacated source positions).
//!   - The write pass propagates into `recalc.changed_cells` for each
//!     target position.
//!   - `relocate_cells_yrs` calls `flush_viewport_patches` and (for
//!     cross-sheet) additionally rebuilds full viewport binaries on both
//!     source and target sheets.
//!
//! After the source-position-clear follow-up (this round):
//!   - `RelocationResult.source_positions_vacated` carries the (row, col)
//!     of every moved cell's pre-move position.
//!   - `mutation_relocate_cells` emits a synthetic Null `CellChange` for
//!     each source position that's not re-occupied by the move
//!     (overlap-aware). These flow through `flush_viewport_patches` and
//!     show up in the binary patch payload — which is what the viewport
//!     buffer reads to clear stale display values.
//!
//! Run:
//!   cargo test -p compute-core --test relocate_cells_viewport_patches

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use compute_wire::constants::{
    CELL_STRIDE, MUTATION_HEADER_SIZE, OFF_FLAGS, OFF_NUMBER_VALUE, PATCH_STRIDE,
    VIEWPORT_HEADER_SIZE,
};
use compute_wire::flags::{VALUE_TYPE_MASK, VALUE_TYPE_NULL, VALUE_TYPE_NUMBER};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id_str(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}
fn cell_id_str(suffix: u32) -> String {
    format!("a0000000-0000-0000-0000-{:012x}", suffix)
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

fn snapshot_two_sheets() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                id: sheet_id_str(1),
                name: "S1".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![
                    number_cell(100, 0, 0, 10.0),
                    number_cell(101, 0, 1, 20.0),
                    number_cell(102, 1, 0, 30.0),
                    number_cell(103, 1, 1, 40.0),
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                id: sheet_id_str(2),
                name: "S2".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

fn snapshot_single_sheet() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                number_cell(100, 0, 0, 10.0),
                number_cell(101, 0, 1, 20.0),
                number_cell(102, 1, 0, 30.0),
                number_cell(103, 1, 1, 40.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

/// Single-column snapshot for the `cut-clears-source-on-paste-only` test:
/// A1=1, A2=2, A3=3.
fn snapshot_a1_a3_column() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 26,
            cells: vec![
                number_cell(200, 0, 0, 1.0),
                number_cell(201, 1, 0, 2.0),
                number_cell(202, 2, 0, 3.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn register_viewport(engine: &mut YrsComputeEngine, sheet_id: &SheetId, vp_id: &str) {
    engine
        .register_viewport(vp_id, sheet_id, 0, 0, 9, 5)
        .expect("register_viewport");
}

fn viewport_count(patches: &[u8]) -> u16 {
    assert!(patches.len() >= 2);
    u16::from_le_bytes([patches[0], patches[1]])
}

// ---------------------------------------------------------------------------
// Patch decoding helpers
// ---------------------------------------------------------------------------

/// One decoded cell-patch record.
#[derive(Debug, Clone)]
struct DecodedPatch {
    row: u32,
    col: u32,
    flags: u16,
    number_value: f64,
}

impl DecodedPatch {
    fn value_type_bits(&self) -> u16 {
        self.flags & VALUE_TYPE_MASK
    }
}

/// Extract every cell-patch record from a single viewport's mutation bytes.
/// Returns the records in wire order. Sheet ID is skipped — caller already
/// knows which sheet they're inspecting because they picked the viewport.
fn decode_patches(mutation_bytes: &[u8]) -> Vec<DecodedPatch> {
    if mutation_bytes.len() < MUTATION_HEADER_SIZE {
        return Vec::new();
    }
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;

    let mut out = Vec::with_capacity(patch_count);
    for i in 0..patch_count {
        let off = patches_start + i * PATCH_STRIDE;
        if off + PATCH_STRIDE > mutation_bytes.len() {
            break;
        }
        let row = u32::from_le_bytes([
            mutation_bytes[off],
            mutation_bytes[off + 1],
            mutation_bytes[off + 2],
            mutation_bytes[off + 3],
        ]);
        let col = u32::from_le_bytes([
            mutation_bytes[off + 4],
            mutation_bytes[off + 5],
            mutation_bytes[off + 6],
            mutation_bytes[off + 7],
        ]);
        let number_value = f64::from_le_bytes([
            mutation_bytes[off + 8],
            mutation_bytes[off + 9],
            mutation_bytes[off + 10],
            mutation_bytes[off + 11],
            mutation_bytes[off + 12],
            mutation_bytes[off + 13],
            mutation_bytes[off + 14],
            mutation_bytes[off + 15],
        ]);
        let flags = u16::from_le_bytes([mutation_bytes[off + 24], mutation_bytes[off + 25]]);
        out.push(DecodedPatch {
            row,
            col,
            flags,
            number_value,
        });
    }
    out
}

/// Resolve the value-type the viewport buffer would see at `(row, col)`
/// for a given viewport's mutation bytes. When multiple patches target the
/// same position, the LAST one wins (matches the wire-order replay the
/// viewport buffer performs). Returns None when no patch covers `(row, col)`.
fn effective_value_type_at(mutation_bytes: &[u8], row: u32, col: u32) -> Option<u16> {
    decode_patches(mutation_bytes)
        .into_iter()
        .rfind(|p| p.row == row && p.col == col)
        .map(|p| p.value_type_bits())
}

fn effective_number_at(mutation_bytes: &[u8], row: u32, col: u32) -> Option<f64> {
    decode_patches(mutation_bytes)
        .into_iter()
        .rfind(|p| p.row == row && p.col == col)
        .map(|p| p.number_value)
}

fn full_viewport_cell_offset(viewport_bytes: &[u8], row: u32, col: u32) -> Option<usize> {
    if viewport_bytes.len() < VIEWPORT_HEADER_SIZE {
        return None;
    }
    let start_row = u32::from_le_bytes([
        viewport_bytes[0],
        viewport_bytes[1],
        viewport_bytes[2],
        viewport_bytes[3],
    ]);
    let start_col = u32::from_le_bytes([
        viewport_bytes[4],
        viewport_bytes[5],
        viewport_bytes[6],
        viewport_bytes[7],
    ]);
    let cell_count = u32::from_le_bytes([
        viewport_bytes[8],
        viewport_bytes[9],
        viewport_bytes[10],
        viewport_bytes[11],
    ]) as usize;
    let viewport_cols = u16::from_le_bytes([viewport_bytes[22], viewport_bytes[23]]) as u32;
    if row < start_row || col < start_col || viewport_cols == 0 {
        return None;
    }
    let rel_row = row - start_row;
    let rel_col = col - start_col;
    if rel_col >= viewport_cols {
        return None;
    }
    let index = rel_row.checked_mul(viewport_cols)?.checked_add(rel_col)? as usize;
    if index >= cell_count {
        return None;
    }
    let offset = VIEWPORT_HEADER_SIZE + index * CELL_STRIDE;
    (offset + CELL_STRIDE <= viewport_bytes.len()).then_some(offset)
}

fn full_viewport_value_type_at(viewport_bytes: &[u8], row: u32, col: u32) -> Option<u16> {
    let offset = full_viewport_cell_offset(viewport_bytes, row, col)?;
    let flags = u16::from_le_bytes([
        viewport_bytes[offset + OFF_FLAGS],
        viewport_bytes[offset + OFF_FLAGS + 1],
    ]);
    Some(flags & VALUE_TYPE_MASK)
}

fn full_viewport_number_at(viewport_bytes: &[u8], row: u32, col: u32) -> Option<f64> {
    let offset = full_viewport_cell_offset(viewport_bytes, row, col)?;
    Some(f64::from_le_bytes([
        viewport_bytes[offset + OFF_NUMBER_VALUE],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 1],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 2],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 3],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 4],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 5],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 6],
        viewport_bytes[offset + OFF_NUMBER_VALUE + 7],
    ]))
}

/// Pick the first viewport's mutation bytes that match the given `vp_id`.
/// Returns the per-viewport mutation buffer (header + sheet id + patch
/// records + string pool + optional sections) for that viewport.
fn viewport_bytes<'a>(packed: &'a [u8], vp_id: &str) -> Option<&'a [u8]> {
    if packed.len() < 2 {
        return None;
    }
    let count = u16::from_le_bytes([packed[0], packed[1]]) as usize;
    let mut offset = 2usize;
    for _ in 0..count {
        if offset >= packed.len() {
            return None;
        }
        let id_len = packed[offset] as usize;
        offset += 1;
        let id = std::str::from_utf8(&packed[offset..offset + id_len]).ok()?;
        offset += id_len;
        let patch_len = u32::from_le_bytes([
            packed[offset],
            packed[offset + 1],
            packed[offset + 2],
            packed[offset + 3],
        ]) as usize;
        offset += 4;
        if id == vp_id {
            return Some(&packed[offset..offset + patch_len]);
        }
        offset += patch_len;
    }
    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn relocate_same_sheet_emits_patches_with_clear_and_write() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp-s1");

    // Move A1:B2 (rows 0..=1, cols 0..=1) to D5 (row 4, col 3).
    let (patches, _result) = engine
        .relocate_cells_yrs(&sid, 0, 0, 1, 1, &sid, 4, 3)
        .expect("relocate_cells_yrs");

    // Same-sheet: incremental flush_viewport_patches; one viewport
    // because we registered one. filter viewport R5.3 — pre-fix, this returned
    // a 2-byte sentinel `[0u8, 0u8]` (empty multi-viewport blob). After
    // the fix, the blob carries a non-empty per-viewport patch.
    assert_eq!(viewport_count(&patches), 1, "one viewport");
    assert!(
        patches.len() > 16,
        "non-empty patch payload: clear+write entries pinned (filter viewport R5.3), got {} bytes",
        patches.len()
    );

    // Verify the GridIndex moved the CellIds: position (0,0)..(1,1) no
    // longer host the source CellIds; position (4,3)..(5,4) do.
    let grid = engine.grid_index(&sid).expect("grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            grid.cell_id_at(r, c).is_none(),
            "source GridIndex pos ({},{}) should be empty post-relocate",
            r,
            c
        );
    }
    for (r, c) in [(4u32, 3u32), (4, 4), (5, 3), (5, 4)] {
        assert!(
            grid.cell_id_at(r, c).is_some(),
            "target GridIndex pos ({},{}) should hold moved CellId",
            r,
            c
        );
    }

    // Tightened assertion (source-clear patch contract):
    // The viewport buffer at the source positions must read back as Null.
    // Pre-fix this failed silently because no clear patch was emitted at
    // (0,0)..(1,1); only the destination writes flowed through, so the
    // viewport kept the cached "10 / 20 / 30 / 40" indefinitely.
    let bytes = viewport_bytes(&patches, "vp-s1").expect("vp-s1 bytes");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        let vt = effective_value_type_at(bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no patch covers source ({},{}); without a Null patch the \
                 viewport buffer would keep the stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "source ({},{}) must replay as Null in the patch stream; got value_type={}",
            r, c, vt
        );
    }
    // Sanity: target positions carry numeric writes with the right values.
    for (r, c, expected) in [
        (4u32, 3u32, 10.0f64),
        (4, 4, 20.0),
        (5, 3, 30.0),
        (5, 4, 40.0),
    ] {
        let vt = effective_value_type_at(bytes, r, c)
            .unwrap_or_else(|| panic!("no patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "target ({},{}) must replay as Number; got value_type={}",
            r, c, vt
        );
        let n = effective_number_at(bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "target ({},{}) value: expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }
}

#[test]
fn relocate_cross_sheet_emits_patches_on_both_sheets() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_two_sheets()).expect("from_snapshot");
    let s1 = engine.mirror().sheet_by_name("S1").expect("S1");
    let s2 = engine.mirror().sheet_by_name("S2").expect("S2");
    register_viewport(&mut engine, &s1, "vp-s1");
    register_viewport(&mut engine, &s2, "vp-s2");

    // Move S1!A1:B2 to S2!A1.
    let (patches, _result) = engine
        .relocate_cells_yrs(&s1, 0, 0, 1, 1, &s2, 0, 0)
        .expect("relocate_cells_yrs");

    // Cross-sheet: incremental flush + full rebuilds on both sheets.
    // Combined payload should carry at least 2 viewports (one per sheet);
    // the implementation may also include the incremental flush blob,
    // so the count is "at least 2".
    let count = viewport_count(&patches);
    assert!(
        count >= 2,
        "cross-sheet relocate emits patches for both sheets, got {}",
        count
    );

    // Verify GridIndex state: S1 source positions vacated, S2 target
    // positions hold the moved CellIds.
    let s1_grid = engine.grid_index(&s1).expect("s1 grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            s1_grid.cell_id_at(r, c).is_none(),
            "source S1!({},{}) GridIndex empty post-cross-sheet relocate",
            r,
            c
        );
    }
    let s2_grid = engine.grid_index(&s2).expect("s2 grid");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        assert!(
            s2_grid.cell_id_at(r, c).is_some(),
            "target S2!({},{}) GridIndex carries moved CellId",
            r,
            c
        );
    }

    // Tightened assertion: source S1!A1:B2 must replay as Null in the
    // patch stream, AND target S2!A1:B2 must replay as Number with the
    // original values.
    //
    // Cross-sheet rebuild path produces full viewport binaries on both
    // sheets, so the source-side Null is generated either by the
    // incremental flush (Null entries in `recalc.changed_cells`) or by
    // the full-viewport rebuild reading the (now-empty) mirror — either
    // way, the effective value type at the source positions must be Null.
    let s1_bytes = viewport_bytes(&patches, "vp-s1").expect("vp-s1 bytes");
    for (r, c) in [(0u32, 0u32), (0, 1), (1, 0), (1, 1)] {
        let vt = effective_value_type_at(s1_bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no S1 patch covers source ({},{}) — viewport buffer would \
                 keep stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "S1!({},{}) must replay as Null after cross-sheet move; got {}",
            r, c, vt
        );
    }
    let s2_bytes = viewport_bytes(&patches, "vp-s2").expect("vp-s2 bytes");
    for (r, c, expected) in [
        (0u32, 0u32, 10.0f64),
        (0, 1, 20.0),
        (1, 0, 30.0),
        (1, 1, 40.0),
    ] {
        let vt = effective_value_type_at(s2_bytes, r, c)
            .unwrap_or_else(|| panic!("no S2 patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "S2!({},{}) must replay as Number; got value_type={}",
            r, c, vt
        );
        let n = effective_number_at(s2_bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "S2!({},{}): expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }
}

/// `relocate_cells_yrs` must clear every source position and write every
/// target position — not just the *last* one. filter viewport finding 2 / R5.3
/// pinned exactly this contract: the prior implementation only carried
/// the last-cell patch, so multi-cell relocations left interior source
/// cells visible in the viewport buffer.
/// All four target positions must end up holding values — filter viewport
/// finding 2 documented that the prior implementation only carried
/// the *last* target's write patch out to the viewport buffer.
#[test]
fn relocate_writes_all_target_positions_not_just_last() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_single_sheet()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");

    // Move A1:B2 (4 cells) to D5.
    let (_patches, _) = engine
        .relocate_cells_yrs(&sid, 0, 0, 1, 1, &sid, 4, 3)
        .expect("relocate_cells_yrs");

    // Every target position must hold a moved CellId in the GridIndex.
    let grid = engine.grid_index(&sid).expect("grid");
    for (r, c) in [(4u32, 3u32), (4, 4), (5, 3), (5, 4)] {
        assert!(
            grid.cell_id_at(r, c).is_some(),
            "target ({},{}) populated post-relocate",
            r,
            c
        );
    }
}

/// Mirror of the failing app-eval scenario `cut-clears-source-on-paste-only`.
///
/// Snapshot: A1=1, A2=2, A3=3. Cut A1:A3, paste at C1.
/// After R5.3 deleted the kernel-side `onCutPasteComplete` band-aid, this
/// scenario regressed to red because no patch was emitted for the source
/// positions A1:A3 — the viewport buffer kept showing 1/2/3 on the left
/// while also showing 1/2/3 on the right.
///
/// Contract: source A1:A3 read back as Null in the patch stream AND
/// target C1:C3 hold the original values 1/2/3.
#[test]
fn cut_clears_source_on_paste_only() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_a1_a3_column()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");

    // Move A1:A3 (rows 0..=2, col 0) to C1 (row 0, col 2).
    let (patches, _result) = engine
        .relocate_cells_yrs(&sid, 0, 0, 2, 0, &sid, 0, 2)
        .expect("relocate_cells_yrs");

    let bytes = viewport_bytes(&patches, "vp").expect("vp bytes");

    // Source positions vacated: A1, A2, A3.
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        let vt = effective_value_type_at(bytes, r, c).unwrap_or_else(|| {
            panic!(
                "no patch covers source ({},{}) — without a Null patch the \
                 viewport buffer keeps showing the stale value",
                r, c
            )
        });
        assert_eq!(
            vt, VALUE_TYPE_NULL,
            "source ({},{}) must replay as Null; got value_type={}",
            r, c, vt
        );
    }

    // Target positions populated: C1=1, C2=2, C3=3.
    for (r, c, expected) in [(0u32, 2u32, 1.0f64), (1, 2, 2.0), (2, 2, 3.0)] {
        let vt = effective_value_type_at(bytes, r, c)
            .unwrap_or_else(|| panic!("no patch covers target ({},{})", r, c));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "target ({},{}) must replay as Number",
            r, c
        );
        let n = effective_number_at(bytes, r, c).expect("number at target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "target ({},{}): expected {}, got {}",
            r,
            c,
            expected,
            n
        );
    }

    // GridIndex sanity: source vacated, target populated.
    let grid = engine.grid_index(&sid).expect("grid");
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        assert!(
            grid.cell_id_at(r, c).is_none(),
            "GridIndex source ({},{}) should be empty",
            r,
            c
        );
    }
    for (r, c) in [(0u32, 2u32), (1, 2), (2, 2)] {
        assert!(
            grid.cell_id_at(r, c).is_some(),
            "GridIndex target ({},{}) should be populated",
            r,
            c
        );
    }

    // query_range sanity: this is the production read path the kernel's
    // `getCellsViaBridge` fallback uses. The viewport-patch channel can
    // emit a Null patch for a vacated source position, but if the engine's
    // `query_range` still surfaces the old value the UI capture layer
    // (which prefers a non-null bridge result over a null buffer
    // entry) will mask the fix and the cut-paste scenarios stay red.
    // Mirrors the UI harness bridge-fallback read path.
    let qr = engine.query_range(&sid, 0, 0, 2, 2);
    let cells_at = |r: u32, c: u32| qr.cells.iter().find(|cd| cd.row == r && cd.col == c);
    for (r, c) in [(0u32, 0u32), (1, 0), (2, 0)] {
        assert!(
            cells_at(r, c).is_none(),
            "query_range source ({},{}) must be empty after relocate; got {:?}",
            r,
            c,
            cells_at(r, c),
        );
    }
    for (r, c, expected) in [(0u32, 2u32, 1.0), (1, 2, 2.0), (2, 2, 3.0)] {
        let entry =
            cells_at(r, c).unwrap_or_else(|| panic!("query_range target ({},{}) missing", r, c));
        match &entry.value {
            value_types::CellValue::Number(n) => assert!(
                (n.get() - expected).abs() < f64::EPSILON,
                "query_range target ({},{}): expected {}, got {}",
                r,
                c,
                expected,
                n.get(),
            ),
            other => panic!(
                "query_range target ({},{}) expected Number, got {:?}",
                r, c, other
            ),
        }
    }
}

/// Mirrors the Kewpie Insert Cut Cells shape more closely than the minimal
/// app-eval failure: the destination viewport is registered over L:M, the cut
/// source AA:AB sits outside it, and the moved formula is imported with a null
/// cached value even though ComputeCore has an evaluated result.
#[test]
fn relocate_formula_cell_after_insert_down_writes_target_patch_when_source_offscreen() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str(1),
            name: "S1".to_string(),
            rows: 50,
            cols: 40,
            cells: vec![
                number_cell(200, 6, 23, 10.0),
                number_cell(201, 6, 24, 20.0),
                number_cell(202, 6, 25, 30.0),
                formula_cell(203, 6, 26, "=1000-Z7-Y7-X7"),
                number_cell(204, 6, 27, 123.0),
                number_cell(205, 6, 12, 505.0),
            ],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");

    let before = engine.query_range(&sid, 6, 26, 6, 27);
    let aa7 = before
        .cells
        .iter()
        .find(|cell| cell.row == 6 && cell.col == 26)
        .expect("AA7 formula before cut");
    assert_eq!(aa7.value, CellValue::Number(FiniteF64::must(940.0)));
    assert_eq!(aa7.formula.as_deref(), Some("=1000-Z7-Y7-X7"));

    engine
        .register_viewport("vp", &sid, 0, 0, 20, 15)
        .expect("register destination viewport");

    engine
        .insert_cells_with_shift(&sid, 6, 11, 1, 2, false)
        .expect("insert L7:M7 shift down");
    let (patches, _result) = engine
        .relocate_cells_yrs(&sid, 6, 26, 6, 27, &sid, 6, 11)
        .expect("relocate AA7:AB7 to L7:M7");
    let bytes = viewport_bytes(&patches, "vp").expect("vp bytes");

    let l7_vt = effective_value_type_at(bytes, 6, 11).expect("patch at target L7");
    assert_eq!(
        l7_vt, VALUE_TYPE_NUMBER,
        "target L7 must replay as Number for the moved offscreen formula; got value_type={}",
        l7_vt
    );
    let l7_number = effective_number_at(bytes, 6, 11).expect("L7 number");
    assert!(
        (l7_number - 940.0).abs() < f64::EPSILON,
        "target L7 expected evaluated formula value 940, got {}",
        l7_number
    );

    let m7_vt = effective_value_type_at(bytes, 6, 12).expect("patch at target M7");
    assert_eq!(
        m7_vt, VALUE_TYPE_NUMBER,
        "target M7 must replay as Number for the moved value"
    );
    let m7_number = effective_number_at(bytes, 6, 12).expect("M7 number");
    assert!(
        (m7_number - 123.0).abs() < f64::EPSILON,
        "target M7 expected moved value 123, got {}",
        m7_number
    );

    let after = engine.query_range(&sid, 6, 11, 6, 12);
    let l7 = after
        .cells
        .iter()
        .find(|cell| cell.row == 6 && cell.col == 11)
        .expect("L7 formula cell");
    assert_eq!(l7.value, CellValue::Number(FiniteF64::must(940.0)));
    assert_eq!(l7.formula.as_deref(), Some("=1000-Z7-Y7-X7"));

    let full_viewport = engine.get_viewport_binary(&sid, 0, 0, 20, 15, false);
    let full_l7_vt =
        full_viewport_value_type_at(&full_viewport, 6, 11).expect("full viewport L7 record");
    assert_eq!(
        full_l7_vt, VALUE_TYPE_NUMBER,
        "full viewport rebuild must serialize L7 as Number after relocate; got value_type={}",
        full_l7_vt
    );
    let full_l7_number =
        full_viewport_number_at(&full_viewport, 6, 11).expect("full viewport L7 number");
    assert!(
        (full_l7_number - 940.0).abs() < f64::EPSILON,
        "full viewport rebuild expected L7 value 940, got {}",
        full_l7_number
    );
}

/// Overlapping source/target case: A1:A3 → A2:A4. After move, A2/A3
/// host the moved cells (former A1/A2 values), A4 holds the former A3
/// value, A1 is the only fully-vacated source position. The overlap
/// filter in the source-clear pass must NOT emit Null patches at A2/A3
/// — that would shadow the valid destination writes.
#[test]
fn relocate_overlap_keeps_destination_writes() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_a1_a3_column()).expect("from_snapshot");
    let sid = engine.mirror().sheet_by_name("S1").expect("S1");
    register_viewport(&mut engine, &sid, "vp");

    // Move A1:A3 (rows 0..=2, col 0) to A2 (row 1, col 0). Source and
    // target overlap on rows 1, 2.
    let (patches, _result) = engine
        .relocate_cells_yrs(&sid, 0, 0, 2, 0, &sid, 1, 0)
        .expect("relocate_cells_yrs");

    let bytes = viewport_bytes(&patches, "vp").expect("vp bytes");

    // A1 (the only fully-vacated source position) must replay as Null.
    let a1 = effective_value_type_at(bytes, 0, 0).expect("patch at A1");
    assert_eq!(
        a1, VALUE_TYPE_NULL,
        "A1 must replay as Null after overlap move; got value_type={}",
        a1
    );

    // A2/A3/A4 must replay as Number with the *original* values
    // (the move shifted A1=1 → A2, A2=2 → A3, A3=3 → A4). If the
    // overlap filter is broken and the source-clear pass emits Null
    // at A2/A3, those Null entries would shadow the destination
    // writes (extend appends; LAST patch wins) and the viewport
    // buffer would show A2/A3 as empty.
    for (r, expected) in [(1u32, 1.0f64), (2, 2.0), (3, 3.0)] {
        let vt = effective_value_type_at(bytes, r, 0)
            .unwrap_or_else(|| panic!("no patch covers ({}, 0)", r));
        assert_eq!(
            vt, VALUE_TYPE_NUMBER,
            "({}, 0) must replay as Number after overlap move; got value_type={} \
             (overlap filter broken — source-clear pass shadowed the destination write)",
            r, vt
        );
        let n = effective_number_at(bytes, r, 0).expect("number at overlap target");
        assert!(
            (n - expected).abs() < f64::EPSILON,
            "({}, 0): expected {}, got {}",
            r,
            expected,
            n
        );
    }

    // GridIndex sanity: A1 empty, A2..A4 populated.
    let grid = engine.grid_index(&sid).expect("grid");
    assert!(
        grid.cell_id_at(0, 0).is_none(),
        "A1 GridIndex empty post-overlap-move"
    );
    for r in 1u32..=3 {
        assert!(
            grid.cell_id_at(r, 0).is_some(),
            "({}, 0) GridIndex populated post-overlap-move",
            r
        );
    }
}
