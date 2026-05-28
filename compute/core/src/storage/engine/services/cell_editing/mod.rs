//! Cell editing service facade.

mod a1;
mod array_formulas;
mod bulk_edits;
mod direct_edits;
mod identity;
mod range_sync;
mod yrs_persistence;

pub(in crate::storage::engine) use a1::a1_range_string;
pub(in crate::storage::engine) use array_formulas::set_array_formula;
pub(in crate::storage::engine) use bulk_edits::{import_values, set_cell_values_parsed};
pub(in crate::storage::engine) use direct_edits::{
    set_cell, set_cell_value_as_text, set_cell_value_parsed,
};
pub(in crate::storage::engine) use identity::{
    ensure_cell_id_mirrored, find_cell_id_at, find_cell_id_at_mirrored,
    persist_identity_formula_cell_identities,
};
pub(in crate::storage::engine) use range_sync::sync_range_with_compute;
pub(in crate::storage::engine) use yrs_persistence::{write_cell_to_yrs, write_cell_to_yrs_in_txn};
