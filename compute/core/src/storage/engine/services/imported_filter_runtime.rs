//! Runtime refreshes for imported filters whose executable bounds depend on
//! workbook settings.

use cell_types::SheetId;
use domain_types::domain::filter::{DateGroupItem, OoxmlFilterType};
use domain_types::domain::table::FilterSpec;
use value_types::DateSystem;

use crate::mirror::CellMirror;
use crate::storage::engine::services::imported_filters::read_imported_auto_filter_metadata;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

/// Recompile an imported date-group criterion when workbook date-system
/// settings changed after hydration. The runtime state is authoritative once
/// a user edits a column, so replacement only occurs when its current value is
/// exactly one of the two date-system projections of the retained import
/// criterion.
pub(in crate::storage::engine) fn refresh_imported_date_group_filters_for_evaluation(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
) {
    let Some(mut filter) = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    ) else {
        return;
    };
    let Some(binding) = filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    ) else {
        return;
    };
    if binding.shell.capability != filters::FilterCapability::Supported {
        return;
    }

    let date_system = DateSystem::from_date1904(mirror.date1904);
    let alternate_date_system = match date_system {
        DateSystem::Date1900 => DateSystem::Date1904,
        DateSystem::Date1904 => DateSystem::Date1900,
    };
    let mut changed = false;

    let filter_kind = filter.filter_kind.clone();
    match filter_kind {
        filters::FilterKind::AutoFilter => {
            let Some(imported_auto_filter) = read_imported_auto_filter_metadata(stores, sheet_id)
            else {
                return;
            };
            for column in &imported_auto_filter.columns {
                let Some(OoxmlFilterType::Values {
                    values,
                    blanks,
                    date_group_items,
                    ..
                }) = column.filter_type.as_ref()
                else {
                    continue;
                };
                if date_group_items.is_empty() {
                    continue;
                }
                let Some(header_cell_id) = binding.col_id_to_header_cell_id.get(&column.col_index)
                else {
                    continue;
                };
                changed |= refresh_imported_date_group_column(
                    &mut filter,
                    header_cell_id,
                    values,
                    *blanks,
                    date_group_items,
                    date_system,
                    alternate_date_system,
                );
            }
        }
        filters::FilterKind::TableFilter => {
            let Some(table_id) = filter.table_id.clone() else {
                return;
            };
            let Some(table) = mirror
                .all_tables()
                .iter()
                .find(|table| table.id == table_id || table.name == table_id)
            else {
                return;
            };
            for column in &table.filter_columns {
                let FilterSpec::Values {
                    blank,
                    values,
                    date_group_items,
                    ..
                } = &column.filter
                else {
                    continue;
                };
                if date_group_items.is_empty() {
                    continue;
                }
                let Some(header_cell_id) = binding.col_id_to_header_cell_id.get(&column.col_id)
                else {
                    continue;
                };
                changed |= refresh_imported_date_group_column(
                    &mut filter,
                    header_cell_id,
                    values,
                    *blank,
                    date_group_items,
                    date_system,
                    alternate_date_system,
                );
            }
        }
        filters::FilterKind::AdvancedFilter => {}
    }

    if changed {
        let _ = filters::upsert_import_filter_state(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            &filter,
        );
    }
}

/// Drop retained table date-group provenance when a user edits that table
/// column. Table filters share the generic runtime mutation API with sheet
/// AutoFilters, but their lossless source lives in the canonical table entry
/// rather than the sheet `autoFilter` metadata. Clearing the date-group items
/// there prevents a coincidentally equal user `ColumnFilter` from being
/// mistaken for the old imported projection on the next evaluation.
pub(in crate::storage::engine) fn clear_imported_table_date_group_metadata_after_column_edit(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    filter_id: &str,
    header_col: u32,
) {
    let Some(filter) = filters::get_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    ) else {
        return;
    };
    if filter.filter_kind != filters::FilterKind::TableFilter {
        return;
    }
    let Some(table_id) = filter.table_id.as_deref() else {
        return;
    };
    let Some(mut table) = mirror
        .all_tables()
        .iter()
        .find(|table| {
            table.sheet_id == sheet_id.to_uuid_string()
                && (table.id == table_id || table.name == table_id)
        })
        .cloned()
    else {
        return;
    };
    let Some(relative_col) = header_col.checked_sub(table.range.start_col()) else {
        return;
    };
    let Some(binding) = filters::get_filter_metadata_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        filter_id,
    ) else {
        return;
    };
    let Some(header_cell_id) = binding.col_id_to_header_cell_id.get(&relative_col) else {
        return;
    };
    if !filter.column_filters.contains_key(header_cell_id) {
        let original_len = table.filter_columns.len();
        table
            .filter_columns
            .retain(|column| column.col_id != relative_col);
        if table.filter_columns.len() != original_len {
            stores.compute.set_table(mirror, table.clone());
            super::tables::persist_table_to_yrs(stores, &table);
        }
        return;
    }
    let Some(column) = table
        .filter_columns
        .iter_mut()
        .find(|column| column.col_id == relative_col)
    else {
        return;
    };
    let FilterSpec::Values {
        date_group_items, ..
    } = &mut column.filter
    else {
        return;
    };
    if date_group_items.is_empty() {
        return;
    }

    date_group_items.clear();
    stores.compute.set_table(mirror, table.clone());
    super::tables::persist_table_to_yrs(stores, &table);
}

fn refresh_imported_date_group_column(
    filter: &mut filters::FilterState,
    header_cell_id: &str,
    values: &[String],
    include_blanks: bool,
    date_group_items: &[DateGroupItem],
    date_system: DateSystem,
    alternate_date_system: DateSystem,
) -> bool {
    let Some(current_filter) = filters::values_filter_to_column_filter(
        values,
        include_blanks,
        date_group_items,
        date_system,
    ) else {
        return false;
    };
    let Some(alternate_filter) = filters::values_filter_to_column_filter(
        values,
        include_blanks,
        date_group_items,
        alternate_date_system,
    ) else {
        return false;
    };
    let Some(existing_filter) = filter.column_filters.get(header_cell_id) else {
        return false;
    };
    if existing_filter != &alternate_filter {
        return false;
    }

    filter
        .column_filters
        .insert(header_cell_id.to_string(), current_filter);
    true
}
