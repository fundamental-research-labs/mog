//! Resolved (validated) pivot configuration types.
//!
//! These types can only be constructed through `validate_and_resolve()`, which
//! guarantees all field references are valid, all defaults are resolved, and all
//! flat serde types are converted to their type-safe equivalents.
//!
//! The engine accepts only these types — zero `unwrap_or` fallbacks needed.

use value_types::CellValue;

use super::calc_field::CalcFieldExpr;
use super::types::{
    AggregateFunction, CellRange, DateGrouping, FieldId, LayoutForm, NumberGrouping,
    OutputLocation, PivotField, PivotFilterCondition, PivotValueSource, PlacementId,
    ShowValuesAsConfig, SortDirection, TopBottomBy, TopBottomType,
};

// ============================================================================
// Top-level resolved config
// ============================================================================

/// Validated pivot table configuration — all fields resolved, all references checked.
///
/// Constructed only via `validate_and_resolve()`. The engine trusts every field.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedPivotConfig {
    /// Pivot table ID (validated non-empty).
    pub(crate) id: String,
    /// Stable source sheet ID when available.
    pub(crate) source_sheet_id: Option<String>,
    /// Source sheet name, retained for display and legacy configs.
    pub(crate) source_sheet_name: String,
    /// Source data range.
    pub(crate) source_range: CellRange,
    /// Output sheet name.
    pub(crate) output_sheet_name: String,
    /// Output location.
    pub(crate) output_location: OutputLocation,
    /// All fields with source column indices (validated to exist).
    pub(crate) fields: Vec<PivotField>,
    /// Row axis placements (sorted by position, all fields resolved to column indices).
    pub(crate) row_placements: Vec<ResolvedAxisPlacement>,
    /// Column axis placements (sorted by position, all fields resolved).
    pub(crate) column_placements: Vec<ResolvedAxisPlacement>,
    /// Value placements (sorted by position, aggregate functions guaranteed present).
    pub(crate) value_placements: Vec<ResolvedValuePlacement>,
    /// Filter placements.
    pub(crate) filter_placements: Vec<ResolvedFilterPlacement>,
    /// Filters with pre-resolved column indices and type-safe conditions.
    pub(crate) filters: Vec<ResolvedFilter>,
    /// Layout with all Options resolved to concrete booleans.
    pub(crate) layout: ResolvedLayout,
    /// Calculated fields with pre-parsed formulas.
    pub(crate) calculated_fields: Vec<ResolvedCalculatedField>,
}

impl ResolvedPivotConfig {
    /// The pivot table ID.
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The source sheet name.
    #[must_use]
    pub fn source_sheet_name(&self) -> &str {
        &self.source_sheet_name
    }

    /// The stable source sheet ID, when available.
    #[must_use]
    pub fn source_sheet_id(&self) -> Option<&str> {
        self.source_sheet_id.as_deref()
    }

    /// The source data range.
    #[must_use]
    pub fn source_range(&self) -> &CellRange {
        &self.source_range
    }

    /// The output sheet name.
    #[must_use]
    pub fn output_sheet_name(&self) -> &str {
        &self.output_sheet_name
    }

    /// The output location anchor cell.
    #[must_use]
    pub fn output_location(&self) -> &OutputLocation {
        &self.output_location
    }

    /// All source fields.
    #[must_use]
    pub fn fields(&self) -> &[PivotField] {
        &self.fields
    }

    /// Row axis placements, sorted by position.
    #[must_use]
    pub fn row_placements(&self) -> &[ResolvedAxisPlacement] {
        &self.row_placements
    }

    /// Column axis placements, sorted by position.
    #[must_use]
    pub fn column_placements(&self) -> &[ResolvedAxisPlacement] {
        &self.column_placements
    }

    /// Value placements, sorted by position.
    #[must_use]
    pub fn value_placements(&self) -> &[ResolvedValuePlacement] {
        &self.value_placements
    }

    /// Filter placements.
    #[must_use]
    pub fn filter_placements(&self) -> &[ResolvedFilterPlacement] {
        &self.filter_placements
    }

    /// Filters with type-safe conditions and pre-resolved column indices.
    #[must_use]
    pub fn filters(&self) -> &[ResolvedFilter] {
        &self.filters
    }

    /// Layout with all defaults resolved.
    #[must_use]
    pub fn layout(&self) -> &ResolvedLayout {
        &self.layout
    }

    /// Calculated fields with pre-parsed formulas.
    #[must_use]
    pub fn calculated_fields(&self) -> &[ResolvedCalculatedField] {
        &self.calculated_fields
    }
}

// ============================================================================
// Resolved axis (row/column) placement
// ============================================================================

