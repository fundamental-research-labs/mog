//! Native workbook-level mutations for What-If Data Table regions.

use std::collections::HashSet;

use cell_types::{CellId, SheetId, SheetPos};
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;

use crate::mirror::CellMirror;
use crate::storage::WorkbookStorage;

fn data_table_region_id(def: &DataTableRegionDef) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        def.sheet, def.start_row, def.start_col, def.end_row, def.end_col
    )
}

/// Sheet IDs cross several persistence boundaries: imported snapshots may
/// carry dashed UUIDs, while the in-memory engine normally emits compact
/// 32-character hex. Compare IDs semantically and preserve the source's
/// spelling when a moved region is rewritten so snapshot round trips retain
/// their authored representation.
fn sheet_id_matches(value: &str, sheet_id: &SheetId) -> bool {
    SheetId::from_uuid_str(value).is_ok_and(|parsed| parsed == *sheet_id)
}

fn sheet_id_like(value: &str, sheet_id: &SheetId) -> String {
    if value.contains('-') {
        uuid::Uuid::from_u128(sheet_id.as_u128()).to_string()
    } else {
        sheet_id.to_uuid_string()
    }
}

/// The result of a workbook-level data-table mutation.
///
/// `invalidated` contains the old definitions whose body formulas must be
/// dematerialized by the caller. The native region catalog is authoritative
/// for export, while the cell formula text is authoritative for recalculation; returning
/// both sides of that contract keeps a removed region from becoming an
/// executable `TABLE(...)` formula after the next recalc.
#[derive(Debug, Default)]
pub struct DataTableRegionMutation {
    pub changed: bool,
    pub invalidated: Vec<DataTableRegionDef>,
    /// Cell ranges whose `TABLE(...)` body formula state must be cleared after
    /// the region catalog mutation. A source range can produce both an old source
    /// range and a translated destination range during a partial move.
    pub formula_ranges: Vec<(SheetId, u32, u32, u32, u32)>,
}

