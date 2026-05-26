//! Stream D1.5 — Data Table partial-write guard.
//!
//! `set_cell` / `set_cells` / `set_cells_raw{UserEdit}` MUST reject any
//! partial write into a Data Table region with `PartialArrayWrite`.
//! "Partial write" includes:
//!
//! - Literal/Parse into the master cell (would orphan body cells).
//! - Literal/Parse into any body cell (would diverge from synthesized formula).
//! - Clear of any cell in the region (Data Tables are atomic — clear-all only).
//!
//! The unified guard at `scheduler/edit.rs::check_region_partial_write`
//! consults BOTH `cse_anchor_covering` (CSE rectangles) AND
//! `find_data_table_at` (Data Table regions). One helper, one path; no
//! parallel `check_data_table_partial_write`.
//!
//! Run:
//!   cargo test -p compute-core --test data_table_partial_write_rejection

#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_common;
use stress_common::*;

use cell_types::SheetId;
use compute_core::bridge_types::CellInput;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::{ComputeCore, WriteTrust};
use snapshot_types::DataTableRegionDef;
use value_types::{CellValue, ComputeError, FiniteF64};

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

/// Build a 2×2 Data Table at B2:C3 with master at B2, plus header /
/// input cells. Returns `(core, mirror, sheet_id)` ready to receive
/// edits.
///
/// Pre-allocates CellIds for every cell in the region so that
/// post-init `set_cell` / `set_cells` / `set_cells_raw` calls have
/// stable identity to target. Master B2 carries the `=TABLE($A$2,$A$1)`
/// formula stub (Stream E will eventually evaluate it; D1.5 only cares
/// about partial-write rejection).
fn make_data_table_workbook() -> (ComputeCore, CellMirror, SheetId) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        50,
        10,
        vec![
            // A1 = top-row anchor, A2 = left-col anchor
            (0, 0, CellValue::Number(FiniteF64::must(2.0)), None),
            (1, 0, CellValue::Number(FiniteF64::must(3.0)), None),
            // B1, C1 — top-row headers
            (0, 1, CellValue::Number(FiniteF64::must(5.0)), None),
            (0, 2, CellValue::Number(FiniteF64::must(7.0)), None),
            // B2 — master, carries the TABLE formula stub
            (
                1,
                1,
                CellValue::Number(FiniteF64::must(0.0)),
                Some("TABLE($A$2,$A$1)"),
            ),
            // Body cells with cached values
            (1, 2, CellValue::Number(FiniteF64::must(14.0)), None), // C2
            (2, 1, CellValue::Number(FiniteF64::must(15.0)), None), // B3
            (2, 2, CellValue::Number(FiniteF64::must(21.0)), None), // C3
        ],
    )]);

    // Inject the Data Table region definition. The snapshot helper
    // doesn't expose `data_table_regions`, so we patch after building.
    let mut snapshot = snapshot;
    snapshot.data_table_regions = vec![DataTableRegionDef {
        sheet: snapshot.sheets[0].id.clone(),
        start_row: 1,
        start_col: 1,
        end_row: 2,
        end_col: 2,
        row_input_ref: None,
        col_input_ref: None,
        ooxml_flags: None,
    }];

    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    let sheet_id = sid(0);
    (core, mirror, sheet_id)
}

// ---------------------------------------------------------------------------
// Tests — set_cell single-cell path
// ---------------------------------------------------------------------------

#[test]
fn set_cell_into_data_table_body_rejects_with_partial_array_write() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // C3 = (row=2, col=2) — a body cell. Literal write must reject.
    let c3_id = cid(0, 2, 2);
    let result = core.set_cell(
        &mut mirror,
        &sheet_id,
        c3_id,
        2,
        2,
        CellInput::Literal {
            text: "999".to_string(),
        },
    );

    match result {
        Err(ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!((row, col), (2, 2), "rejected coords mismatch");
            assert_eq!(
                (anchor_row, anchor_col),
                (1, 1),
                "anchor must point at Data Table master B2=(1,1)"
            );
        }
        Err(other) => panic!("expected PartialArrayWrite, got {:?}", other),
        Ok(_) => panic!(
            "expected PartialArrayWrite, got Ok(_) — set_cell silently \
             overwrote a Data Table body cell. The unified region guard \
             at scheduler/edit.rs::check_region_partial_write was not \
             extended to consult mirror.find_data_table_at."
        ),
    }

    // Atomicity: C3 must still hold its cached value 21.0.
    assert_pos_number(&mirror, 0, 2, 2, 21.0);
}

#[test]
fn set_cell_into_data_table_master_literal_rejects() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // B2 = (row=1, col=1) — the master. Literal overwrites are
    // rejected: the TABLE formula is the region's source of truth.
    let b2_id = cid(0, 1, 1);
    let result = core.set_cell(
        &mut mirror,
        &sheet_id,
        b2_id,
        1,
        1,
        CellInput::Literal {
            text: "42".to_string(),
        },
    );

    match result {
        Err(ComputeError::PartialArrayWrite {
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!((anchor_row, anchor_col), (1, 1));
        }
        Err(other) => panic!("expected PartialArrayWrite, got {:?}", other),
        Ok(_) => panic!(
            "expected PartialArrayWrite at the Data Table master — \
             editing the master would orphan body cells; Excel parity \
             rejects with the array-part error."
        ),
    }
}

