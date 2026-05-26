//! Test-only binary deserializer for the viewport wire format.
//!
//! Used exclusively by property-based roundtrip tests. NOT part of the
//! public API -- the real consumer is TypeScript via DataView.

#![allow(missing_docs, clippy::pedantic, dead_code)]

use crate::constants::{
    CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE, NO_STRING,
    POSITION_ENTRY_SIZE, VIEWPORT_HEADER_SIZE,
};

// ---------------------------------------------------------------------------
// Deserialized types (parallel to the real types, test-only)
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct DeserializedViewport {
    pub start_row: u32,
    pub start_col: u32,
    pub cell_count: u32,
    pub viewport_rows: u16,
    pub viewport_cols: u16,
    pub generation: u8,
    pub is_delta: bool,
    pub wire_version: u8,
    pub cells: Vec<DeserializedCell>,
    pub merges: Vec<DeserializedMerge>,
    pub row_dims: Vec<DeserializedRowDim>,
    pub col_dims: Vec<DeserializedColDim>,
    pub palette_start_index: u16,
    pub palette_formats: Vec<domain_types::CellFormat>,
    pub data_bars: Vec<DeserializedDataBar>,
    pub icons: Vec<DeserializedIcon>,
    pub row_positions: Vec<f64>,
    pub col_positions: Vec<f64>,
}

#[derive(Debug)]
pub struct DeserializedCell {
    pub number_value: f64,
    pub display: Option<String>,
    pub error: Option<String>,
    pub flags: u16,
    pub format_idx: u16,
    pub bg_color_override: u32,
    pub font_color_override: u32,
}

#[derive(Debug)]
pub struct DeserializedMerge {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

#[derive(Debug)]
pub struct DeserializedRowDim {
    pub row: u32,
    pub height: f32,
    pub hidden: bool,
}

#[derive(Debug)]
pub struct DeserializedColDim {
    pub col: u32,
    pub width: f32,
    pub hidden: bool,
}

#[derive(Debug)]
pub struct DeserializedDataBar {
    pub cell_index: u32,
    pub fill_percent: f32,
    pub color: u32,
    pub gradient: bool,
    pub is_negative: bool,
    pub show_value: bool,
    pub show_axis: bool,
    pub axis_position: f32,
    pub negative_color: u32,
}

#[derive(Debug)]
pub struct DeserializedIcon {
    pub cell_index: u32,
    pub set_name_index: u8,
    pub icon_index: u8,
    pub icon_only: bool,
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Errors that can occur when deserializing a viewport binary buffer.
#[derive(Debug, Clone)]
pub enum DeserializeError {
    /// Buffer is shorter than the minimum required size.
    BufferTooShort { expected: usize, actual: usize },
    /// A section extends beyond the buffer boundary.
    SectionOutOfBounds {
        section: &'static str,
        end: usize,
        buf_len: usize,
    },
    /// A string in the pool is not valid UTF-8.
    InvalidUtf8 { section: &'static str },
    /// An arithmetic overflow occurred during size calculation.
    Overflow,
    /// Buffer has unexpected trailing bytes.
    TrailingBytes { expected: usize, actual: usize },
}

impl std::fmt::Display for DeserializeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BufferTooShort { expected, actual } => {
                write!(
                    f,
                    "buffer too short: expected at least {expected} bytes, got {actual}"
                )
            }
            Self::SectionOutOfBounds {
                section,
                end,
                buf_len,
            } => {
                write!(
                    f,
                    "{section} section extends to byte {end}, but buffer is only {buf_len} bytes"
                )
            }
            Self::InvalidUtf8 { section } => {
                write!(f, "invalid UTF-8 in {section}")
            }
            Self::Overflow => write!(f, "arithmetic overflow in size calculation"),
            Self::TrailingBytes { expected, actual } => {
                write!(
                    f,
                    "expected {expected} bytes total, but buffer has {actual}"
                )
            }
        }
    }
}

impl std::error::Error for DeserializeError {}

// ---------------------------------------------------------------------------
// Byte-reading helpers
// ---------------------------------------------------------------------------

fn read_u8(buf: &[u8], off: usize) -> Result<u8, ()> {
    buf.get(off).copied().ok_or(())
}

fn read_u16(buf: &[u8], off: usize) -> Result<u16, ()> {
    buf.get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or(())
}

fn read_u32(buf: &[u8], off: usize) -> Result<u32, ()> {
    buf.get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or(())
}

fn read_f32(buf: &[u8], off: usize) -> Result<f32, ()> {
    buf.get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .map(f32::from_le_bytes)
        .ok_or(())
}

