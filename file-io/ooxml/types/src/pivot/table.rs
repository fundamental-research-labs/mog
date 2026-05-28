use super::field::{
    PivotColFields, PivotColHierarchiesUsage, PivotDataFields, PivotFields, PivotHierarchies,
    PivotPageFields, PivotRowFields, PivotRowHierarchiesUsage,
};
use super::items::{PivotColItems, PivotRowItems};
use super::layout::{PivotChartFormats, PivotConditionalFormats, PivotFilters, PivotFormats};

// ============================================================================
// PivotTableStyleInfo — CT_PivotTableStyle
// ============================================================================

/// Pivot table style info (CT_PivotTableStyle, §18.10.1.75).
///
/// Specifies the style applied to the pivot table.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotTableStyleInfo {
    /// Name of the pivot table style.
    pub name: Option<String>,
    /// Show row header formatting.
    pub show_row_headers: Option<bool>,
    /// Show column header formatting.
    pub show_col_headers: Option<bool>,
    /// Show row stripes.
    pub show_row_stripes: Option<bool>,
    /// Show column stripes.
    pub show_col_stripes: Option<bool>,
    /// Show last column formatting.
    pub show_last_column: Option<bool>,
}

// ============================================================================
// PivotLocation — CT_Location
// ============================================================================

/// Pivot table location (CT_Location, §18.10.1.55).
///
/// Specifies the cell reference and row/column counts for the pivot table location.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotLocation {
    /// Cell reference for the upper-left cell of the pivot table.
    pub r#ref: String,
    /// First data row (zero-based, relative to ref).
    pub first_data_row: u32,
    /// First data column (zero-based, relative to ref).
    pub first_data_col: u32,
    /// First header row count. Default: `1`.
    pub first_header_row: Option<u32>,
    /// Number of row page fields. Default: `0`.
    pub row_page_count: Option<u32>,
    /// Number of column page fields. Default: `0`.
    pub col_page_count: Option<u32>,
}

// ============================================================================
// PivotTableDefinition — CT_pivotTableDefinition
// ============================================================================

