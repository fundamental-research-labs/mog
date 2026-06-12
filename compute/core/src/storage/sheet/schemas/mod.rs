//! Column schema and range schema (data validation) CRUD operations.
//!
//! Column schemas live under `sheets/{hex}/schemas` (keyed by ColId hex) and
//! are independent of data validations.
//!
//! Range schemas (data validations) are stored via the Range-backed store:
//! rule bodies live in `sheets/{hex}/validationRules`, individual range
//! entries live in `sheets/{hex}/ranges` with bindings in `rangeBindings`.
//! The runtime API translates between [`RangeSchema`] and [`ValidationSpec`]
//! at the boundary.

use cell_types::SheetId;

mod columns;
mod range_geometry;
mod range_store;
mod range_view;
mod ranges;
mod validation_rules;
mod validator;
mod yrs_io;

pub use columns::{
    clear_column_schema, get_all_column_schemas, get_column_schema, set_column_schema,
};
pub(crate) use range_store::write_imported_validation_specs;
pub use ranges::{
    delete_range_schema, get_range_schema, get_range_schemas_for_sheet, set_range_schema,
    set_range_schema_with_alloc, update_range_schema, update_range_schema_with_alloc,
};
pub(crate) use validator::{
    DataValidationOutcome, validate_cell_value, validate_cell_value_against_data_validations,
};

// Re-export pure domain types from domain-types.
pub use domain_types::domain::validation::*;

pub(crate) fn get_validation_specs_for_sheet(
    doc: &yrs::Doc,
    sheets: &yrs::MapRef,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    let txn = yrs::Transact::transact(doc);
    range_store::read_range_backed_validation_specs(&txn, sheets, sheet_id)
}

#[cfg(test)]
use crate::storage::sheet::yrs_helpers::KEY_DV_DECLARED_COUNT;
#[cfg(test)]
pub(super) use range_geometry::position_in_range;
#[cfg(test)]
pub(super) use validator::str_to_cell_value;
#[cfg(test)]
use yrs::{Map, Transact};
#[cfg(test)]
use yrs_io::get_properties_map;

#[cfg(test)]
mod tests;