/// Resolved axis (row/column) placement — field reference pre-resolved to column index.
///
/// All optional fields from `AxisPlacement` are resolved to concrete values:
/// - `sort_order` defaults to `SortDirection::Asc`
/// - `show_subtotals` defaults to `false`
/// - `column_index` is pre-resolved from the field map (no `unwrap_or(0)`)
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedAxisPlacement {
    /// The field ID for this placement.
    pub(crate) field_id: FieldId,
    /// Pre-resolved source column index (from `field_map`, no `unwrap_or(0)`).
    pub(crate) column_index: usize,
    /// Position within the axis (determines nesting order).
    pub(crate) position: usize,
    /// Optional custom display name.
    pub(crate) display_name: Option<String>,
    /// Sort direction — non-optional, defaulted to Asc.
    pub(crate) sort_order: SortDirection,
    /// Custom sort order for group labels.
    pub(crate) custom_sort_list: Option<Vec<CellValue>>,
    /// Sort by a value field's aggregated values instead of labels.
    pub(crate) sort_by_value: Option<ResolvedSortByValue>,
    /// Date grouping for this field.
    pub(crate) date_grouping: Option<DateGrouping>,
    /// Number grouping for this field (already validated).
    pub(crate) number_grouping: Option<NumberGrouping>,
    /// Whether to show subtotals — non-optional, defaulted to false.
    pub(crate) show_subtotals: bool,
}

impl ResolvedAxisPlacement {
    /// The field ID for this placement.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// Pre-resolved source column index.
    #[must_use]
    pub fn column_index(&self) -> usize {
        self.column_index
    }

    /// Position within the axis.
    #[must_use]
    pub fn position(&self) -> usize {
        self.position
    }

    /// Optional custom display name.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    /// Sort direction (always resolved, never None).
    #[must_use]
    pub fn sort_order(&self) -> SortDirection {
        self.sort_order
    }

    /// Custom sort order for group labels.
    #[must_use]
    pub fn custom_sort_list(&self) -> Option<&[CellValue]> {
        self.custom_sort_list.as_deref()
    }

    /// Sort by value configuration, if set.
    #[must_use]
    pub fn sort_by_value(&self) -> Option<&ResolvedSortByValue> {
        self.sort_by_value.as_ref()
    }

    /// Date grouping, if set.
    #[must_use]
    pub fn date_grouping(&self) -> Option<DateGrouping> {
        self.date_grouping
    }

    /// Number grouping, if set (already validated).
    #[must_use]
    pub fn number_grouping(&self) -> Option<&NumberGrouping> {
        self.number_grouping.as_ref()
    }

    /// Whether to show subtotals (always resolved, never None).
    #[must_use]
    pub fn show_subtotals(&self) -> bool {
        self.show_subtotals
    }
}

// ============================================================================
// Resolved sort-by-value config
// ============================================================================

/// Resolved sort-by-value config — value field index pre-resolved.
///
/// `column_key` is kept as a string because column leaves depend on the data
/// and can only be resolved after grouping. The engine resolves it at sort time.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedSortByValue {
    /// Index into `value_placements` for the value field to sort by.
    pub(crate) value_field_index: usize,
    /// Sort direction.
    pub(crate) order: SortDirection,
    /// Column leaf key (validated to reference a valid column field value).
    /// `None` means use the first column leaf or grand total.
    pub(crate) column_key: Option<String>,
}

impl ResolvedSortByValue {
    /// Index into `value_placements`.
    #[must_use]
    pub fn value_field_index(&self) -> usize {
        self.value_field_index
    }

    /// Sort direction.
    #[must_use]
    pub fn order(&self) -> SortDirection {
        self.order
    }

    /// Column leaf key, if specified.
    #[must_use]
    pub fn column_key(&self) -> Option<&str> {
        self.column_key.as_deref()
    }
}

// ============================================================================
// Resolved value placement
// ============================================================================

/// Resolved value placement — aggregate function guaranteed, field resolved.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedValuePlacement {
    /// Stable placement identity.
    pub(crate) placement_id: PlacementId,
    /// The field ID for this value placement.
    pub(crate) field_id: FieldId,
    /// User-facing source field name.
    pub(crate) source_field_name: String,
    /// Source descriptor for result metadata.
    pub(crate) source: PivotValueSource,
    /// Pre-resolved source column index.
    pub(crate) column_index: usize,
    /// Position within the values area.
    pub(crate) position: usize,
    /// Optional custom display name (e.g., "Sum of Sales").
    pub(crate) display_name: Option<String>,
    /// Aggregation function — always present (already non-optional in `ValuePlacement`).
    pub(crate) aggregate_function: AggregateFunction,
    /// Optional number format string.
    pub(crate) number_format: Option<String>,
    /// Optional "Show Values As" post-aggregation transform.
    pub(crate) show_values_as: Option<ShowValuesAsConfig>,
}

impl ResolvedValuePlacement {
    /// Stable placement identity.
    #[must_use]
    pub fn placement_id(&self) -> &PlacementId {
        &self.placement_id
    }

