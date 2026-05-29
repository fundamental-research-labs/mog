//! YrsSchema for TableSpec — flat fields as native keys, columns as JSON.
//!
//! Most table properties (name, style, toggle flags) are stored as native
//! Yrs keys for fine-grained collaborative editing. The columns array is
//! stored as JSON since column definitions change atomically (add/remove).

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::table::*;

// ── Canonical Y.Map keys (used by both Table and TableSpec) ─────────
pub const KEY_ID: &str = "id";
pub const KEY_NAME: &str = "name";
pub const KEY_DISPLAY_NAME: &str = "displayName";
pub const KEY_COLUMNS: &str = "columns";
pub const KEY_STYLE_NAME: &str = "styleName";
pub const KEY_HAS_HEADER_ROW: &str = "hasHeaderRow";
pub const KEY_HAS_TOTALS_ROW: &str = "hasTotalsRow";
pub const KEY_SHOW_ROW_STRIPES: &str = "showRowStripes";
pub const KEY_SHOW_COL_STRIPES: &str = "showColumnStripes";
pub const KEY_SHOW_FIRST_COL: &str = "showFirstColumn";
pub const KEY_SHOW_LAST_COL: &str = "showLastColumn";
pub const KEY_AUTO_EXPAND: &str = "autoExpand";
pub const KEY_AUTO_CALCULATED_COLUMNS: &str = "autoCalculatedColumns";

// ── Table-only keys (canonical Table type) ──────────────────────────
pub const KEY_SHEET_ID: &str = "sheetId";
pub const KEY_START_ROW: &str = "startRow";
pub const KEY_START_COL: &str = "startCol";
pub const KEY_END_ROW: &str = "endRow";
pub const KEY_END_COL: &str = "endCol";
pub const KEY_SHOW_FILTER_BUTTONS: &str = "showFilterButtons";

// ── OOXML round-trip keys (TableSpec / legacy) ──────────────────────
pub const KEY_RANGE_REF: &str = "rangeRef";
pub const KEY_AUTO_FILTER_REF: &str = "autoFilterRef";
pub const KEY_HEADER_ROW_DXF_ID: &str = "headerRowDxfId";
pub const KEY_DATA_DXF_ID: &str = "dataDxfId";
pub const KEY_TOTALS_ROW_DXF_ID: &str = "totalsRowDxfId";
pub const KEY_HEADER_ROW_BORDER_DXF_ID: &str = "headerRowBorderDxfId";
pub const KEY_TABLE_BORDER_DXF_ID: &str = "tableBorderDxfId";
pub const KEY_TOTALS_ROW_BORDER_DXF_ID: &str = "totalsRowBorderDxfId";
pub const KEY_HEADER_ROW_CELL_STYLE: &str = "headerRowCellStyle";
pub const KEY_DATA_CELL_STYLE: &str = "dataCellStyle";
pub const KEY_TOTALS_ROW_CELL_STYLE: &str = "totalsRowCellStyle";
pub const KEY_TABLE_TYPE: &str = "tableType";
pub const KEY_TOTALS_ROW_SHOWN: &str = "totalsRowShown";
pub const KEY_CONNECTION_ID: &str = "connectionId";
pub const KEY_COMMENT: &str = "comment";
pub const KEY_INSERT_ROW: &str = "insertRow";
pub const KEY_INSERT_ROW_SHIFT: &str = "insertRowShift";
pub const KEY_PUBLISHED: &str = "published";
pub const KEY_OOXML_COLUMNS: &str = "ooxmlColumns";
pub const KEY_OOXML_META: &str = "ooxmlMeta";
pub const KEY_QUERY_TABLE: &str = "queryTable";
pub const KEY_WORKSHEET_RELATIONSHIP_ID_HINT: &str = "worksheetRelationshipIdHint";
pub const KEY_TABLE_PART_PATH_HINT: &str = "tablePartPathHint";
pub const KEY_WORKSHEET_RELATIONSHIP_TARGET_HINT: &str = "worksheetRelationshipTargetHint";