/// Pivot table definition (CT_pivotTableDefinition, §18.10.1.73).
///
/// The root element of a pivot table part. Contains the full configuration
/// of a pivot table including layout, formatting, and field settings.
/// Only the most commonly used attributes are represented as typed fields;
/// less common ones can be preserved via `ext_lst`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PivotTableDefinition {
    /// Name of the pivot table (required).
    pub name: String,
    /// ID of the pivot cache definition (required).
    pub cache_id: u32,
    /// Whether data fields are on rows (vs columns). Default: `false`.
    pub data_on_rows: bool,
    /// Position of the data field among other fields.
    pub data_position: Option<u32>,
    /// Auto-format ID.
    pub auto_format_id: Option<u32>,
    /// Apply number formats from auto-format.
    pub apply_number_formats: Option<bool>,
    /// Apply border formats from auto-format.
    pub apply_border_formats: Option<bool>,
    /// Apply font formats from auto-format.
    pub apply_font_formats: Option<bool>,
    /// Apply pattern formats from auto-format.
    pub apply_pattern_formats: Option<bool>,
    /// Apply alignment formats from auto-format.
    pub apply_alignment_formats: Option<bool>,
    /// Apply width/height formats from auto-format.
    pub apply_width_height_formats: Option<bool>,
    /// Caption for the data field column/row (required).
    pub data_caption: String,
    /// Caption for grand total columns/rows.
    pub grand_total_caption: Option<String>,
    /// Caption to display for error values.
    pub error_caption: Option<String>,
    /// Whether to show error caption. Default: `false`.
    pub show_error: bool,
    /// Caption to display for missing values.
    pub missing_caption: Option<String>,
    /// Whether to show missing caption. Default: `true`.
    pub show_missing: bool,
    /// Page field layout style.
    pub page_style: Option<String>,
    /// Pivot table style name.
    pub pivot_table_style: Option<String>,
    /// User-defined tag.
    pub tag: Option<String>,
    /// Version of the application that last updated this pivot table.
    pub updated_version: Option<u8>,
    /// Minimum version required to refresh this pivot table.
    pub min_refreshable_version: Option<u8>,
    /// Show calculated members. Default: `true`.
    pub show_calc_members: bool,
    /// Show data field drop-downs. Default: `true`.
    pub show_data_drops: bool,
    /// Show expand/collapse drill indicators. Default: `true`.
    pub show_drill: bool,
    /// Show member property tooltips. Default: `true`.
    pub show_member_property_tips: bool,
    /// Show data tooltips. Default: `true`.
    pub show_data_tips: bool,
    /// Enable the PivotTable Wizard. Default: `true`.
    pub enable_wizard: bool,
    /// Enable drill-down. Default: `true`.
    pub enable_drill: bool,
    /// Enable field properties dialog. Default: `true`.
    pub enable_field_properties: bool,
    /// Preserve cell formatting on refresh. Default: `true`.
    pub preserve_formatting: bool,
    /// Number of page fields per column before wrapping.
    pub page_wrap: Option<u32>,
    /// Page field layout: over then down (vs down then over). Default: `false`.
    pub page_over_then_down: bool,
    /// Include hidden items in subtotals. Default: `false`.
    pub subtotal_hidden_items: bool,
    /// Show row grand totals. Default: `true`.
    pub row_grand_totals: bool,
    /// Show column grand totals. Default: `true`.
    pub col_grand_totals: bool,
    /// Compact layout. Default: `true`.
    pub compact: bool,
    /// Outline layout. Default: `false`.
    pub outline: bool,
    /// Show outline data. Default: `false`.
    pub outline_data: bool,
    /// Allow multiple filters per field. Default: `true`.
    pub multiple_field_filters: bool,
    /// Chart format counter.
    pub chart_format: Option<u32>,
    /// Caption for the row header.
    pub row_header_caption: Option<String>,
    /// Caption for the column header.
    pub col_header_caption: Option<String>,
    /// Sort field list in ascending order. Default: `false`.
    pub field_list_sort_ascending: bool,
    /// Use custom list for sorting. Default: `true`.
    pub custom_list_sort: bool,

    // --- Additional optional attributes (ECMA-376 §18.10.1.73) ---
    /// Style name for vacated cells.
    pub vacated_style: Option<String>,
    /// Whether the user is allowed to edit data in the data area. Default: `false`.
    pub edit_data: bool,
    /// Disable the field list UI. Default: `false`.
    pub disable_field_list: bool,
    /// Show calculated members of OLAP fields. Default: `true`.
    pub show_calc_mbrs: bool,
    /// Show visual totals for OLAP. Default: `true`.
    pub visual_totals: bool,
    /// Show multiple labels when a field is on multiple axes. Default: `true`.
    pub show_multiple_label: bool,
    /// Show data field drop-down filter. Default: `true`.
    pub show_data_drop_down: bool,
    /// Print drill indicators. Default: `false`.
    pub print_drill: bool,
    /// Use auto-formatting on the pivot table. Default: `false`.
    pub use_auto_formatting: bool,
    /// Print field titles on each printed page. Default: `false`.
    pub field_print_titles: bool,
    /// Print item titles on each printed page. Default: `false`.
    pub item_print_titles: bool,
    /// Merge item cells when appropriate. Default: `false`.
    pub merge_item: bool,
    /// Show drop zones in the UI. Default: `true`.
    pub show_drop_zones: bool,
    /// Version of the application that created this pivot table.
    pub created_version: Option<u8>,
    /// Indentation increment for compact axis. Default: `1`.
    pub indent: Option<u32>,
    /// Show empty rows. Default: `false`.
    pub show_empty_row: bool,
    /// Show empty columns. Default: `false`.
    pub show_empty_col: bool,
    /// Show field headers. Default: `true`.
    pub show_headers: bool,
    /// Compact data layout. Default: `true`.
    pub compact_data: bool,
    /// Whether the pivot table is published for OLAP. Default: `false`.
    pub published: bool,
    /// Show drop zones in the grid area. Default: `false`.
    pub grid_drop_zones: bool,
    /// Enable immersive experience. Default: `true`.
    pub immersive: bool,
    /// Support MDX subqueries (OLAP). Default: `false`.
    pub mdx_subqueries: bool,

    // --- Optional child elements (ECMA-376 §18.10.1.73) ---
    /// Pivot field definitions (`<pivotFields>`).
    pub pivot_fields: Option<PivotFields>,
    /// Row field references (`<rowFields>`).
    pub row_fields: Option<PivotRowFields>,
    /// Row item entries (`<rowItems>`).
    pub row_items: Option<PivotRowItems>,
    /// Column field references (`<colFields>`).
    pub col_fields: Option<PivotColFields>,
    /// Column item entries (`<colItems>`).
    pub col_items: Option<PivotColItems>,
    /// Page field definitions (`<pageFields>`).
    pub page_fields: Option<PivotPageFields>,
    /// Data field definitions (`<dataFields>`).
    pub data_fields: Option<PivotDataFields>,
    /// Pivot table format definitions (`<formats>`).
    pub formats: Option<PivotFormats>,
    /// Conditional format definitions (`<conditionalFormats>`).
    pub conditional_formats: Option<PivotConditionalFormats>,
    /// Chart format definitions (`<chartFormats>`).
    pub chart_formats: Option<PivotChartFormats>,
    /// Pivot hierarchy definitions (`<pivotHierarchies>`).
    pub pivot_hierarchies: Option<PivotHierarchies>,
    /// Pivot table style info (`<pivotTableStyleInfo>`).
    pub pivot_table_style_info: Option<PivotTableStyleInfo>,
    /// Pivot table filters (`<filters>`).
    pub filters: Option<PivotFilters>,
    /// Row hierarchy usage references (`<rowHierarchiesUsage>`).
    pub row_hierarchies_usage: Option<PivotRowHierarchiesUsage>,
    /// Column hierarchy usage references (`<colHierarchiesUsage>`).
    pub col_hierarchies_usage: Option<PivotColHierarchiesUsage>,

    /// Extension list for forward-compatible round-tripping.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for PivotTableDefinition {
    fn default() -> Self {
        Self {
            name: String::new(),
            cache_id: 0,
            data_on_rows: false,
            data_position: None,
            auto_format_id: None,
            apply_number_formats: None,
            apply_border_formats: None,
            apply_font_formats: None,
            apply_pattern_formats: None,
            apply_alignment_formats: None,
            apply_width_height_formats: None,
            data_caption: String::new(),
            grand_total_caption: None,
            error_caption: None,
            show_error: false,
            missing_caption: None,
            show_missing: true,
            page_style: None,
            pivot_table_style: None,
            tag: None,
            updated_version: None,
            min_refreshable_version: None,
            show_calc_members: true,
            show_data_drops: true,
            show_drill: true,
            show_member_property_tips: true,
            show_data_tips: true,
            enable_wizard: true,
            enable_drill: true,
            enable_field_properties: true,
            preserve_formatting: true,
            page_wrap: None,
            page_over_then_down: false,
            subtotal_hidden_items: false,
            row_grand_totals: true,
            col_grand_totals: true,
            compact: true,
            outline: false,
            outline_data: false,
            multiple_field_filters: true,
            chart_format: None,
            row_header_caption: None,
            col_header_caption: None,
            field_list_sort_ascending: false,
            custom_list_sort: true,
            vacated_style: None,
            edit_data: false,
            disable_field_list: false,
            show_calc_mbrs: true,
            visual_totals: true,
            show_multiple_label: true,
            show_data_drop_down: true,
            print_drill: false,
            use_auto_formatting: false,
            field_print_titles: false,
            item_print_titles: false,
            merge_item: false,
            show_drop_zones: true,
            created_version: None,
            indent: None,
            show_empty_row: false,
            show_empty_col: false,
            show_headers: true,
            compact_data: true,
            published: false,
            grid_drop_zones: false,
            immersive: true,
            mdx_subqueries: false,
            pivot_fields: None,
            row_fields: None,
            row_items: None,
            col_fields: None,
            col_items: None,
            page_fields: None,
            data_fields: None,
            formats: None,
            conditional_formats: None,
            chart_formats: None,
            pivot_hierarchies: None,
            pivot_table_style_info: None,
            filters: None,
            row_hierarchies_usage: None,
            col_hierarchies_usage: None,
            ext_lst: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_table_definition_default() {
        let ptd = PivotTableDefinition::default();
        assert_eq!(ptd.name, "");
        assert_eq!(ptd.cache_id, 0);
        assert!(!ptd.data_on_rows);
        assert!(ptd.data_position.is_none());
        assert_eq!(ptd.data_caption, "");
        assert!(!ptd.show_error);
        assert!(ptd.show_missing);
        assert!(ptd.show_calc_members);
        assert!(ptd.show_data_drops);
        assert!(ptd.show_drill);
        assert!(ptd.show_member_property_tips);
        assert!(ptd.show_data_tips);
        assert!(ptd.enable_wizard);
        assert!(ptd.enable_drill);
        assert!(ptd.enable_field_properties);
        assert!(ptd.preserve_formatting);
        assert!(!ptd.page_over_then_down);
        assert!(!ptd.subtotal_hidden_items);
        assert!(ptd.row_grand_totals);
        assert!(ptd.col_grand_totals);
        assert!(ptd.compact);
        assert!(!ptd.outline);
        assert!(!ptd.outline_data);
        assert!(ptd.multiple_field_filters);
        assert!(!ptd.field_list_sort_ascending);
        assert!(ptd.custom_list_sort);
        assert!(ptd.show_calc_mbrs);
        assert!(ptd.visual_totals);
        assert!(ptd.show_multiple_label);
        assert!(ptd.show_data_drop_down);
        assert!(ptd.show_drop_zones);
        assert!(ptd.show_headers);
        assert!(ptd.compact_data);
        assert!(ptd.immersive);
        assert!(ptd.ext_lst.is_none());
    }

    #[test]
    fn pivot_table_definition_serde_roundtrip() {
        let original = PivotTableDefinition {
            name: "SalesPivot".to_string(),
            cache_id: 42,
            data_caption: "Values".to_string(),
            pivot_table_style: Some("PivotStyleMedium9".to_string()),
            row_grand_totals: false,
            ..PivotTableDefinition::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: PivotTableDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
