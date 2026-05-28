//! Tests for the cell parser module.

#![cfg(test)]

mod data_tables;
mod fast_parse;
mod format_import;
mod helpers;
mod manual_real_file;
mod recovery;

use crate::domain::cells::CellData;

// Helpers copy packed fields by value, avoiding references to unaligned fields.
impl CellData {
    #[inline]
    fn get_row(&self) -> u32 {
        self.row
    }
    #[inline]
    fn get_col(&self) -> u32 {
        self.col
    }
    #[inline]
    fn get_cell_type(&self) -> u8 {
        self.cell_type
    }
    #[inline]
    fn get_style_idx(&self) -> u16 {
        self.style_idx
    }
    #[inline]
    fn get_value_offset(&self) -> u32 {
        self.value_offset
    }
    #[inline]
    fn get_value_len(&self) -> u32 {
        self.value_len
    }
}
