//! Range Manager Utilities
//!
//! Port of `spreadsheet-model/src/utils/range-manager.ts` (spreadsheet-model elimination).
//!
//! Centralized utility for parsing and stringifying A1-style range references,
//! plus a spatial index for efficient range lookups.
//!
//! ## Type naming
//!
//! The A1-style cell/range refs here (`A1CellRef`, `A1RangeRef`) are intentionally named
//! differently from `formula_types::CellRef` / `formula_types::RangeRef`, which are
//! identity-based references used in the formula AST. The A1 types carry absolute/relative
//! markers and represent user-visible spreadsheet references like `$A$1:B10`.
//!
//! ## Spatial Index
//!
//! `RangeSpatialIndex<T>` provides efficient lookups of "which items contain this cell?"
//! using a trait-based position lookup. This supports the Cell Identity Model where
//! range schemas reference cells by CellId and positions are resolved at query time.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use cell_types::col_to_letter;
#[cfg(test)]
use cell_types::letter_to_col;

// A1-style ref types live in engine_types::ranges (public contract);
// re-import here for internal use.
pub use crate::engine_types::{A1CellRef, A1RangeRef};

/// Bounds for viewport queries (all inclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub(crate) struct ViewportBounds {
    /// Minimum row index (inclusive).
    pub min_row: u32,
    /// Maximum row index (inclusive).
    pub max_row: u32,
    /// Minimum column index (inclusive).
    pub min_col: u32,
    /// Maximum column index (inclusive).
    pub max_col: u32,
}

// =============================================================================
// Parsing
// =============================================================================

/// Parse a cell reference string (e.g., `"A1"`, `"$A$1"`, `"A$1"`).
///
/// Returns `None` if the string is not a valid cell reference.
pub(crate) fn parse_cell(cell_str: &str) -> Option<A1CellRef> {
    // Delegates to compute_parser::parse_a1_cell; lifts the typed
    // CellRefNode back into the engine-local A1CellRef shape.
    let node = compute_parser::parse_a1_cell(cell_str)?;
    let (row, col) = match node.reference {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some(A1CellRef {
        row,
        col,
        row_absolute: node.abs_row,
        col_absolute: node.abs_col,
    })
}

/// Parse a range reference string.
///
/// Supports:
/// - Simple ranges: `"A1:B10"`
/// - Absolute refs: `"$A$1:$B$10"`, `"A$1:$B10"`
/// - Cross-sheet: `"Sheet2!A1:B10"`, `"'Sheet Name'!A1:B10"`
/// - Single cell: `"A1"` (start and end are the same)
///
/// Returns `None` if the string is not a valid range reference.
pub(crate) fn parse_range(range_str: &str) -> Option<A1RangeRef> {
    // Delegates to compute_parser::{split_sheet_prefix, parse_a1_range}; lifts
    // the typed RangeRef back into A1RangeRef for engine-internal consumers.
    let (sheet_name, range_part) = split_sheet_prefix(range_str);

    let range = compute_parser::parse_a1_range(range_part)?;

    let start = a1_cell_from_positional(range.start, range.abs_start)?;
    let end = a1_cell_from_positional(range.end, range.abs_end)?;

    Some(A1RangeRef {
        start,
        end,
        sheet_name,
    })
}

/// Extract `(row, col)` from a positional `CellRef`, pairing with explicit abs
/// flags to assemble an `A1CellRef`.
fn a1_cell_from_positional(
    cell: formula_types::CellRef,
    abs: compute_parser::AbsFlags,
) -> Option<A1CellRef> {
    match cell {
        formula_types::CellRef::Positional { row, col, .. } => Some(A1CellRef {
            row,
            col,
            row_absolute: abs.row,
            col_absolute: abs.col,
        }),
        formula_types::CellRef::Resolved(_) => None,
    }
}

/// Split a range string into optional sheet name and the range part.
///
/// Handles both `Sheet1!A1:B10` and `'Sheet Name'!A1:B10` formats.
fn split_sheet_prefix(range_str: &str) -> (Option<String>, &str) {
    // Delegates to compute_parser::split_sheet_prefix; upgrades the borrowed
    // sheet-name slice to `String` for the engine-local A1RangeRef contract.
    let (sheet, rest) = compute_parser::split_sheet_prefix(range_str);
    (sheet.map(str::to_string), rest)
}

// =============================================================================
// Stringification
// =============================================================================

/// Convert a 0-based (row, col) position to an A1-style cell reference (e.g., (0, 0) → "A1").
pub(crate) fn pos_to_a1(row: u32, col: u32) -> String {
    format!("{}{}", col_to_letter(col), row + 1)
}

/// Convert an `A1CellRef` back to string (e.g., `"$A$1"`, `"B2"`).
pub(crate) fn stringify_cell(cell: &A1CellRef) -> String {
    let mut result = String::with_capacity(8);
    if cell.col_absolute {
        result.push('$');
    }
    result.push_str(&col_to_letter(cell.col));
    if cell.row_absolute {
        result.push('$');
    }
    // Convert 0-based to 1-based for display
    result.push_str(&(cell.row + 1).to_string());
    result
}

/// Convert an `A1RangeRef` back to string (e.g., `"Sheet1!$A$1:$B$10"`).
pub(crate) fn stringify_range(range: &A1RangeRef) -> String {
    let start_str = stringify_cell(&range.start);
    let end_str = stringify_cell(&range.end);

    // Check if it's a single cell (start and end are the same)
    let is_single_cell = range.start.row == range.end.row && range.start.col == range.end.col;
    let range_str = if is_single_cell {
        start_str
    } else {
        format!("{}:{}", start_str, end_str)
    };

    if let Some(ref sheet_name) = range.sheet_name {
        // Quote sheet name if it contains spaces or special chars
        let needs_quotes =
            sheet_name.contains(' ') || sheet_name.contains('!') || sheet_name.contains('\'');
        let quoted_name = if needs_quotes {
            format!("'{}'", sheet_name)
        } else {
            sheet_name.clone()
        };
        format!("{}!{}", quoted_name, range_str)
    } else {
        range_str
    }
}

// =============================================================================
// Spatial Index
// =============================================================================

/// Resolved range bounds from CellId-based refs.
///
/// Cached per-query to avoid repeated lookups.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ResolvedBounds {
    pub(crate) min_row: u32,
    pub(crate) max_row: u32,
    pub(crate) min_col: u32,
    pub(crate) max_col: u32,
}

