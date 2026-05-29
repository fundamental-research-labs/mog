//! Dimensions and tables export functions.
//!
//! Extracted from `export.rs` — row heights, column widths, hidden
//! rows/cols, and table specs.

use cell_types::SheetId;
use compute_document::schema::*;
use domain_types::{
    ColDimension, RowDimension, RowXmlHints, SheetDimensions, domain::table::TableSpec, yrs_schema,
};
use yrs::{Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::engine::services::queries;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::get_meta_for_export;
use crate::storage::sheet::{dimensions, settings};

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

/// Export tables for a sheet, reading lossless data from Yrs schema.
/// Takes a list of table names that belong to this sheet (from the compute mirror).
pub(in crate::storage::engine) fn export_tables_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<TableSpec> {
    let table_names: Vec<String> = mirror
        .all_table_defs()
        .iter()
        .filter(|t| t.sheet == *sheet_id)
        .map(|t| t.name.clone())
        .collect();
    let txn = stores.storage.doc().transact();
    let yrs_tables_map = stores
        .storage
        .workbook_map()
        .get(&txn, KEY_TABLES)
        .and_then(|v| match v {
            Out::YMap(m) => Some(m),
            _ => None,
        });
    table_names
        .iter()
        .filter_map(|name| {
            yrs_tables_map
                .as_ref()
                .and_then(|tm| match tm.get(&txn, name.as_str()) {
                    Some(Out::YMap(inner)) => yrs_schema::table::from_yrs_map(&inner, &txn),
                    _ => None,
                })
        })
        .collect()
}