    /// The field ID for this value placement.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// User-facing source field name.
    #[must_use]
    pub fn source_field_name(&self) -> &str {
        &self.source_field_name
    }

    /// Source descriptor for result metadata.
    #[must_use]
    pub fn source(&self) -> &PivotValueSource {
        &self.source
    }

    /// Pre-resolved source column index.
    #[must_use]
    pub fn column_index(&self) -> usize {
        self.column_index
    }

    /// Position within the values area.
    #[must_use]
    pub fn position(&self) -> usize {
        self.position
    }

    /// Optional custom display name.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }

    /// Aggregation function.
    #[must_use]
    pub fn aggregate_function(&self) -> AggregateFunction {
        self.aggregate_function
    }

    /// Optional number format string.
    #[must_use]
    pub fn number_format(&self) -> Option<&str> {
        self.number_format.as_deref()
    }

    /// Optional "Show Values As" configuration.
    #[must_use]
    pub fn show_values_as(&self) -> Option<&ShowValuesAsConfig> {
        self.show_values_as.as_ref()
    }
}

// ============================================================================
// Resolved filter placement
// ============================================================================

/// Resolved filter placement — field reference pre-resolved to column index.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedFilterPlacement {
    /// The field ID.
    pub(crate) field_id: FieldId,
    /// Pre-resolved source column index.
    pub(crate) column_index: usize,
    /// Position within the filter area.
    pub(crate) position: usize,
    /// Optional custom display name.
    pub(crate) display_name: Option<String>,
}

impl ResolvedFilterPlacement {
    /// The field ID.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// Pre-resolved source column index.
    #[must_use]
    pub fn column_index(&self) -> usize {
        self.column_index
    }

    /// Position within the filter area.
    #[must_use]
    pub fn position(&self) -> usize {
        self.position
    }

    /// Optional custom display name.
    #[must_use]
    pub fn display_name(&self) -> Option<&str> {
        self.display_name.as_deref()
    }
}

// ============================================================================
// Resolved filter
// ============================================================================

/// Resolved filter — type-safe condition, pre-resolved column index.
///
/// Uses `PivotFilterCondition` (the type-safe enum) instead of the flat serde type.
/// Field column index is pre-resolved from the field map.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedFilter {
    /// The field this filter applies to.
    pub(crate) field_id: FieldId,
    /// Pre-resolved source column index for this field.
    pub(crate) field_column_index: usize,
    /// Values to include (allowlist).
    pub(crate) include_values: Option<Vec<CellValue>>,
    /// Values to exclude (denylist).
    pub(crate) exclude_values: Option<Vec<CellValue>>,
    /// Type-safe condition (not flat).
    pub(crate) condition: Option<PivotFilterCondition>,
    /// Top/bottom N filter with pre-resolved value column.
    pub(crate) top_bottom: Option<ResolvedTopBottom>,
    /// Whether to show items with no data — resolved, defaulted to false.
    pub(crate) show_items_with_no_data: bool,
}

impl ResolvedFilter {
    /// The field ID this filter applies to.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// Pre-resolved source column index for the filtered field.
    #[must_use]
    pub fn field_column_index(&self) -> usize {
        self.field_column_index
    }

    /// Values to include (allowlist), if set.
    #[must_use]
    pub fn include_values(&self) -> Option<&[CellValue]> {
        self.include_values.as_deref()
    }

    /// Values to exclude (denylist), if set.
    #[must_use]
    pub fn exclude_values(&self) -> Option<&[CellValue]> {
        self.exclude_values.as_deref()
    }

    /// Type-safe filter condition, if set.
    #[must_use]
    pub fn condition(&self) -> Option<&PivotFilterCondition> {
        self.condition.as_ref()
    }

    /// Top/bottom N filter, if set.
    #[must_use]
    pub fn top_bottom(&self) -> Option<&ResolvedTopBottom> {
        self.top_bottom.as_ref()
    }

    /// Whether to show items with no data (always resolved).
    #[must_use]
    pub fn show_items_with_no_data(&self) -> bool {
        self.show_items_with_no_data
    }
}

// ============================================================================
// Resolved top/bottom filter
// ============================================================================

/// Resolved top/bottom filter — value column pre-resolved.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedTopBottom {
    /// Whether to select top or bottom items.
    pub(crate) filter_type: TopBottomType,
    /// The number of items (or percentage/sum threshold).
    pub(crate) n: f64,
    /// How to interpret `n`: as a count, percentage, or cumulative sum.
    pub(crate) by: TopBottomBy,
    /// Pre-resolved index into `value_placements` for the ranking field.
    /// `None` means use the first value field.
    pub(crate) value_field_index: Option<usize>,
}

