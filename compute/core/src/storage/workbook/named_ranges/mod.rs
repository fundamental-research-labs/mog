//! Native defined names with canonical typed identity references.

mod keys;
pub(crate) use keys::get_defined_name_key;
mod mutations;
mod queries;
#[cfg(test)]
mod tests;
mod validation;

pub use domain_types::domain::named_range::*;
pub(crate) use mutations::{
    create_named_range, import_named_ranges, remove_named_range_by_id, remove_named_range_by_name,
    remove_named_ranges_by_scope, update_named_range, upsert_named_range,
};
pub(crate) use queries::{
    get_all_named_ranges, get_named_range_by_id, get_named_range_by_name,
    get_named_ranges_by_scope, get_visible_named_ranges, named_range_count, named_range_exists,
    resolve_named_range,
};
pub(crate) use validation::validate_name;

/// Authored name metadata and its typed native formula reference.
pub type StoredDefinedName = domain_types::DefinedName<formula_types::IdentityFormula>;

/// Build the temporary typed expression used at the import boundary. Construction
/// resolves its references against the fully installed sheet and cell identities.
pub(crate) fn expression_template(expression: &str) -> formula_types::IdentityFormula {
    formula_types::IdentityFormula {
        template: expression
            .strip_prefix('=')
            .unwrap_or(expression)
            .to_string(),
        refs: Vec::new(),
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    }
}
