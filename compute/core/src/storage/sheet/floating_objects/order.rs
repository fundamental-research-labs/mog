use std::sync::Arc;

use compute_document::schema::KEY_FLOATING_OBJECT_ORDER;
use yrs::{Any, Array, ArrayRef, MapRef, Out};

use super::sheet_map::get_or_create_sheet_subarray;

pub(super) fn append_object_id_if_missing(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_hex: &str,
    object_id: &str,
) {
    let Some(order) =
        get_or_create_sheet_subarray(txn, sheets, sheet_hex, KEY_FLOATING_OBJECT_ORDER)
    else {
        return;
    };
    if !contains_object_id(txn, &order, object_id) {
        order.push_back(txn, Any::String(Arc::from(object_id)));
    }
}

pub(super) fn remove_object_id(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_hex: &str,
    object_id: &str,
) {
    let Some(order) =
        get_or_create_sheet_subarray(txn, sheets, sheet_hex, KEY_FLOATING_OBJECT_ORDER)
    else {
        return;
    };
    let mut index = 0;
    while index < order.len(txn) {
        if order
            .get(txn, index)
            .is_some_and(|value| out_string_eq(&value, object_id))
        {
            order.remove(txn, index);
        } else {
            index += 1;
        }
    }
}

fn contains_object_id(txn: &impl yrs::ReadTxn, order: &ArrayRef, object_id: &str) -> bool {
    (0..order.len(txn)).any(|index| {
        order
            .get(txn, index)
            .is_some_and(|value| out_string_eq(&value, object_id))
    })
}

fn out_string_eq(value: &Out, expected: &str) -> bool {
    matches!(value, Out::Any(Any::String(actual)) if actual.as_ref() == expected)
}