impl ResolvedTopBottom {
    /// Whether to select top or bottom items.
    #[must_use]
    pub fn filter_type(&self) -> TopBottomType {
        self.filter_type
    }

    /// The N value (count, percentage, or sum threshold).
    #[must_use]
    pub fn n(&self) -> f64 {
        self.n
    }

    /// How to interpret `n`.
    #[must_use]
    pub fn by(&self) -> TopBottomBy {
        self.by
    }

    /// Pre-resolved index into `value_placements`, if specified.
    #[must_use]
    pub fn value_field_index(&self) -> Option<usize> {
        self.value_field_index
    }
}

// ============================================================================
// Resolved layout
// ============================================================================

/// Layout with all defaults resolved — no Options for known defaults.
///
/// Default values match Excel's defaults:
/// - Grand totals: shown (true)
/// - Layout form: Compact
/// - Repeat labels: false
/// - Show empty rows/columns: false
#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::struct_excessive_bools)] // These bools represent independent layout settings
pub struct ResolvedLayout {
    /// Whether to show grand totals for rows. Default: true.
    pub(crate) show_row_grand_totals: bool,
    /// Whether to show grand totals for columns. Default: true.
    pub(crate) show_column_grand_totals: bool,
    /// Layout form. Default: Compact.
    pub(crate) layout_form: LayoutForm,
    /// Whether to repeat all item labels. Default: false.
    /// Corresponds to `PivotTableLayout.repeat_row_labels`. Uses Excel's terminology.
    pub(crate) repeat_all_item_labels: bool,
    /// Whether to show empty rows. Default: false.
    pub(crate) show_empty_rows: bool,
    /// Whether to show empty columns. Default: false.
    pub(crate) show_empty_columns: bool,
    /// Whether subtotals are placed at the top (before children) or bottom (after).
    pub(crate) subtotal_at_top: bool,
    /// Custom label for the grand total row/column (default: "Grand Total").
    pub(crate) grand_total_caption: Option<String>,
}

impl ResolvedLayout {
    /// Whether to show row grand totals.
    #[must_use]
    pub fn show_row_grand_totals(&self) -> bool {
        self.show_row_grand_totals
    }

    /// Whether to show column grand totals.
    #[must_use]
    pub fn show_column_grand_totals(&self) -> bool {
        self.show_column_grand_totals
    }

    /// Layout form (Compact, Outline, or Tabular).
    #[must_use]
    pub fn layout_form(&self) -> &LayoutForm {
        &self.layout_form
    }

    /// Whether to repeat all item labels.
    #[must_use]
    pub fn repeat_all_item_labels(&self) -> bool {
        self.repeat_all_item_labels
    }

    /// Whether to show empty rows.
    #[must_use]
    pub fn show_empty_rows(&self) -> bool {
        self.show_empty_rows
    }

    /// Whether to show empty columns.
    #[must_use]
    pub fn show_empty_columns(&self) -> bool {
        self.show_empty_columns
    }

    /// Whether subtotals are placed at the top (before children).
    #[must_use]
    pub fn subtotal_at_top(&self) -> bool {
        self.subtotal_at_top
    }

    /// Custom label for the grand total row/column.
    /// Returns `None` to use the default ("Grand Total").
    #[must_use]
    pub fn grand_total_caption(&self) -> Option<&str> {
        self.grand_total_caption.as_deref()
    }
}

impl Default for ResolvedLayout {
    fn default() -> Self {
        Self {
            show_row_grand_totals: true,
            show_column_grand_totals: true,
            layout_form: LayoutForm::Compact,
            repeat_all_item_labels: false,
            show_empty_rows: false,
            show_empty_columns: false,
            subtotal_at_top: false,
            grand_total_caption: None,
        }
    }
}

// ============================================================================
// Resolved calculated field
// ============================================================================

/// Resolved calculated field — formula pre-parsed.
///
/// The `parsed_expr` is guaranteed to be a valid AST produced by
/// `parse_calc_field()`. The engine can evaluate it directly without
/// re-parsing or error handling.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedCalculatedField {
    /// The calculated field ID.
    pub(crate) field_id: FieldId,
    /// Display name for the calculated field.
    pub(crate) name: String,
    /// The original formula string (kept for display/serialization).
    pub(crate) formula: String,
    /// Pre-parsed expression AST — guaranteed valid.
    pub(crate) parsed_expr: CalcFieldExpr,
}

impl ResolvedCalculatedField {
    /// The calculated field ID.
    #[must_use]
    pub fn field_id(&self) -> &FieldId {
        &self.field_id
    }

    /// Display name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The original formula string.
    #[must_use]
    pub fn formula(&self) -> &str {
        &self.formula
    }

    /// The pre-parsed expression AST.
    #[must_use]
    pub fn parsed_expr(&self) -> &CalcFieldExpr {
        &self.parsed_expr
    }
}
