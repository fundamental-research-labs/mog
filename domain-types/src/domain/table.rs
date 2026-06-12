use ooxml_types::cond_format::IconSetType;
use serde::{Deserialize, Deserializer, Serialize};

use super::filter::{SortConditionBy, SortMethod};

mod ooxml;

#[cfg(feature = "yrs")]
pub(crate) use ooxml::col_index_to_letter;
pub use ooxml::{
    catalog_entry_to_xlsx_table_spec, parse_table_range_ref,
    xlsx_table_spec_to_catalog_entry_with_ids,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSpec {
    pub id: u32,
    pub name: String,
    pub display_name: String,
    /// "A1:D10"
    pub range_ref: String,
    pub has_headers: bool,
    pub has_totals: bool,
    pub style_name: Option<String>,
    pub row_stripes: bool,
    pub col_stripes: bool,
    pub first_col_highlight: bool,
    pub last_col_highlight: bool,
    pub auto_filter_ref: Option<String>,
    /// Auto-filter xr:uid for revision tracking
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_xr_uid: Option<String>,
    /// Raw direct-child `<extLst>` owned by the table autoFilter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_ext_lst_raw: Option<String>,
    pub columns: Vec<TableColumnSpec>,
    // DXF formatting IDs (differential formatting for table regions)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_border_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_border_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_border_dxf_id: Option<u32>,
    // Named cell styles for table regions
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Table type (worksheet, xml, queryTable). Default is "worksheet".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
    /// Whether totals row is shown (None = attribute absent, OOXML default is true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_shown: Option<bool>,
    /// Connection ID for external data sources (query tables).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<u32>,
    /// Table comment attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Whether to insert a blank row below table.
    #[serde(default)]
    pub insert_row: bool,
    /// Whether insert row shifts existing rows.
    #[serde(default)]
    pub insert_row_shift: bool,
    /// Whether the table is published.
    #[serde(default)]
    pub published: bool,
    /// Extension UID for revision tracking (xr:uid).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    /// Table-level sort state (sortState element at table level).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<TableSortState>,
    /// Auto-filter column definitions (filter criteria applied to columns).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_columns: Vec<FilterColumnSpec>,
    /// Query table owned by this table part, when the table is backed by an
    /// external workbook connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_table: Option<super::connections::QueryTable>,
    /// Imported worksheet relationship id for this table, when the table still
    /// maps to the same live table relationship on export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_id_hint: Option<String>,
    /// Imported package path for the table part, retained as typed provenance
    /// for graph-owned export decisions and diagnostics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_part_path_hint: Option<String>,
    /// Imported worksheet relationship target spelling for this table part.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_target_hint: Option<String>,
}

/// Sort state for a table (for round-trip fidelity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSortState {
    /// Reference range for the sort
    pub ref_range: String,
    /// Whether the sort operates column-wise rather than row-wise.
    #[serde(default)]
    pub column_sort: bool,
    /// Whether sort is case sensitive
    #[serde(default)]
    pub case_sensitive: bool,
    /// CJK sort method.
    #[serde(default)]
    pub sort_method: SortMethod,
    /// Sort conditions
    pub conditions: Vec<TableSortCondition>,
    /// Raw direct-child `<extLst>` owned by this sortState.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
}

/// A single sort condition within a table sort state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSortCondition {
    /// Reference range for this sort condition
    pub ref_range: String,
    /// Whether this condition sorts descending
    #[serde(default)]
    pub descending: bool,
    /// What to sort on: value, cell color, font color, or icon.
    #[serde(default)]
    pub sort_by: SortConditionBy,
    /// Custom sort list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_list: Option<String>,
    /// Differential format ID for color sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dxf_id: Option<u32>,
    /// Conditional-formatting icon set for icon sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_set: Option<IconSetType>,
    /// Zero-based icon ID for icon sorts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<u32>,
}