/// Relocate authoritative data-table regions during a cell cut/move. A region
/// moves only when its complete body is inside the source range and its input
/// references can follow the move. Complete
/// cross-sheet moves are supported for positional/raw input refs inside the
/// moved range. A positional/raw input outside that range cannot be serialized
/// with an explicit sheet by the current XLSX export contract, so that region
/// is invalidated rather than replayed on the wrong sheet. Partial and
/// destination-conflicting regions are also invalidated.
pub fn relocate_regions(
    mirror: &mut CellMirror,
    source_sheet: &SheetId,
    source_start_row: u32,
    source_start_col: u32,
    source_end_row: u32,
    source_end_col: u32,
    target_sheet: &SheetId,
    target_start_row: u32,
    target_start_col: u32,
) -> DataTableRegionMutation {
    let regions: Vec<(String, DataTableRegionDef)> = mirror
        .all_data_table_regions()
        .iter()
        .map(|region| (data_table_region_id(region), region.clone()))
        .collect();
    let source_bounds = (
        source_start_row,
        source_start_col,
        source_end_row,
        source_end_col,
    );
    let target_end_row = target_start_row.saturating_add(source_end_row - source_start_row);
    let target_end_col = target_start_col.saturating_add(source_end_col - source_start_col);
    let target_bounds = (
        target_start_row,
        target_start_col,
        target_end_row,
        target_end_col,
    );

    // Decide every move against the immutable pre-mutation snapshot first.
    // Applying removals and inserts while iterating the catalog can otherwise
    // remove a freshly inserted destination record when its derived key also
    // names an old destination record.
    let mut candidates = Vec::new();
    let mut invalidated_keys = HashSet::new();
    let mut mutation = DataTableRegionMutation::default();

    for (key, region) in &regions {
        let region_box = (
            region.start_row,
            region.start_col,
            region.end_row,
            region.end_col,
        );
        let source_hit = sheet_id_matches(&region.sheet, source_sheet)
            && ranges_intersect(region_box, source_bounds);

        if !source_hit {
            continue;
        }
        if !contains_range(source_bounds, region_box) {
            record_region_invalidation(
                &mut invalidated_keys,
                &mut mutation,
                key,
                region,
                [
                    (*source_sheet, region_box),
                    (
                        *target_sheet,
                        translate_intersection(
                            region_box,
                            source_bounds,
                            target_start_row,
                            target_start_col,
                        ),
                    ),
                ],
            );
            continue;
        }

        let mut moved = region.clone();
        moved.start_row = target_start_row + (moved.start_row - source_start_row);
        moved.end_row = target_start_row + (moved.end_row - source_start_row);
        moved.start_col = target_start_col + (moved.start_col - source_start_col);
        moved.end_col = target_start_col + (moved.end_col - source_start_col);
        let inputs_follow = shift_region_input_refs(
            &mut moved,
            *source_sheet,
            source_bounds,
            *target_sheet,
            target_start_row,
            target_start_col,
        );
        moved.sheet = sheet_id_like(&region.sheet, target_sheet);
        if !inputs_follow {
            record_region_invalidation(
                &mut invalidated_keys,
                &mut mutation,
                key,
                region,
                [
                    (*source_sheet, region_box),
                    (
                        *target_sheet,
                        (
                            moved.start_row,
                            moved.start_col,
                            moved.end_row,
                            moved.end_col,
                        ),
                    ),
                ],
            );
            continue;
        }
        candidates.push((key.clone(), region.clone(), moved, region_box));
    }

    // Regions already at the destination are independently invalidated. A
    // source candidate is allowed to overlap its own old body on same-sheet
    // moves; only another region's body at the moved destination is a
    // conflict.
    for (key, region) in &regions {
        let region_box = (
            region.start_row,
            region.start_col,
            region.end_row,
            region.end_col,
        );
        if !sheet_id_matches(&region.sheet, target_sheet)
            || !ranges_intersect(region_box, target_bounds)
            || candidates
                .iter()
                .any(|(candidate_key, _, _, _)| candidate_key == key)
        {
            continue;
        }
        record_region_invalidation(
            &mut invalidated_keys,
            &mut mutation,
            key,
            region,
            [(*target_sheet, region_box)],
        );
    }

    // A candidate is retained only if its translated body does not collide
    // with another region's current body or another candidate's translated
    // body. This handles overlapping destinations deterministically while
    // still allowing a complete block containing multiple regions to move.
    for (key, region, moved, region_box) in &candidates {
        let moved_box = (
            moved.start_row,
            moved.start_col,
            moved.end_row,
            moved.end_col,
        );
        let collides = regions.iter().any(|(other_key, other)| {
            if other_key == key {
                return false;
            }
            let other_is_candidate = candidates
                .iter()
                .any(|(candidate_key, _, _, _)| candidate_key == other_key);
            if other_is_candidate {
                let other_moved = candidates
                    .iter()
                    .find(|(candidate_key, _, _, _)| candidate_key == other_key)
                    .map(|(_, _, moved, _)| {
                        (
                            moved.start_row,
                            moved.start_col,
                            moved.end_row,
                            moved.end_col,
                        )
                    });
                return other_moved.is_some_and(|other_box| ranges_intersect(moved_box, other_box));
            }
            if !sheet_id_matches(&other.sheet, target_sheet) {
                return false;
            }
            let other_box = (
                other.start_row,
                other.start_col,
                other.end_row,
                other.end_col,
            );
            ranges_intersect(moved_box, other_box)
        });
        if collides {
            record_region_invalidation(
                &mut invalidated_keys,
                &mut mutation,
                key,
                region,
                [(*source_sheet, *region_box), (*target_sheet, moved_box)],
            );
        }
    }

    // Apply the precomputed plan in two phases: remove all old/conflicting
    // records, then insert only candidates that survived every conflict check.
    let has_surviving_move = candidates
        .iter()
        .any(|(key, _, _, _)| !invalidated_keys.contains(key));
    mutation.changed = !invalidated_keys.is_empty() || has_surviving_move;
    if mutation.changed {
        let mut updated: Vec<DataTableRegionDef> = regions
            .into_iter()
            .filter(|(key, _)| {
                !invalidated_keys.contains(key)
                    && !candidates
                        .iter()
                        .any(|(candidate, _, _, _)| candidate == key)
            })
            .map(|(_, region)| region)
            .collect();
        updated.extend(
            candidates.into_iter().filter_map(|(key, _, moved, _)| {
                (!invalidated_keys.contains(&key)).then_some(moved)
            }),
        );
        mirror.replace_data_table_regions(updated);
    }
    mutation
}

