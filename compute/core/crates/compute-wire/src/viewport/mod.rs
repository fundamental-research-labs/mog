//! Binary serializer for viewport render data.
//!
//! Converts [`ViewportRenderData`] into a compact `Vec<u8>` following the
//! Viewport Binary Transfer Protocol. The resulting blob is sent directly to
//! the TypeScript renderer as a `Uint8Array`.
//!
//! # Wire Layout (all little-endian)
//!
//! ```text
//! [Header 36 B] [CellRecords N x 32 B] [StringPool] [Merges M x 16 B]
//! [RowDims R x 12 B] [ColDims C x 12 B] [FormatPalette(binary)]
//! [DataBars D x 24 B] [Icons I x 8 B]
//! [RowPositions R x 8 B] [ColPositions C x 8 B]
//! ```

mod cells;
mod records;
mod sections;
mod string_pool;

#[cfg(test)]
mod tests;

use crate::constants::{
    CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE,
    POSITION_ENTRY_SIZE, VIEWPORT_HEADER_SIZE as HEADER_SIZE, WIRE_VERSION,
};
use crate::types::ViewportRenderData;

use cells::build_string_pool_and_records;
pub use records::{ViewportCellRecord, ViewportHeader};
use sections::{
    write_cell_records, write_col_dimensions, write_data_bar_entries, write_icon_entries,
    write_merge_records, write_position_arrays, write_row_dimensions, write_viewport_header,
};
pub(crate) use string_pool::{intern_optional_string, intern_str};

/// Serialize viewport render data into a compact binary blob.
///
/// # Arguments
/// - `data` - The viewport render data produced by `build_viewport_render_data()`.
/// - `generation` - Monotonic counter so the consumer can detect stale buffers.
/// - `is_delta` - Whether this is a delta (incremental) response.
/// - `palette_start_index` - 0 for full responses; N for deltas (only new entries).
///
/// # Returns
/// A `Vec<u8>` containing the binary blob ready for transfer to TypeScript.
///
/// # Wire version
///
/// The header flags byte embeds [`WIRE_VERSION`] in bits 4-7. TypeScript
/// decoders should validate this matches before reading the buffer.
#[must_use]
#[allow(clippy::cast_possible_truncation)] // counts clamped to protocol bounds
pub fn serialize_viewport_binary(
    data: &ViewportRenderData,
    generation: u8,
    is_delta: bool,
    palette_start_index: u16,
) -> Vec<u8> {
    let build = build_string_pool_and_records(&data.cells);
    let palette_bytes =
        crate::palette_binary::serialize_palette_binary(&data.format_palette, palette_start_index);

    let cell_count = build.cell_records.len();
    let total_size = serialized_viewport_size(data, cell_count, &build, palette_bytes.len());

    debug_assert!(u32::try_from(cell_count).is_ok(), "cell count exceeds u32");
    debug_assert!(
        u16::try_from(data.merges.len()).is_ok(),
        "merge count exceeds u16"
    );
    debug_assert!(
        u16::try_from(data.row_dimensions.len()).is_ok(),
        "row dimension count exceeds u16"
    );
    debug_assert!(
        u16::try_from(data.col_dimensions.len()).is_ok(),
        "col dimension count exceeds u16"
    );
    debug_assert!(
        u32::try_from(palette_bytes.len()).is_ok(),
        "palette JSON exceeds u32"
    );
    debug_assert!(
        u32::try_from(build.string_pool.len()).is_ok(),
        "string pool exceeds u32"
    );
    debug_assert!(
        u16::try_from(build.data_bar_entries.len()).is_ok(),
        "data bar count exceeds u16"
    );
    debug_assert!(
        u16::try_from(build.icon_entries.len()).is_ok(),
        "icon count exceeds u16"
    );

    let mut buf = Vec::with_capacity(total_size);

    let rows_u16 = data.viewport_rows.min(u32::from(u16::MAX)) as u16;
    let cols_u16 = data.viewport_cols.min(u32::from(u16::MAX)) as u16;
    write_viewport_header(
        &mut buf,
        &ViewportHeader {
            start_row: data.start_row,
            start_col: data.start_col,
            cell_count: cell_count as u32,
            format_palette_len: palette_bytes.len() as u32,
            string_pool_bytes: build.string_pool.len() as u32,
            viewport_rows: rows_u16,
            viewport_cols: cols_u16,
            merge_count: data.merges.len() as u16,
            row_dim_count: data.row_dimensions.len() as u16,
            col_dim_count: data.col_dimensions.len() as u16,
            flags: u8::from(is_delta) | (WIRE_VERSION << 4),
            generation,
            data_bar_count: build.data_bar_entries.len() as u16,
            icon_count: build.icon_entries.len() as u16,
        },
    );

    write_cell_records(&mut buf, &build.cell_records);
    buf.extend_from_slice(&build.string_pool);
    write_merge_records(&mut buf, &data.merges);
    write_row_dimensions(&mut buf, &data.row_dimensions);
    write_col_dimensions(&mut buf, &data.col_dimensions);
    buf.extend_from_slice(&palette_bytes);
    write_data_bar_entries(&mut buf, &build.data_bar_entries);
    write_icon_entries(&mut buf, &build.icon_entries);
    write_position_arrays(&mut buf, &data.row_positions, &data.col_positions);

    debug_assert_eq!(buf.len(), total_size);
    buf
}

fn serialized_viewport_size(
    data: &ViewportRenderData,
    cell_count: usize,
    build: &cells::CellBuildResult<'_>,
    palette_len: usize,
) -> usize {
    HEADER_SIZE
        + cell_count * CELL_STRIDE
        + build.string_pool.len()
        + data.merges.len() * MERGE_STRIDE
        + data.row_dimensions.len() * DIM_STRIDE
        + data.col_dimensions.len() * DIM_STRIDE
        + palette_len
        + build.data_bar_entries.len() * DATA_BAR_ENTRY_STRIDE
        + build.icon_entries.len() * ICON_ENTRY_STRIDE
        + data.row_positions.len() * POSITION_ENTRY_SIZE
        + data.col_positions.len() * POSITION_ENTRY_SIZE
}
