use super::IdAllocator;
use compute_document::hex::id_to_hex;
use std::collections::HashMap;

pub(super) type PositionMap = HashMap<(u32, u32), String>;

/// Allocate an identity for metadata without creating an authored blank cell.
pub(super) fn get_or_create_cell_id_for_pos(
    pos_map: &mut PositionMap,
    row: u32,
    col: u32,
    allocator: &mut impl IdAllocator,
) -> String {
    pos_map
        .entry((row, col))
        .or_insert_with(|| id_to_hex(allocator.alloc_cell_id().as_u128()).to_string())
        .clone()
}
