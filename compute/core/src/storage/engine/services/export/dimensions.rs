//! Dimensions and tables export functions.
//!
//! Extracted from `export.rs` — row heights, column widths, hidden
//! rows/cols, and table specs.

use cell_types::{CellId, SheetId};
use compute_document::hex::hex_to_id;
use compute_document::schema::*;
use domain_types::{
    ColDimension, RowDimension, RowXmlHints, SheetData, SheetDimensions,
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
    yrs_schema,
};
use std::collections::{HashMap, HashSet};
use yrs::{Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::engine::services::queries;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::get_meta_for_export;
use crate::storage::sheet::{dimensions, filters as sheet_filters, settings};

use super::table_totals::apply_runtime_table_totals_to_spec;

// -------------------------------------------------------------------
// Dimensions export (row heights, col widths, hidden, etc.)
// -------------------------------------------------------------------

/// Export dimensions (custom row heights and column widths) for a sheet.
///
/// Reads stored row heights, hidden rows/cols, custom-height/format flags,
/// descent values, and column widths from Yrs and produces a `SheetDimensions`.
pub(in crate::storage::engine) fn export_dimensions_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    override_max_col: Option<u32>,
) -> SheetDimensions {
    let bounds = queries::get_data_bounds(stores, mirror, sheet_id);
    let (max_row, data_max_col) = bounds
        .as_ref()
        .map(|b| (b.max_row, b.max_col))
        .unwrap_or((0, 0));
    let max_col = override_max_col
        .map(|o| data_max_col.max(o))
        .unwrap_or(data_max_col);

    let default_row_height = queries::get_default_row_height(stores, sheet_id);
    let default_col_width = queries::get_default_col_width(stores, sheet_id);

    // Read custom row heights.
    // Use get_row_height_explicit to distinguish "no stored height" (returns None)
    // from "explicitly stored height". Without this, rows with no stored height
    // return DEFAULT_ROW_HEIGHT (20.0), which may differ from the sheet's actual
    // defaultRowHeight (e.g. 15.0) and would be spuriously emitted as custom.
    let mut row_heights = Vec::new();
    let hidden_rows = queries::get_hidden_rows(stores, sheet_id);

    // Read customHeight row set from meta (stored during hydration)
    let custom_height_rows: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowCustomHeight"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    let custom_format_rows: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowCustomFormat"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    let row_outline_levels: std::collections::HashMap<u32, u8> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| {
                yrs_schema::helpers::read_json_vec::<_, (u32, u8)>(&m, &txn, "rowOutlineLevels")
            })
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let explicit_hidden_rows: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowExplicitHidden"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let explicit_outline_zero_rows: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| {
                yrs_schema::helpers::read_json_vec::<_, u32>(
                    &m,
                    &txn,
                    "rowExplicitOutlineLevelZero",
                )
            })
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let row_collapsed: std::collections::HashMap<u32, bool> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, (u32, bool)>(&m, &txn, "rowCollapsed"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let row_thick_top: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowThickTop"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let row_thick_bot: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowThickBot"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let row_phonetic: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "rowPhonetic"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let row_spans: std::collections::HashMap<u32, String> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, (u32, String)>(&m, &txn, "rowSpans"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    let bare_empty_rows: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "bareEmptyRows"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    // Extend max_row to include rows beyond the data range that have
    // stored height metadata (customHeight rows with ghost/styled-empty cells).
    // Without this, rows like styled-empty cells at row 17 with
    // customHeight="1" are missed because the grid index only tracks
    // rows with real data (non-ghost cells).
    let max_custom_height_row = custom_height_rows.iter().copied().max().unwrap_or(0);
    // Also include rows with stored heights (non-customHeight rows with
    // non-default heights beyond the data range, e.g., styled-empty rows
    // with auto-calculated heights from fonts or thick borders).
    // Scan the row_index to find the max materialized row, since any row
    // with a stored height must have a row_id in the index.
    let max_materialized_row = stores
        .grid_indexes
        .get(sheet_id)
        .map(|gi| gi.row_count().saturating_sub(1))
        .unwrap_or(0);
    let max_custom_format_row = custom_format_rows.iter().copied().max().unwrap_or(0);
    let max_row = max_row
        .max(max_custom_height_row)
        .max(max_materialized_row)
        .max(max_custom_format_row);

    for row in 0..=max_row {
        let is_hidden = hidden_rows.binary_search(&row).is_ok();
        let explicit_height = dimensions::get_row_height_explicit(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            row,
            stores.grid_indexes.get(sheet_id),
        );

        let is_custom_format = custom_format_rows.contains(&row);

        match explicit_height {
            Some(height) => {
                let differs = (height.0 - default_row_height.0).abs() > 0.01;
                let is_custom_height = custom_height_rows.contains(&row);
                let has_metadata = row_outline_levels.contains_key(&row)
                    || explicit_hidden_rows.contains(&row)
                    || explicit_outline_zero_rows.contains(&row)
                    || row_collapsed.contains_key(&row)
                    || row_thick_top.contains(&row)
                    || row_thick_bot.contains(&row)
                    || row_phonetic.contains(&row)
                    || row_spans.contains_key(&row)
                    || bare_empty_rows.contains(&row);
                if differs || is_hidden || is_custom_height || is_custom_format || has_metadata {
                    // When height matches default and the row is only included
                    // for custom_format (not for height/hidden/customHeight),
                    // use 0.0 to avoid emitting a spurious ht="<default>".
                    let emit_height = if !differs && !is_hidden && !is_custom_height {
                        0.0
                    } else {
                        height.0
                    };
                    row_heights.push(RowDimension {
                        row,
                        height: emit_height,
                        height_str: None,
                        custom_height: is_custom_height,
                        hidden: is_hidden,
                        explicit_hidden: explicit_hidden_rows.contains(&row),
                        custom_format: is_custom_format,
                        outline_level: row_outline_levels.get(&row).copied(),
                        explicit_outline_level_zero: explicit_outline_zero_rows.contains(&row),
                        collapsed: row_collapsed.get(&row).copied(),
                        thick_top: row_thick_top.contains(&row),
                        thick_bot: row_thick_bot.contains(&row),
                        phonetic: row_phonetic.contains(&row),
                        descent: None,
                        xml_hints: RowXmlHints {
                            spans: row_spans.get(&row).cloned(),
                            bare_empty: bare_empty_rows.contains(&row),
                        },
                    });
                }
            }
            None => {
                // No stored height — emit if the row is hidden or has
                // customHeight (the height may match the default but
                // customHeight="1" still needs to be preserved).
                let is_custom_height = custom_height_rows.contains(&row);
                let has_metadata = row_outline_levels.contains_key(&row)
                    || explicit_hidden_rows.contains(&row)
                    || explicit_outline_zero_rows.contains(&row)
                    || row_collapsed.contains_key(&row)
                    || row_thick_top.contains(&row)
                    || row_thick_bot.contains(&row)
                    || row_phonetic.contains(&row)
                    || row_spans.contains_key(&row)
                    || bare_empty_rows.contains(&row);
                if is_hidden || is_custom_height || is_custom_format || has_metadata {
                    // Use 0.0 for height when no explicit height is stored.
                    // The sheet_builder skips ht= when height is 0.0 and
                    // custom_height is false, which avoids emitting a
                    // spurious ht="<default>" on custom_format-only rows.
                    let height = if is_hidden || is_custom_height {
                        default_row_height.0
                    } else {
                        0.0
                    };
                    row_heights.push(RowDimension {
                        row,
                        height,
                        height_str: None,
                        custom_height: is_custom_height,
                        hidden: is_hidden,
                        explicit_hidden: explicit_hidden_rows.contains(&row),
                        custom_format: is_custom_format,
                        outline_level: row_outline_levels.get(&row).copied(),
                        explicit_outline_level_zero: explicit_outline_zero_rows.contains(&row),
                        collapsed: row_collapsed.get(&row).copied(),
                        thick_top: row_thick_top.contains(&row),
                        thick_bot: row_thick_bot.contains(&row),
                        phonetic: row_phonetic.contains(&row),
                        descent: None,
                        xml_hints: RowXmlHints {
                            spans: row_spans.get(&row).cloned(),
                            bare_empty: bare_empty_rows.contains(&row),
                        },
                    });
                }
            }
        }
    }

    // Read per-row descent values from meta (stored during hydration)
    let row_descents: std::collections::HashMap<u32, f64> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, (u32, f64)>(&m, &txn, "rowDescents"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };
    // Apply descent to existing RowDimension entries
    for rd in &mut row_heights {
        if let Some(&d) = row_descents.get(&rd.row) {
            rd.descent = Some(d);
        }
    }
    // Add descent-only rows that weren't already in row_heights
    {
        let existing_rows: std::collections::HashSet<u32> =
            row_heights.iter().map(|r| r.row).collect();
        for (&row, &descent) in &row_descents {
            if !existing_rows.contains(&row) {
                row_heights.push(RowDimension {
                    row,
                    height: 0.0,
                    height_str: None,
                    custom_height: false,
                    hidden: false,
                    explicit_hidden: explicit_hidden_rows.contains(&row),
                    custom_format: custom_format_rows.contains(&row),
                    outline_level: row_outline_levels.get(&row).copied(),
                    explicit_outline_level_zero: explicit_outline_zero_rows.contains(&row),
                    collapsed: row_collapsed.get(&row).copied(),
                    thick_top: row_thick_top.contains(&row),
                    thick_bot: row_thick_bot.contains(&row),
                    phonetic: row_phonetic.contains(&row),
                    descent: Some(descent),
                    xml_hints: RowXmlHints {
                        spans: row_spans.get(&row).cloned(),
                        bare_empty: bare_empty_rows.contains(&row),
                    },
                });
            }
        }
        row_heights.sort_by_key(|r| r.row);
    }

    // Read bestFit column set from meta
    let best_fit_cols: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "colBestFit"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    // Read customWidth column set from meta.
    let custom_width_cols: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "colCustomWidth"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    // Read collapsed column set from meta
    let collapsed_cols: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "colCollapsed"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    let phonetic_cols: std::collections::HashSet<u32> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .map(|m| yrs_schema::helpers::read_json_vec::<_, u32>(&m, &txn, "colPhonetic"))
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    // Read custom column widths.
    // Use get_col_width_explicit to distinguish "no stored width" (returns None)
    // from "explicitly stored width". Without this, columns with no stored width
    // return DEFAULT_COL_WIDTH (64.0), which differs from the sheet's actual
    // defaultColWidth (e.g. 7.75) and would be spuriously emitted as custom.
    let mut col_widths = Vec::new();
    let hidden_cols = queries::get_hidden_columns(stores, sheet_id);
    for col in 0..=max_col {
        let is_hidden = hidden_cols.binary_search(&col).is_ok();
        let explicit_width = dimensions::get_col_width_explicit(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            col,
            stores.grid_indexes.get(sheet_id),
        );
        let is_best_fit = best_fit_cols.contains(&col);
        let is_phonetic = phonetic_cols.contains(&col);

        // Only emit a <col> entry if there's an explicit stored width, or the
        // column is hidden/bestFit. Columns with no stored width inherit the
        // sheet's defaultColWidth and need no explicit entry.
        match explicit_width {
            Some(width) => {
                let is_custom_width = custom_width_cols.contains(&col);
                let width_differs = (width.0 - default_col_width.0).abs() > 0.01;
                let custom = is_custom_width || width_differs;
                let is_collapsed = collapsed_cols.contains(&col);
                if custom
                    || width_differs
                    || is_hidden
                    || is_best_fit
                    || is_collapsed
                    || is_phonetic
                {
                    col_widths.push(ColDimension {
                        col,
                        width: width.0,
                        width_str: None,
                        width_present: Some(true),
                        custom_width: custom,
                        custom_width_attr: custom.then_some(true),
                        hidden: is_hidden,
                        hidden_attr: is_hidden.then_some(true),
                        best_fit: is_best_fit,
                        best_fit_attr: is_best_fit.then_some(true),
                        outline_level: None,
                        collapsed: is_collapsed,
                        collapsed_attr: is_collapsed.then_some(true),
                        phonetic: is_phonetic,
                        phonetic_attr: is_phonetic.then_some(true),
                    });
                }
            }
            None => {
                // No explicit width stored — only emit if hidden, bestFit, or collapsed
                let is_collapsed = collapsed_cols.contains(&col);
                if is_hidden || is_best_fit || is_collapsed || is_phonetic {
                    col_widths.push(ColDimension {
                        col,
                        width: default_col_width.0,
                        width_str: None,
                        width_present: Some(true),
                        custom_width: false,
                        custom_width_attr: None,
                        hidden: is_hidden,
                        hidden_attr: is_hidden.then_some(true),
                        best_fit: is_best_fit,
                        best_fit_attr: is_best_fit.then_some(true),
                        outline_level: None,
                        collapsed: is_collapsed,
                        collapsed_attr: is_collapsed.then_some(true),
                        phonetic: is_phonetic,
                        phonetic_attr: is_phonetic.then_some(true),
                    });
                }
            }
        }
    }

    let default_row_descent =
        settings::get_default_row_descent(stores.storage.doc(), stores.storage.sheets(), sheet_id);

    // Only emit default_col_width when explicitly stored in Yrs.
    // When not stored, the original file had no defaultColWidth attribute —
    // emitting the fallback 8.43 would invent data that wasn't there.
    let rt_meta =
        settings::get_roundtrip_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id);

    // Read trailing column ranges from meta (stored during hydration).
    // These represent <col max="16384"> ranges that extend beyond the data region.
    // Use the stored min directly — these ranges start right after the columns
    // that were individually expanded during to_parse_output, and the export's
    // col_widths loop only emits columns with explicitly stored widths, so there
    // is no overlap. The writer's add_col merges adjacent compatible ranges.
    let trailing_col_ranges: Vec<domain_types::TrailingColRange> = {
        let txn = stores.storage.doc().transact();
        get_meta_for_export(&txn, stores.storage.sheets(), sheet_id)
            .and_then(|m| match m.get(&txn, "trailingColRanges") {
                Some(yrs::Out::Any(yrs::Any::String(s))) => serde_json::from_str(&s).ok(),
                _ => None,
            })
            .unwrap_or_default()
    };

    // No conversion needed — Yrs stores canonical OOXML units (points / char-width).

    SheetDimensions {
        default_row_height: Some(default_row_height.0),
        default_col_width: rt_meta.default_col_width,
        default_row_descent,
        base_col_width: rt_meta.base_col_width,
        custom_height: rt_meta.custom_height,
        zero_height: rt_meta.zero_height,
        thick_top: rt_meta.thick_top,
        thick_bottom: rt_meta.thick_bottom,
        outline_level_row: rt_meta.outline_level_row,
        outline_level_col: rt_meta.outline_level_col,
        row_heights,
        col_widths,
        trailing_col_ranges,
    }
}

