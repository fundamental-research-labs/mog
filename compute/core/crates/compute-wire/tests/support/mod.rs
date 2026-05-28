pub mod wire {
    use compute_wire::constants::NO_STRING;

    pub fn read_u8(buf: &[u8], off: usize) -> u8 {
        buf[off]
    }

    pub fn read_u16(buf: &[u8], off: usize) -> u16 {
        u16::from_le_bytes([buf[off], buf[off + 1]])
    }

    pub fn read_u32(buf: &[u8], off: usize) -> u32 {
        u32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
    }

    pub fn read_f32(buf: &[u8], off: usize) -> f32 {
        f32::from_le_bytes(buf[off..off + 4].try_into().unwrap())
    }

    pub fn read_f64(buf: &[u8], off: usize) -> f64 {
        f64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
    }

    pub fn read_string(buf: &[u8], pool_start: usize, offset: u32, len: u16) -> String {
        if offset == NO_STRING {
            panic!("attempted to read NO_STRING sentinel as a string");
        }
        let start = pool_start + offset as usize;
        let end = start + len as usize;
        String::from_utf8(buf[start..end].to_vec()).expect("invalid UTF-8 in string pool")
    }
}

pub mod fixtures {
    use compute_wire::types::ViewportRenderCell;

    pub fn viewport_cell(
        row: u32,
        col: u32,
        flags: u16,
        number_value: f64,
        formatted: Option<&str>,
        error: Option<&str>,
    ) -> ViewportRenderCell {
        ViewportRenderCell {
            row,
            col,
            format_idx: 0,
            flags,
            number_value,
            formatted: formatted.map(String::from),
            error: error.map(String::from),
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }
    }
}

pub mod layout {
    use compute_wire::constants::{
        CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE,
        MUTATION_HEADER_SIZE, PATCH_STRIDE, POSITION_ENTRY_SIZE, VIEWPORT_HEADER_SIZE,
    };
    use compute_wire::flags::{MUT_HAS_ERRORS, MUT_HAS_PROJECTION_CHANGES};

    use super::wire::{read_u8, read_u16, read_u32};

    pub struct ViewportLayout {
        pub cell_count: usize,
        pub palette_len: usize,
        pub string_pool_bytes: usize,
        pub merge_count: usize,
        pub row_dim_count: usize,
        pub col_dim_count: usize,
        pub data_bar_count: usize,
        pub icon_count: usize,
        pub cells_start: usize,
        pub string_pool_start: usize,
        pub merges_start: usize,
        pub row_dims_start: usize,
        pub col_dims_start: usize,
        pub palette_start: usize,
        pub data_bars_start: usize,
        pub icons_start: usize,
        pub row_pos_start: usize,
        pub col_pos_start: usize,
        pub expected_end: usize,
    }

    impl ViewportLayout {
        pub fn new(buf: &[u8], row_positions_len: usize, col_positions_len: usize) -> Self {
            let cell_count = read_u32(buf, 8) as usize;
            let palette_len = read_u32(buf, 12) as usize;
            let string_pool_bytes = read_u32(buf, 16) as usize;
            let merge_count = read_u16(buf, 24) as usize;
            let row_dim_count = read_u16(buf, 26) as usize;
            let col_dim_count = read_u16(buf, 28) as usize;
            let data_bar_count = read_u16(buf, 32) as usize;
            let icon_count = read_u16(buf, 34) as usize;

            let cells_start = VIEWPORT_HEADER_SIZE;
            let string_pool_start = cells_start + cell_count * CELL_STRIDE;
            let merges_start = string_pool_start + string_pool_bytes;
            let row_dims_start = merges_start + merge_count * MERGE_STRIDE;
            let col_dims_start = row_dims_start + row_dim_count * DIM_STRIDE;
            let palette_start = col_dims_start + col_dim_count * DIM_STRIDE;
            let data_bars_start = palette_start + palette_len;
            let icons_start = data_bars_start + data_bar_count * DATA_BAR_ENTRY_STRIDE;
            let row_pos_start = icons_start + icon_count * ICON_ENTRY_STRIDE;
            let col_pos_start = row_pos_start + row_positions_len * POSITION_ENTRY_SIZE;
            let expected_end = col_pos_start + col_positions_len * POSITION_ENTRY_SIZE;

            Self {
                cell_count,
                palette_len,
                string_pool_bytes,
                merge_count,
                row_dim_count,
                col_dim_count,
                data_bar_count,
                icon_count,
                cells_start,
                string_pool_start,
                merges_start,
                row_dims_start,
                col_dims_start,
                palette_start,
                data_bars_start,
                icons_start,
                row_pos_start,
                col_pos_start,
                expected_end,
            }
        }

        pub fn cell_base(&self, index: usize) -> usize {
            self.cells_start + index * CELL_STRIDE
        }

        pub fn data_bar_base(&self, index: usize) -> usize {
            self.data_bars_start + index * DATA_BAR_ENTRY_STRIDE
        }

        pub fn icon_base(&self, index: usize) -> usize {
            self.icons_start + index * ICON_ENTRY_STRIDE
        }
    }

    pub struct MutationLayout {
        pub patch_count: usize,
        pub string_pool_bytes: usize,
        pub sheet_id_len: usize,
        pub sheet_id_start: usize,
        pub patches_start: usize,
        pub string_pool_start: usize,
        pub spill_section_start: Option<usize>,
        pub errors_section_start: Option<usize>,
    }

    impl MutationLayout {
        pub fn new(buf: &[u8]) -> Self {
            let patch_count = read_u32(buf, 0) as usize;
            let string_pool_bytes = read_u32(buf, 4) as usize;
            let sheet_id_len = read_u16(buf, 8) as usize;
            let flags = read_u8(buf, 10);
            let sheet_id_start = MUTATION_HEADER_SIZE;
            let patches_start = sheet_id_start + sheet_id_len;
            let string_pool_start = patches_start + patch_count * PATCH_STRIDE;
            let optional_start = string_pool_start + string_pool_bytes;
            let spill_section_start =
                (flags & MUT_HAS_PROJECTION_CHANGES != 0).then_some(optional_start);
            let errors_section_start = if flags & MUT_HAS_ERRORS != 0 {
                let spill_bytes = spill_section_start
                    .map(|start| 4 + read_u32(buf, start) as usize * PATCH_STRIDE)
                    .unwrap_or(0);
                Some(optional_start + spill_bytes)
            } else {
                None
            };

            Self {
                patch_count,
                string_pool_bytes,
                sheet_id_len,
                sheet_id_start,
                patches_start,
                string_pool_start,
                spill_section_start,
                errors_section_start,
            }
        }

        pub fn patch_base(&self, index: usize) -> usize {
            self.patches_start + index * PATCH_STRIDE
        }

        pub fn patch_cell_base(&self, index: usize) -> usize {
            self.patch_base(index) + 8
        }

        pub fn spill_patch_base(&self, index: usize) -> usize {
            self.spill_section_start.expect("missing spill section") + 4 + index * PATCH_STRIDE
        }
    }
}
