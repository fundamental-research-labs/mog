//! Dimensions and tables export functions.
//!
//! Extracted from `export.rs` — row heights, column widths, hidden
//! rows/cols, and table specs.

use cell_types::SheetId;
use domain_types::{
    ColDimension, RowDimension, SheetData, SheetDimensions,
    domain::{
        connections::QueryTable,
        filter::{
            FilterColumn as OoxmlFilterColumn, OoxmlFilterCondition, OoxmlFilterType,
            SortState as OoxmlSortState, filter_state_to_auto_filter,
        },
        table::{
            CustomFilterSpec, FilterColumnSpec, FilterSpec, TableCatalogEntry, TableSortCondition,
            TableSortState, TableSpec,
        },
    },
};
use std::collections::{HashMap, HashSet};

use crate::cells::CellStore;
use crate::storage::engine::services::queries;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters as sheet_filters;

use super::table_totals::apply_runtime_table_totals_to_spec;

// -------------------------------------------------------------------
// Dimensions export (row heights, col widths, hidden, etc.)
// -------------------------------------------------------------------

/// Export dimensions (custom row heights and column widths) for a sheet.
///
/// Reads stored row heights, hidden rows/cols, custom-height/format flags,
/// descent values, and column widths from native metadata and produces a `SheetDimensions`.
pub(in crate::storage::engine) fn export_dimensions_for_sheet(
    stores: &EngineStores,
    _store: &CellStore,
    sheet_id: &SheetId,
    _override_max_col: Option<u32>,
) -> SheetDimensions {
    let Some(meta) = stores.storage.sheet_metadata.get(sheet_id) else {
        return SheetDimensions::default();
    };
    let grid = stores.grid_indexes.get(sheet_id);
    let default_row = domain_types::units::Points(meta.format.default_row_height.unwrap_or(15.0));
    let default_col = domain_types::units::CharWidth(meta.format.default_col_width.unwrap_or(8.43));
    let hidden_rows: std::collections::BTreeSet<_> = queries::get_hidden_rows(stores, sheet_id)
        .into_iter()
        .collect();
    let hidden_columns: std::collections::BTreeSet<_> =
        queries::get_hidden_columns(stores, sheet_id)
            .into_iter()
            .collect();
    let mut rows: std::collections::BTreeMap<u32, RowDimension> = meta
        .dimensions
        .rows
        .iter()
        .filter_map(|(id, record)| {
            let row = grid?.row_index(id)?;
            Some((
                row,
                record.to_domain(row, default_row, hidden_rows.contains(&row)),
            ))
        })
        .collect();
    for &row in &hidden_rows {
        rows.entry(row).or_insert_with(|| RowDimension {
            row,
            height: default_row.0,
            hidden: true,
            ..Default::default()
        });
    }
    let mut columns: std::collections::BTreeMap<u32, ColDimension> = meta
        .dimensions
        .columns
        .iter()
        .filter_map(|(id, record)| {
            let col = grid?.col_index(id)?;
            let hidden = hidden_columns.contains(&col);
            let mut dimension = record.to_domain(col, default_col, hidden);
            dimension.hidden_attr = dimension
                .hidden_attr
                .map(|_| hidden)
                .or(hidden.then_some(true));
            Some((col, dimension))
        })
        .collect();
    for &col in &hidden_columns {
        columns.entry(col).or_insert_with(|| ColDimension {
            col,
            width: default_col.0,
            hidden: true,
            hidden_attr: Some(true),
            ..Default::default()
        });
    }
    SheetDimensions {
        default_row_height: meta.format.default_row_height,
        default_col_width: meta.format.default_col_width,
        default_row_descent: meta.format.default_row_descent,
        base_col_width: meta.format.base_col_width,
        custom_height: meta.format.custom_height,
        zero_height: meta.format.zero_height,
        thick_top: meta.format.thick_top,
        thick_bottom: meta.format.thick_bottom,
        outline_level_row: meta.format.outline_level_row,
        outline_level_col: meta.format.outline_level_col,
        row_heights: rows.into_values().collect(),
        col_widths: columns.into_values().collect(),
        trailing_col_ranges: meta.format.trailing_col_ranges.clone(),
    }
}