/// Write a TableSpec to Y.Map prelim entries.
pub fn to_yrs_prelim(table: &TableSpec) -> Vec<(&str, Any)> {
    let cols_json = serde_json::to_string(&table.columns).unwrap_or_default();

    let mut entries = vec![
        (KEY_ID, Any::Number(table.id as f64)),
        (KEY_NAME, Any::String(Arc::from(table.name.as_str()))),
        (
            KEY_DISPLAY_NAME,
            Any::String(Arc::from(table.display_name.as_str())),
        ),
        (
            KEY_RANGE_REF,
            Any::String(Arc::from(table.range_ref.as_str())),
        ),
        (KEY_HAS_HEADER_ROW, Any::Bool(table.has_headers)),
        (KEY_HAS_TOTALS_ROW, Any::Bool(table.has_totals)),
        (KEY_SHOW_ROW_STRIPES, Any::Bool(table.row_stripes)),
        (KEY_SHOW_COL_STRIPES, Any::Bool(table.col_stripes)),
        (KEY_SHOW_FIRST_COL, Any::Bool(table.first_col_highlight)),
        (KEY_SHOW_LAST_COL, Any::Bool(table.last_col_highlight)),
        (KEY_COLUMNS, Any::String(Arc::from(cols_json.as_str()))),
    ];

    // Optional fields
    match &table.style_name {
        Some(s) => entries.push((KEY_STYLE_NAME, Any::String(Arc::from(s.as_str())))),
        None => entries.push((KEY_STYLE_NAME, Any::Null)),
    }
    match &table.auto_filter_ref {
        Some(s) => entries.push((KEY_AUTO_FILTER_REF, Any::String(Arc::from(s.as_str())))),
        None => entries.push((KEY_AUTO_FILTER_REF, Any::Null)),
    }
    if let Some(s) = &table.auto_filter_xr_uid {
        entries.push(("autoFilterXrUid", Any::String(Arc::from(s.as_str()))));
    }
    if let Some(s) = &table.auto_filter_ext_lst_raw {
        entries.push(("autoFilterExtLstRaw", Any::String(Arc::from(s.as_str()))));
    }

    // DXF formatting IDs
    if let Some(v) = table.header_row_dxf_id {
        entries.push((KEY_HEADER_ROW_DXF_ID, Any::Number(v as f64)));
    }
    if let Some(v) = table.data_dxf_id {
        entries.push((KEY_DATA_DXF_ID, Any::Number(v as f64)));
    }
    if let Some(v) = table.totals_row_dxf_id {
        entries.push((KEY_TOTALS_ROW_DXF_ID, Any::Number(v as f64)));
    }
    if let Some(v) = table.header_row_border_dxf_id {
        entries.push((KEY_HEADER_ROW_BORDER_DXF_ID, Any::Number(v as f64)));
    }
    if let Some(v) = table.table_border_dxf_id {
        entries.push((KEY_TABLE_BORDER_DXF_ID, Any::Number(v as f64)));
    }
    if let Some(v) = table.totals_row_border_dxf_id {
        entries.push((KEY_TOTALS_ROW_BORDER_DXF_ID, Any::Number(v as f64)));
    }

    // Named cell styles
    if let Some(s) = &table.header_row_cell_style {
        entries.push((
            KEY_HEADER_ROW_CELL_STYLE,
            Any::String(Arc::from(s.as_str())),
        ));
    }
    if let Some(s) = &table.data_cell_style {
        entries.push((KEY_DATA_CELL_STYLE, Any::String(Arc::from(s.as_str()))));
    }
    if let Some(s) = &table.totals_row_cell_style {
        entries.push((
            KEY_TOTALS_ROW_CELL_STYLE,
            Any::String(Arc::from(s.as_str())),
        ));
    }

    // Table metadata fields
    if let Some(s) = &table.table_type {
        entries.push((KEY_TABLE_TYPE, Any::String(Arc::from(s.as_str()))));
    }
    if let Some(shown) = table.totals_row_shown {
        entries.push((KEY_TOTALS_ROW_SHOWN, Any::Bool(shown)));
    }
    if let Some(v) = table.connection_id {
        entries.push((KEY_CONNECTION_ID, Any::Number(v as f64)));
    }
    if let Some(s) = &table.comment {
        entries.push((KEY_COMMENT, Any::String(Arc::from(s.as_str()))));
    }
    if table.insert_row {
        entries.push((KEY_INSERT_ROW, Any::Bool(true)));
    }
    if table.insert_row_shift {
        entries.push((KEY_INSERT_ROW_SHIFT, Any::Bool(true)));
    }
    if table.published {
        entries.push((KEY_PUBLISHED, Any::Bool(true)));
    }
    if let Some(ref uid) = table.xr_uid {
        entries.push(("xrUid", Any::String(Arc::from(uid.as_str()))));
    }
    if let Some(ref ss) = table.sort_state
        && let Ok(json) = serde_json::to_string(ss)
    {
        entries.push(("sortState", Any::String(Arc::from(json.as_str()))));
    }
    if !table.filter_columns.is_empty()
        && let Ok(json) = serde_json::to_string(&table.filter_columns)
    {
        entries.push(("filterColumns", Any::String(Arc::from(json.as_str()))));
    }
    if let Some(ref query_table) = table.query_table
        && let Ok(json) = serde_json::to_string(query_table)
    {
        entries.push((KEY_QUERY_TABLE, Any::String(Arc::from(json.as_str()))));
    }
    if let Some(s) = &table.worksheet_relationship_id_hint {
        entries.push((
            KEY_WORKSHEET_RELATIONSHIP_ID_HINT,
            Any::String(Arc::from(s.as_str())),
        ));
    }
    if let Some(s) = &table.table_part_path_hint {
        entries.push((KEY_TABLE_PART_PATH_HINT, Any::String(Arc::from(s.as_str()))));
    }
    if let Some(s) = &table.worksheet_relationship_target_hint {
        entries.push((
            KEY_WORKSHEET_RELATIONSHIP_TARGET_HINT,
            Any::String(Arc::from(s.as_str())),
        ));
    }

    entries
}

