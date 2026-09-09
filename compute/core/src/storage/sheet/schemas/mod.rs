//! Native column schemas and ordered data validations.
use cell_types::SheetId;

mod columns;
mod state;
pub(crate) use state::{StoredValidation, ValidationState};
mod range_geometry;
mod range_view;
mod ranges;
mod validator;

pub use columns::{
    clear_column_schema, get_all_column_schemas, get_column_schema, set_column_schema,
};
pub use ranges::{
    delete_range_schema, get_range_schema, get_range_schemas_for_sheet, set_range_schema,
    update_range_schema,
};
pub(crate) use validator::{
    DataValidationOutcome, validate_cell_value, validate_cell_value_against_data_validations,
};

// Re-export pure domain types from domain-types.
pub use domain_types::domain::validation::*;

pub(crate) fn get_validation_specs_for_sheet(
    storage: &crate::storage::WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|metadata| {
            metadata
                .validations
                .rules
                .iter()
                .map(|entry| entry.spec.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
pub(super) use range_geometry::position_in_range;
#[cfg(test)]
pub(super) use validator::str_to_cell_value;

#[cfg(test)]
mod tests;
