use cell_types::CellId;
use domain_types::domain::filter::{ColorPosition, SortOrder};
use value_types::CellValue;

/// Configuration for cell value comparison.
#[derive(Debug, Clone)]
pub(crate) struct SortConfig {
    /// Sort direction. `None` means no-op (returns Equal).
    pub order: Option<SortOrder>,
    /// Whether null/empty values sort before non-null values.
    pub nulls_first: bool,
    /// Whether string comparison is case-sensitive.
    pub case_sensitive: bool,
    /// Whether to use natural sort for strings (e.g. "Item 2" before "Item 10").
    pub natural_sort: bool,
}

impl Default for SortConfig {
    fn default() -> Self {
        Self {
            order: Some(SortOrder::Asc),
            nulls_first: true,
            case_sensitive: false,
            natural_sort: true,
        }
    }
}

/// What aspect of a cell drives the sort comparator, plus the per-mode
/// auxiliary data (custom list, target color, etc.). Discriminated so
/// invalid combinations are unrepresentable.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) enum SortMode {
    /// Sort by computed cell value. Optionally consult a custom list to
    /// override natural-order on matched values (Excel "sort by custom
    /// list" feature; values not in the list sort *after* list members).
    Value { custom_list: Option<Vec<CellValue>> },
    /// Sort by cell fill color. Matched rows are placed at the top or
    /// bottom of the range per `position`; ties fall through to natural
    /// value order.
    CellColor {
        target: String,
        position: ColorPosition,
    },
    /// Sort by font color. Same `Top`/`Bottom` semantics as `CellColor`.
    FontColor {
        target: String,
        position: ColorPosition,
    },
}

/// A single sort criterion referencing a column by its header CellId.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct SortCriterion {
    /// The CellId of the header cell in the sort column.
    pub header_cell_id: CellId,
    /// Sort direction for this column. `None` means no-op.
    pub direction: Option<SortOrder>,
    /// Whether string comparison is case-sensitive for this criterion.
    pub case_sensitive: bool,
    /// What this criterion sorts on (value / cell color / font color)
    /// plus the per-mode auxiliary data.
    pub mode: SortMode,
}

/// A single sort criterion referencing a column by absolute sheet position.
///
/// Bridge/API callers specify sort keys by column coordinate, so this planner
/// input cannot depend on sparse CellIds existing in the target column.
#[derive(Debug, Clone)]
pub(crate) struct SortColumnCriterion {
    /// Absolute zero-based sheet column index for the sort key.
    pub column: u32,
    /// Sort direction for this column. `None` means no-op.
    pub direction: Option<SortOrder>,
    /// Whether string comparison is case-sensitive for this criterion.
    pub case_sensitive: bool,
    /// What this criterion sorts on (value / cell color / font color)
    /// plus the per-mode auxiliary data.
    pub mode: SortMode,
}

/// Options for a sort operation.
#[derive(Debug, Clone)]
pub(crate) struct SortOptions {
    /// The sort criteria (one per column, evaluated in order).
    pub criteria: Vec<SortCriterion>,
    /// Whether the first row of the range is a header row (excluded from sort).
    pub has_headers: bool,
}

/// Result of computing a sorted row order.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(crate) struct SortResult {
    /// Original row indices in their new sorted order.
    pub sorted_indices: Vec<u32>,
    /// Destination row slots corresponding to `sorted_indices`.
    ///
    /// For normal sorts this is the contiguous data range. For filtered
    /// visible-row sorts it contains only non-hidden rows, preserving hidden
    /// row positions.
    pub target_indices: Vec<u32>,
    /// Number of rows that changed position.
    pub rows_moved: u32,
    /// Whether any criteria could not be resolved (e.g., column was deleted).
    pub has_unresolved_criteria: bool,
}

/// Position-only cell range (re-exported from compute-types for backward compat).
pub type CellRange = crate::PositionRange;
