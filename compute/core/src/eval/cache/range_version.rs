use smallvec::SmallVec;

use crate::eval::context::traits::DataSource;
use cell_types::SheetId;

/// Captures column version snapshots for a range of columns.
/// Used to validate whether cached data is still current.
#[derive(Debug, Clone)]
pub struct RangeVersion {
    versions: SmallVec<[((SheetId, u32), u64); 4]>,
}

impl RangeVersion {
    /// Capture the current column versions for a range of columns.
    ///
    /// If `col_start > col_end` (inverted range), the version is empty and
    /// `is_valid()` will return `true` (vacuously). Callers should guard
    /// against inverted ranges before caching data keyed on this version.
    pub fn capture(source: &dyn DataSource, sheet: &SheetId, col_start: u32, col_end: u32) -> Self {
        let mut versions = SmallVec::new();
        // Inverted range (col_start > col_end) produces an empty version whose
        // is_valid() is vacuously true. Callers should guard against caching
        // data keyed on such a version.
        for col in col_start..=col_end {
            let v = source.col_version(sheet, col);
            versions.push(((*sheet, col), v));
        }
        RangeVersion { versions }
    }

    /// Check if all captured column versions still match the data source.
    pub fn is_valid(&self, source: &dyn DataSource) -> bool {
        self.versions
            .iter()
            .all(|((sheet, col), v)| source.col_version(sheet, *col) == *v)
    }

    /// Returns true if this range version has no columns tracked.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.versions.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::{CellEntry, CellMirror, SheetMirror};
    use cell_types::{CellId, SheetPos};
    use value_types::CellValue;

    fn make_mirror_with_sheet() -> (CellMirror, SheetId) {
        let mut mirror = CellMirror::new();
        let sheet_id = SheetId::from_raw(1);
        let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 10);
        mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
        (mirror, sheet_id)
    }

    #[test]
    fn capture_is_valid_when_nothing_changed() {
        let (mirror, sheet_id) = make_mirror_with_sheet();
        let rv = RangeVersion::capture(&mirror, &sheet_id, 0, 2);
        assert!(rv.is_valid(&mirror));
    }

    #[test]
    fn is_valid_false_after_write_to_tracked_column() {
        let (mut mirror, sheet_id) = make_mirror_with_sheet();
        let rv = RangeVersion::capture(&mirror, &sheet_id, 0, 2);

        // Write to column 1
        let cell_id = CellId::from_raw(100);
        let pos = SheetPos::new(0, 1);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            pos,
            CellEntry {
                value: CellValue::number(42.0),
                formula: None,
            },
        );

        assert!(!rv.is_valid(&mirror));
    }

    #[test]
    fn multi_column_range_only_b_changes() {
        let (mut mirror, sheet_id) = make_mirror_with_sheet();

        // Insert into col 0 and col 2 first
        let cell_a = CellId::from_raw(200);
        mirror.insert_cell(
            &sheet_id,
            cell_a,
            SheetPos::new(0, 0),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        let cell_c = CellId::from_raw(201);
        mirror.insert_cell(
            &sheet_id,
            cell_c,
            SheetPos::new(0, 2),
            CellEntry {
                value: CellValue::number(3.0),
                formula: None,
            },
        );

        // Capture after initial writes
        let rv = RangeVersion::capture(&mirror, &sheet_id, 0, 2);
        assert!(rv.is_valid(&mirror));

        // Write to column 1 only
        let cell_b = CellId::from_raw(202);
        mirror.insert_cell(
            &sheet_id,
            cell_b,
            SheetPos::new(0, 1),
            CellEntry {
                value: CellValue::number(2.0),
                formula: None,
            },
        );

        assert!(!rv.is_valid(&mirror));
    }

    #[test]
    fn is_empty_for_degenerate_range() {
        let (mirror, sheet_id) = make_mirror_with_sheet();
        // col_start > col_end => empty (0..=u32 wraps, but the range is empty)
        let rv = RangeVersion::capture(&mirror, &sheet_id, 5, 3);
        assert!(rv.is_empty());
    }
}
