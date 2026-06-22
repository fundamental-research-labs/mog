//! Cell editing service facade.

mod a1;
mod array_formulas;
mod bulk_edits;
mod direct_edits;
mod identity;
mod range_sync;
mod yrs_persistence;

/// Internal marker used before result enrichment to mean "the direct edit had
/// no old formula". It is cleared before mutation results cross the bridge.
pub(in crate::storage::engine) const NO_OLD_FORMULA_SENTINEL: &str = "\u{0}mog:no-old-formula";

pub(in crate::storage::engine) use a1::a1_range_string;
pub(in crate::storage::engine) use array_formulas::set_array_formula;
pub(in crate::storage::engine) use bulk_edits::{import_values, set_cell_values_parsed};
pub(in crate::storage::engine) use direct_edits::{
    set_cell, set_cell_value_as_text, set_cell_value_parsed,
};
pub(in crate::storage::engine) use identity::{
    cell_id_for_region_guard, ensure_cell_id_mirrored, ensure_cell_id_mirrored_with_origin,
    find_cell_id_at, find_cell_id_at_mirrored, persist_cell_formula_identity,
    persist_identity_formula_cell_identities,
};
pub(in crate::storage::engine) use range_sync::sync_range_with_compute;
pub(in crate::storage::engine) use yrs_persistence::{write_cell_to_yrs, write_cell_to_yrs_in_txn};
