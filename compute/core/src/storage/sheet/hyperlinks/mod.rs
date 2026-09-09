//! Native hyperlink metadata anchored by stable cell identities.

mod mutations;
mod queries;

#[cfg(test)]
mod mutation_metadata_tests;
#[cfg(test)]
mod tests;

pub(crate) use mutations::reanchor_before_delete;
pub use mutations::{clear_hyperlinks_in_range, remove_hyperlink, set_hyperlink};
pub(crate) use queries::hyperlink_formula_url;
pub use queries::{get_all_hyperlinks, get_hyperlink};

/// Authored order is the vector order. Only export derives an A1 reference.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredHyperlink {
    pub start_id: cell_types::CellId,
    pub end_id: Option<cell_types::CellId>,
    pub data: domain_types::domain::hyperlink::Hyperlink,
}
