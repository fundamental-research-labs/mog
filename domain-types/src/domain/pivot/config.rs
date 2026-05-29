//! Pivot table configuration types.
//!
//! Consolidated from `pivot-types/src/config.rs`.

use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};
use std::fmt;

use super::field::PivotField;
use super::filter::PivotFilter;
use super::ooxml::PivotRowColItem;
use super::placement_flat::{PivotFieldArea, PivotFieldPlacementFlat};

/// Bounds of a rendered pivot table (used to derive PivotTableDef).
///
/// These come from the pivot compute result — the config alone only knows
/// the output anchor cell, not the rendered extent.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRenderedBounds {
    /// Total number of rendered rows (including headers + grand totals).
    pub total_rows: u32,
    /// Total number of rendered columns (including row labels + data columns).
    pub total_cols: u32,
    /// Row offset from the top of the pivot table to the first data row.
    pub first_data_row: u32,
    /// Column offset from the left of the pivot table to the first data column.
    pub first_data_col: u32,
    /// Number of data columns reserved for the pivot body — `column_leaves * max(v, 1)`.
    /// Distinct from `total_cols`, which adds row-header columns and grand-total columns.
    /// Computed from the column-axis structure (sum of depth-0 column-header spans),
    /// not from per-row value vectors, so it stays correct when measures or rows are empty.
    pub num_data_cols: u32,
}

/// Layout options for the pivot table.
///
/// Controls the visual structure of the rendered pivot table, including
/// grand total visibility, layout form, and label repetition.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableLayout {
    /// Whether to show grand totals for rows (bottom row).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_grand_totals: Option<bool>,
    /// Whether to show grand totals for columns (rightmost column).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_column_grand_totals: Option<bool>,
    /// Layout form: compact (default), outline, or tabular.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_form: Option<LayoutForm>,
    /// Where to place subtotals relative to their group.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtotal_location: Option<SubtotalLocation>,
    /// Whether to repeat row labels for indented items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_row_labels: Option<bool>,
    /// Whether to insert a blank row after each group's items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_blank_row_after_item: Option<bool>,
    /// Whether to show row header styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_headers: Option<bool>,
    /// Whether to show column header styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_column_headers: Option<bool>,
    /// Whether to use classic pivot table layout (no indentation).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classic_layout: Option<bool>,
    /// Custom label for the grand total row/column (default: "Grand Total").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grand_total_caption: Option<String>,
    /// Custom label for the row header area (overrides field name).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_header_caption: Option<String>,
    /// Custom label for the column header area.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub col_header_caption: Option<String>,
    /// Caption for the data field area (e.g., "Values").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_caption: Option<String>,
    /// Whether to use classic pivot layout with grid drop zones.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_drop_zones: Option<bool>,
    /// Caption to display for error values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_caption: Option<String>,
    /// Whether to show error caption instead of error values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_error: Option<bool>,
    /// Caption to display for missing/empty values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_caption: Option<String>,
    /// Whether to show missing caption instead of blanks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_missing: Option<bool>,
}

/// Layout form for the pivot table.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutForm {
    /// Compact form — nested fields share a single column with indentation.
    Compact,
    /// Outline form — each field gets its own column, with subtotals above groups.
    Outline,
    /// Tabular form — each field gets its own column, with subtotals below groups.
    Tabular,
}

/// Subtotal position relative to the group items.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtotalLocation {
    /// Subtotals appear above (before) the group items.
    Top,
    /// Subtotals appear below (after) the group items.
    Bottom,
}

/// Style options for the pivot table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableStyle {
    /// Named style preset (e.g., "`PivotStyleMedium9`").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
    /// Whether to apply row header styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_headers: Option<bool>,
    /// Whether to apply column header styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_column_headers: Option<bool>,
    /// Whether to apply alternating row stripe styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_stripes: Option<bool>,
    /// Whether to apply alternating column stripe styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_column_stripes: Option<bool>,
    /// Whether to apply last-column styling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_last_column: Option<bool>,
}

/// Options for handling missing/error values in the pivot table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableDataOptions {
    /// Display string for empty aggregation cells (e.g., "-" or "0").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty_value: Option<String>,
    /// Display string for error aggregation cells (e.g., "Error" or "#N/A").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_value: Option<String>,
    /// Whether to refresh the pivot table on file open.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_on_open: Option<bool>,
}

