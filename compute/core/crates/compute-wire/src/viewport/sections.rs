//! Byte-section writers for viewport binary serialization.

use crate::constants::{CELL_STRIDE, VIEWPORT_HEADER_SIZE as HEADER_SIZE};
use crate::types::{
    DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension, RenderViewportMerge,
};

use super::records::{ViewportCellRecord, ViewportHeader};

/// Write a [`ViewportHeader`] as 36 little-endian bytes to `buf`.
pub(super) fn write_viewport_header(buf: &mut Vec<u8>, header: &ViewportHeader) {
    buf.extend_from_slice(&header.start_row.to_le_bytes());
    buf.extend_from_slice(&header.start_col.to_le_bytes());
    buf.extend_from_slice(&header.cell_count.to_le_bytes());
    buf.extend_from_slice(&header.format_palette_len.to_le_bytes());
    buf.extend_from_slice(&header.string_pool_bytes.to_le_bytes());
    buf.extend_from_slice(&header.viewport_rows.to_le_bytes());
    buf.extend_from_slice(&header.viewport_cols.to_le_bytes());
    buf.extend_from_slice(&header.merge_count.to_le_bytes());
    buf.extend_from_slice(&header.row_dim_count.to_le_bytes());
    buf.extend_from_slice(&header.col_dim_count.to_le_bytes());
    buf.push(header.flags);
    buf.push(header.generation);
    buf.extend_from_slice(&header.data_bar_count.to_le_bytes());
    buf.extend_from_slice(&header.icon_count.to_le_bytes());

    debug_assert_eq!(buf.len(), HEADER_SIZE);
}

/// Write `N x 32`-byte cell records to `buf`.
///
/// Each record is assembled into a `[u8; CELL_STRIDE]` array first, then
/// written in a single `extend_from_slice` call per cell.
pub(super) fn write_cell_records(buf: &mut Vec<u8>, records: &[ViewportCellRecord]) {
    for r in records {
        let mut rec = [0u8; CELL_STRIDE];
        rec[0..8].copy_from_slice(&r.number_value.to_le_bytes());
        rec[8..12].copy_from_slice(&r.display_off.to_le_bytes());
        rec[12..16].copy_from_slice(&r.error_off.to_le_bytes());
        rec[16..18].copy_from_slice(&r.flags.to_le_bytes());
        rec[18..20].copy_from_slice(&r.format_idx.to_le_bytes());
        rec[20..22].copy_from_slice(&r.display_len.to_le_bytes());
        rec[22..24].copy_from_slice(&r.error_len.to_le_bytes());
        rec[24..28].copy_from_slice(&r.bg_color_override.to_le_bytes());
        rec[28..32].copy_from_slice(&r.font_color_override.to_le_bytes());
        buf.extend_from_slice(&rec);
    }
}

/// Write `M x 16`-byte merge records to `buf`.
pub(super) fn write_merge_records(buf: &mut Vec<u8>, merges: &[RenderViewportMerge]) {
    for m in merges {
        buf.extend_from_slice(&m.start_row.to_le_bytes());
        buf.extend_from_slice(&m.start_col.to_le_bytes());
        buf.extend_from_slice(&m.end_row.to_le_bytes());
        buf.extend_from_slice(&m.end_col.to_le_bytes());
    }
}

/// Write row dimension records (12 bytes each) to `buf`.
pub(super) fn write_row_dimensions(buf: &mut Vec<u8>, dims: &[RenderRowDimension]) {
    for d in dims {
        buf.extend_from_slice(&d.row.to_le_bytes());
        buf.extend_from_slice(&d.height.to_le_bytes());
        buf.extend_from_slice(&u32::from(d.hidden).to_le_bytes());
    }
}

/// Write column dimension records (12 bytes each) to `buf`.
pub(super) fn write_col_dimensions(buf: &mut Vec<u8>, dims: &[RenderColDimension]) {
    for d in dims {
        buf.extend_from_slice(&d.col.to_le_bytes());
        buf.extend_from_slice(&d.width.to_le_bytes());
        buf.extend_from_slice(&u32::from(d.hidden).to_le_bytes());
    }
}

/// Write sparse data bar entries (24 bytes each) to `buf`.
pub(super) fn write_data_bar_entries(buf: &mut Vec<u8>, entries: &[(u32, &DataBarRenderData)]) {
    for &(cell_index, db) in entries {
        buf.extend_from_slice(&cell_index.to_le_bytes());
        buf.extend_from_slice(&db.fill_percent.to_le_bytes());
        buf.extend_from_slice(&db.color.to_le_bytes());
        let flags: u32 = u32::from(db.gradient)
            | (u32::from(db.is_negative) << 1)
            | (u32::from(db.show_value) << 2)
            | (u32::from(db.show_axis) << 3);
        buf.extend_from_slice(&flags.to_le_bytes());
        buf.extend_from_slice(&db.axis_position.to_le_bytes());
        buf.extend_from_slice(&db.negative_color.to_le_bytes());
    }
}

/// Write sparse icon entries (8 bytes each) to `buf`.
pub(super) fn write_icon_entries(buf: &mut Vec<u8>, entries: &[(u32, &IconRenderData)]) {
    for &(cell_index, icon) in entries {
        buf.extend_from_slice(&cell_index.to_le_bytes());
        buf.push(icon.set_name_index);
        buf.push(icon.icon_index);
        buf.push(u8::from(icon.icon_only));
        buf.push(0u8); // padding
    }
}

/// Write row and column pixel-position arrays (f64 LE each) to `buf`.
pub(super) fn write_position_arrays(
    buf: &mut Vec<u8>,
    row_positions: &[f64],
    col_positions: &[f64],
) {
    write_f64_array(buf, row_positions);
    write_f64_array(buf, col_positions);
}

/// Write an f64 slice as little-endian bytes, batching into chunks of 32 values.
fn write_f64_array(buf: &mut Vec<u8>, values: &[f64]) {
    const BATCH: usize = 32;
    let mut batch_buf = [0u8; BATCH * 8];
    let mut i = 0;
    while i + BATCH <= values.len() {
        for j in 0..BATCH {
            batch_buf[j * 8..(j + 1) * 8].copy_from_slice(&values[i + j].to_le_bytes());
        }
        buf.extend_from_slice(&batch_buf);
        i += BATCH;
    }
    for &pos in &values[i..] {
        buf.extend_from_slice(&pos.to_le_bytes());
    }
}