/// Trait for resolving CellId-based range references to positions.
///
/// Implementors resolve start/end CellIds to `(row, col)` positions.
/// Returns `None` if either corner cell has been deleted.
pub(crate) trait RangeBoundsResolver {
    /// The type of range reference to resolve (e.g., an identity-based range ref).
    type RangeRef;

    /// Resolve a range reference to positional bounds.
    ///
    /// Returns `None` if either corner cell is deleted (range is invalid).
    fn resolve(&self, range_ref: &Self::RangeRef) -> Option<ResolvedBounds>;
}

/// A schema item that has an ID and a set of range references.
pub(crate) trait SpatialItem {
    /// The type of range reference used by this item.
    type RangeRef;

    /// Get the unique ID for this item (used for deduplication).
    fn id(&self) -> &str;

    /// Get the range references associated with this item.
    fn range_refs(&self) -> &[Self::RangeRef];
}

/// Spatial index for efficient range lookups.
///
/// Uses a simple scan approach suitable for spreadsheet use cases.
/// For typical usage (hundreds of validation rules, thousands of visible cells),
/// this provides excellent performance without the complexity of R-trees.
///
/// ## Cell Identity Model
///
/// Items' range references are identity-based (CellId). The spatial index
/// resolves CellIds to positions at query time via a `RangeBoundsResolver`. This
/// ensures:
/// - Concurrent structure changes compose correctly (no adjustment needed)
/// - Position resolution is always current (no stale cached positions)
/// - Deleted cells result in invalid ranges (item is effectively disabled for that range)
pub(crate) struct RangeSpatialIndex<T> {
    items: Vec<T>,
}

impl<T> Default for RangeSpatialIndex<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> RangeSpatialIndex<T> {
    /// Create a new empty spatial index.
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    /// Create a spatial index with the given items.
    pub fn with_items(items: Vec<T>) -> Self {
        Self { items }
    }

    /// Rebuild the index with new items.
    pub fn rebuild(&mut self, items: Vec<T>) {
        self.items = items;
    }