// -------------------------------------------------------------------
// Tables
// -------------------------------------------------------------------

/// Export tables for a sheet, reading lossless data from the native table catalog.
pub(in crate::storage::engine) fn export_tables_for_sheet(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
) -> Vec<ExportedTableSpec> {
    let sheet_hex = sheet_id.to_uuid_string();
    let mut catalog_tables: Vec<_> = cell_store
        .all_tables()
        .iter()
        .filter(|table| table.sheet_id == sheet_hex)
        .collect();
    catalog_tables.sort_by(|left, right| {
        (
            left.range.start_row(),
            left.range.start_col(),
            left.name.as_str(),
            left.id.as_str(),
        )
            .cmp(&(
                right.range.start_row(),
                right.range.start_col(),
                right.name.as_str(),
                right.id.as_str(),
            ))
    });

    let mut exported = Vec::new();
    for table in catalog_tables {
        exported.push(exported_table_spec_for_table(
            stores, cell_store, sheet_id, &table,
        ));
    }
    exported
}

/// Transport authored table metadata with the current runtime filter projection.
/// The returned catalog is a snapshot payload; the live table source stays native.
pub(in crate::storage::engine) fn table_catalog_for_snapshot(
    stores: &EngineStores,
    cell_store: &CellStore,
) -> Vec<TableCatalogEntry> {
    cell_store
        .all_tables()
        .iter()
        .cloned()
        .map(|mut table| {
            if let Ok(sheet_id) = SheetId::from_uuid_str(&table.sheet_id) {
                let mut spec =
                    domain_types::domain::table::catalog_entry_to_xlsx_table_spec(&table, None);
                apply_runtime_table_filter_to_spec(
                    stores, cell_store, &sheet_id, &table.id, &mut spec,
                );
                // Empty filter shells are reconstructed from show_filter_buttons.
                // Carry only actual authored criteria/sorts over the snapshot boundary.
                if !spec.filter_columns.is_empty() || spec.sort_state.is_some() {
                    table.auto_filter_ref = spec.auto_filter_ref;
                    table.auto_filter_xr_uid = spec.auto_filter_xr_uid;
                    table.auto_filter_ext_lst_raw = spec.auto_filter_ext_lst_raw;
                    table.filter_columns = spec.filter_columns;
                    table.sort_state = spec.sort_state;
                }
            }
            table
        })
        .collect()
}

fn exported_table_spec_for_table(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    table: &TableCatalogEntry,
) -> ExportedTableSpec {
    let mut spec = domain_types::domain::table::catalog_entry_to_xlsx_table_spec(table, None);
    apply_runtime_table_filter_to_spec(stores, cell_store, sheet_id, &table.id, &mut spec);
    apply_runtime_table_totals_to_spec(stores, cell_store, sheet_id, table, &mut spec);
    ExportedTableSpec {
        projection_input: ExportedTableProjectionInput {
            stable_table_id: table.id.clone(),
            stable_column_ids: table
                .columns
                .iter()
                .map(|column| column.id.clone())
                .collect(),
        },
        spec,
    }
}

pub(in crate::storage::engine) struct ExportedTableSpec {
    pub(in crate::storage::engine) projection_input: ExportedTableProjectionInput,
    pub(in crate::storage::engine) spec: TableSpec,
}

