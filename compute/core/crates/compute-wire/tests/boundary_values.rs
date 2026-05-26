//! Boundary value tests for the viewport wire format.
//!
//! Tests clamping, truncation, and capacity limits at u16 boundaries.

#![allow(clippy::pedantic, clippy::all, missing_docs)]

use compute_wire::deserialize::deserialize_viewport;
use compute_wire::types::{ViewportRenderCell, ViewportRenderData};
use compute_wire::viewport::serialize_viewport_binary;
use compute_wire::{FormatPalette, PaletteFullError};
use domain_types::CellFormat;

/// Read a little-endian u16 from a buffer.
fn read_u16(buf: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([buf[off], buf[off + 1]])
}

/// Build a minimal `ViewportRenderData` with the given viewport dimensions and no cells.
fn make_empty_viewport(viewport_rows: u32, viewport_cols: u32) -> ViewportRenderData {
    ViewportRenderData {
        cells: vec![],
        format_palette: vec![],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows,
        viewport_cols,
        start_row: 0,
        start_col: 0,
        row_positions: vec![],
        col_positions: vec![],
    }
}

#[test]
fn viewport_rows_exceeding_u16_max() {
    let data = make_empty_viewport(u32::from(u16::MAX) + 1, 1);
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    // viewport_rows is at offset 20 in the header.
    let rows = read_u16(&buf, 20);
    assert_eq!(
        rows,
        u16::MAX,
        "viewport_rows should be clamped to u16::MAX"
    );
}

#[test]
fn viewport_cols_exceeding_u16_max() {
    let data = make_empty_viewport(1, u32::from(u16::MAX) + 1);
    let buf = serialize_viewport_binary(&data, 0, false, 0);

    // viewport_cols is at offset 22 in the header.
    let cols = read_u16(&buf, 22);
    assert_eq!(
        cols,
        u16::MAX,
        "viewport_cols should be clamped to u16::MAX"
    );
}

#[test]
fn string_at_u16_max_boundary() {
    // Create a cell with a formatted string of exactly u16::MAX (65535) bytes.
    let display_str = "a".repeat(u16::MAX as usize);
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: 0,
            number_value: f64::NAN,
            formatted: Some(display_str.clone()),
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }],
        format_palette: vec![CellFormat::default()],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        // Length = viewport_{rows,cols} + 1 (1 entry + 1 sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let vp = deserialize_viewport(&buf).expect("should deserialize successfully");

    assert_eq!(vp.cells.len(), 1);
    let cell_display = vp.cells[0]
        .display
        .as_ref()
        .expect("should have display string");
    assert_eq!(
        cell_display.len(),
        u16::MAX as usize,
        "display string should survive roundtrip at exactly u16::MAX bytes"
    );
    assert_eq!(cell_display, &display_str);
}

#[test]
fn string_exceeding_u16_max_truncated() {
    // Create a cell with a formatted string longer than u16::MAX bytes.
    let display_str = "a".repeat(66000);
    let data = ViewportRenderData {
        cells: vec![ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 0,
            flags: 0,
            number_value: f64::NAN,
            formatted: Some(display_str),
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }],
        format_palette: vec![CellFormat::default()],
        merges: vec![],
        row_dimensions: vec![],
        col_dimensions: vec![],
        viewport_rows: 1,
        viewport_cols: 1,
        start_row: 0,
        start_col: 0,
        // Length = viewport_{rows,cols} + 1 (1 entry + 1 sentinel).
        row_positions: vec![0.0, 21.0],
        col_positions: vec![0.0, 64.0],
    };

    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let vp = deserialize_viewport(&buf).expect("should deserialize successfully");

    assert_eq!(vp.cells.len(), 1);
    let cell_display = vp.cells[0]
        .display
        .as_ref()
        .expect("should have display string");
    assert!(
        cell_display.len() <= u16::MAX as usize,
        "display string should be truncated to at most u16::MAX bytes, got {}",
        cell_display.len()
    );
}

#[test]
fn palette_near_capacity() {
    let mut palette = FormatPalette::new();

    // Intern u16::MAX - 1 (65534) unique formats.
    // Use font_size with unique millipoint values to create distinct formats.
    for i in 0..u16::MAX - 1 {
        let fmt = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(u32::from(i) + 1)),
            ..Default::default()
        };
        let result = palette.intern(&fmt);
        assert!(
            result.is_ok(),
            "intern should succeed for format #{i}, got {:?}",
            result
        );
    }
    assert_eq!(palette.len(), (u16::MAX - 1) as usize);

    // Intern one more to reach exactly u16::MAX - 1 formats (index u16::MAX - 2 is the last).
    // Actually palette.len() is now 65534. u16::MAX is 65535, and the check is len >= u16::MAX.
    // So we can intern one more (len becomes 65535 = u16::MAX), then the NEXT one should fail.
    let fmt_last = CellFormat {
        font_size: Some(domain_types::FontSize::from_millipoints(u32::from(
            u16::MAX,
        ))),
        ..Default::default()
    };
    // This brings len to u16::MAX (65535). The guard is `len >= u16::MAX as usize` which
    // means it returns Err when len >= 65535. Let's check what actually happens.
    // From the source: `if len >= u16::MAX as usize { return Err(PaletteFullError); }`
    // So at len=65534, intern succeeds (idx=65534). At len=65535, intern would fail.
    // Wait, the check is `len >= u16::MAX as usize` where u16::MAX = 65535.
    // At len=65534: 65534 >= 65535 is false, so it succeeds. idx = 65534.
    // Now len=65535. Next intern: 65535 >= 65535 is true, so Err.
    let result = palette.intern(&fmt_last);
    assert!(result.is_ok(), "should succeed at index 65534");
    assert_eq!(palette.len(), u16::MAX as usize);

    // Now try one more — should fail with PaletteFullError.
    let fmt_overflow = CellFormat {
        font_size: Some(domain_types::FontSize::from_millipoints(
            u32::from(u16::MAX) + 1,
        )),
        ..Default::default()
    };
    let result = palette.intern(&fmt_overflow);
    assert!(
        matches!(result, Err(PaletteFullError)),
        "expected PaletteFullError when palette is full, got {:?}",
        result
    );
}
