use crate::types::SortDirection;

/// Sort configuration controlling direction, case sensitivity, and natural sort.
///
/// Unlike the previous version, there is no `nulls_first` field — blanks always
/// sort last (Excel behavior), encoded in `SortKey`'s type priority.
///
/// There is no "none" direction. If you need "preserve original order", wrap in
/// `Option<SortConfig>` and skip sorting when `None`.
#[derive(Debug, Clone)]
pub struct SortConfig {
    /// Sort direction: ascending or descending.
    pub direction: SortDirection,
    /// Whether string comparisons are case-sensitive.
    /// When `false` (the default), "Apple" and "apple" compare equal.
    pub case_sensitive: bool,
    /// Whether to use natural sort for strings.
    /// When `true` (the default), "Item 2" sorts before "Item 10".
    pub natural_sort: bool,
}

impl Default for SortConfig {
    fn default() -> Self {
        SortConfig {
            direction: SortDirection::Asc,
            case_sensitive: false,
            natural_sort: true,
        }
    }
}

impl SortConfig {
    /// Ascending sort with default options (case-insensitive, natural sort).
    #[must_use]
    pub fn asc() -> Self {
        SortConfig::default()
    }

    /// Descending sort with default options (case-insensitive, natural sort).
    #[must_use]
    pub fn desc() -> Self {
        SortConfig {
            direction: SortDirection::Desc,
            ..SortConfig::default()
        }
    }
}