#[derive(Debug, Clone)]
pub(in crate::storage::engine) struct ExportedTableProjectionInput {
    pub(in crate::storage::engine) stable_table_id: String,
    stable_column_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub(in crate::storage::engine) struct TableExportProjection {
    lookup: HashMap<String, TableExportProjectionEntry>,
}

#[derive(Debug, Clone)]
pub(in crate::storage::engine) struct TableExportProjectionEntry {
    pub(in crate::storage::engine) ooxml_table_id: u32,
    pub(in crate::storage::engine) columns: Vec<TableExportColumnProjection>,
}

#[derive(Debug, Clone)]
pub(in crate::storage::engine) struct TableExportColumnProjection {
    pub(in crate::storage::engine) stable_column_id: Option<String>,
    pub(in crate::storage::engine) ooxml_column_id: u32,
    pub(in crate::storage::engine) name: String,
}

impl TableExportProjection {
    pub(in crate::storage::engine) fn empty() -> Self {
        Self {
            lookup: HashMap::new(),
        }
    }

    pub(in crate::storage::engine) fn get(&self, key: &str) -> Option<&TableExportProjectionEntry> {
        self.lookup.get(&key.to_ascii_lowercase())
    }

    fn insert_key(&mut self, key: &str, entry: TableExportProjectionEntry) {
        if key.is_empty() {
            return;
        }
        self.lookup.entry(key.to_ascii_lowercase()).or_insert(entry);
    }
}

/// Finalize the workbook-scoped OOXML table projection for export.
///
/// The storage catalog owns stable Mog table IDs. XLSX package parts need a
/// separate workbook-scoped numeric/table-part projection. This pass stamps the
/// emitted `TableSpec`s with collision-free OOXML IDs and package paths so table
/// XML, worksheet relationships, slicer caches, and query-table sidecars all
/// consume the same projection.
pub(in crate::storage::engine) fn finalize_table_export_projection(
    sheets: &mut [SheetData],
    projection_inputs_by_sheet: &[Vec<ExportedTableProjectionInput>],
) -> TableExportProjection {
    let mut used_table_ids = HashSet::new();
    let mut used_table_paths = HashSet::new();
    let mut used_query_table_paths = HashSet::new();
    let mut next_table_id = 1u32;
    let mut next_table_path = 1usize;
    let mut next_query_table_path = 1usize;
    let mut projection = TableExportProjection::empty();

    for (sheet_idx, sheet) in sheets.iter_mut().enumerate() {
        for (table_idx, table) in sheet.tables.iter_mut().enumerate() {
            table.id = allocate_table_ooxml_id(table.id, &mut used_table_ids, &mut next_table_id);
            finalize_table_column_ooxml_projection(table);

            let table_path = allocate_family_path(
                table.table_part_path_hint.as_deref(),
                "xl/tables/table",
                ".xml",
                &mut used_table_paths,
                &mut next_table_path,
            );
            table.worksheet_relationship_target_hint =
                Some(worksheet_table_relationship_target(&table_path));
            table.table_part_path_hint = Some(table_path);

            if let Some(query_table) = table.query_table.as_mut() {
                let query_path = allocate_family_path(
                    query_table.path_hint.as_deref(),
                    "xl/queryTables/queryTable",
                    ".xml",
                    &mut used_query_table_paths,
                    &mut next_query_table_path,
                );
                query_table.path_hint = Some(query_path);
                reconcile_query_table_field_column_ids(query_table, &table.columns);
            }

            let entry = TableExportProjectionEntry {
                ooxml_table_id: table.id,
                columns: table
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(column_idx, column)| TableExportColumnProjection {
                        stable_column_id: projection_inputs_by_sheet
                            .get(sheet_idx)
                            .and_then(|inputs| inputs.get(table_idx))
                            .and_then(|input| input.stable_column_ids.get(column_idx))
                            .cloned(),
                        ooxml_column_id: column.id,
                        name: column.name.clone(),
                    })
                    .collect(),
            };
            if let Some(stable_table_id) = projection_inputs_by_sheet
                .get(sheet_idx)
                .and_then(|inputs| inputs.get(table_idx))
                .map(|input| input.stable_table_id.as_str())
            {
                projection.insert_key(stable_table_id, entry.clone());
            }
            projection.insert_key(table.name.as_str(), entry.clone());
            projection.insert_key(table.display_name.as_str(), entry.clone());
            projection.insert_key(&table.id.to_string(), entry);
        }
    }
    projection
}

