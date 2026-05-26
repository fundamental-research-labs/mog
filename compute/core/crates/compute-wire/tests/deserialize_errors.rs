//! Explicit error-path tests for the viewport deserializer.
//!
//! Each test triggers a specific [`DeserializeError`] variant to ensure
//! the deserializer rejects malformed input correctly.

#![allow(clippy::pedantic, clippy::all, missing_docs)]

use compute_wire::constants::{CELL_STRIDE, MERGE_STRIDE, VIEWPORT_HEADER_SIZE};
use compute_wire::deserialize::{DeserializeError, deserialize_viewport};

/// Build a 36-byte viewport header with the given section counts.
fn make_header(
    cell_count: u32,
    string_pool_bytes: u32,
    palette_len: u32,
    merge_count: u16,
    row_dims: u16,
    col_dims: u16,
    vp_rows: u16,
    vp_cols: u16,
    data_bars: u16,
    icons: u16,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(36);
    buf.extend_from_slice(&0u32.to_le_bytes()); // start_row
    buf.extend_from_slice(&0u32.to_le_bytes()); // start_col
    buf.extend_from_slice(&cell_count.to_le_bytes());
    buf.extend_from_slice(&palette_len.to_le_bytes());
    buf.extend_from_slice(&string_pool_bytes.to_le_bytes());
    buf.extend_from_slice(&vp_rows.to_le_bytes());
    buf.extend_from_slice(&vp_cols.to_le_bytes());
    buf.extend_from_slice(&merge_count.to_le_bytes());
    buf.extend_from_slice(&row_dims.to_le_bytes());
    buf.extend_from_slice(&col_dims.to_le_bytes());
    buf.push(0x10); // flags: wire version 1 in bits 4-7
    buf.push(0); // generation
    buf.extend_from_slice(&data_bars.to_le_bytes());
    buf.extend_from_slice(&icons.to_le_bytes());
    assert_eq!(buf.len(), 36);
    buf
}

/// Build a minimal valid binary palette (0 formats).
fn make_empty_palette_binary() -> Vec<u8> {
    compute_wire::palette_binary::serialize_palette_binary(&[], 0)
}

/// Build a minimal valid viewport buffer (0 cells, 0 of everything, empty binary palette).
fn make_minimal_valid() -> Vec<u8> {
    let palette_bin = make_empty_palette_binary();
    let mut buf = make_header(
        0,                        // cell_count
        0,                        // string_pool_bytes
        palette_bin.len() as u32, // palette_len
        0,                        // merge_count
        0,                        // row_dims
        0,                        // col_dims
        0,                        // vp_rows
        0,                        // vp_cols
        0,                        // data_bars
        0,                        // icons
    );
    buf.extend_from_slice(&palette_bin);
    buf
}

#[test]
fn buffer_too_short_empty() {
    let result = deserialize_viewport(&[]);
    match result {
        Err(DeserializeError::BufferTooShort { expected, actual }) => {
            assert_eq!(expected, VIEWPORT_HEADER_SIZE);
            assert_eq!(actual, 0);
        }
        other => panic!("expected BufferTooShort, got {:?}", other),
    }
}

#[test]
fn buffer_too_short_partial_header() {
    let buf = vec![0u8; 20];
    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::BufferTooShort { expected, actual }) => {
            assert_eq!(expected, VIEWPORT_HEADER_SIZE);
            assert_eq!(actual, 20);
        }
        other => panic!("expected BufferTooShort, got {:?}", other),
    }
}

#[test]
fn section_out_of_bounds_cells() {
    // Header claims 1000 cells but no cell data follows.
    let buf = make_header(
        1000, // cell_count — requires 1000 * 32 = 32000 bytes of cell data
        0,    // string_pool_bytes
        0,    // palette_len
        0,    // merge_count
        0,    // row_dims
        0,    // col_dims
        0,    // vp_rows
        0,    // vp_cols
        0,    // data_bars
        0,    // icons
    );
    // buf is only 36 bytes (header), no cell data
    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::SectionOutOfBounds {
            section,
            end,
            buf_len,
        }) => {
            assert!(
                section.contains("cell"),
                "section should mention 'cell', got: {section}"
            );
            // Expected end = 36 + 1000*32 = 32036
            assert_eq!(end, VIEWPORT_HEADER_SIZE + 1000 * CELL_STRIDE);
            assert_eq!(buf_len, 36);
        }
        other => panic!("expected SectionOutOfBounds for cells, got {:?}", other),
    }
}

