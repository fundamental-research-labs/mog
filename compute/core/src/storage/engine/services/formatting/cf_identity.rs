use std::sync::Arc;

use crate::mirror::CellMirror;
use crate::storage::sheet::cf_store::CFCellRange;
use cell_types::{IdAllocator, SheetId, SheetPos};

pub(in crate::storage::engine) fn resolve_cf_ranges_to_identities(
    mirror: &mut CellMirror,
    id_alloc: &Arc<IdAllocator>,
    sheet_id: &SheetId,
    ranges: &[CFCellRange],
) -> Vec<domain_types::domain::conditional_format::CellIdRange> {
    let mut result = Vec::with_capacity(ranges.len());
    for range in ranges {
        let start_id = mirror.ensure_cell_id(
            sheet_id,
            SheetPos::new(range.start_row(), range.start_col()),
            id_alloc,
        );
        let end_id = mirror.ensure_cell_id(
            sheet_id,
            SheetPos::new(range.end_row(), range.end_col()),
            id_alloc,
        );
        if let (Some(start), Some(end)) = (start_id, end_id) {
            result.push(domain_types::domain::conditional_format::CellIdRange {
                top_left_cell_id: start.to_uuid_string(),
                bottom_right_cell_id: end.to_uuid_string(),
            });
        }
    }
    result
}