impl Default for TableSpec {
    fn default() -> Self {
        Self {
            id: 0,
            name: String::new(),
            display_name: String::new(),
            range_ref: String::new(),
            has_headers: true,
            has_totals: false,
            style_name: None,
            row_stripes: true,
            col_stripes: false,
            first_col_highlight: false,
            last_col_highlight: false,
            auto_filter_ref: None,
            auto_filter_xr_uid: None,
            auto_filter_ext_lst_raw: None,
            columns: Vec::new(),
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_border_dxf_id: None,
            table_border_dxf_id: None,
            totals_row_border_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            table_type: None,
            totals_row_shown: None,
            connection_id: None,
            comment: None,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            xr_uid: None,
            sort_state: None,
            filter_columns: Vec::new(),
            query_table: None,
            worksheet_relationship_id_hint: None,
            table_part_path_hint: None,
            worksheet_relationship_target_hint: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnSpec {
    /// Column ID (unique within table, 1-based)
    #[serde(default)]
    pub id: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_function: Option<TotalsFunction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculated_formula: Option<String>,
    /// Whether calculated column formula is an array formula
    #[serde(default)]
    pub calculated_formula_array: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_formula: Option<String>,
    /// Whether totals row formula is an array formula
    #[serde(default)]
    pub totals_row_formula_array: bool,
    // DXF formatting IDs
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    // Named cell styles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Unique name for the column (uniqueName attribute, used by query tables).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unique_name: Option<String>,
    /// Query table field ID (queryTableFieldId attribute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_table_field_id: Option<u32>,
    /// XML column properties for XML-mapped table columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xml_column_pr: Option<ooxml_types::tables::XmlColumnPr>,
    /// Extension UID for revision tracking (xr3:uid).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr3_uid: Option<String>,
}

// =============================================================================
// Auto-filter column types (for round-trip fidelity)
// =============================================================================

/// A filter column definition — one column's active filter criteria.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterColumnSpec {
    pub col_id: u32,
    #[serde(default)]
    pub hidden_button: bool,
    #[serde(default = "default_true", skip_serializing_if = "is_true_default")]
    pub show_button: bool,
    pub filter: FilterSpec,
    /// Raw direct-child `<extLst>` owned by this filterColumn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_raw: Option<String>,
}

fn is_true_default(v: &bool) -> bool {
    *v
}

/// The filter type and settings for a single column.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FilterSpec {
    /// Discrete value filter (CT_Filters)
    Values {
        #[serde(default)]
        blank: bool,
        values: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        calendar_type: Option<super::filter::CalendarType>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        date_group_items: Vec<super::filter::DateGroupItem>,
    },
    /// Custom filter with 1-2 conditions (CT_CustomFilters)
    Custom {
        #[serde(default)]
        and: bool,
        filters: Vec<CustomFilterSpec>,
    },
    /// Top/bottom N filter (CT_Top10)
    Top10 {
        #[serde(default = "default_true")]
        top: bool,
        #[serde(default)]
        percent: bool,
        val: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filter_val: Option<f64>,
    },
    /// Dynamic filter (CT_DynamicFilter)
    Dynamic {
        kind: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        val: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_val: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        val_iso: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_val_iso: Option<String>,
    },
    /// Color filter (CT_ColorFilter)
    Color {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dxf_id: Option<u32>,
        #[serde(default = "default_true")]
        cell_color: bool,
    },
    /// Icon filter (CT_IconFilter)
    Icon {
        icon_set: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        icon_id: Option<u32>,
    },
}

impl<'de> Deserialize<'de> for FilterSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut value = serde_json::Value::deserialize(deserializer)?;
        if value.get("type").is_none()
            && let Some(object) = value.as_object()
            && object.len() == 1
            && let Some((legacy_kind, legacy_payload)) = object.iter().next()
        {
            let mut payload = legacy_payload.clone();
            if let Some(payload_object) = payload.as_object_mut() {
                payload_object.insert(
                    "type".to_string(),
                    serde_json::Value::String(legacy_kind.clone()),
                );
                value = payload;
            }
        }

        #[derive(Deserialize)]
        #[serde(tag = "type", rename_all = "camelCase")]
        enum TaggedFilterSpec {
            Values {
                #[serde(default)]
                blank: bool,
                values: Vec<String>,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                calendar_type: Option<super::filter::CalendarType>,
                #[serde(default, skip_serializing_if = "Vec::is_empty")]
                date_group_items: Vec<super::filter::DateGroupItem>,
            },
            Custom {
                #[serde(default)]
                and: bool,
                filters: Vec<CustomFilterSpec>,
            },
            Top10 {
                #[serde(default = "default_true")]
                top: bool,
                #[serde(default)]
                percent: bool,
                val: f64,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                filter_val: Option<f64>,
            },
            Dynamic {
                kind: String,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                val: Option<f64>,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                max_val: Option<f64>,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                val_iso: Option<String>,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                max_val_iso: Option<String>,
            },
            Color {
                #[serde(default, skip_serializing_if = "Option::is_none")]
                dxf_id: Option<u32>,
                #[serde(default = "default_true")]
                cell_color: bool,
            },
            Icon {
                icon_set: String,
                #[serde(default, skip_serializing_if = "Option::is_none")]
                icon_id: Option<u32>,
            },
        }

