//! Merge-range lowering — boundary 1.16.
//!
//! **W4.d status: no field migration required.** `MergeRange::from_ref`
//! (at `file-io/xlsx/parser/src/domain/worksheet/read.rs:47`) parses the
//! XLSX `<mergeCell ref="…"/>` reference into numeric coordinates at
//! construction time. The canonical struct — `ooxml_types::worksheet::MergeRange`
//! — carries `start_row`, `start_col`, `end_row`, `end_col` as `u32` fields
//! alongside `ref_range: String`; the downstream [`domain_types::MergeRegion`]
//! drops the string entirely and keeps only the numeric coordinates.
//!
//! The consumer path (`storage/infra/hydration/features::hydrate_merges`
//! and friends) reads `merge.start_row` / `merge.end_col` directly —
//! there is no shadow-parse of the ref string anywhere downstream.
//!
//! Per the W3 pre-split plan note for this landing pad:
//! > `MergeRange` is already typed at construction (via `MergeRange::from_ref`),
//! > so any work here is limited to adding downstream callers / verifying
//! > the existing typed shape flows through the lowering pipeline cleanly.
//!
//! The W4.d verification (below) confirms the typed shape flows end-to-end;
//! no boundary work required. Placed here as a documented no-op so later
//! agents can tell "this was reviewed and the boundary is clean" from "this
//! is a pending landing pad nobody has opened yet."

#[cfg(test)]
mod tests {
    use domain_types::MergeRegion;
    use ooxml_types::worksheet::MergeRange;

    /// Confirm that `MergeRange::from_ref` parses into numeric coordinates
    /// at construction, i.e. the typed shape is in place at the XLSX
    /// boundary without any downstream String custody.
    #[test]
    fn merge_range_from_ref_is_numeric_at_construction() {
        let mr = MergeRange::from_ref("A1:B3");
        assert_eq!(mr.start_row, 0);
        assert_eq!(mr.start_col, 0);
        assert_eq!(mr.end_row, 2);
        assert_eq!(mr.end_col, 1);
        // The reference string is present for writer round-trip — but the
        // consumers read numeric coordinates, not the string.
        assert_eq!(mr.ref_range, "A1:B3");
    }

    /// Confirm that `domain_types::MergeRegion` drops the string entirely:
    /// it is the only shape compute-core consumes downstream.
    #[test]
    fn merge_region_is_pure_numeric() {
        let mr = MergeRange::from_ref("C2:D5");
        let region: MergeRegion = mr.into();
        assert_eq!(region.start_row, 1);
        assert_eq!(region.start_col, 2);
        assert_eq!(region.end_row, 4);
        assert_eq!(region.end_col, 3);
    }

    /// `MergeRegion` round-trips through `MergeRange` without loss — no
    /// String hop in either direction.
    #[test]
    fn merge_region_round_trip_numeric() {
        let original = MergeRegion {
            start_row: 3,
            start_col: 7,
            end_row: 9,
            end_col: 14,
        };
        let mr: MergeRange = original.clone().into();
        let back: MergeRegion = mr.into();
        assert_eq!(original, back);
    }
}