/// Invalidate data-table regions touched by row compaction. Remove-duplicates
/// has no single translation delta because duplicate rows are skipped, so any
/// intersecting authoritative region is unsafe to retain.
pub fn invalidate_regions(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> DataTableRegionMutation {
    let bounds = (start_row, start_col, end_row, end_col);
    let (invalidated, retained): (Vec<_>, Vec<_>) = mirror
        .all_data_table_regions()
        .iter()
        .cloned()
        .partition(|region| {
            sheet_id_matches(&region.sheet, sheet_id)
                && ranges_intersect(
                    (
                        region.start_row,
                        region.start_col,
                        region.end_row,
                        region.end_col,
                    ),
                    bounds,
                )
        });
    let changed = !invalidated.is_empty();
    let formula_ranges = invalidated
        .iter()
        .map(|region| {
            (
                *sheet_id,
                region.start_row,
                region.start_col,
                region.end_row,
                region.end_col,
            )
        })
        .collect();
    if changed {
        mirror.replace_data_table_regions(retained);
    }
    DataTableRegionMutation {
        changed,
        invalidated,
        formula_ranges,
    }
}

fn intersection(
    left: (u32, u32, u32, u32),
    right: (u32, u32, u32, u32),
) -> Option<(u32, u32, u32, u32)> {
    if !ranges_intersect(left, right) {
        return None;
    }
    Some((
        left.0.max(right.0),
        left.1.max(right.1),
        left.2.min(right.2),
        left.3.min(right.3),
    ))
}

fn translate_range(
    range: (u32, u32, u32, u32),
    source_bounds: (u32, u32, u32, u32),
    target_row: u32,
    target_col: u32,
) -> (u32, u32, u32, u32) {
    (
        target_row + (range.0 - source_bounds.0),
        target_col + (range.1 - source_bounds.1),
        target_row + (range.2 - source_bounds.0),
        target_col + (range.3 - source_bounds.1),
    )
}

fn translate_intersection(
    region_bounds: (u32, u32, u32, u32),
    source_bounds: (u32, u32, u32, u32),
    target_row: u32,
    target_col: u32,
) -> (u32, u32, u32, u32) {
    translate_range(
        intersection(region_bounds, source_bounds).unwrap_or(region_bounds),
        source_bounds,
        target_row,
        target_col,
    )
}

fn push_formula_range(
    ranges: &mut Vec<(SheetId, u32, u32, u32, u32)>,
    sheet: SheetId,
    bounds: (u32, u32, u32, u32),
) {
    if !ranges
        .iter()
        .any(|(sid, sr, sc, er, ec)| *sid == sheet && (*sr, *sc, *er, *ec) == bounds)
    {
        ranges.push((sheet, bounds.0, bounds.1, bounds.2, bounds.3));
    }
}

fn record_region_invalidation<const N: usize>(
    invalidated_keys: &mut HashSet<String>,
    mutation: &mut DataTableRegionMutation,
    key: &str,
    region: &DataTableRegionDef,
    ranges: [(SheetId, (u32, u32, u32, u32)); N],
) {
    if !invalidated_keys.insert(key.to_string()) {
        return;
    }
    mutation.invalidated.push(region.clone());
    for (sheet, bounds) in ranges {
        push_formula_range(&mut mutation.formula_ranges, sheet, bounds);
    }
}

fn ranges_intersect(left: (u32, u32, u32, u32), right: (u32, u32, u32, u32)) -> bool {
    left.0 <= right.2 && right.0 <= left.2 && left.1 <= right.3 && right.1 <= left.3
}

fn contains_range(outer: (u32, u32, u32, u32), inner: (u32, u32, u32, u32)) -> bool {
    inner.0 >= outer.0 && inner.1 >= outer.1 && inner.2 <= outer.2 && inner.3 <= outer.3
}

fn shift_region_input_refs(
    region: &mut DataTableRegionDef,
    source_sheet: SheetId,
    source_bounds: (u32, u32, u32, u32),
    target_sheet: SheetId,
    target_row: u32,
    target_col: u32,
) -> bool {
    let cross_sheet = source_sheet != target_sheet;
    let mut follows = true;
    if let Some(reference) = &mut region.row_input_ref {
        follows &= shift_cell_ref(
            reference,
            source_sheet,
            source_bounds,
            target_sheet,
            target_row,
            target_col,
            cross_sheet,
        );
    }
    if let Some(reference) = &mut region.col_input_ref {
        follows &= shift_cell_ref(
            reference,
            source_sheet,
            source_bounds,
            target_sheet,
            target_row,
            target_col,
            cross_sheet,
        );
    }
    if let Some(flags) = &mut region.ooxml_flags {
        if let Some(reference) = &mut flags.r1 {
            follows &= shift_a1_ref(
                reference,
                source_bounds,
                target_row,
                target_col,
                cross_sheet,
            );
        }
        if let Some(reference) = &mut flags.r2 {
            follows &= shift_a1_ref(
                reference,
                source_bounds,
                target_row,
                target_col,
                cross_sheet,
            );
        }
    }
    follows
}

fn shift_cell_ref(
    reference: &mut CellRef,
    source_sheet: SheetId,
    source_bounds: (u32, u32, u32, u32),
    target_sheet: SheetId,
    target_row: u32,
    target_col: u32,
    cross_sheet: bool,
) -> bool {
    let CellRef::Positional { sheet, row, col } = reference else {
        // A resolved CellId follows the cell itself. This is safe for an
        // identity-preserving move; the current public data-table creation and
        // XLSX paths use positional refs, so an unresolved external identity
        // cannot be re-emitted and is deliberately rejected below only when
        // the caller supplies it through a cross-sheet move.
        return source_sheet == target_sheet;
    };
    let local_sheet = *sheet == source_sheet || *sheet == SheetId::from_raw(0);
    let inside = local_sheet
        && *row >= source_bounds.0
        && *row <= source_bounds.2
        && *col >= source_bounds.1
        && *col <= source_bounds.3;
    if inside {
        *sheet = target_sheet;
        *row = target_row + (*row - source_bounds.0);
        *col = target_col + (*col - source_bounds.1);
        return true;
    }
    !cross_sheet
}

fn shift_a1_ref(
    reference: &mut String,
    source_bounds: (u32, u32, u32, u32),
    target_row: u32,
    target_col: u32,
    cross_sheet: bool,
) -> bool {
    // `r1`/`r2` are single-cell OOXML attributes. Preserve the authored
    // absolute markers while translating the coordinate; the typed
    // `CellRef` intentionally drops those markers, but the raw sidecar is
    // retained for round-trip fidelity.
    let Some(cell) = compute_parser::parse_a1_cell(reference) else {
        return !cross_sheet;
    };
    let formula_types::CellRef::Positional {
        row: sr, col: sc, ..
    } = cell.reference
    else {
        return !cross_sheet;
    };
    let inside = sr >= source_bounds.0
        && sr <= source_bounds.2
        && sc >= source_bounds.1
        && sc <= source_bounds.3;
    if inside {
        let row = target_row + (sr - source_bounds.0);
        let col = target_col + (sc - source_bounds.1);
        let original = reference.clone();
        *reference = shifted_a1_cell(&original, SheetPos::new(row, col));
        return true;
    }
    // Raw OOXML refs carry no sheet identity in the current export contract;
    // preserving one across sheets would silently bind it to the destination.
    !cross_sheet
}

fn shifted_a1_cell(original: &str, shifted: SheetPos) -> String {
    let bytes = original.as_bytes();
    let mut index = 0;
    let col_absolute = bytes.get(index) == Some(&b'$');
    if col_absolute {
        index += 1;
    }
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_alphabetic())
    {
        index += 1;
    }
    let row_absolute = bytes.get(index) == Some(&b'$');
    let plain = shifted.to_string();
    let mut result = if col_absolute {
        format!("${plain}")
    } else {
        plain
    };
    if row_absolute && let Some(digit) = result.find(|ch: char| ch.is_ascii_digit()) {
        result.insert(digit, '$');
    }
    result
}