        Ok(
            match serde_json::from_value(value).map_err(serde::de::Error::custom)? {
                TaggedFilterSpec::Values {
                    blank,
                    values,
                    calendar_type,
                    date_group_items,
                } => Self::Values {
                    blank,
                    values,
                    calendar_type,
                    date_group_items,
                },
                TaggedFilterSpec::Custom { and, filters } => Self::Custom { and, filters },
                TaggedFilterSpec::Top10 {
                    top,
                    percent,
                    val,
                    filter_val,
                } => Self::Top10 {
                    top,
                    percent,
                    val,
                    filter_val,
                },
                TaggedFilterSpec::Dynamic {
                    kind,
                    val,
                    max_val,
                    val_iso,
                    max_val_iso,
                } => Self::Dynamic {
                    kind,
                    val,
                    max_val,
                    val_iso,
                    max_val_iso,
                },
                TaggedFilterSpec::Color { dxf_id, cell_color } => {
                    Self::Color { dxf_id, cell_color }
                }
                TaggedFilterSpec::Icon { icon_set, icon_id } => Self::Icon { icon_set, icon_id },
            },
        )
    }
}

fn default_true() -> bool {
    true
}

/// A single custom filter condition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFilterSpec {
    pub operator: String,
    pub val: String,
}

// =============================================================================
// Canonical table types
// =============================================================================

/// Totals row aggregation function (proper enum, not stringly-typed).
/// Replaces `Option<String>` in old TableSpec and matches compute-table's TotalsFunction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TotalsFunction {
    Average,
    Count,
    CountNums,
    Max,
    Min,
    StdDev,
    Sum,
    Var,
    Custom,
    None,
}

impl TotalsFunction {
    /// Convert an OOXML totals function string to the enum.
    /// OOXML uses lowercase strings: "average", "count", "countNums", "max", "min", "stdDev", "sum", "var", "custom", "none".
    pub fn from_ooxml_str(s: &str) -> Option<TotalsFunction> {
        match s {
            "average" => Some(TotalsFunction::Average),
            "count" => Some(TotalsFunction::Count),
            "countNums" => Some(TotalsFunction::CountNums),
            "max" => Some(TotalsFunction::Max),
            "min" => Some(TotalsFunction::Min),
            "stdDev" => Some(TotalsFunction::StdDev),
            "sum" => Some(TotalsFunction::Sum),
            "var" => Some(TotalsFunction::Var),
            "custom" => Some(TotalsFunction::Custom),
            "none" => Some(TotalsFunction::None),
            _ => Option::None,
        }
    }

    /// Convert the enum to an OOXML totals function string.
    pub fn to_ooxml_str(&self) -> &str {
        match self {
            TotalsFunction::Average => "average",
            TotalsFunction::Count => "count",
            TotalsFunction::CountNums => "countNums",
            TotalsFunction::Max => "max",
            TotalsFunction::Min => "min",
            TotalsFunction::StdDev => "stdDev",
            TotalsFunction::Sum => "sum",
            TotalsFunction::Var => "var",
            TotalsFunction::Custom => "custom",
            TotalsFunction::None => "none",
        }
    }
}

/// A column within a table — the canonical runtime representation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    /// Unique column ID (String, consistent across all systems).
    pub id: String,
    /// Imported or export-projected OOXML column ID. This is package metadata,
    /// not the stable Mog column identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_column_id: Option<u32>,
    /// Column display name.
    pub name: String,
    /// Position within table (0-based).
    pub index: u32,
    /// Totals row aggregation function (null when absent).
    pub totals_function: Option<TotalsFunction>,
    /// Custom totals label (e.g., "Total").
    pub totals_label: Option<String>,
    /// Calculated column formula.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_formula: Option<String>,
    /// Whether calculated column formula is an array formula.
    #[serde(default)]
    pub calculated_formula_array: bool,
    /// Totals row formula.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_formula: Option<String>,
    /// Whether totals row formula is an array formula.
    #[serde(default)]
    pub totals_row_formula_array: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Unique name for query-table columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unique_name: Option<String>,
    /// Query table field ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_table_field_id: Option<u32>,
    /// XML column properties for XML-mapped table columns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xml_column_pr: Option<ooxml_types::tables::XmlColumnPr>,
    /// Extension UID for revision tracking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr3_uid: Option<String>,
}

