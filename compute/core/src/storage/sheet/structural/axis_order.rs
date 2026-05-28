use std::sync::Arc;

use yrs::{Any, Array, MapRef};

use crate::identity::GridIndex;
use crate::storage::infra::grid_helpers::{get_col_order_array, get_row_order_array};
use compute_document::hex::id_to_hex;

pub(super) fn insert_row_ids(
    txn: &mut yrs::TransactionMut<'_>,
    sheet_map: &MapRef,
    grid_index: &GridIndex,
    at_row: u32,
    count: u32,
) {
    if let Some(row_order) = get_row_order_array(sheet_map, txn) {
        for i in 0..count {
            let row_id = grid_index
                .row_id(at_row + i)
                .expect("newly inserted row should exist in GridIndex");
            let hex = id_to_hex(row_id.as_u128());
            row_order.insert(txn, at_row + i, Any::String(Arc::from(hex.as_str())));
        }
    }
}

pub(super) fn insert_col_ids(
    txn: &mut yrs::TransactionMut<'_>,
    sheet_map: &MapRef,
    grid_index: &GridIndex,
    at_col: u32,
    count: u32,
) {
    if let Some(col_order) = get_col_order_array(sheet_map, txn) {
        for i in 0..count {
            let col_id = grid_index
                .col_id(at_col + i)
                .expect("newly inserted col should exist in GridIndex");
            let hex = id_to_hex(col_id.as_u128());
            col_order.insert(txn, at_col + i, Any::String(Arc::from(hex.as_str())));
        }
    }
}

pub(super) fn remove_rows(
    txn: &mut yrs::TransactionMut<'_>,
    sheet_map: &MapRef,
    at_row: u32,
    count: u32,
) {
    if let Some(row_order) = get_row_order_array(sheet_map, txn) {
        row_order.remove_range(txn, at_row, count);
    }
}

pub(super) fn remove_cols(
    txn: &mut yrs::TransactionMut<'_>,
    sheet_map: &MapRef,
    at_col: u32,
    count: u32,
) {
    if let Some(col_order) = get_col_order_array(sheet_map, txn) {
        col_order.remove_range(txn, at_col, count);
    }
}