/// Write a canonical Table to Y.Map prelim entries.
pub fn to_yrs_prelim_from_table(table: &Table) -> Vec<(&str, Any)> {
    let cols_json = serde_json::to_string(&table.columns).unwrap_or_default();

    vec![
        (KEY_ID, Any::String(Arc::from(table.id.as_str()))),
        (KEY_NAME, Any::String(Arc::from(table.name.as_str()))),
        (
            KEY_DISPLAY_NAME,
            Any::String(Arc::from(table.display_name.as_str())),
        ),
        (
            KEY_SHEET_ID,
            Any::String(Arc::from(table.sheet_id.as_str())),
        ),
        (KEY_START_ROW, Any::Number(table.range.start_row() as f64)),
        (KEY_START_COL, Any::Number(table.range.start_col() as f64)),
        (KEY_END_ROW, Any::Number(table.range.end_row() as f64)),
        (KEY_END_COL, Any::Number(table.range.end_col() as f64)),
        (KEY_COLUMNS, Any::String(Arc::from(cols_json.as_str()))),
        (KEY_HAS_HEADER_ROW, Any::Bool(table.has_header_row)),
        (KEY_HAS_TOTALS_ROW, Any::Bool(table.has_totals_row)),
        (KEY_STYLE_NAME, Any::String(Arc::from(table.style.as_str()))),
        (KEY_SHOW_ROW_STRIPES, Any::Bool(table.banded_rows)),
        (KEY_SHOW_COL_STRIPES, Any::Bool(table.banded_columns)),
        (KEY_SHOW_FIRST_COL, Any::Bool(table.emphasize_first_column)),
        (KEY_SHOW_LAST_COL, Any::Bool(table.emphasize_last_column)),
        (
            KEY_SHOW_FILTER_BUTTONS,
            Any::Bool(table.show_filter_buttons),
        ),
        (KEY_AUTO_EXPAND, Any::Bool(table.auto_expand)),
        (
            KEY_AUTO_CALCULATED_COLUMNS,
            Any::Bool(table.auto_calculated_columns),
        ),
        (
            KEY_RANGE_REF,
            Any::String(Arc::from(
                format!(
                    "{}{}:{}{}",
                    col_index_to_letter(table.range.start_col()),
                    table.range.start_row() + 1,
                    col_index_to_letter(table.range.end_col()),
                    table.range.end_row() + 1,
                )
                .as_str(),
            )),
        ),
    ]
}