/// Remove executable TABLE state while retaining the cached cell value.
/// Callers replay the returned cells as literals through the compute scheduler.
pub fn clear_table_formula_cells(
    storage: &mut WorkbookStorage,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
) -> Vec<CellId> {
    let mut cleared = Vec::new();
    for cell_id in cell_ids {
        let body_is_table = mirror.get_formula(cell_id).is_some_and(|formula| {
            let body = formula.template.trim_start();
            body.strip_prefix('=')
                .unwrap_or(body)
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("TABLE("))
        });
        let metadata_is_table = storage
            .cell_metadata(cell_id)
            .and_then(|metadata| metadata.formula.as_ref())
            .is_some_and(|formula| formula.t == ooxml_types::worksheet::CellFormulaType::DataTable);
        if !body_is_table && !metadata_is_table {
            continue;
        }
        let Some(pos) = mirror.resolve_position(cell_id) else {
            continue;
        };
        if mirror.sheet_for_cell(cell_id) != Some(*sheet_id) {
            continue;
        }
        let value = mirror
            .get_cell_value_raw(cell_id)
            .cloned()
            .unwrap_or(value_types::CellValue::Null);
        if let Some(mut metadata) = storage.cell_metadata(cell_id).cloned() {
            metadata.formula = None;
            metadata.array_ref = None;
            metadata.formula_result_mode = None;
            storage.set_cell_metadata(*cell_id, metadata);
        }
        mirror.apply_edit(sheet_id, *cell_id, pos, value, None);
        cleared.push(*cell_id);
    }
    cleared
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(
        sheet: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        row_input: Option<CellRef>,
        col_input: Option<CellRef>,
    ) -> DataTableRegionDef {
        DataTableRegionDef {
            sheet: sheet.to_uuid_string(),
            start_row,
            start_col,
            end_row,
            end_col,
            row_input_ref: row_input,
            col_input_ref: col_input,
            ooxml_flags: None,
        }
    }

    #[test]
    fn complete_cross_sheet_move_translates_inputs_inside_the_moved_range() {
        let mut mirror = CellMirror::new();
        let source = SheetId::from_raw(11);
        let target = SheetId::from_raw(12);
        let mut original = region(
            source,
            2,
            2,
            3,
            3,
            Some(CellRef::Positional {
                sheet: source,
                row: 2,
                col: 2,
            }),
            Some(CellRef::Positional {
                sheet: source,
                row: 3,
                col: 3,
            }),
        );
        original.ooxml_flags = Some(snapshot_types::DataTableOoxmlFlags {
            r1: Some("$C$3".to_string()),
            r2: Some("D$4".to_string()),
            aca: false,
            ca: false,
            bx: false,
            dt2d: false,
            dtr: false,
            del1: false,
            del2: false,
        });
        mirror.upsert_data_table_region(original);

        let mutation = relocate_regions(&mut mirror, &source, 2, 2, 3, 3, &target, 8, 9);

        assert!(mutation.changed);
        assert!(mutation.invalidated.is_empty());
        let regions = mirror.all_data_table_regions();
        assert_eq!(regions.len(), 1);
        let moved = &regions[0];
        assert_eq!(moved.sheet, target.to_uuid_string());
        assert_eq!((moved.start_row, moved.start_col), (8, 9));
        assert_eq!((moved.end_row, moved.end_col), (9, 10));
        assert_eq!(
            moved.row_input_ref,
            Some(CellRef::Positional {
                sheet: target,
                row: 8,
                col: 9,
            })
        );
        assert_eq!(
            moved.col_input_ref,
            Some(CellRef::Positional {
                sheet: target,
                row: 9,
                col: 10,
            })
        );
        let flags = moved.ooxml_flags.as_ref().expect("OOXML flags");
        assert_eq!(flags.r1.as_deref(), Some("$J$9"));
        assert_eq!(flags.r2.as_deref(), Some("K$10"));
    }

    #[test]
    fn complete_cross_sheet_move_drops_external_positional_input() {
        let mut mirror = CellMirror::new();
        let source = SheetId::from_raw(21);
        let target = SheetId::from_raw(22);
        let original = region(
            source,
            2,
            2,
            3,
            3,
            Some(CellRef::Positional {
                sheet: source,
                row: 0,
                col: 0,
            }),
            None,
        );
        mirror.upsert_data_table_region(original);

        let mutation = relocate_regions(&mut mirror, &source, 2, 2, 3, 3, &target, 8, 9);

        assert!(mutation.changed);
        assert_eq!(mutation.invalidated.len(), 1);
        assert!(mirror.all_data_table_regions().is_empty());
    }

    #[test]
    fn destination_overlap_invalidates_both_regions_before_insert() {
        let mut mirror = CellMirror::new();
        let source = SheetId::from_raw(23);
        let target = SheetId::from_raw(24);
        let unrelated = SheetId::from_raw(25);
        let source_region = region(
            source,
            2,
            2,
            3,
            3,
            Some(CellRef::Positional {
                sheet: source,
                row: 2,
                col: 2,
            }),
            None,
        );
        let destination_region = region(target, 8, 9, 10, 10, None, None);
        let unrelated_region = region(unrelated, 8, 9, 10, 10, None, None);
        mirror.upsert_data_table_region(source_region);
        mirror.upsert_data_table_region(destination_region);
        mirror.upsert_data_table_region(unrelated_region);

        let mutation = relocate_regions(&mut mirror, &source, 2, 2, 3, 3, &target, 8, 9);

        assert!(mutation.changed);
        assert_eq!(mutation.invalidated.len(), 2);
        let remaining = mirror.all_data_table_regions();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].sheet, unrelated.to_uuid_string());
    }

    #[test]
    fn same_sheet_move_preserves_external_input_and_translates_region() {
        let mut mirror = CellMirror::new();
        let sheet = SheetId::from_raw(31);
        let external = CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        };
        let original = region(sheet, 2, 2, 3, 3, Some(external), None);
        mirror.upsert_data_table_region(original);

        let mutation = relocate_regions(&mut mirror, &sheet, 2, 2, 3, 3, &sheet, 8, 9);

        assert!(mutation.changed);
        assert!(mutation.invalidated.is_empty());
        let moved = &mirror.all_data_table_regions()[0];
        assert_eq!(moved.row_input_ref, Some(external));
        assert_eq!((moved.start_row, moved.start_col), (8, 9));
    }

    #[test]
    fn clearing_invalidated_table_body_keeps_cached_value_but_removes_formula() {
        let mut storage = WorkbookStorage::new();
        let mut mirror = CellMirror::new();
        let sheet = SheetId::from_raw(41);
        let cell_id = CellId::from_raw(42);
        mirror.add_sheet_mirror(
            sheet,
            "Sheet1".to_string(),
            crate::mirror::SheetMirror::new(sheet, "Sheet1".to_string(), 10, 10),
        );
        mirror.apply_edit(
            &sheet,
            cell_id,
            SheetPos::new(0, 0),
            value_types::CellValue::number(5.0),
            Some(formula_types::IdentityFormula {
                template: "TABLE(A1,B1)".into(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }),
        );
        storage.set_cell_metadata(
            cell_id,
            crate::storage::CellMetadata {
                formula: Some(crate::storage::FormulaMetadata::from(
                    &ooxml_types::worksheet::CellFormula {
                        t: ooxml_types::worksheet::CellFormulaType::DataTable,
                        ..Default::default()
                    },
                )),
                ..Default::default()
            },
        );
        let cleared = clear_table_formula_cells(&mut storage, &mut mirror, &sheet, &[cell_id]);
        assert_eq!(cleared, vec![cell_id]);
        assert_eq!(
            mirror.get_cell_value_raw(&cell_id),
            Some(&value_types::CellValue::number(5.0))
        );
        assert!(mirror.get_formula(&cell_id).is_none());
        assert!(storage.cell_metadata(&cell_id).is_none());
    }
}