/// Source data range — a rectangular region in a sheet.
///
/// This is a type alias for [`cell_types::SheetRange`], which has identical
/// fields (`start_row`, `start_col`, `end_row`, `end_col`) and the same
/// `#[serde(rename_all = "camelCase")]` attribute.
pub type CellRange = cell_types::SheetRange;

/// Output location anchor cell — the top-left cell of the pivot table output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputLocation {
    /// Row index (zero-based).
    pub row: u32,
    /// Column index (zero-based).
    pub col: u32,
}

/// Current pivot table contract schema version.
pub const PIVOT_CONFIG_SCHEMA_VERSION: u32 = 2;

/// Strongly-typed calculated field identifier.
///
/// Calculated field IDs live in a separate namespace from source [`FieldId`]s
/// so value placements can distinguish source-column measures from derived
/// measures without relying on string conventions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CalculatedFieldId(String);

impl CalculatedFieldId {
    /// Create a new `CalculatedFieldId`.
    #[must_use]
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    /// Return the inner string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::ops::Deref for CalculatedFieldId {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CalculatedFieldId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<String> for CalculatedFieldId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for CalculatedFieldId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

impl AsRef<str> for CalculatedFieldId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

fn default_pivot_config_schema_version() -> u32 {
    PIVOT_CONFIG_SCHEMA_VERSION
}

/// Complete pivot table configuration.
///
/// This is the top-level type that fully describes a pivot table: its source data,
/// field placements, filters, layout, and style. It is persisted and sent over the
/// wire between TypeScript and Rust.
///
/// # Placements
///
/// The `placements` field uses the flat serde-visible DTO. Engine code converts
/// this boundary shape into its internal typed placement model before validating
/// or computing a pivot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableConfig {
    /// Version of the persisted pivot configuration schema.
    #[serde(default = "default_pivot_config_schema_version")]
    pub schema_version: u32,
    /// Unique identifier for this pivot table.
    pub id: String,
    /// Display name of the pivot table.
    pub name: String,
    /// Stable ID of the sheet containing the source data.
    ///
    /// Authoritative when present. `source_sheet_name` is retained as derived
    /// display metadata and as a legacy migration key for older configs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet_id: Option<String>,
    /// Name of the sheet containing the source data.
    #[serde(default)]
    pub source_sheet_name: String,
    /// Range of cells in the source sheet that provide data.
    pub source_range: CellRange,
    /// Name of the sheet where the pivot table is rendered.
    pub output_sheet_name: String,
    /// Top-left cell of the pivot table output.
    pub output_location: OutputLocation,
    /// Available fields detected from the source data.
    pub fields: Vec<PivotField>,
    /// Field placements defining the pivot table structure.
    #[serde(default)]
    pub placements: Vec<PivotFieldPlacementFlat>,
    /// Filter configurations for individual fields.
    pub filters: Vec<PivotFilter>,
    /// Layout options (grand totals, subtotals, form).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<PivotTableLayout>,
    /// Style options (theme, stripes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<PivotTableStyle>,
    /// Data display options (empty/error value text).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_options: Option<PivotTableDataOptions>,
    /// Timestamp when the pivot table was created (Unix milliseconds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<f64>,
    /// Timestamp when the pivot table was last updated (Unix milliseconds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<f64>,
    /// Calculated fields — derived values computed from other fields post-aggregation.
    ///
    /// Each calculated field defines a formula that references other field names.
    /// The formula is evaluated after regular aggregation (Sum, Average, etc.) has been
    /// applied, producing a new value column for each column leaf in the pivot table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calculated_fields: Option<Vec<CalculatedField>>,
    /// When true, allows multiple filter criteria on a single field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_multiple_filters_per_field: Option<bool>,
    /// Controls whether the pivot table auto-formats when refreshed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_format: Option<bool>,
    /// Controls whether custom formatting is preserved on refresh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preserve_formatting: Option<bool>,
    /// Pivot cache ID this table reads from (OOXML).
    ///
    /// `cache_id` is a cache concept — it identifies the `<pivotCache>` entry
    /// in workbook.xml that holds source data for this pivot. Keyed by u32 in
    /// `ParseOutput.pivot_cache_records`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_id: Option<u32>,
    /// OOXML `dataOnRows` data-axis placement.
    ///
    /// When absent for newly authored pivots, exporters may choose a default
    /// from current placements. Imported pivots set this explicitly so multiple
    /// value fields round-trip on the original row/column data axis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_on_rows: Option<bool>,
    /// OOXML `<location ref="…">` — the full A1 range the rendered pivot
    /// occupies (e.g., "A3:G20"). `None` for API-created pivots.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_range: Option<String>,
    /// OOXML `<location firstDataRow="…">` — row offset to the first data
    /// row within the pivot's rendered area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_data_row: Option<u32>,
    /// OOXML `<location firstHeaderRow="…">` — row offset to the first header
    /// row within the pivot's rendered area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_header_row: Option<u32>,
    /// OOXML `<location firstDataCol="…">` — column offset to the first data
    /// column within the pivot's rendered area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_data_col: Option<u32>,
    /// OOXML `<location rowPageCount="…">` page wrap row count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows_per_page: Option<u32>,
    /// OOXML `<location colPageCount="…">` page wrap column count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols_per_page: Option<u32>,
    /// Row items array for OOXML layout reconstruction. The writer uses these
    /// to emit `<rowItems>` entries without recomputing layout.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_items: Vec<PivotRowColItem>,
    /// Column items array for OOXML layout reconstruction. See `row_items`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub col_items: Vec<PivotRowColItem>,
}