/// Read a TableSpec from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<TableSpec> {
    let columns: Vec<TableColumnSpec> = read_string(map, txn, KEY_COLUMNS)
        .and_then(|s| {
            // Try OOXML TableColumnSpec format first (imported tables).
            serde_json::from_str::<Vec<TableColumnSpec>>(&s)
                .ok()
                .or_else(|| {
                    // Fallback: canonical TableColumn format (runtime-created tables
                    // persisted via to_yrs_prelim_from_table). Convert to TableColumnSpec
                    // so the OOXML export path can consume them.
                    serde_json::from_str::<Vec<TableColumn>>(&s)
                        .ok()
                        .map(|defs| {
                            defs.iter()
                                .map(|c| TableColumnSpec {
                                    id: c.id.parse::<u32>().unwrap_or(0),
                                    name: c.name.clone(),
                                    totals_function: c.totals_function,
                                    totals_label: c.totals_label.clone(),
                                    calculated_formula: c.calculated_formula.clone(),
                                    ..TableColumnSpec::default()
                                })
                                .collect()
                        })
                })
        })
        .unwrap_or_default();

    Some(TableSpec {
        id: read_u32(map, txn, KEY_ID)
            .or_else(|| read_string(map, txn, KEY_ID).and_then(|s| s.parse::<u32>().ok()))
            .unwrap_or(0),
        name: read_string(map, txn, KEY_NAME).unwrap_or_default(),
        display_name: read_string(map, txn, KEY_DISPLAY_NAME).unwrap_or_default(),
        range_ref: read_string(map, txn, KEY_RANGE_REF).unwrap_or_default(),
        has_headers: read_bool(map, txn, KEY_HAS_HEADER_ROW).unwrap_or(true),
        has_totals: read_bool(map, txn, KEY_HAS_TOTALS_ROW).unwrap_or(false),
        style_name: read_string(map, txn, KEY_STYLE_NAME),
        row_stripes: read_bool(map, txn, KEY_SHOW_ROW_STRIPES).unwrap_or(true),
        col_stripes: read_bool(map, txn, KEY_SHOW_COL_STRIPES).unwrap_or(false),
        first_col_highlight: read_bool(map, txn, KEY_SHOW_FIRST_COL).unwrap_or(false),
        last_col_highlight: read_bool(map, txn, KEY_SHOW_LAST_COL).unwrap_or(false),
        auto_filter_ref: read_string(map, txn, KEY_AUTO_FILTER_REF),
        auto_filter_xr_uid: read_string(map, txn, "autoFilterXrUid"),
        auto_filter_ext_lst_raw: read_string(map, txn, "autoFilterExtLstRaw"),
        columns,
        header_row_dxf_id: read_u32(map, txn, KEY_HEADER_ROW_DXF_ID),
        data_dxf_id: read_u32(map, txn, KEY_DATA_DXF_ID),
        totals_row_dxf_id: read_u32(map, txn, KEY_TOTALS_ROW_DXF_ID),
        header_row_border_dxf_id: read_u32(map, txn, KEY_HEADER_ROW_BORDER_DXF_ID),
        table_border_dxf_id: read_u32(map, txn, KEY_TABLE_BORDER_DXF_ID),
        totals_row_border_dxf_id: read_u32(map, txn, KEY_TOTALS_ROW_BORDER_DXF_ID),
        header_row_cell_style: read_string(map, txn, KEY_HEADER_ROW_CELL_STYLE),
        data_cell_style: read_string(map, txn, KEY_DATA_CELL_STYLE),
        totals_row_cell_style: read_string(map, txn, KEY_TOTALS_ROW_CELL_STYLE),
        table_type: read_string(map, txn, KEY_TABLE_TYPE),
        totals_row_shown: read_bool(map, txn, KEY_TOTALS_ROW_SHOWN),
        connection_id: read_u32(map, txn, KEY_CONNECTION_ID),
        comment: read_string(map, txn, KEY_COMMENT),
        insert_row: read_bool(map, txn, KEY_INSERT_ROW).unwrap_or(false),
        insert_row_shift: read_bool(map, txn, KEY_INSERT_ROW_SHIFT).unwrap_or(false),
        published: read_bool(map, txn, KEY_PUBLISHED).unwrap_or(false),
        xr_uid: read_string(map, txn, "xrUid"),
        sort_state: read_string(map, txn, "sortState").and_then(|s| serde_json::from_str(&s).ok()),
        filter_columns: read_string(map, txn, "filterColumns")
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        query_table: read_string(map, txn, KEY_QUERY_TABLE)
            .and_then(|s| serde_json::from_str(&s).ok()),
        worksheet_relationship_id_hint: read_string(map, txn, KEY_WORKSHEET_RELATIONSHIP_ID_HINT),
        table_part_path_hint: read_string(map, txn, KEY_TABLE_PART_PATH_HINT),
        worksheet_relationship_target_hint: read_string(
            map,
            txn,
            KEY_WORKSHEET_RELATIONSHIP_TARGET_HINT,
        ),
    })
}