fn allocate_table_ooxml_id(preferred: u32, used: &mut HashSet<u32>, next_id: &mut u32) -> u32 {
    if preferred > 0 && used.insert(preferred) {
        *next_id = (*next_id).max(preferred.saturating_add(1));
        return preferred;
    }

    loop {
        let candidate = *next_id;
        *next_id = (*next_id).saturating_add(1);
        if candidate > 0 && used.insert(candidate) {
            return candidate;
        }
    }
}

fn finalize_table_column_ooxml_projection(table: &mut TableSpec) {
    let mut used = HashSet::new();
    let mut next_id = 1u32;
    let mut column_id_by_name = HashMap::new();
    let mut old_to_new = HashMap::new();

    for column in &mut table.columns {
        let old_id = column.id;
        let new_id = allocate_table_ooxml_id(old_id, &mut used, &mut next_id);
        column.id = new_id;
        old_to_new.entry(old_id).or_insert(new_id);
        column_id_by_name
            .entry(column.name.to_ascii_lowercase())
            .or_insert(new_id);
    }

    if let Some(query_table) = table.query_table.as_mut() {
        for field in &mut query_table.fields {
            if let Some(name) = field.name.as_ref()
                && let Some(column_id) = column_id_by_name.get(&name.to_ascii_lowercase())
            {
                field.table_column_id = Some(*column_id);
                continue;
            }
            if let Some(old_id) = field.table_column_id
                && let Some(new_id) = old_to_new.get(&old_id)
            {
                field.table_column_id = Some(*new_id);
            }
        }
    }
}

fn reconcile_query_table_field_column_ids(
    query_table: &mut QueryTable,
    columns: &[domain_types::domain::table::TableColumnSpec],
) {
    let column_id_by_name: HashMap<_, _> = columns
        .iter()
        .map(|column| (column.name.to_ascii_lowercase(), column.id))
        .collect();
    for field in &mut query_table.fields {
        if let Some(name) = field.name.as_ref()
            && let Some(column_id) = column_id_by_name.get(&name.to_ascii_lowercase())
        {
            field.table_column_id = Some(*column_id);
        }
    }
}

fn allocate_family_path(
    preferred: Option<&str>,
    prefix: &str,
    suffix: &str,
    used: &mut HashSet<String>,
    next_idx: &mut usize,
) -> String {
    if let Some(path) = preferred.and_then(|path| normalized_family_path(path, prefix, suffix))
        && used.insert(path.clone())
    {
        if let Some(index) = family_path_index(&path, prefix, suffix) {
            *next_idx = (*next_idx).max(index.saturating_add(1));
        }
        return path;
    }

    loop {
        let path = format!("{prefix}{next_idx}{suffix}");
        *next_idx = (*next_idx).saturating_add(1);
        if used.insert(path.clone()) {
            return path;
        }
    }
}

fn normalized_family_path(path: &str, prefix: &str, suffix: &str) -> Option<String> {
    let normalized = domain_types::normalize_package_path(path);
    (normalized.starts_with(prefix) && normalized.ends_with(suffix)).then_some(normalized)
}

fn family_path_index(path: &str, prefix: &str, suffix: &str) -> Option<usize> {
    path.strip_prefix(prefix)?
        .strip_suffix(suffix)?
        .parse()
        .ok()
}

fn worksheet_table_relationship_target(path: &str) -> String {
    path.strip_prefix("xl/")
        .map(|path| format!("../{path}"))
        .unwrap_or_else(|| path.to_string())
}

