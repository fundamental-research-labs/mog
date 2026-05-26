//! Table Range Resolution
//!
//! P0-07 Cell Identity Model: resolve CellId-based ranges to position-based ranges.
//! Ported from spreadsheet-model/src/tables/range-resolution.ts.

use super::types::TableRange;
use cell_types::SheetPos;

// ============================================================================
// CellId Range Types
// ============================================================================

/// A range defined by two corner CellIds (CRDT-safe table positioning).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellIdRange {
    /// CellId of the top-left corner cell.
    pub top_left_cell_id: String,
    /// CellId of the bottom-right corner cell.
    pub bottom_right_cell_id: String,
}

/// Extended table range that supports both legacy and CellId-based positioning.
#[derive(Debug, Clone, PartialEq)]
pub struct TableRangeWithIdentity {
    /// Static position-based range (legacy, always present).
    pub range: TableRange,
    /// CellId-based range for CRDT-safe positioning (present after migration).
    pub range_identity: Option<CellIdRange>,
}

/// Cell position — alias for `cell_types::SheetPos`.
pub type CellPosition = SheetPos;

/// Resolve a TableRangeWithIdentity to a concrete TableRange.
pub fn resolve_table_range(
    range_with_identity: &TableRangeWithIdentity,
    top_left_pos: Option<CellPosition>,
    bottom_right_pos: Option<CellPosition>,
) -> Option<TableRange> {
    if range_with_identity.range_identity.is_some()
        && let (Some(tl), Some(br)) = (top_left_pos, bottom_right_pos)
    {
        return Some(TableRange::new(tl.row(), tl.col(), br.row(), br.col()));
    }
    Some(range_with_identity.range)
}

/// Check if a table needs migration to the Cell Identity Model.
pub fn needs_migration(range_with_identity: &TableRangeWithIdentity) -> bool {
    range_with_identity.range_identity.is_none()
}

/// Info about a table range and columns, for converting structured refs to A1.
#[derive(Debug, Clone)]
pub struct TableRangeInfo {
    pub name: String,
    pub range: TableRange,
    pub columns: Vec<TableColumnInfo>,
    pub has_header_row: bool,
    pub has_total_row: bool,
}

/// Minimal column info for range resolution.
#[derive(Debug, Clone)]
pub struct TableColumnInfo {
    pub name: String,
    pub index: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_from_cell_id_positions() {
        let r = TableRangeWithIdentity {
            range: TableRange::new(0, 0, 10, 3),
            range_identity: Some(CellIdRange {
                top_left_cell_id: "tl".into(),
                bottom_right_cell_id: "br".into(),
            }),
        };
        let resolved = resolve_table_range(
            &r,
            Some(CellPosition::new(2, 1)),
            Some(CellPosition::new(12, 5)),
        )
        .unwrap();
        assert_eq!(resolved.start_row(), 2);
        assert_eq!(resolved.start_col(), 1);
        assert_eq!(resolved.end_row(), 12);
        assert_eq!(resolved.end_col(), 5);
    }

    #[test]
    fn fallback_to_legacy_when_corners_deleted() {
        let r = TableRangeWithIdentity {
            range: TableRange::new(0, 0, 10, 3),
            range_identity: Some(CellIdRange {
                top_left_cell_id: "tl".into(),
                bottom_right_cell_id: "br".into(),
            }),
        };
        let resolved = resolve_table_range(&r, None, Some(CellPosition::new(12, 5))).unwrap();
        assert_eq!(resolved.start_row(), 0);
        assert_eq!(resolved.end_row(), 10);
    }

    #[test]
    fn fallback_to_legacy_when_no_identity() {
        let r = TableRangeWithIdentity {
            range: TableRange::new(5, 2, 15, 7),
            range_identity: None,
        };
        let resolved = resolve_table_range(&r, None, None).unwrap();
        assert_eq!(resolved.start_row(), 5);
        assert_eq!(resolved.end_row(), 15);
    }

    #[test]
    fn needs_migration_checks() {
        let no_id = TableRangeWithIdentity {
            range: TableRange::new(0, 0, 10, 3),
            range_identity: None,
        };
        assert!(needs_migration(&no_id));
        let with_id = TableRangeWithIdentity {
            range: TableRange::new(0, 0, 10, 3),
            range_identity: Some(CellIdRange {
                top_left_cell_id: "tl".into(),
                bottom_right_cell_id: "br".into(),
            }),
        };
        assert!(!needs_migration(&with_id));
    }

    #[test]
    fn table_range_info_construction() {
        let info = TableRangeInfo {
            name: "Sales".to_string(),
            range: TableRange::new(0, 0, 10, 2),
            columns: vec![
                TableColumnInfo {
                    name: "Region".to_string(),
                    index: 0,
                },
                TableColumnInfo {
                    name: "Amount".to_string(),
                    index: 1,
                },
            ],
            has_header_row: true,
            has_total_row: false,
        };
        assert_eq!(info.columns.len(), 2);
    }
}
