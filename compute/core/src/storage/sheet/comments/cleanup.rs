use yrs::{Doc, Map, MapRef, Origin, Out, Transact};

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_GRID_ID_TO_POS, KEY_GRID_INDEX};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::yrs_schema::comment as comment_schema;

use super::yrs_io::get_comments_map;
use crate::storage::infra::grid_helpers::get_cells_map;

fn comment_cell_ref_exists<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
    cells_map: Option<&MapRef>,
    cell_ref: &str,
) -> bool {
    if cells_map.is_some_and(|cells| cells.get(txn, cell_ref).is_some()) {
        return true;
    }

    let Some(Out::YMap(sheet_map)) = sheets.get(txn, sheet_hex) else {
        return false;
    };
    let Some(Out::YMap(grid_index)) = sheet_map.get(txn, KEY_GRID_INDEX) else {
        return false;
    };
    let Some(Out::YMap(id_to_pos)) = grid_index.get(txn, KEY_GRID_ID_TO_POS) else {
        return false;
    };
    id_to_pos.get(txn, cell_ref).is_some()
}
/// Validate and clean orphaned comments.
pub fn validate_and_clean_comments(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let comments_map = match get_comments_map(&txn, sheets, &sheet_hex) {
        Some(m) => m,
        None => return 0,
    };
    let cells_map = get_cells_map(&txn, sheets, &sheet_hex);
    let to_remove: Vec<String> = comments_map
        .iter(&txn)
        .filter_map(|(key, value)| {
            if let Out::YMap(map) = value {
                let comment = comment_schema::from_yrs_map(&map, &txn)?;
                if !comment_cell_ref_exists(
                    &txn,
                    sheets,
                    &sheet_hex,
                    cells_map.as_ref(),
                    &comment.cell_ref,
                ) {
                    Some(key.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    let count = to_remove.len();
    for key in &to_remove {
        comments_map.remove(&mut txn, key.as_str());
    }
    count
}