/// A calculated field that creates derived values from other fields.
///
/// Calculated fields are evaluated post-aggregation: each regular value field
/// is aggregated first (Sum, Average, etc.), then the formula runs on the
/// aggregated values to produce a new column.
///
/// # Example
///
/// With fields "Revenue" (Sum) and "Units" (Sum), a calculated field with
/// formula `Revenue / Units` produces an "Average Price" column showing
/// the ratio of summed revenue to summed units for each cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculatedField {
    /// Unique identifier for this calculated field.
    pub field_id: CalculatedFieldId,
    /// Display name shown in the pivot table.
    pub name: String,
    /// Formula expression referencing other field names.
    /// Supports: field references, +, -, *, /, parentheses, numeric literals.
    /// Field names can be bare (`Revenue`) or quoted (`'Cost of Goods'`).
    pub formula: String,
}

/// Required fields for PivotTableConfig with their expected JSON type and description.
const REQUIRED_FIELDS: &[(&str, &str, &str)] = &[
    (
        "sourceRange",
        "object",
        "{ startRow, startCol, endRow, endCol } — bounds of source data",
    ),
    (
        "outputSheetName",
        "string",
        "name of the sheet where pivot output renders",
    ),
    (
        "outputLocation",
        "object",
        "{ row, col } — anchor cell for pivot output",
    ),
    (
        "fields",
        "array",
        "field definitions: [{ id, name, sourceColumn, dataType }, ...]",
    ),
    (
        "placements",
        "array",
        "field placements: [{ fieldId, area, position }, ...]",
    ),
    ("filters", "array", "filter definitions (can be empty [])"),
];

