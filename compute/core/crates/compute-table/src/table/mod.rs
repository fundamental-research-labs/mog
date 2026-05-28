//! Table engine - pure computation model for Excel-style tables.
//!
//! Every function is pure and stateless. All operations return new structs.
//! No DOM, no Yjs, no React, no XState.

mod columns;
mod create;
mod lookup;
mod names;
mod options;
mod ranges;
mod totals;

pub use columns::{add_column, remove_column, rename_column, resize_table};
pub(crate) use create::validate_range;
pub use create::{CreateTableOptions, create_table};
pub use lookup::{get_column_by_id, get_column_by_name};
pub use names::{generate_table_name, validate_table_name};
pub use options::{set_table_option, set_table_style};
pub use ranges::{
    get_column_at_position, get_column_data_range, get_column_range, get_data_range,
    get_header_range, get_totals_range, is_in_data_range, is_in_header_row, is_in_totals_row,
    is_position_in_table,
};
pub use totals::{get_subtotal_formula, set_totals_function, toggle_totals_row};

#[cfg(test)]
mod columns_tests;
#[cfg(test)]
mod create_tests;
#[cfg(test)]
mod hit_testing_tests;
#[cfg(test)]
mod lookup_tests;
#[cfg(test)]
mod names_tests;
#[cfg(test)]
mod options_tests;
#[cfg(test)]
mod overlap_tests;
#[cfg(test)]
mod range_validation_tests;
#[cfg(test)]
mod ranges_tests;
#[cfg(test)]
mod regions_tests;
#[cfg(test)]
mod resize_tests;
#[cfg(test)]
mod totals_tests;

#[cfg(test)]
mod test_fixtures;
