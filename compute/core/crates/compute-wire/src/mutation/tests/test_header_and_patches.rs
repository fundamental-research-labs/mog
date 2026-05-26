use super::super::*;
use super::helpers::*;
use snapshot_types::RecalcResult;
use value_types::CellValue;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, NO_STRING, PATCH_STRIDE};
use crate::flags::{self as render_flags, MUT_HAS_ERRORS, MUT_HAS_PROJECTION_CHANGES};

#[test]
fn test_header_fields() {
    let result = make_test_result();
    let buf = serialize_mutation_result(&result, "sheet-abc", 7, None);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 3);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap());
    assert_eq!(sheet_id_len, 9); // "sheet-abc".len()

    assert_eq!(buf[10], 0); // no spill changes, no errors
    assert_eq!(buf[11], 7); // generation
}

#[test]
fn test_sheet_id_roundtrip() {
    let result = make_test_result();
    let buf = serialize_mutation_result(&result, "my-sheet", 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let sheet_id = std::str::from_utf8(&buf[HEADER_SIZE..HEADER_SIZE + sheet_id_len]).unwrap();
    assert_eq!(sheet_id, "my-sheet");
}

#[test]
fn test_cell_patch_row_col() {
    let result = make_test_result();
    let sheet_id = "s1";
    let buf = serialize_mutation_result(&result, sheet_id, 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let patches_start = HEADER_SIZE + sheet_id_len;

    // First patch: row=0, col=0
    let row = u32::from_le_bytes(buf[patches_start..patches_start + 4].try_into().unwrap());
    let col = u32::from_le_bytes(
        buf[patches_start + 4..patches_start + 8]
            .try_into()
            .unwrap(),
    );
    assert_eq!(row, 0);
    assert_eq!(col, 0);

    // Second patch: row=1, col=3
    let off2 = patches_start + PATCH_STRIDE;
    let row2 = u32::from_le_bytes(buf[off2..off2 + 4].try_into().unwrap());
    let col2 = u32::from_le_bytes(buf[off2 + 4..off2 + 8].try_into().unwrap());
    assert_eq!(row2, 1);
    assert_eq!(col2, 3);
}

#[test]
fn test_number_cell_record() {
    let result = make_test_result();
    let sheet_id = "s1";
    let buf = serialize_mutation_result(&result, sheet_id, 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    // number_value at offset 8 within patch (offset 0 is row, 4 is col)
    let num = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
    assert_eq!(num, 42.0);

    // flags at offset 24 within patch
    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );

    // format_idx at offset 26
    let fmt_idx = u16::from_le_bytes(buf[off + 26..off + 28].try_into().unwrap());
    assert_eq!(fmt_idx, 1);
}

#[test]
fn test_string_pool_display_text() {
    let result = make_test_result();
    let sheet_id = "s1";
    let buf = serialize_mutation_result(&result, sheet_id, 0, None);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;

    // First cell: display_off=0, display_len=2 ("42")
    let off = HEADER_SIZE + sheet_id_len;
    let d_off = u32::from_le_bytes(buf[off + 16..off + 20].try_into().unwrap()) as usize;
    let d_len = u16::from_le_bytes(buf[off + 28..off + 30].try_into().unwrap()) as usize;
    let text = std::str::from_utf8(&buf[pool_start + d_off..pool_start + d_off + d_len]).unwrap();
    assert_eq!(text, "42");

    // Second cell: "Hello"
    let off2 = HEADER_SIZE + sheet_id_len + PATCH_STRIDE;
    let d_off2 = u32::from_le_bytes(buf[off2 + 16..off2 + 20].try_into().unwrap()) as usize;
    let d_len2 = u16::from_le_bytes(buf[off2 + 28..off2 + 30].try_into().unwrap()) as usize;
    let text2 =
        std::str::from_utf8(&buf[pool_start + d_off2..pool_start + d_off2 + d_len2]).unwrap();
    assert_eq!(text2, "Hello");
}

#[test]
fn test_error_cell() {
    let result = make_test_result();
    let sheet_id = "s1";
    let buf = serialize_mutation_result(&result, sheet_id, 0, None);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;

    // Third cell (error)
    let off = HEADER_SIZE + sheet_id_len + 2 * PATCH_STRIDE;
    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_ERROR
    );

    // display_off should be NO_STRING (no display_text)
    let d_off = u32::from_le_bytes(buf[off + 16..off + 20].try_into().unwrap());
    assert_eq!(d_off, NO_STRING);

    // error_off should point to "#DIV/0!" in the string pool
    let e_off = u32::from_le_bytes(buf[off + 20..off + 24].try_into().unwrap()) as usize;
    let e_len = u16::from_le_bytes(buf[off + 30..off + 32].try_into().unwrap()) as usize;
    let error_text =
        std::str::from_utf8(&buf[pool_start + e_off..pool_start + e_off + e_len]).unwrap();
    assert_eq!(error_text, "#DIV/0!");
}

#[test]
fn test_flags_spill_and_errors() {
    let mut result = make_test_result();
    result
        .projection_changes
        .push(snapshot_types::ProjectionChange {
            source_cell_id: "c1".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![snapshot_types::ProjectionCellData {
                cell_id: "c1".into(),
                row: 5,
                col: 5,
                value: CellValue::number(99.0),
            }],
        });
    result.errors.push(snapshot_types::CellErrorInfo {
        cell_id: "c3".into(),
        sheet_id: "s1".into(),
        error: "div0".into(),
    });
    let buf = serialize_mutation_result(&result, "s1", 0, None);
    assert_eq!(
        buf[10] & MUT_HAS_PROJECTION_CHANGES,
        MUT_HAS_PROJECTION_CHANGES
    );
    assert_eq!(buf[10] & MUT_HAS_ERRORS, MUT_HAS_ERRORS);
}

#[test]
fn test_empty_result() {
    let result = RecalcResult::empty();
    let buf = serialize_mutation_result(&result, "empty-sheet", 0, None);

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 0);

    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    assert_eq!(string_bytes, 0);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    assert_eq!(sheet_id_len, "empty-sheet".len());

    // Total size = header + sheet_id
    assert_eq!(buf.len(), HEADER_SIZE + sheet_id_len);
}
