use serde::{Deserialize, Serialize};

use crate::config::CalculatedFieldId;
use crate::config::PivotRenderedBounds;
use crate::field_id::FieldId;
use crate::placement::PivotValueSource;
use crate::placement::PlacementId;
use domain_types::domain::analytics::AggregateFunction;
use value_types::CellValue;

/// Typed key for one member on a pivot axis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotMemberKey {
    /// Placement that produced this member.
    pub placement_id: PlacementId,
    /// Source field for field-backed axis members.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_id: Option<FieldId>,
    /// Typed member value.
    pub value: CellValue,
}

/// Typed tuple key for a row or column leaf.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTupleKey {
    /// Ordered member path from outermost to innermost placement.
    pub members: Vec<PivotMemberKey>,
    /// Whether this tuple identifies a subtotal.
    pub is_subtotal: bool,
    /// Whether this tuple identifies a grand total.
    pub is_grand_total: bool,
}

/// Descriptor for one computed measure in a pivot result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotMeasureDescriptor {
    /// Placement that requested this measure.
    pub placement_id: PlacementId,
    /// Field or calculated-field source for the measure.
    pub source: PivotValueSource,
    /// Aggregation used for field-backed measures.
    pub aggregate_function: AggregateFunction,
    /// Display name shown to users.
    pub name: String,
    /// Optional number format string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

/// Compatibility descriptor for calculated measures emitted in result metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotCalculatedMeasureDescriptor {
    /// Calculated field identity.
    pub calculated_field_id: CalculatedFieldId,
    /// Display name shown to users.
    pub name: String,
    /// Formula expression used to compute the measure.
    pub formula: String,
}

/// One addressable value in the pivot body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotValueRecord {
    /// Row tuple addressed by this value.
    pub row_key: PivotTupleKey,
    /// Column tuple addressed by this value.
    pub column_key: PivotTupleKey,
    /// Measure descriptor index in `PivotTableResult.measure_descriptors`.
    pub measure_index: usize,
    /// Computed cell value.
    pub value: CellValue,
    /// Source row indices contributing to this value when provenance is enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_row_indices: Option<Vec<usize>>,
}

/// A single header in the row or column axis.
///
/// Headers form a tree structure: each header has a `parent_key` linking to its
/// parent and `child_keys` listing its children.
///
/// # Key Encoding
///
/// The `key` field uses a compound encoding for unique identification:
/// - NUL-separated path components: `"East\0Widget"` for the Widget group under East
/// - Sentinel suffixes for special rows: `"East\0__SUBTOTAL__"` for the East subtotal
/// - Grand total key: `"__GRAND_TOTAL__"`
///
/// This encoding ensures uniqueness across all levels and prevents collisions
/// between data values and structural elements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)] // These bools represent independent header properties
pub struct PivotHeader {
    /// Compound key uniquely identifying this header in the tree.
    /// See "Key Encoding" in the type documentation.
    pub key: String,
    /// The display value for this header.
    pub value: CellValue,
    /// The field this header belongs to.
    pub field_id: FieldId,
    /// Nesting depth (0 = outermost grouping level).
    pub depth: usize,
    /// Number of child rows/columns this header spans.
    pub span: usize,
    /// Whether this header can be expanded to show children.
    pub is_expandable: bool,
    /// Whether this header is currently expanded.
    pub is_expanded: bool,
    /// Whether this is a subtotal row/column.
    pub is_subtotal: bool,
    /// Whether this is the grand total row/column.
    pub is_grand_total: bool,
    /// Key of the parent header (None for top-level headers).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_key: Option<String>,
    /// Keys of child headers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_keys: Option<Vec<String>>,
}

/// A row in the pivot table result.
///
/// Each row contains headers (identifying the row's position in the grouping
/// hierarchy) and values (aggregated data for each column x value-field combination).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotRow {
    /// Compound key uniquely identifying this row.
    pub key: String,
    /// Headers for this row (one per row axis field, plus potential subtotal/grand total markers).
    pub headers: Vec<PivotHeader>,
    /// Aggregated values for this row (one per column-leaf x value-field combination).
    pub values: Vec<CellValue>,
    /// Nesting depth of this row.
    pub depth: usize,
    /// Whether this is a subtotal row.
    pub is_subtotal: bool,
    /// Whether this is the grand total row.
    pub is_grand_total: bool,
    /// Source row indices from the original data that contribute to this row's values.
    /// Present when provenance tracking is enabled; indices are 0-based into the source
    /// data rows (excluding the header row).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_row_indices: Option<Vec<usize>>,
}

/// Column header structure (multi-level).
///
/// For multi-level column groupings (e.g., Year > Quarter), each level has its
/// own `PivotColumnHeader` with the headers at that level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotColumnHeader {
    /// Headers at this column level.
    pub headers: Vec<PivotHeader>,
    /// The field this column level corresponds to.
    pub field_id: FieldId,
}