/// Validate a raw JSON value as a PivotTableConfig, reporting ALL structural
/// issues in a single error instead of serde's one-at-a-time failures.
///
/// If valid, returns `Ok(())`. On failure, returns an error message listing
/// every missing field, every type mismatch, what was provided, and hints.
///
/// This is the fix for the "18 trial-and-error calls" problem: serde only
/// reports one missing field per attempt. This function catches them all
/// and works for every API consumer (TypeScript, Python, WASM, etc.).
pub fn validate_pivot_config_json(value: &serde_json::Value) -> Result<(), String> {
    let obj = match value.as_object() {
        Some(o) => o,
        None => {
            return Err("PivotTableConfig must be a JSON object, got: ".to_string()
                + match value {
                    serde_json::Value::Array(_) => "array",
                    serde_json::Value::String(_) => "string",
                    serde_json::Value::Number(_) => "number",
                    serde_json::Value::Bool(_) => "boolean",
                    serde_json::Value::Null => "null",
                    _ => "unknown",
                });
        }
    };

    let mut missing = Vec::new();
    let mut wrong_type = Vec::new();

    match (obj.get("sourceSheetId"), obj.get("sourceSheetName")) {
        (None, None) => {
            missing.push(
                "  - sourceSheetId or sourceSheetName (string): stable source sheet ID preferred; sourceSheetName accepted for legacy configs".to_string(),
            );
        }
        (Some(val), _) if !val.is_string() => {
            wrong_type.push(format!(
                "  - sourceSheetId: expected string, got {}",
                json_type_for_error(val)
            ));
        }
        (_, Some(val)) if !val.is_string() => {
            wrong_type.push(format!(
                "  - sourceSheetName: expected string, got {}",
                json_type_for_error(val)
            ));
        }
        _ => {}
    }

    for &(field, expected_type, description) in REQUIRED_FIELDS {
        match obj.get(field) {
            None => {
                missing.push(format!("  - {field} ({expected_type}): {description}"));
            }
            Some(val) => {
                let type_ok = match expected_type {
                    "string" => val.is_string(),
                    "object" => val.is_object(),
                    "array" => val.is_array(),
                    _ => true,
                };
                if !type_ok {
                    wrong_type.push(format!(
                        "  - {field}: expected {expected_type}, got {}",
                        json_type_for_error(val)
                    ));
                }
            }
        }
    }

    // Validate sourceRange sub-fields if present and is an object
    if let Some(serde_json::Value::Object(range)) = obj.get("sourceRange") {
        let sub_fields = ["startRow", "startCol", "endRow", "endCol"];
        let missing_sub: Vec<&str> = sub_fields
            .iter()
            .filter(|f| !range.contains_key(**f))
            .copied()
            .collect();
        if !missing_sub.is_empty() {
            wrong_type.push(format!(
                "  - sourceRange: missing sub-fields: {}. Expected {{ startRow, startCol, endRow, endCol }}",
                missing_sub.join(", ")
            ));
        }
    }

    // Validate outputLocation sub-fields if present and is an object
    if let Some(serde_json::Value::Object(loc)) = obj.get("outputLocation") {
        let sub_fields = ["row", "col"];
        let missing_sub: Vec<&str> = sub_fields
            .iter()
            .filter(|f| !loc.contains_key(**f))
            .copied()
            .collect();
        if !missing_sub.is_empty() {
            wrong_type.push(format!(
                "  - outputLocation: missing sub-fields: {}. Expected {{ row, col }}",
                missing_sub.join(", ")
            ));
        }
    }

    if missing.is_empty() && wrong_type.is_empty() {
        return Ok(());
    }

    // Build comprehensive error message
    let mut parts = vec!["PivotTableConfig validation failed:".to_string()];

    if !missing.is_empty() {
        parts.push(format!("Missing required fields ({}):", missing.len()));
        parts.extend(missing);
    }

    if !wrong_type.is_empty() {
        parts.push(format!("Type errors ({}):", wrong_type.len()));
        parts.extend(wrong_type);
    }

    // List provided fields so the caller knows what they sent
    let provided: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
    parts.push(format!("Provided fields: [{}]", provided.join(", ")));

    // Hints
    parts.push(String::new());
    parts.push("Hint: Use the simple format instead: { name, dataSource: \"Sheet!A1:D100\", rowFields: [\"Field1\"], valueFields: [{ field: \"Field2\", aggregation: \"sum\" }] }".to_string());
    parts.push(
        "Or use detectFields(sheetId, range) to auto-detect fields from source data.".to_string(),
    );

    Err(parts.join("\n"))
}

fn json_type_for_error(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::String(s) => format!("string \"{}\"", truncate(s, 40)),
        serde_json::Value::Number(n) => format!("number {n}"),
        serde_json::Value::Bool(b) => format!("boolean {b}"),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "object".to_string(),
        serde_json::Value::Null => "null".to_string(),
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}…", &s[..max_len])
    }
}

impl PivotTableConfig {
    /// Get all placements for a specific area, sorted by position.
    #[must_use]
    pub fn get_placements_for_area(&self, area: PivotFieldArea) -> Vec<&PivotFieldPlacementFlat> {
        let mut placements: Vec<&PivotFieldPlacementFlat> =
            self.placements.iter().filter(|p| p.area == area).collect();
        placements.sort_by_key(|p| p.position);
        placements
    }

    /// Get a field by ID.
    #[must_use]
    pub fn get_field(&self, field_id: &str) -> Option<&PivotField> {
        self.fields.iter().find(|f| f.id.as_str() == field_id)
    }

    /// Get value field placements, sorted by position.
    #[must_use]
    pub fn value_placements(&self) -> Vec<&PivotFieldPlacementFlat> {
        self.get_placements_for_area(PivotFieldArea::Value)
    }

    /// Get row field placements, sorted by position.
    #[must_use]
    pub fn row_placements(&self) -> Vec<&PivotFieldPlacementFlat> {
        self.get_placements_for_area(PivotFieldArea::Row)
    }