/// Complete table definition — the one canonical representation stored in Yrs.
///
/// `TableCatalogEntry` is an alias for this type at storage/engine boundaries.
/// XLSX import transforms `TableSpec` -> `TableCatalogEntry`.
/// XLSX export transforms `TableCatalogEntry` -> `TableSpec`.
/// Formula engine projects `TableCatalogEntry` -> `TableDef`.
/// `compute-table` operations consume the same canonical shape directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    /// Unique table ID (String).
    pub id: String,
    /// Imported or export-projected OOXML table ID. This is package metadata,
    /// not the stable Mog table identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_table_id: Option<u32>,
    /// Table name.
    pub name: String,
    /// Display name (may differ from name for OOXML round-trip).
    pub display_name: String,
    /// Sheet ID as UUID hex string.
    pub sheet_id: String,
    /// Table range (structured, not A1 string).
    pub range: cell_types::SheetRange,
    /// Column definitions.
    pub columns: Vec<TableColumn>,
    /// Whether the table has a header row.
    pub has_header_row: bool,
    /// Whether the table has a totals row.
    pub has_totals_row: bool,
    /// Style preset name (e.g., "TableStyleMedium2").
    pub style: String,
    /// Show banded (alternating) row stripes.
    pub banded_rows: bool,
    /// Show banded (alternating) column stripes.
    pub banded_columns: bool,
    /// Emphasize the first column.
    pub emphasize_first_column: bool,
    /// Emphasize the last column.
    pub emphasize_last_column: bool,
    /// Show auto-filter dropdown buttons.
    pub show_filter_buttons: bool,
    /// Whether this table automatically expands when adjacent user input is entered.
    #[serde(default = "default_true")]
    pub auto_expand: bool,
    /// Whether formulas entered in table data columns automatically create/fill calculated columns.
    #[serde(default = "default_true")]
    pub auto_calculated_columns: bool,
    /// Imported OOXML auto-filter range, when distinct metadata must round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_xr_uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_filter_ext_lst_raw: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_border_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_border_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_border_dxf_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totals_row_shown: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default)]
    pub insert_row: bool,
    #[serde(default)]
    pub insert_row_shift: bool,
    #[serde(default)]
    pub published: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<TableSortState>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_columns: Vec<FilterColumnSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query_table: Option<super::connections::QueryTable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_id_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_part_path_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_target_hint: Option<String>,
}

/// Canonical workbook table catalog entry stored under `workbook.tables`.
///
/// `TableSpec` remains the XLSX adapter DTO. Runtime storage, mirror sync,
/// SDK/events, sidecars, and export projection operate on this catalog type.
pub type TableCatalogEntry = Table;

/// Canonical workbook table column entry stored inside `TableCatalogEntry`.
pub type TableCatalogColumn = TableColumn;

impl Default for Table {
    fn default() -> Self {
        Self {
            id: String::new(),
            ooxml_table_id: None,
            name: String::new(),
            display_name: String::new(),
            sheet_id: String::new(),
            range: cell_types::SheetRange::new(0, 0, 0, 0),
            columns: Vec::new(),
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
            auto_filter_ref: None,
            auto_filter_xr_uid: None,
            auto_filter_ext_lst_raw: None,
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_border_dxf_id: None,
            table_border_dxf_id: None,
            totals_row_border_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            table_type: None,
            totals_row_shown: None,
            connection_id: None,
            comment: None,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            xr_uid: None,
            sort_state: None,
            filter_columns: Vec::new(),
            query_table: None,
            worksheet_relationship_id_hint: None,
            table_part_path_hint: None,
            worksheet_relationship_target_hint: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_column_show_button_defaults_to_true_when_omitted() {
        let spec: FilterColumnSpec = serde_json::from_value(serde_json::json!({
            "colId": 0,
            "filter": {
                "type": "values",
                "blank": false,
                "values": ["A"]
            }
        }))
        .unwrap();

        assert!(spec.show_button);
    }

    #[test]
    fn filter_column_show_button_explicit_true_uses_skip_true_policy() {
        let spec: FilterColumnSpec = serde_json::from_value(serde_json::json!({
            "colId": 0,
            "showButton": true,
            "filter": {
                "type": "values",
                "blank": false,
                "values": ["A"]
            }
        }))
        .unwrap();

        assert!(spec.show_button);
        let value = serde_json::to_value(&spec).unwrap();
        assert!(value.get("showButton").is_none());
    }

    #[test]
    fn filter_column_show_button_explicit_false_serializes_false() {
        let spec: FilterColumnSpec = serde_json::from_value(serde_json::json!({
            "colId": 0,
            "showButton": false,
            "filter": {
                "type": "values",
                "blank": false,
                "values": ["A"]
            }
        }))
        .unwrap();

        assert!(!spec.show_button);
        let value = serde_json::to_value(&spec).unwrap();
        assert_eq!(value.get("showButton"), Some(&serde_json::json!(false)));
    }
}