// -------------------------------------------------------------------
// Tables (from Yrs schema)
// -------------------------------------------------------------------

/// Export tables for a sheet, reading lossless data from the id-keyed Yrs table catalog.
pub(in crate::storage::engine) fn export_tables_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<ExportedTableSpec> {
    let sheet_hex = sheet_id.to_uuid_string();
    let mut catalog_tables = {
        let txn = stores.storage.doc().transact();
        match stores.storage.workbook_map().get(&txn, KEY_TABLES) {
            Some(Out::YMap(tables_map)) => tables_map
                .iter(&txn)
                .filter_map(|(key, value)| match value {
                    Out::YMap(inner) => yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                        .filter(|table| table.id == key && table.sheet_id == sheet_hex)
                        .map(|table| (key.to_string(), table)),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        }
    };
    catalog_tables.sort_by(|(_, left), (_, right)| {
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
    for (_, table) in catalog_tables {
        exported.push(exported_table_spec_for_table(
            stores, mirror, sheet_id, &table,
        ));
    }
    exported
}

fn exported_table_spec_for_table(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table: &TableCatalogEntry,
) -> ExportedTableSpec {
    let mut spec = domain_types::domain::table::catalog_entry_to_xlsx_table_spec(table, None);
    apply_runtime_table_filter_to_spec(stores, mirror, sheet_id, &table.id, &mut spec);
    apply_runtime_table_totals_to_spec(stores, mirror, sheet_id, table, &mut spec);
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
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table_id: &str,
    spec: &mut TableSpec,
) {
    let filter = sheet_filters::get_table_filter(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        table_id,
    );
    let Some(filter) = filter else {
        return;
    };
    if filter.column_filters.is_empty() && filter.sort_state.is_none() {
        return;
    }

    let pos_resolver =
        |cell_id: &str| resolve_filter_cell_position(stores, mirror, sheet_id, cell_id);
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

fn resolve_filter_cell_position(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<(u32, u32)> {
    let id = hex_to_id(cell_id_hex)?;
    let cell_id = CellId::from_raw(id);
    if let Some(pos) = mirror.resolve_position(&cell_id) {
        return Some((pos.row(), pos.col()));
    }
    stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_position(&cell_id))
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