/// Grand totals structure for the pivot table.
///
/// # Structure
///
/// - `row`: 1D vector — one value per (column-leaf x value-field) combination.
///   This is the "Grand Total" row at the bottom of the pivot table.
///
/// - `column`: 2D vector — `column[row_idx][value_idx]` gives the row grand total
///   for each row. This is the "Grand Total" column on the right side.
///   It's 2D because each row contributes one set of totals (one per value field).
///
/// - `grand`: 1D vector — the corner cell(s) where row and column grand totals meet.
///   One value per value field. This is the overall total of all data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotGrandTotals {
    /// Row grand totals (bottom row): one value per column-leaf x value-field.
    ///
    /// `Some(Vec::new())` is a legal value meaning "frame the row grand-total
    /// slot, no value cells to fill" — the materializer writes the label and
    /// reserves the slot but writes no value cells. `None` means "no row
    /// grand-total slot for this axis at all"; the materializer writes nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<Vec<CellValue>>,
    /// Column grand totals (rightmost column): `column[row_idx][value_idx]`.
    ///
    /// `Some(Vec::new())` (or a vector of empty inner vecs) is a legal value
    /// meaning "frame the column grand-total slot, no value cells to fill" —
    /// the materializer writes the column-GT header label and reserves the
    /// slot but writes no value cells. `None` means "no column grand-total
    /// slot for this axis at all"; the materializer writes nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<Vec<Vec<CellValue>>>,
    /// Corner grand total: one value per value field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grand: Option<Vec<CellValue>>,
    /// Caption shared by the row-GT label cell *and* the column-GT header-label
    /// cell. Both come from `layout.grand_total_caption()` (or `"Grand Total"`
    /// default). Despite the field name, it is read from two sites.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_label: Option<String>,
}

/// Complete computed pivot table result.
///
/// This is the output of `compute()` — a fully materialized pivot table ready
/// for rendering. It contains the column headers, data rows, grand totals,
/// metadata, and any errors encountered during computation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotTableResult {
    /// Column headers (one per column grouping level).
    pub column_headers: Vec<PivotColumnHeader>,
    /// Data rows (includes subtotal rows if enabled).
    pub rows: Vec<PivotRow>,
    /// Grand totals (row, column, and corner).
    pub grand_totals: PivotGrandTotals,
    /// Number of rows in the source data (excluding header).
    pub source_row_count: usize,
    /// Layout geometry for rendering. Computed by the engine so renderers
    /// don't need to infer it from row/column data.
    pub rendered_bounds: PivotRenderedBounds,
    /// Measure descriptors for addressable values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub measure_descriptors: Vec<PivotMeasureDescriptor>,
    /// Addressable value records keyed by typed row/column tuples.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_records: Vec<PivotValueRecord>,
    /// Any non-fatal errors encountered during computation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

impl PivotTableResult {
    /// Create an empty result, typically used for error or empty-data paths.
    #[must_use]
    pub fn empty(source_row_count: usize, errors: Option<Vec<String>>) -> Self {
        Self {
            column_headers: vec![],
            rows: vec![],
            grand_totals: PivotGrandTotals {
                row: None,
                column: None,
                grand: None,
                row_label: None,
            },
            rendered_bounds: PivotRenderedBounds {
                total_rows: 0,
                total_cols: 0,
                first_data_row: 0,
                first_data_col: 0,
                num_data_cols: 0,
            },
            measure_descriptors: vec![],
            value_records: vec![],
            source_row_count,
            errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_value_record_serializes_measure_and_tuple_keys() {
        let record = PivotValueRecord {
            row_key: PivotTupleKey {
                members: vec![PivotMemberKey {
                    placement_id: PlacementId::from("row-region"),
                    field_id: Some(FieldId::from("region")),
                    value: CellValue::from("East"),
                }],
                is_subtotal: false,
                is_grand_total: false,
            },
            column_key: PivotTupleKey {
                members: vec![],
                is_subtotal: false,
                is_grand_total: true,
            },
            measure_index: 0,
            value: CellValue::from(12.0),
            source_row_indices: Some(vec![0, 3]),
        };

        let json = serde_json::to_value(&record).expect("serialize value record");

        assert_eq!(json["rowKey"]["members"][0]["placementId"], "row-region");
        assert_eq!(json["measureIndex"], 0);
        assert_eq!(json["sourceRowIndices"], serde_json::json!([0, 3]));
    }

    #[test]
    fn empty_result_initializes_new_metadata_vectors() {
        let result = PivotTableResult::empty(5, None);

        assert!(result.measure_descriptors.is_empty());
        assert!(result.value_records.is_empty());
        assert_eq!(result.source_row_count, 5);
    }
}
