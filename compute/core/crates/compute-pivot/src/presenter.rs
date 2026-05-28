//! Presenter bridge between pivot table configuration/results and relational compute.
//!
//! The presenter pipeline has two public entry points:
//!
//! - [`pivot_config_to_query`] maps a resolved pivot configuration into the
//!   relational engine's query model.
//! - [`query_result_to_pivot`] projects a relational query result back into
//!   pivot headers, rows, grand totals, and rendered bounds.
//!
//! The implementation is split into small modules for query mapping,
//! visibility, column headers, row flattening, value remapping, grand totals,
//! and final result projection.

mod column_headers;
mod grand_totals;
mod query_mapping;
mod result_projection;
mod row_flattening;
mod value_remap;
mod visibility;

pub use query_mapping::pivot_config_to_query;
pub use result_projection::query_result_to_pivot;
pub use visibility::ExpansionKey;

#[cfg(test)]
mod tests {
    use compute_relational::{QueryResult, RelationalQuery};

    use crate::presenter::{ExpansionKey, pivot_config_to_query, query_result_to_pivot};
    use crate::resolved::ResolvedPivotConfig;
    use crate::types::{PivotExpansionState, PivotTableResult};

    #[test]
    fn public_presenter_import_paths_remain_usable() {
        let _ = pivot_config_to_query as fn(&ResolvedPivotConfig) -> RelationalQuery;
        let _ = query_result_to_pivot
            as fn(
                &QueryResult,
                &ResolvedPivotConfig,
                Option<&PivotExpansionState>,
            ) -> PivotTableResult;
        let _ = std::mem::size_of::<ExpansionKey>();
    }
}