fn read_f64(buf: &[u8], off: usize) -> Result<f64, ()> {
    buf.get(off..off + 8)
        .and_then(|s| s.try_into().ok())
        .map(f64::from_le_bytes)
        .ok_or(())
}

fn check_section(
    buf: &[u8],
    cursor: usize,
    count: usize,
    stride: usize,
    section: &'static str,
) -> Result<usize, DeserializeError> {
    let section_size = count
        .checked_mul(stride)
        .ok_or(DeserializeError::Overflow)?;
    let end = cursor
        .checked_add(section_size)
        .ok_or(DeserializeError::Overflow)?;
    if end > buf.len() {
        return Err(DeserializeError::SectionOutOfBounds {
            section,
            end,
            buf_len: buf.len(),
        });
    }
    Ok(end)
}

// ---------------------------------------------------------------------------
// Deserializer
// ---------------------------------------------------------------------------

pub fn deserialize_viewport(buf: &[u8]) -> Result<DeserializedViewport, DeserializeError> {
    if buf.len() < VIEWPORT_HEADER_SIZE {
        return Err(DeserializeError::BufferTooShort {
            expected: VIEWPORT_HEADER_SIZE,
            actual: buf.len(),
        });
    }

    // --- Header (36 bytes) ---
    let hdr_err = |()| DeserializeError::BufferTooShort {
        expected: VIEWPORT_HEADER_SIZE,
        actual: buf.len(),
    };
    let start_row = read_u32(buf, 0).map_err(hdr_err)?;
    let start_col = read_u32(buf, 4).map_err(hdr_err)?;
    let cell_count = read_u32(buf, 8).map_err(hdr_err)?;
    let format_palette_len = read_u32(buf, 12).map_err(hdr_err)?;
    let string_pool_bytes = read_u32(buf, 16).map_err(hdr_err)?;
    let viewport_rows = read_u16(buf, 20).map_err(hdr_err)?;
    let viewport_cols = read_u16(buf, 22).map_err(hdr_err)?;
    let merge_count = read_u16(buf, 24).map_err(hdr_err)?;
    let row_dim_count = read_u16(buf, 26).map_err(hdr_err)?;
    let col_dim_count = read_u16(buf, 28).map_err(hdr_err)?;
    let flags_byte = read_u8(buf, 30).map_err(hdr_err)?;
    let generation = read_u8(buf, 31).map_err(hdr_err)?;
    let data_bar_count = read_u16(buf, 32).map_err(hdr_err)?;
    let icon_count = read_u16(buf, 34).map_err(hdr_err)?;

    let is_delta = (flags_byte & 1) != 0;
    let wire_version = flags_byte >> 4;

    // --- Cursor tracking ---
    let mut cursor = VIEWPORT_HEADER_SIZE;

    // --- Cell records (N x 32 bytes) + String pool ---
    let cell_section_size = (cell_count as usize)
        .checked_mul(CELL_STRIDE)
        .ok_or(DeserializeError::Overflow)?;
    let cell_records_end = cursor
        .checked_add(cell_section_size)
        .ok_or(DeserializeError::Overflow)?;
    let string_pool_start = cell_records_end;
    let string_pool_end = string_pool_start
        .checked_add(string_pool_bytes as usize)
        .ok_or(DeserializeError::Overflow)?;
    if string_pool_end > buf.len() {
        return Err(DeserializeError::SectionOutOfBounds {
            section: "cell records + string pool",
            end: string_pool_end,
            buf_len: buf.len(),
        });
    }
    let string_pool = &buf[string_pool_start..string_pool_end];

    // Parse cells
    let cell_err = |()| DeserializeError::SectionOutOfBounds {
        section: "cell records",
        end: cell_records_end,
        buf_len: buf.len(),
    };
    let mut cells = Vec::with_capacity(cell_count as usize);
    for i in 0..cell_count as usize {
        let base = cursor + i * CELL_STRIDE;
        let number_value = read_f64(buf, base).map_err(cell_err)?;
        let display_off = read_u32(buf, base + 8).map_err(cell_err)?;
        let error_off = read_u32(buf, base + 12).map_err(cell_err)?;
        let flags = read_u16(buf, base + 16).map_err(cell_err)?;
        let format_idx = read_u16(buf, base + 18).map_err(cell_err)?;
        let display_len = read_u16(buf, base + 20).map_err(cell_err)?;
        let error_len = read_u16(buf, base + 22).map_err(cell_err)?;
        let bg_color_override = read_u32(buf, base + 24).map_err(cell_err)?;
        let font_color_override = read_u32(buf, base + 28).map_err(cell_err)?;

        let display = if display_off == NO_STRING {
            None
        } else {
            let display_off_usize = display_off as usize;
            let display_len_usize = display_len as usize;
            let end = display_off_usize
                .checked_add(display_len_usize)
                .ok_or(DeserializeError::Overflow)?;
            if display_off_usize > string_pool.len() || end > string_pool.len() {
                return Err(DeserializeError::SectionOutOfBounds {
                    section: "display string pool",
                    end,
                    buf_len: string_pool.len(),
                });
            }
            let s = &string_pool[display_off_usize..end];
            Some(
                String::from_utf8(s.to_vec()).map_err(|_| DeserializeError::InvalidUtf8 {
                    section: "display string",
                })?,
            )
        };

        let error = if error_off == NO_STRING {
            None
        } else {
            let error_off_usize = error_off as usize;
            let error_len_usize = error_len as usize;
            let end = error_off_usize
                .checked_add(error_len_usize)
                .ok_or(DeserializeError::Overflow)?;
            if error_off_usize > string_pool.len() || end > string_pool.len() {
                return Err(DeserializeError::SectionOutOfBounds {
                    section: "error string pool",
                    end,
                    buf_len: string_pool.len(),
                });
            }
            let s = &string_pool[error_off_usize..end];
            Some(
                String::from_utf8(s.to_vec()).map_err(|_| DeserializeError::InvalidUtf8 {
                    section: "error string",
                })?,
            )
        };

        cells.push(DeserializedCell {
            number_value,
            display,
            error,
            flags,
            format_idx,
            bg_color_override,
            font_color_override,
        });
    }

    cursor = string_pool_end;

    // --- Merge records (M x 16 bytes) ---
    let merge_section_end = check_section(
        buf,
        cursor,
        merge_count as usize,
        MERGE_STRIDE,
        "merge records",
    )?;
    let bl = buf.len();
    let merge_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "merge records",
        end: merge_section_end,
        buf_len: bl,
    };
    let mut merges = Vec::with_capacity(merge_count as usize);
    for _ in 0..merge_count {
        merges.push(DeserializedMerge {
            start_row: read_u32(buf, cursor).map_err(merge_err)?,
            start_col: read_u32(buf, cursor + 4).map_err(merge_err)?,
            end_row: read_u32(buf, cursor + 8).map_err(merge_err)?,
            end_col: read_u32(buf, cursor + 12).map_err(merge_err)?,
        });
        cursor += MERGE_STRIDE;
    }

    // --- Row dimensions (R x 12 bytes) ---
    let row_dim_section_end = check_section(
        buf,
        cursor,
        row_dim_count as usize,
        DIM_STRIDE,
        "row dimensions",
    )?;
    let bl = buf.len();
    let row_dim_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "row dimensions",
        end: row_dim_section_end,
        buf_len: bl,
    };
    let mut row_dims = Vec::with_capacity(row_dim_count as usize);
    for _ in 0..row_dim_count {
        row_dims.push(DeserializedRowDim {
            row: read_u32(buf, cursor).map_err(row_dim_err)?,
            height: read_f32(buf, cursor + 4).map_err(row_dim_err)?,
            hidden: read_u32(buf, cursor + 8).map_err(row_dim_err)? != 0,
        });
        cursor += DIM_STRIDE;
    }

    // --- Col dimensions (C x 12 bytes) ---
    let col_dim_section_end = check_section(
        buf,
        cursor,
        col_dim_count as usize,
        DIM_STRIDE,
        "col dimensions",
    )?;
    let bl = buf.len();
    let col_dim_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "col dimensions",
        end: col_dim_section_end,
        buf_len: bl,
    };
    let mut col_dims = Vec::with_capacity(col_dim_count as usize);
    for _ in 0..col_dim_count {
        col_dims.push(DeserializedColDim {
            col: read_u32(buf, cursor).map_err(col_dim_err)?,
            width: read_f32(buf, cursor + 4).map_err(col_dim_err)?,
            hidden: read_u32(buf, cursor + 8).map_err(col_dim_err)? != 0,
        });
        cursor += DIM_STRIDE;
    }

    // --- Format palette (binary) ---
    let palette_end = check_section(
        buf,
        cursor,
        1,
        format_palette_len as usize,
        "format palette",
    )?;
    let palette_slice = &buf[cursor..palette_end];
    let (palette_start_index, palette_formats) = if palette_slice.is_empty() {
        (0u16, Vec::new())
    } else {
        crate::palette_binary::deserialize_palette_binary(palette_slice).map_err(|_| {
            DeserializeError::InvalidUtf8 {
                section: "palette binary",
            }
        })?
    };
    cursor = palette_end;

    // --- Data bar entries (D x 24 bytes) ---
    let data_bar_section_end = check_section(
        buf,
        cursor,
        data_bar_count as usize,
        DATA_BAR_ENTRY_STRIDE,
        "data bar entries",
    )?;
    let bl = buf.len();
    let data_bar_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "data bar entries",
        end: data_bar_section_end,
        buf_len: bl,
    };
    let mut data_bars = Vec::with_capacity(data_bar_count as usize);
    for _ in 0..data_bar_count {
        let cell_index = read_u32(buf, cursor).map_err(data_bar_err)?;
        let fill_percent = read_f32(buf, cursor + 4).map_err(data_bar_err)?;
        let color = read_u32(buf, cursor + 8).map_err(data_bar_err)?;
        let flags_u32 = read_u32(buf, cursor + 12).map_err(data_bar_err)?;
        let gradient = (flags_u32 & 1) != 0;
        let is_negative = (flags_u32 & 2) != 0;
        let show_value = (flags_u32 & 4) != 0;
        let show_axis = (flags_u32 & 8) != 0;
        let axis_position = read_f32(buf, cursor + 16).map_err(data_bar_err)?;
        let negative_color = read_u32(buf, cursor + 20).map_err(data_bar_err)?;

        data_bars.push(DeserializedDataBar {
            cell_index,
            fill_percent,
            color,
            gradient,
            is_negative,
            show_value,
            show_axis,
            axis_position,
            negative_color,
        });
        cursor += DATA_BAR_ENTRY_STRIDE;
    }

    // --- Icon entries (I x 8 bytes) ---
    let icon_section_end = check_section(
        buf,
        cursor,
        icon_count as usize,
        ICON_ENTRY_STRIDE,
        "icon entries",
    )?;
    let bl = buf.len();
    let icon_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "icon entries",
        end: icon_section_end,
        buf_len: bl,
    };
    let mut icons = Vec::with_capacity(icon_count as usize);
    for _ in 0..icon_count {
        let cell_index = read_u32(buf, cursor).map_err(icon_err)?;
        let set_name_index = read_u8(buf, cursor + 4).map_err(icon_err)?;
        let icon_index = read_u8(buf, cursor + 5).map_err(icon_err)?;
        let icon_only = read_u8(buf, cursor + 6).map_err(icon_err)? != 0;
        // cursor + 7 is padding
        icons.push(DeserializedIcon {
            cell_index,
            set_name_index,
            icon_index,
            icon_only,
        });
        cursor += ICON_ENTRY_STRIDE;
    }

    // --- Row positions ((R+1) x 8 bytes, f64; 0 entries when R==0) ---
    // Length = viewport_rows + 1 for non-empty viewports (the +1 is a trailing
    // sentinel: top edge of the row after the range, used to derive the height
    // of the last in-range row).
    let row_pos_count = if viewport_rows > 0 {
        viewport_rows as usize + 1
    } else {
        0
    };
    let row_pos_section_end = check_section(
        buf,
        cursor,
        row_pos_count,
        POSITION_ENTRY_SIZE,
        "row positions",
    )?;
    let bl = buf.len();
    let row_pos_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "row positions",
        end: row_pos_section_end,
        buf_len: bl,
    };
    let mut row_positions = Vec::with_capacity(row_pos_count);
    for _ in 0..row_pos_count {
        row_positions.push(read_f64(buf, cursor).map_err(row_pos_err)?);
        cursor += POSITION_ENTRY_SIZE;
    }

    // --- Col positions ((C+1) x 8 bytes, f64; 0 entries when C==0) ---
    let col_pos_count = if viewport_cols > 0 {
        viewport_cols as usize + 1
    } else {
        0
    };
    let col_pos_section_end = check_section(
        buf,
        cursor,
        col_pos_count,
        POSITION_ENTRY_SIZE,
        "col positions",
    )?;
    let bl = buf.len();
    let col_pos_err = move |()| DeserializeError::SectionOutOfBounds {
        section: "col positions",
        end: col_pos_section_end,
        buf_len: bl,
    };
    let mut col_positions = Vec::with_capacity(col_pos_count);
    for _ in 0..col_pos_count {
        col_positions.push(read_f64(buf, cursor).map_err(col_pos_err)?);
        cursor += POSITION_ENTRY_SIZE;
    }

    if cursor != buf.len() {
        return Err(DeserializeError::TrailingBytes {
            expected: cursor,
            actual: buf.len(),
        });
    }

    Ok(DeserializedViewport {
        start_row,
        start_col,
        cell_count,
        viewport_rows,
        viewport_cols,
        generation,
        is_delta,
        wire_version,
        cells,
        merges,
        row_dims,
        col_dims,
        palette_start_index,
        palette_formats,
        data_bars,
        icons,
        row_positions,
        col_positions,
    })
}