/// Reconstruct a canonical Table from a `TableBinding` JSON + external range extent.
///
/// This is Tier 1 of the three-tier read path: Range-backed tables store their
/// schema in `rangeBindings[range_id]` as JSON and their extent in the Range itself.
///
/// Returns `None` if the JSON fails to parse.
pub fn from_binding_to_table(
    binding_json: &str,
    table_id: &str,
    sheet_id: &str,
    range: cell_types::SheetRange,
) -> Option<Table> {
    let binding: crate::domain::table::TableBinding = serde_json::from_str(binding_json).ok()?;
    Some(binding.to_table(table_id, sheet_id, range))
}

/// Serialize a canonical Table to a `TableBinding` JSON string.
///
/// The binding is self-contained: it includes table ID, sheet ID, and range
/// coordinates alongside schema metadata.
pub fn table_to_binding_json(table: &Table) -> Option<String> {
    let binding = crate::domain::table::TableBinding::from_table(table);
    serde_json::to_string(&binding).ok()
}

/// Reconstruct a canonical Table from a self-contained `TableBinding` JSON.
///
/// Unlike `from_binding_to_table`, this does not require external `table_id`,
/// `sheet_id`, or `range` parameters -- they are read from the binding itself.
/// Returns `None` if the JSON fails to parse or lacks required extent fields.
pub fn from_binding_json_standalone(binding_json: &str) -> Option<Table> {
    let binding: crate::domain::table::TableBinding = serde_json::from_str(binding_json).ok()?;
    binding.to_table_standalone()
}