    /// Get a reference to all items in the index.
    #[allow(dead_code)] // Public API accessor — used by tests and future callers
    pub fn items(&self) -> &[T] {
        &self.items
    }
}

impl<T: SpatialItem> RangeSpatialIndex<T>
where
    T::RangeRef: Sized,
{
    /// Get all items whose ranges contain the given cell.
    ///
    /// Resolves identity-based refs to positions at query time.
    pub fn get_items_for_cell<R>(&self, row: u32, col: u32, resolver: &R) -> Vec<&T>
    where
        R: RangeBoundsResolver<RangeRef = T::RangeRef>,
    {
        let mut result = Vec::new();

        for item in &self.items {
            for range_ref in item.range_refs() {
                if let Some(bounds) = resolver.resolve(range_ref)
                    && cell_in_bounds(row, col, &bounds)
                {
                    result.push(item);
                    break; // Item matches, no need to check other ranges
                }
            }
        }

        result
    }

    /// Get all items whose ranges intersect the given viewport.
    ///
    /// Returns a `HashMap` for deduplication (item ID -> reference).
    pub fn get_items_in_viewport<'a, R>(
        &'a self,
        bounds: &ViewportBounds,
        resolver: &R,
    ) -> HashMap<&'a str, &'a T>
    where
        R: RangeBoundsResolver<RangeRef = T::RangeRef>,
    {
        let mut result = HashMap::new();

        let viewport_bounds = ResolvedBounds {
            min_row: bounds.min_row,
            max_row: bounds.max_row,
            min_col: bounds.min_col,
            max_col: bounds.max_col,
        };

        for item in &self.items {
            for range_ref in item.range_refs() {
                if let Some(item_bounds) = resolver.resolve(range_ref)
                    && bounds_overlap(&item_bounds, &viewport_bounds)
                {
                    result.insert(item.id(), item);
                    break; // Item matches, no need to check other ranges
                }
            }
        }

        result
    }
}

/// Check if a cell is within resolved bounds.
fn cell_in_bounds(row: u32, col: u32, bounds: &ResolvedBounds) -> bool {
    row >= bounds.min_row && row <= bounds.max_row && col >= bounds.min_col && col <= bounds.max_col
}