#[test]
fn section_out_of_bounds_merges() {
    // Build a buffer with 0 cells, 0 string pool, but merge_count = 1000
    // and no merge data.
    let buf = make_header(
        0,    // cell_count
        0,    // string_pool_bytes
        0,    // palette_len
        1000, // merge_count — requires 1000 * 16 = 16000 bytes
        0,    // row_dims
        0,    // col_dims
        0,    // vp_rows
        0,    // vp_cols
        0,    // data_bars
        0,    // icons
    );
    // After header: 0 cell bytes, 0 string pool bytes, then merges are checked.
    // But we have no merge data. We do NOT append palette here because merges come
    // before palette in the wire format: cells + string pool -> merges -> dims -> palette.
    // Wait, let me re-check the order from the deserializer...
    // Deserializer order: cells + string pool -> merges -> row dims -> col dims -> palette -> data bars -> icons -> positions
    // So merges come right after string pool, before palette.
    // The header has palette_len but it's written after dims in the buffer.
    // So we need: header (36) + 0 cell bytes + 0 string pool bytes = 36 total.
    // Then deserializer checks merge section at cursor=36 with merge_count=1000.
    // buf is only 36 bytes, so merge section end = 36 + 16000 = 16036 > 36.
    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::SectionOutOfBounds {
            section,
            end,
            buf_len,
        }) => {
            assert!(
                section.contains("merge"),
                "section should mention 'merge', got: {section}"
            );
            assert_eq!(end, VIEWPORT_HEADER_SIZE + 1000 * MERGE_STRIDE);
            assert_eq!(buf_len, 36);
        }
        other => panic!("expected SectionOutOfBounds for merges, got {:?}", other),
    }
}

#[test]
fn invalid_utf8_in_string_pool() {
    // Build a buffer with 1 cell that references a display string in the pool,
    // but put invalid UTF-8 bytes in the string pool.
    let invalid_utf8 = vec![0xFF, 0xFE];
    let string_pool_bytes = invalid_utf8.len() as u32;
    let palette_bin = make_empty_palette_binary();

    let mut buf = make_header(
        1,                        // cell_count
        string_pool_bytes,        // string_pool_bytes
        palette_bin.len() as u32, // palette_len
        0,                        // merge_count
        0,                        // row_dims
        0,                        // col_dims
        0,                        // vp_rows
        0,                        // vp_cols
        0,                        // data_bars
        0,                        // icons
    );

    // Write one cell record (32 bytes):
    // number_value (f64) = 0.0
    buf.extend_from_slice(&0.0f64.to_le_bytes());
    // display_off (u32) = 0 (points to start of string pool)
    buf.extend_from_slice(&0u32.to_le_bytes());
    // error_off (u32) = 0xFFFFFFFF (NO_STRING)
    buf.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    // flags (u16) = 0
    buf.extend_from_slice(&0u16.to_le_bytes());
    // format_idx (u16) = 0
    buf.extend_from_slice(&0u16.to_le_bytes());
    // display_len (u16) = 2
    buf.extend_from_slice(&(invalid_utf8.len() as u16).to_le_bytes());
    // error_len (u16) = 0
    buf.extend_from_slice(&0u16.to_le_bytes());
    // bg_color_override (u32) = 0
    buf.extend_from_slice(&0u32.to_le_bytes());
    // font_color_override (u32) = 0
    buf.extend_from_slice(&0u32.to_le_bytes());

    // String pool with invalid UTF-8
    buf.extend_from_slice(&invalid_utf8);

    // Merge records (0), row dims (0), col dims (0) — nothing to write.
    // Palette binary
    buf.extend_from_slice(&palette_bin);

    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::InvalidUtf8 { section }) => {
            assert!(
                section.contains("display") || section.contains("string"),
                "section should mention 'display' or 'string', got: {section}"
            );
        }
        other => panic!("expected InvalidUtf8 for display string, got {:?}", other),
    }
}

#[test]
fn invalid_palette_binary() {
    // Build a buffer with 0 cells, 0 merges, 0 dims, but invalid bytes in the palette slot.
    let invalid_palette = vec![0xFF, 0xFE, 0xFD];
    let mut buf = make_header(
        0,                            // cell_count
        0,                            // string_pool_bytes
        invalid_palette.len() as u32, // palette_len
        0,                            // merge_count
        0,                            // row_dims
        0,                            // col_dims
        0,                            // vp_rows
        0,                            // vp_cols
        0,                            // data_bars
        0,                            // icons
    );
    // No cells, no string pool, no merges, no dims.
    // Palette section (invalid binary):
    buf.extend_from_slice(&invalid_palette);

    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::InvalidUtf8 { section }) => {
            assert!(
                section.contains("palette"),
                "section should mention 'palette', got: {section}"
            );
        }
        other => panic!("expected InvalidUtf8 for palette binary, got {:?}", other),
    }
}

#[test]
fn trailing_bytes() {
    // Build a fully valid minimal viewport buffer and append extra bytes.
    let mut buf = make_minimal_valid();
    let expected_len = buf.len();
    // Append trailing garbage
    buf.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);

    let result = deserialize_viewport(&buf);
    match result {
        Err(DeserializeError::TrailingBytes { expected, actual }) => {
            assert_eq!(expected, expected_len);
            assert_eq!(actual, expected_len + 4);
        }
        other => panic!("expected TrailingBytes, got {:?}", other),
    }
}