/// Read a canonical Table from a Y.Map.
///
/// Three-tier read path:
/// - Tier 1 (Range-backed): Not checked here — caller should check `rangeBindings`
///   first and call `from_binding_to_table` if found.
/// - Tier 2 (Canonical): Check canonical keys (startRow/startCol/endRow/endCol,
///   id as String, columns as Vec<TableColumn>).
/// - Tier 3 (OOXML fallback): Fall back to rangeRef as A1 string, id as Number,
///   columns as Vec<TableColumnSpec>.
pub fn from_yrs_map_to_table<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<Table> {
    // ID: try String first, fall back to Number→String
    let id = read_string(map, txn, KEY_ID)
        .or_else(|| read_u32(map, txn, KEY_ID).map(|n| format!("{}", n)))
        .unwrap_or_default();

    // Range: try canonical keys first, fall back to parsing OOXML rangeRef
    let range = match (
        read_u32(map, txn, KEY_START_ROW),
        read_u32(map, txn, KEY_START_COL),
        read_u32(map, txn, KEY_END_ROW),
        read_u32(map, txn, KEY_END_COL),
    ) {
        (Some(sr), Some(sc), Some(er), Some(ec)) => cell_types::SheetRange::new(sr, sc, er, ec),
        _ => {
            // Fallback: parse OOXML rangeRef (A1 string like "A1:D20")
            let range_ref = read_string(map, txn, KEY_RANGE_REF).unwrap_or_default();
            crate::domain::table::parse_table_range_ref(&range_ref)
                .map(|(sr, sc, er, ec)| cell_types::SheetRange::new(sr, sc, er, ec))
                .unwrap_or_else(|| cell_types::SheetRange::new(0, 0, 0, 0))
        }
    };

    // Columns: try canonical TableColumn first, fall back to OOXML TableColumnSpec
    let columns: Vec<TableColumn> = read_string(map, txn, KEY_COLUMNS)
        .and_then(|s| {
            // Try canonical format first
            serde_json::from_str::<Vec<TableColumn>>(&s)
                .ok()
                .or_else(|| {
                    // Fallback: parse OOXML TableColumnSpec format and convert
                    serde_json::from_str::<Vec<TableColumnSpec>>(&s)
                        .ok()
                        .map(|ooxml_cols| {
                            ooxml_cols
                                .iter()
                                .enumerate()
                                .map(|(i, c)| TableColumn {
                                    id: format!("{}", c.id),
                                    name: c.name.clone(),
                                    index: i as u32,
                                    totals_function: c.totals_function,
                                    totals_label: c.totals_label.clone(),
                                    calculated_formula: c.calculated_formula.clone(),
                                })
                                .collect()
                        })
                })
        })
        .unwrap_or_default();

    Some(Table {
        id,
        name: read_string(map, txn, KEY_NAME).unwrap_or_default(),
        display_name: read_string(map, txn, KEY_DISPLAY_NAME).unwrap_or_default(),
        sheet_id: read_string(map, txn, KEY_SHEET_ID).unwrap_or_default(),
        range,
        columns,
        has_header_row: read_bool(map, txn, KEY_HAS_HEADER_ROW).unwrap_or(true),
        has_totals_row: read_bool(map, txn, KEY_HAS_TOTALS_ROW).unwrap_or(false),
        style: read_string(map, txn, KEY_STYLE_NAME).unwrap_or_default(),
        banded_rows: read_bool(map, txn, KEY_SHOW_ROW_STRIPES).unwrap_or(true),
        banded_columns: read_bool(map, txn, KEY_SHOW_COL_STRIPES).unwrap_or(false),
        emphasize_first_column: read_bool(map, txn, KEY_SHOW_FIRST_COL).unwrap_or(false),
        emphasize_last_column: read_bool(map, txn, KEY_SHOW_LAST_COL).unwrap_or(false),
        show_filter_buttons: read_bool(map, txn, KEY_SHOW_FILTER_BUTTONS).unwrap_or(true),
        auto_expand: read_bool(map, txn, KEY_AUTO_EXPAND).unwrap_or(true),
        auto_calculated_columns: read_bool(map, txn, KEY_AUTO_CALCULATED_COLUMNS).unwrap_or(true),
    })
}