/// Check if two bounds overlap.
fn bounds_overlap(a: &ResolvedBounds, b: &ResolvedBounds) -> bool {
    !(a.max_row < b.min_row
        || a.min_row > b.max_row
        || a.max_col < b.min_col
        || a.min_col > b.max_col)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Column conversion (reuses formula_types, but validate integration)
    // -------------------------------------------------------------------------

    #[test]
    fn test_col_conversion_via_formula_types() {
        assert_eq!(col_to_letter(0), "A");
        assert_eq!(col_to_letter(25), "Z");
        assert_eq!(col_to_letter(26), "AA");
        assert_eq!(letter_to_col("A"), Some(0));
        assert_eq!(letter_to_col("Z"), Some(25));
        assert_eq!(letter_to_col("AA"), Some(26));
    }

    // -------------------------------------------------------------------------
    // parse_cell
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_cell_simple() {
        let cell = parse_cell("A1").unwrap();
        assert_eq!(cell.row, 0);
        assert_eq!(cell.col, 0);
        assert!(!cell.row_absolute);
        assert!(!cell.col_absolute);
    }

    #[test]
    fn test_parse_cell_absolute() {
        let cell = parse_cell("$A$1").unwrap();
        assert_eq!(cell.row, 0);
        assert_eq!(cell.col, 0);
        assert!(cell.row_absolute);
        assert!(cell.col_absolute);
    }

    #[test]
    fn test_parse_cell_mixed_absolute() {
        let cell = parse_cell("A$1").unwrap();
        assert!(!cell.col_absolute);
        assert!(cell.row_absolute);

        let cell = parse_cell("$A1").unwrap();
        assert!(cell.col_absolute);
        assert!(!cell.row_absolute);
    }

    #[test]
    fn test_parse_cell_multi_letter_column() {
        let cell = parse_cell("AA10").unwrap();
        assert_eq!(cell.col, 26); // AA = 26
        assert_eq!(cell.row, 9); // 10 -> 0-based = 9
    }

    #[test]
    fn test_parse_cell_case_insensitive() {
        // letter_to_col handles lowercase
        let cell = parse_cell("a1").unwrap();
        assert_eq!(cell.col, 0);
        assert_eq!(cell.row, 0);
    }

    #[test]
    fn test_parse_cell_invalid() {
        assert!(parse_cell("").is_none());
        assert!(parse_cell("$").is_none());
        assert!(parse_cell("123").is_none());
        assert!(parse_cell("A").is_none());
        assert!(parse_cell("A0").is_none()); // Row 0 is invalid
        assert!(parse_cell("1A").is_none());
        assert!(parse_cell("A1B").is_none()); // Trailing chars
    }

    // -------------------------------------------------------------------------
    // parse_range
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_range_simple() {
        let range = parse_range("A1:B10").unwrap();
        assert_eq!(range.start.col, 0);
        assert_eq!(range.start.row, 0);
        assert_eq!(range.end.col, 1);
        assert_eq!(range.end.row, 9);
        assert!(range.sheet_name.is_none());
    }

    #[test]
    fn test_parse_range_absolute() {
        let range = parse_range("$A$1:$B$10").unwrap();
        assert!(range.start.col_absolute);
        assert!(range.start.row_absolute);
        assert!(range.end.col_absolute);
        assert!(range.end.row_absolute);
    }

    #[test]
    fn test_parse_range_single_cell() {
        let range = parse_range("C5").unwrap();
        assert_eq!(range.start, range.end);
        assert_eq!(range.start.col, 2);
        assert_eq!(range.start.row, 4);
    }

    #[test]
    fn test_parse_range_with_sheet() {
        let range = parse_range("Sheet2!A1:B10").unwrap();
        assert_eq!(range.sheet_name, Some("Sheet2".to_string()));
        assert_eq!(range.start.col, 0);
        assert_eq!(range.end.col, 1);
    }

    #[test]
    fn test_parse_range_with_quoted_sheet() {
        let range = parse_range("'Sheet Name'!A1:B10").unwrap();
        assert_eq!(range.sheet_name, Some("Sheet Name".to_string()));
    }

    #[test]
    fn test_parse_range_invalid() {
        assert!(parse_range("").is_none());
        assert!(parse_range("A1:B2:C3").is_none()); // Too many colons
        assert!(parse_range("XYZ").is_none()); // No row digits
    }

    // -------------------------------------------------------------------------
    // stringify_cell / stringify_range
    // -------------------------------------------------------------------------

    #[test]
    fn test_stringify_cell_simple() {
        let cell = A1CellRef {
            row: 0,
            col: 0,
            row_absolute: false,
            col_absolute: false,
        };
        assert_eq!(stringify_cell(&cell), "A1");
    }

    #[test]
    fn test_stringify_cell_absolute() {
        let cell = A1CellRef {
            row: 0,
            col: 0,
            row_absolute: true,
            col_absolute: true,
        };
        assert_eq!(stringify_cell(&cell), "$A$1");
    }

    #[test]
    fn test_stringify_range_simple() {
        let range = parse_range("A1:B10").unwrap();
        assert_eq!(stringify_range(&range), "A1:B10");
    }

    #[test]
    fn test_stringify_range_single_cell() {
        let range = parse_range("C5").unwrap();
        assert_eq!(stringify_range(&range), "C5");
    }

    #[test]
    fn test_stringify_range_with_sheet() {
        let range = A1RangeRef {
            start: A1CellRef {
                row: 0,
                col: 0,
                row_absolute: false,
                col_absolute: false,
            },
            end: A1CellRef {
                row: 9,
                col: 1,
                row_absolute: false,
                col_absolute: false,
            },
            sheet_name: Some("Sheet1".to_string()),
        };
        assert_eq!(stringify_range(&range), "Sheet1!A1:B10");
    }

    #[test]
    fn test_stringify_range_with_quoted_sheet() {
        let range = A1RangeRef {
            start: A1CellRef {
                row: 0,
                col: 0,
                row_absolute: false,
                col_absolute: false,
            },
            end: A1CellRef {
                row: 9,
                col: 1,
                row_absolute: false,
                col_absolute: false,
            },
            sheet_name: Some("My Sheet".to_string()),
        };
        assert_eq!(stringify_range(&range), "'My Sheet'!A1:B10");
    }

    #[test]
    fn test_parse_stringify_roundtrip() {
        let test_cases = [
            "A1",
            "A1:B10",
            "$A$1:$B$10",
            "A$1:$B10",
            "Sheet1!A1:B10",
            "AA100:ZZ200",
        ];
        for case in &test_cases {
            let parsed = parse_range(case).unwrap();
            let stringified = stringify_range(&parsed);
            assert_eq!(&stringified, case, "roundtrip failed for '{}'", case);
        }
    }

    #[test]
    fn test_parse_stringify_roundtrip_quoted_sheet() {
        let input = "'My Sheet'!A1:B10";
        let parsed = parse_range(input).unwrap();
        let stringified = stringify_range(&parsed);
        assert_eq!(stringified, input);
    }

    // -------------------------------------------------------------------------
    // Spatial Index
    // -------------------------------------------------------------------------

    /// A test schema item for spatial index tests.
    #[derive(Debug, Clone)]
    struct TestSchema {
        id: String,
        ranges: Vec<TestRangeRef>,
    }

    /// A simple (row, col) based range ref for testing.
    #[derive(Debug, Clone)]
    struct TestRangeRef {
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    }

    impl SpatialItem for TestSchema {
        type RangeRef = TestRangeRef;

        fn id(&self) -> &str {
            &self.id
        }

        fn range_refs(&self) -> &[TestRangeRef] {
            &self.ranges
        }
    }

    /// A simple resolver that uses the bounds directly.
    struct DirectResolver;

    impl RangeBoundsResolver for DirectResolver {
        type RangeRef = TestRangeRef;

        fn resolve(&self, range_ref: &TestRangeRef) -> Option<ResolvedBounds> {
            Some(ResolvedBounds {
                min_row: range_ref.start_row.min(range_ref.end_row),
                max_row: range_ref.start_row.max(range_ref.end_row),
                min_col: range_ref.start_col.min(range_ref.end_col),
                max_col: range_ref.start_col.max(range_ref.end_col),
            })
        }
    }

    #[test]
    fn test_spatial_index_get_items_for_cell() {
        let schemas = vec![
            TestSchema {
                id: "s1".to_string(),
                ranges: vec![TestRangeRef {
                    start_row: 0,
                    start_col: 0,
                    end_row: 2,
                    end_col: 2,
                }],
            },
            TestSchema {
                id: "s2".to_string(),
                ranges: vec![TestRangeRef {
                    start_row: 5,
                    start_col: 5,
                    end_row: 7,
                    end_col: 7,
                }],
            },
        ];

        let index = RangeSpatialIndex::with_items(schemas);
        let resolver = DirectResolver;

        // Cell (1,1) is in s1
        let items = index.get_items_for_cell(1, 1, &resolver);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id(), "s1");

        // Cell (6,6) is in s2
        let items = index.get_items_for_cell(6, 6, &resolver);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id(), "s2");

        // Cell (3,3) is in neither
        let items = index.get_items_for_cell(3, 3, &resolver);
        assert!(items.is_empty());
    }

    #[test]
    fn test_spatial_index_get_items_in_viewport() {
        let schemas = vec![
            TestSchema {
                id: "s1".to_string(),
                ranges: vec![TestRangeRef {
                    start_row: 0,
                    start_col: 0,
                    end_row: 5,
                    end_col: 5,
                }],
            },
            TestSchema {
                id: "s2".to_string(),
                ranges: vec![TestRangeRef {
                    start_row: 10,
                    start_col: 10,
                    end_row: 15,
                    end_col: 15,
                }],
            },
            TestSchema {
                id: "s3".to_string(),
                ranges: vec![TestRangeRef {
                    start_row: 3,
                    start_col: 3,
                    end_row: 12,
                    end_col: 12,
                }],
            },
        ];

        let index = RangeSpatialIndex::with_items(schemas);
        let resolver = DirectResolver;

        // Viewport that intersects s1 and s3 but not s2
        let viewport = ViewportBounds {
            min_row: 0,
            max_row: 8,
            min_col: 0,
            max_col: 8,
        };
        let items = index.get_items_in_viewport(&viewport, &resolver);
        assert_eq!(items.len(), 2);
        assert!(items.contains_key("s1"));
        assert!(items.contains_key("s3"));
        assert!(!items.contains_key("s2"));
    }

    #[test]
    fn test_spatial_index_multiple_ranges_per_item() {
        let schemas = vec![TestSchema {
            id: "multi".to_string(),
            ranges: vec![
                TestRangeRef {
                    start_row: 0,
                    start_col: 0,
                    end_row: 1,
                    end_col: 1,
                },
                TestRangeRef {
                    start_row: 10,
                    start_col: 10,
                    end_row: 11,
                    end_col: 11,
                },
            ],
        }];

        let index = RangeSpatialIndex::with_items(schemas);
        let resolver = DirectResolver;

        // Cell in first range
        let items = index.get_items_for_cell(0, 0, &resolver);
        assert_eq!(items.len(), 1);

        // Cell in second range
        let items = index.get_items_for_cell(10, 10, &resolver);
        assert_eq!(items.len(), 1);

        // Cell in neither
        let items = index.get_items_for_cell(5, 5, &resolver);
        assert!(items.is_empty());
    }

    #[test]
    fn test_spatial_index_rebuild() {
        let mut index: RangeSpatialIndex<TestSchema> = RangeSpatialIndex::new();
        let resolver = DirectResolver;

        assert!(index.get_items_for_cell(0, 0, &resolver).is_empty());

        index.rebuild(vec![TestSchema {
            id: "s1".to_string(),
            ranges: vec![TestRangeRef {
                start_row: 0,
                start_col: 0,
                end_row: 5,
                end_col: 5,
            }],
        }]);

        assert_eq!(index.get_items_for_cell(0, 0, &resolver).len(), 1);
    }

    #[test]
    fn test_spatial_index_resolver_returns_none() {
        /// A resolver that always returns None (simulating deleted cells).
        struct NullResolver;

        impl RangeBoundsResolver for NullResolver {
            type RangeRef = TestRangeRef;

            fn resolve(&self, _range_ref: &TestRangeRef) -> Option<ResolvedBounds> {
                None
            }
        }

        let schemas = vec![TestSchema {
            id: "s1".to_string(),
            ranges: vec![TestRangeRef {
                start_row: 0,
                start_col: 0,
                end_row: 5,
                end_col: 5,
            }],
        }];

        let index = RangeSpatialIndex::with_items(schemas);
        let resolver = NullResolver;

        // Even though cell is in range, resolver returns None -> no match
        let items = index.get_items_for_cell(1, 1, &resolver);
        assert!(items.is_empty());
    }

    // -------------------------------------------------------------------------
    // Serde roundtrips
    // -------------------------------------------------------------------------

    #[test]
    fn test_a1_cell_ref_serde_roundtrip() {
        let cell = A1CellRef {
            row: 5,
            col: 3,
            row_absolute: true,
            col_absolute: false,
        };
        let json = serde_json::to_string(&cell).unwrap();
        let deserialized: A1CellRef = serde_json::from_str(&json).unwrap();
        assert_eq!(cell, deserialized);
    }

    #[test]
    fn test_a1_range_ref_serde_roundtrip() {
        let range = A1RangeRef {
            start: A1CellRef {
                row: 0,
                col: 0,
                row_absolute: false,
                col_absolute: false,
            },
            end: A1CellRef {
                row: 9,
                col: 2,
                row_absolute: true,
                col_absolute: true,
            },
            sheet_name: Some("Sheet1".to_string()),
        };
        let json = serde_json::to_string(&range).unwrap();
        let deserialized: A1RangeRef = serde_json::from_str(&json).unwrap();
        assert_eq!(range, deserialized);
    }

    #[test]
    fn test_viewport_bounds_serde_roundtrip() {
        let bounds = ViewportBounds {
            min_row: 0,
            max_row: 100,
            min_col: 0,
            max_col: 25,
        };
        let json = serde_json::to_string(&bounds).unwrap();
        let deserialized: ViewportBounds = serde_json::from_str(&json).unwrap();
        assert_eq!(bounds, deserialized);
    }

    #[test]
    fn test_default_spatial_index() {
        let index: RangeSpatialIndex<TestSchema> = RangeSpatialIndex::default();
        assert!(index.items().is_empty());
    }
}