fn apply_runtime_table_filter_to_spec(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    table_id: &str,
    spec: &mut TableSpec,
) {
    let filter = sheet_filters::get_table_filter(&stores.storage, sheet_id, table_id);
    let Some(filter) = filter else {
        return;
    };
    if filter.column_filters.is_empty() && filter.sort_state.is_none() {
        return;
    }
    let pos_resolver = |cell_id: &str| {
        crate::storage::engine::filter_import_diagnostics::resolve_filter_cell_pos(
            cell_store, sheet_id, cell_id,
        )
    };
    let Some(auto_filter) = filter_state_to_auto_filter(&filter, &pos_resolver) else {
        return;
    };

    spec.auto_filter_ref = Some(auto_filter.range_ref);
    spec.auto_filter_xr_uid = auto_filter.xr_uid;
    spec.auto_filter_ext_lst_raw = auto_filter.ext_lst_raw;
    let filter_columns: Vec<FilterColumnSpec> = auto_filter
        .columns
        .iter()
        .filter_map(table_filter_column_spec_from_ooxml)
        .collect();
    if !filter_columns.is_empty() || !filter.column_filters.is_empty() {
        spec.filter_columns = filter_columns;
    }
    if let Some(sort) = auto_filter.sort {
        spec.sort_state = Some(table_sort_state_from_ooxml(sort));
    }
}

fn table_filter_column_spec_from_ooxml(column: &OoxmlFilterColumn) -> Option<FilterColumnSpec> {
    Some(FilterColumnSpec {
        col_id: column.col_index,
        hidden_button: column.hidden_button,
        show_button: column.show_button,
        filter: table_filter_spec_from_ooxml(column.filter_type.as_ref()?)?,
        ext_lst_raw: column.ext_lst_raw.clone(),
    })
}

fn table_filter_spec_from_ooxml(filter: &OoxmlFilterType) -> Option<FilterSpec> {
    Some(match filter {
        OoxmlFilterType::Values {
            values,
            blanks,
            calendar_type,
            date_group_items,
        } => FilterSpec::Values {
            blank: *blanks,
            values: values.clone(),
            calendar_type: *calendar_type,
            date_group_items: date_group_items.clone(),
        },
        OoxmlFilterType::Custom {
            conditions,
            and_logic,
        } => FilterSpec::Custom {
            and: *and_logic,
            filters: conditions
                .iter()
                .map(table_custom_filter_from_ooxml)
                .collect(),
        },
        OoxmlFilterType::Top10 {
            top,
            percent,
            value,
            filter_val,
        } => FilterSpec::Top10 {
            top: *top,
            percent: *percent,
            val: *value,
            filter_val: *filter_val,
        },
        OoxmlFilterType::Dynamic {
            dynamic_type,
            value,
            max_value,
            value_iso,
            max_value_iso,
        } => FilterSpec::Dynamic {
            kind: dynamic_type.clone(),
            val: *value,
            max_val: *max_value,
            val_iso: value_iso.clone(),
            max_val_iso: max_value_iso.clone(),
        },
        OoxmlFilterType::Color { dxf_id, cell_color } => FilterSpec::Color {
            dxf_id: *dxf_id,
            cell_color: *cell_color,
        },
        OoxmlFilterType::Icon { icon_set, icon_id } => FilterSpec::Icon {
            icon_set: icon_set.clone().unwrap_or_default(),
            icon_id: Some(*icon_id),
        },
    })
}

fn table_custom_filter_from_ooxml(condition: &OoxmlFilterCondition) -> CustomFilterSpec {
    CustomFilterSpec {
        operator: condition.operator.clone(),
        val: condition.value.to_string(),
    }
}

fn table_sort_state_from_ooxml(sort: OoxmlSortState) -> TableSortState {
    TableSortState {
        ref_range: sort.range_ref,
        column_sort: sort.column_sort,
        case_sensitive: sort.case_sensitive,
        sort_method: sort.sort_method,
        conditions: sort
            .conditions
            .into_iter()
            .map(|condition| TableSortCondition {
                ref_range: condition.range_ref,
                descending: condition.descending,
                sort_by: condition.sort_by,
                custom_list: condition.custom_list,
                dxf_id: condition.dxf_id,
                icon_set: condition.icon_set,
                icon_id: condition.icon_id,
            })
            .collect(),
        ext_lst_raw: sort.ext_lst_raw,
    }
}