    /// Get column field placements, sorted by position.
    #[must_use]
    pub fn column_placements(&self) -> Vec<&PivotFieldPlacementFlat> {
        self.get_placements_for_area(PivotFieldArea::Column)
    }

    /// Move a field placement to a target area and position, recalculating all indices.
    ///
    /// This mirrors the TypeScript `moveFieldPlacement` + `reorderPlacements` logic:
    ///
    /// 1. The placement at `field_index` is removed from the placements list.
    /// 2. Its area is changed to `target_area` (converting the variant if needed).
    /// 3. Its position is set to `position` (will be clamped during reindexing).
    /// 4. It is appended back to the list.
    /// 5. All placements are grouped by area, sorted by position, and reindexed 0..n.
    ///
    /// # Panics
    ///
    /// Does not panic. Returns `false` if `field_index` is out of bounds.
    pub fn reorder_placement(
        &mut self,
        field_index: usize,
        target_area: PivotFieldArea,
        position: usize,
    ) -> bool {
        if field_index >= self.placements.len() {
            return false;
        }

        // Remove the placement from its current position
        let mut placement = self.placements.remove(field_index);

        // Convert to the target area (no-op if same area)
        placement.area = target_area;

        // Set the desired position (reindexing below will normalize it)
        placement.position = position;

        // Append to the end — reindexing will place it correctly
        self.placements.push(placement);

        // Reindex: group by area, sort each group by position within each area, reassign 0..n
        Self::reindex_placements(&mut self.placements);

        true
    }

    /// Reindex all placements: group by area, sort each group by position, reassign 0..n.
    ///
    /// This is the Rust equivalent of the TypeScript `reorderPlacements` method.
    fn reindex_placements(placements: &mut [PivotFieldPlacementFlat]) {
        // We need to process each area independently.
        // Collect indices for each area, sort by current position, then reassign.
        for area in &[
            PivotFieldArea::Row,
            PivotFieldArea::Column,
            PivotFieldArea::Value,
            PivotFieldArea::Filter,
        ] {
            // Collect indices of placements in this area
            let mut area_indices: Vec<usize> = placements
                .iter()
                .enumerate()
                .filter(|(_, p)| p.area == *area)
                .map(|(i, _)| i)
                .collect();

            // Sort indices by the current position of their placement
            area_indices.sort_by_key(|&i| placements[i].position);

            // Reassign positions 0, 1, 2, ...
            for (new_pos, &idx) in area_indices.iter().enumerate() {
                placements[idx].position = new_pos;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculated_field_id_serializes_as_string() {
        let id = CalculatedFieldId::from("margin");
        let json = serde_json::to_value(&id).expect("serialize id");

        assert_eq!(json, serde_json::json!("margin"));
    }

    #[test]
    fn pivot_config_schema_version_defaults_for_legacy_json() {
        let json = serde_json::json!({
            "id": "pivot-1",
            "name": "Pivot",
            "sourceSheetName": "Data",
            "sourceRange": {"startRow": 0, "startCol": 0, "endRow": 4, "endCol": 2},
            "outputSheetName": "Pivot",
            "outputLocation": {"row": 0, "col": 0},
            "fields": [],
            "placements": [],
            "filters": []
        });

        let config: PivotTableConfig = serde_json::from_value(json).expect("legacy config");

        assert_eq!(config.schema_version, PIVOT_CONFIG_SCHEMA_VERSION);
    }

    #[test]
    fn pivot_config_accepts_flat_value_placements_from_typescript() {
        let json = serde_json::json!({
            "id": "pivot-1",
            "name": "Pivot",
            "sourceSheetName": "Data",
            "sourceRange": {"startRow": 0, "startCol": 0, "endRow": 4, "endCol": 2},
            "outputSheetName": "Pivot",
            "outputLocation": {"row": 0, "col": 0},
            "fields": [],
            "placements": [
                {
                    "placementId": "value-revenue",
                    "fieldId": "revenue",
                    "area": "value",
                    "position": 0,
                    "aggregateFunction": "sum"
                }
            ],
            "filters": []
        });

        let config: PivotTableConfig = serde_json::from_value(json).expect("flat placement config");
        let serialized = serde_json::to_value(&config).expect("serialize config");

        assert_eq!(config.placements.len(), 1);
        assert_eq!(
            serialized["placements"][0],
            serde_json::json!({
                "placementId": "value-revenue",
                "fieldId": "revenue",
                "area": "value",
                "position": 0,
                "aggregateFunction": "sum"
            })
        );
    }
}
