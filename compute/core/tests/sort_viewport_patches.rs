//! Sort viewport-patch regression tests.
//!
//! Range-backed sorts can reorder row identities without changing many cell
//! values. The UI viewport must therefore be rebuilt from post-sort state,
//! rather than patched only from recalc.changed_cells.
//!
//! Run:
//!   cargo test -p compute-core --test sort_viewport_patches

use cell_types::{
    ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetId, SheetPos,
};
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "a1000000-0000-4000-8000-000000000001";
const RANGE_UUID: &str = "b1000000-0000-4000-8000-000000000001";
const NUM_ROWS: u32 = 10;
const NUM_COLS: u32 = 5;

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet id")
}

fn test_range_id() -> RangeId {
    RangeId::from_uuid_str(RANGE_UUID).expect("valid range id")
}

fn hydrated_row_id(row: u32) -> RowId {
    RowId::from_raw((row + 1) as u128)
}

fn hydrated_col_id(col: u32) -> ColId {
    ColId::from_raw((NUM_ROWS + col + 1) as u128)
}

fn sparse_cell_uuid(row: u32, col: u32) -> String {
    format!("c1000000-0000-4000-8000-{:04x}{:08x}", row, col)
}

fn mixed_range_snapshot() -> WorkbookSnapshot {
    let mut payload = Vec::new();
    for row_vals in &[
        [5.0_f64, 50.0],
        [3.0, 30.0],
        [1.0, 10.0],
        [4.0, 40.0],
        [2.0, 20.0],
    ] {
        for &value in row_vals {
            payload.extend_from_slice(&value.to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..5).map(hydrated_row_id).collect();
    let col_ids: Vec<ColId> = (0..2).map(hydrated_col_id).collect();
    let sparse_values = [500.0, 300.0, 100.0, 400.0, 200.0];
    let sparse_cells = sparse_values
        .iter()
        .enumerate()
        .map(|(row, value)| CellData {
            cell_id: sparse_cell_uuid(row as u32, 2),
            row: row as u32,
            col: 2,
            value: CellValue::Number(FiniteF64::must(*value)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: NUM_ROWS,
            cols: NUM_COLS,
            cells: sparse_cells,
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[4],
                    start_col: col_ids[0],
                    end_col: col_ids[1],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            }],
        }],
        ..Default::default()
    }
}

fn ascending_sort_options(col: u32) -> BridgeSortOptions {
    BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: col,
            direction: SortOrder::Asc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    }
}

fn as_f64(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> f64 {
    match engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
    {
        Some(CellValue::Number(value)) => value.get(),
        other => panic!("expected number at ({row},{col}), got {other:?}"),
    }
}

fn viewport_count(patches: &[u8]) -> u16 {
    assert!(patches.len() >= 2, "patch blob must carry header");
    u16::from_le_bytes([patches[0], patches[1]])
}

fn first_viewport_payload<'a>(patches: &'a [u8], viewport_id: &str) -> &'a [u8] {
    let count = viewport_count(patches) as usize;
    let mut offset = 2usize;
    for _ in 0..count {
        let id_len = patches[offset] as usize;
        offset += 1;
        let id = std::str::from_utf8(&patches[offset..offset + id_len]).expect("viewport id");
        offset += id_len;
        let payload_len = u32::from_le_bytes([
            patches[offset],
            patches[offset + 1],
            patches[offset + 2],
            patches[offset + 3],
        ]) as usize;
        offset += 4;
        let payload = &patches[offset..offset + payload_len];
        if id == viewport_id {
            return payload;
        }
        offset += payload_len;
    }
    panic!("missing viewport payload for {viewport_id}");
}

fn is_full_viewport_binary(payload: &[u8]) -> bool {
    const VIEWPORT_WIRE_VERSION_BITS: u8 = 0x20;
    payload.len() >= 36 && (payload[30] & 0xf0) == VIEWPORT_WIRE_VERSION_BITS
}

#[test]
fn range_backed_sort_returns_full_viewport_patch_for_mixed_rows() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(mixed_range_snapshot()).expect("from_snapshot");
    let sid = test_sheet_id();
    engine
        .register_viewport("main", &sid, 0, 0, 4, 2)
        .expect("register viewport");

    let (patches, _result) = engine
        .sort_range(&sid, 0, 0, 4, 2, ascending_sort_options(0))
        .expect("sort range");

    assert_eq!(viewport_count(&patches), 1, "one viewport registered");
    let payload = first_viewport_payload(&patches, "main");
    assert!(
        is_full_viewport_binary(payload),
        "sort must rebuild the viewport buffer; got {} bytes of incremental payload",
        payload.len()
    );

    for (row, expected) in [(0, 10.0), (1, 20.0), (2, 30.0), (3, 40.0), (4, 50.0)] {
        assert_eq!(as_f64(&engine, &sid, row, 1), expected);
    }
    for (row, expected) in [(0, 100.0), (1, 200.0), (2, 300.0), (3, 400.0), (4, 500.0)] {
        assert_eq!(as_f64(&engine, &sid, row, 2), expected);
    }
}
