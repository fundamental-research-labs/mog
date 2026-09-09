//! Preserve typed imported table filter metadata while it still matches the
//! executable runtime projection.

use std::collections::HashMap;

use cell_types::SheetId;
use domain_types::domain::table::TableSpec;
use value_types::DateSystem;

use crate::mirror::CellMirror;
use crate::storage::engine::construction::table_filter_spec_to_column_filter;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

/// Return true when a table's runtime filter still exactly represents the
/// imported typed table specification. In that state export must retain the
/// source date-group and dynamic attributes rather than rebuilding them from
/// the intentionally smaller runtime `ColumnFilter` shape.
pub(super) fn imported_table_filter_runtime_matches_spec(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table_id: &str,
    spec: &TableSpec,
    filter: &filters::FilterState,
) -> bool {
    let Some(binding) = filters::get_filter_metadata_binding(&stores.storage, sheet_id, &filter.id)
    else {
        return false;
    };
    if binding.shell.capability != filters::FilterCapability::Supported
        || !matches!(
            &binding.owner_path,
            filters::FilterMetadataOwnerPath::TableAutoFilter {
                table_id: owner_table_id,
                ..
            } if owner_table_id == table_id
        )
    {
        return false;
    }

    let date_system = DateSystem::from_date1904(mirror.date1904);
    let mut expected = HashMap::new();
    for column in &spec.filter_columns {
        let Some(header_cell_id) = binding.col_id_to_header_cell_id.get(&column.col_id) else {
            return false;
        };
        let Some(column_filter) = table_filter_spec_to_column_filter(&column.filter, date_system)
        else {
            return false;
        };
        expected.insert(header_cell_id.clone(), column_filter);
    }
    let projected =
        super::super::imported_filter_runtime::project_imported_date_group_filters_for_evaluation(
            stores, mirror, sheet_id, &filter.id,
        );
    projected.is_some_and(|filter| expected == filter.column_filters)
}
