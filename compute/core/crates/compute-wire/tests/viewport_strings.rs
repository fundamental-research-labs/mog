#![allow(clippy::pedantic, clippy::all, missing_docs)]

mod support;

use compute_wire::constants::*;
use compute_wire::flags::*;
use compute_wire::serialize_viewport_binary;
use compute_wire::types::*;
use support::fixtures::viewport_cell as cell;
use support::layout::ViewportLayout;
use support::wire::{read_string, read_u16, read_u32};

#[test]
fn viewport_very_long_strings() {
    // A string that is 60,000 bytes, close to u16::MAX but within range.
    let long_str = "A".repeat(60_000);

    let data = ViewportRenderData {
        cells: vec![cell(0, 0, VALUE_TYPE_TEXT, f64::NAN, Some(&long_str), None)],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert!(
        layout.string_pool_bytes >= 60_000,
        "string pool must hold the long string"
    );

    let cr = layout.cell_base(0);
    let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
    let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
    assert_eq!(disp_len, 60_000);

    let recovered = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
    assert_eq!(recovered.len(), 60_000);
    assert!(recovered.chars().all(|c| c == 'A'));
}

#[test]
fn viewport_unicode_strings() {
    // Emoji, CJK, RTL, combining characters
    let emoji = "\u{1F600}\u{1F680}\u{1F4A9}"; // grinning face, rocket, poo
    let cjk = "\u{4E16}\u{754C}\u{4F60}\u{597D}"; // "world hello" in Chinese
    let rtl = "\u{0645}\u{0631}\u{062D}\u{0628}\u{0627}"; // "merhaba" in Arabic script
    let combining = "e\u{0301}"; // e + combining acute accent

    let data = ViewportRenderData {
        cells: vec![
            cell(0, 0, VALUE_TYPE_TEXT, f64::NAN, Some(emoji), None),
            cell(0, 1, VALUE_TYPE_TEXT, f64::NAN, Some(cjk), None),
            cell(0, 2, VALUE_TYPE_TEXT, f64::NAN, Some(rtl), None),
            cell(0, 3, VALUE_TYPE_TEXT, f64::NAN, Some(combining), None),
        ],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 4,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert_eq!(layout.cell_count, 4);

    let expected_strings = [emoji, cjk, rtl, combining];
    for (i, expected) in expected_strings.iter().enumerate() {
        let cr = layout.cell_base(i);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
        assert_eq!(&disp, expected, "unicode string {} mismatch", i);
        // Verify the byte length matches UTF-8 encoding
        assert_eq!(
            disp_len as usize,
            expected.len(),
            "byte length of string {}",
            i
        );
    }
}

#[test]
fn viewport_multiple_cells_with_both_display_and_error_strings() {
    // Verify string pool offsets are correctly computed when multiple cells
    // contribute both display and error strings.
    let data = ViewportRenderData {
        cells: vec![
            cell(
                0,
                0,
                VALUE_TYPE_ERROR,
                f64::NAN,
                Some("Error!"),
                Some("#REF!"),
            ),
            cell(
                0,
                1,
                VALUE_TYPE_ERROR,
                f64::NAN,
                Some("Another"),
                Some("#N/A"),
            ),
        ],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 2,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let layout = ViewportLayout::new(&buf, data.row_positions.len(), data.col_positions.len());

    assert_eq!(layout.cell_count, 2);

    // Cell 0: display="Error!", error="#REF!"
    let cr0 = layout.cell_base(0);
    let d0_off = read_u32(&buf, cr0 + OFF_DISPLAY_OFF);
    let d0_len = read_u16(&buf, cr0 + OFF_DISPLAY_LEN);
    let e0_off = read_u32(&buf, cr0 + OFF_ERROR_OFF);
    let e0_len = read_u16(&buf, cr0 + OFF_ERROR_LEN);
    assert_eq!(
        read_string(&buf, layout.string_pool_start, d0_off, d0_len),
        "Error!"
    );
    assert_eq!(
        read_string(&buf, layout.string_pool_start, e0_off, e0_len),
        "#REF!"
    );

    // Cell 1: display="Another", error="#N/A"
    let cr1 = layout.cell_base(1);
    let d1_off = read_u32(&buf, cr1 + OFF_DISPLAY_OFF);
    let d1_len = read_u16(&buf, cr1 + OFF_DISPLAY_LEN);
    let e1_off = read_u32(&buf, cr1 + OFF_ERROR_OFF);
    let e1_len = read_u16(&buf, cr1 + OFF_ERROR_LEN);
    assert_eq!(
        read_string(&buf, layout.string_pool_start, d1_off, d1_len),
        "Another"
    );
    assert_eq!(
        read_string(&buf, layout.string_pool_start, e1_off, e1_len),
        "#N/A"
    );

    // Verify no overlaps: all offsets and lengths should be non-overlapping
    let ranges = [
        (d0_off, d0_len as u32),
        (e0_off, e0_len as u32),
        (d1_off, d1_len as u32),
        (e1_off, e1_len as u32),
    ];
    for i in 0..ranges.len() {
        for j in (i + 1)..ranges.len() {
            let (a_off, a_len) = ranges[i];
            let (b_off, b_len) = ranges[j];
            let a_end = a_off + a_len;
            let b_end = b_off + b_len;
            assert!(
                a_end <= b_off || b_end <= a_off,
                "string pool ranges overlap: [{}, {}) vs [{}, {})",
                a_off,
                a_end,
                b_off,
                b_end
            );
        }
    }
}