#[test]
fn set_cell_into_data_table_master_parse_rejects() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // B2 — Parse (formula entry) is also rejected. User must clear
    // the entire region first to remove the Data Table.
    let b2_id = cid(0, 1, 1);
    let result = core.set_cell(
        &mut mirror,
        &sheet_id,
        b2_id,
        1,
        1,
        CellInput::Parse {
            text: "=A1+1".to_string(),
        },
    );

    match result {
        Err(ComputeError::PartialArrayWrite {
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!((anchor_row, anchor_col), (1, 1));
        }
        Err(other) => panic!("expected PartialArrayWrite, got {:?}", other),
        Ok(_) => panic!(
            "expected PartialArrayWrite at the Data Table master Parse — \
             entering a non-TABLE formula on the master must reject."
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests — set_cells batch path
// ---------------------------------------------------------------------------

#[test]
fn set_cells_batch_with_data_table_intersection_rejects_atomically() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // Batch with one cell outside the region (D5) and one inside (B3).
    // The whole batch must reject; D5 must NOT have been written.
    let d5_id = cid(0, 4, 3);
    let b3_id = cid(0, 2, 1);

    let edits = vec![
        (
            sheet_id,
            d5_id,
            4,
            3,
            CellInput::Literal {
                text: "outside".to_string(),
            },
        ),
        (
            sheet_id,
            b3_id,
            2,
            1,
            CellInput::Literal {
                text: "inside".to_string(),
            },
        ),
    ];

    let result = core.set_cells(&mut mirror, &edits, false);
    match result {
        Err(ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!(
                (row, col),
                (2, 1),
                "must report the in-region cell B3=(2,1)"
            );
            assert_eq!((anchor_row, anchor_col), (1, 1));
        }
        Err(other) => panic!("expected PartialArrayWrite, got {:?}", other),
        Ok(_) => panic!("expected PartialArrayWrite at batch with Data Table intersection"),
    }

    // Atomicity: D5 (outside region) must NOT have been written.
    let d5_value = mirror.get_cell_value(&d5_id);
    assert!(
        matches!(d5_value, None | Some(value_types::CellValue::Null)),
        "D5 was written despite atomic rejection: {:?}",
        d5_value
    );
}

// ---------------------------------------------------------------------------
// Tests — clear path
// ---------------------------------------------------------------------------

#[test]
fn clear_cells_data_table_member_rejects() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // Clear a body cell C3 via set_cell with `Clear`. Must reject.
    let c3_id = cid(0, 2, 2);
    let result = core.set_cell(&mut mirror, &sheet_id, c3_id, 2, 2, CellInput::Clear);

    match result {
        Err(ComputeError::PartialArrayWrite {
            row,
            col,
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!((row, col), (2, 2));
            assert_eq!((anchor_row, anchor_col), (1, 1));
        }
        Err(other) => panic!(
            "expected PartialArrayWrite for clear-of-body, got {:?}",
            other
        ),
        Ok(_) => panic!(
            "expected PartialArrayWrite — clearing a Data Table body cell \
             is a partial write. Users must clear the entire region \
             explicitly (the master + every body cell in one batch) to \
             remove the Data Table."
        ),
    }

    // Atomicity: C3's cached value must still be 21.
    assert_pos_number(&mirror, 0, 2, 2, 21.0);
}

// ---------------------------------------------------------------------------
// Tests — set_cells_raw{UserEdit} typed-batch path (Stream A′)
// ---------------------------------------------------------------------------

#[test]
fn set_cells_raw_user_edit_rejects_data_table_partial_write() {
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    // Typed value-write into C3 with UserEdit trust. The Stream A′
    // guard at `set_cells_raw_with_trust(WriteTrust::UserEdit)` rejects
    // any value-write into a CSE / Data Table region with
    // PartialArrayWrite — same shape as the parsed path.
    let c3_id = cid(0, 2, 2);
    let edits = vec![(
        sheet_id,
        c3_id,
        2u32,
        2u32,
        CellValue::Number(FiniteF64::must(999.0)),
        None::<String>,
    )];

    let result = core.set_cells_raw_with_trust(&mut mirror, &edits, false, WriteTrust::UserEdit);
    match result {
        Err(ComputeError::PartialArrayWrite {
            anchor_row,
            anchor_col,
            ..
        }) => {
            assert_eq!((anchor_row, anchor_col), (1, 1));
        }
        Err(other) => panic!("expected PartialArrayWrite, got {:?}", other),
        Ok(_) => panic!(
            "expected PartialArrayWrite from set_cells_raw{{UserEdit}} — \
             the Stream A′ guard must consult find_data_table_at."
        ),
    }

    // Atomicity: C3's cached value must still be 21.
    assert_pos_number(&mirror, 0, 2, 2, 21.0);
}

#[test]
fn set_cells_raw_trusted_replay_skips_data_table_guard() {
    // TrustedReplay path bypasses the guard — by design. The upstream
    // op (collab peer's user edit) already passed its guard, so the
    // replay is consistent with the region invariant. This test
    // documents the contract.
    let (mut core, mut mirror, sheet_id) = make_data_table_workbook();

    let c3_id = cid(0, 2, 2);
    let edits = vec![(
        sheet_id,
        c3_id,
        2u32,
        2u32,
        CellValue::Number(FiniteF64::must(99.0)),
        None::<String>,
    )];

    // TrustedReplay must NOT reject — collab/replay path semantics.
    let result =
        core.set_cells_raw_with_trust(&mut mirror, &edits, false, WriteTrust::TrustedReplay);
    assert!(
        result.is_ok(),
        "TrustedReplay must skip the region guard; got {:?}",
        result
    );
}
