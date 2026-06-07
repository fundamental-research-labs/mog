use crate::snapshot::{Axis, MutationResult, VisibilityChange};
use cell_types::SheetId;

pub(in crate::storage::engine) fn append_row_visibility_changes(
    result: &mut MutationResult,
    sheet_id: &SheetId,
    transitions: &[(u32, bool)],
) {
    result
        .visibility_changes
        .extend(transitions.iter().map(|(row, hidden)| VisibilityChange {
            sheet_id: sheet_id.to_uuid_string(),
            axis: Axis::Row,
            index: *row,
            hidden: *hidden,
        }));
}
