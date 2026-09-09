//! Canonical workbook-level storage for What-If Data Table regions.

use std::collections::HashSet;
use std::sync::Arc;

use cell_types::{CellId, SheetId, SheetPos};
use compute_document::schema::{
    KEY_ARRAY_REF, KEY_DATA_TABLE_REGIONS, KEY_FORMULA, KEY_FORMULA_AGGREGATE,
    KEY_FORMULA_DYNAMIC_ARRAY, KEY_FORMULA_METADATA, KEY_FORMULA_REFS, KEY_FORMULA_RESULT_MODE,
    KEY_FORMULA_TEMPLATE, KEY_FORMULA_VOLATILE,
};
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Out, Transact};

const KEY_SHEET: &str = "sheet";
const KEY_START_ROW: &str = "startRow";
const KEY_START_COL: &str = "startCol";
const KEY_END_ROW: &str = "endRow";
const KEY_END_COL: &str = "endCol";
const KEY_ROW_INPUT_REF: &str = "rowInputRef";
const KEY_COL_INPUT_REF: &str = "colInputRef";
const KEY_OOXML_ACA: &str = "ooxmlAca";
const KEY_OOXML_CA: &str = "ooxmlCa";
const KEY_OOXML_BX: &str = "ooxmlBx";
const KEY_OOXML_DT2D: &str = "ooxmlDt2d";
const KEY_OOXML_DTR: &str = "ooxmlDtr";
const KEY_OOXML_DEL1: &str = "ooxmlDel1";
const KEY_OOXML_DEL2: &str = "ooxmlDel2";
const KEY_OOXML_R1: &str = "ooxmlR1";
const KEY_OOXML_R2: &str = "ooxmlR2";

/// Stable storage key for the current snapshot-era region shape.
///
/// The durable map is keyed independently of vector position. A future
/// role-aware `DataTableRegionDef.region_id` field can replace this derived key
/// without changing the surrounding Yrs authority.
pub fn data_table_region_id(def: &DataTableRegionDef) -> String {
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

pub fn get_all_data_table_regions(doc: &Doc, workbook: &MapRef) -> Vec<DataTableRegionDef> {
    let txn = doc.transact();
    let Some(Out::YMap(regions_map)) = workbook.get(&txn, KEY_DATA_TABLE_REGIONS) else {
        return vec![];
    };

    let mut regions = Vec::new();
    for (_, value) in regions_map.iter(&txn) {
        if let Out::YMap(inner) = value
            && let Some(region) = data_table_region_from_yrs_map(&inner, &txn)
        {
            regions.push(region);
        }
    }
    regions
}

pub fn upsert_data_table_region(doc: &Doc, workbook: &MapRef, region: &DataTableRegionDef) {
    let mut txn = doc.transact_mut();
    let regions_map =
        crate::storage::ensure_workbook_child_map(workbook, &mut txn, KEY_DATA_TABLE_REGIONS);
    let prelim: MapPrelim = data_table_region_to_yrs_prelim(region)
        .into_iter()
        .collect();
    let key = data_table_region_id(region);
    regions_map.insert(&mut txn, &*key, prelim);
}

pub fn hydrate_data_table_regions(
    workbook: &MapRef,
    regions: &[DataTableRegionDef],
    txn: &mut yrs::TransactionMut<'_>,
) {
    if regions.is_empty() {
        return;
    }
    let regions_map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_DATA_TABLE_REGIONS);
    for region in regions {
        let prelim: MapPrelim = data_table_region_to_yrs_prelim(region)
            .into_iter()
            .collect();
        let key = data_table_region_id(region);
        regions_map.insert(txn, &*key, prelim);
    }
}

/// The result of a workbook-level data-table mutation.
///
/// `invalidated` contains the old definitions whose body formulas must be
/// dematerialized by the caller. The region map is authoritative for export,
/// while the cell formula text is authoritative for recalculation; returning
/// both sides of that contract keeps a removed region from becoming an
/// executable `TABLE(...)` formula after the next recalc.
#[derive(Debug, Default)]
pub struct DataTableRegionMutation {
    pub changed: bool,
    pub invalidated: Vec<DataTableRegionDef>,
    /// Cell ranges whose `TABLE(...)` body formula state must be cleared after
    /// the region map mutation. A source range can produce both an old source
    /// range and a translated destination range during a partial move.
    pub formula_ranges: Vec<(SheetId, u32, u32, u32, u32)>,
}

/// Relocate authoritative data-table regions in the same Yrs transaction as a
/// cell cut/move. A region is moved only when its complete body is inside the
/// source range and its input references can follow the move. Complete
/// cross-sheet moves are supported for positional/raw input refs inside the
/// moved range. A positional/raw input outside that range cannot be serialized
/// with an explicit sheet by the current XLSX export contract, so that region
/// is invalidated rather than replayed on the wrong sheet. Partial and
/// destination-conflicting regions are also invalidated.
pub fn relocate_regions_in_txn(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    source_sheet: &SheetId,
    source_start_row: u32,
    source_start_col: u32,
    source_end_row: u32,
    source_end_col: u32,
    target_sheet: &SheetId,
    target_start_row: u32,
    target_start_col: u32,
) -> DataTableRegionMutation {
    let Some(Out::YMap(regions_map)) = workbook.get(&*txn, KEY_DATA_TABLE_REGIONS) else {
        return DataTableRegionMutation::default();
    };

    let regions: Vec<(String, DataTableRegionDef)> = regions_map
        .iter(&*txn)
        .filter_map(|(key, value)| {
            let Out::YMap(inner) = value else {
                return None;
            };
            data_table_region_from_yrs_map(&inner, &*txn).map(|region| (key.to_string(), region))
        })
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
    // Applying removals and inserts while iterating the Yrs map can otherwise
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
    for key in &invalidated_keys {
        regions_map.remove(txn, key);
    }
    let has_surviving_move = candidates
        .iter()
        .any(|(key, _, _, _)| !invalidated_keys.contains(key));
    let mut inserts = Vec::new();
    for (key, _, moved, _) in &candidates {
        if invalidated_keys.contains(key) {
            continue;
        }
        regions_map.remove(txn, key);
        inserts.push((data_table_region_id(moved), moved.clone()));
    }
    for (key, moved) in inserts {
        let prelim: MapPrelim = data_table_region_to_yrs_prelim(&moved)
            .into_iter()
            .collect();
        regions_map.insert(txn, &*key, prelim);
    }

    mutation.changed = !invalidated_keys.is_empty() || has_surviving_move;
    mutation
}

/// Invalidate data-table regions touched by row compaction. Remove-duplicates
/// has no single translation delta because duplicate rows are skipped, so any
/// intersecting authoritative region is unsafe to retain.
pub fn invalidate_regions_in_txn(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> DataTableRegionMutation {
    let Some(Out::YMap(regions_map)) = workbook.get(&*txn, KEY_DATA_TABLE_REGIONS) else {
        return DataTableRegionMutation::default();
    };
    let bounds = (start_row, start_col, end_row, end_col);
    let regions: Vec<(String, DataTableRegionDef)> = regions_map
        .iter(&*txn)
        .filter_map(|(key, value)| {
            let Out::YMap(inner) = value else {
                return None;
            };
            let region = data_table_region_from_yrs_map(&inner, &*txn)?;
            (sheet_id_matches(&region.sheet, sheet_id)
                && ranges_intersect(
                    (
                        region.start_row,
                        region.start_col,
                        region.end_row,
                        region.end_col,
                    ),
                    bounds,
                ))
            .then(|| (key.to_string(), region))
        })
        .collect();
    for (key, _) in &regions {
        regions_map.remove(txn, key);
    }
    DataTableRegionMutation {
        changed: !regions.is_empty(),
        formula_ranges: regions
            .iter()
            .map(|(_, region)| {
                (
                    *sheet_id,
                    region.start_row,
                    region.start_col,
                    region.end_row,
                    region.end_col,
                )
            })
            .collect(),
        invalidated: regions.into_iter().map(|(_, region)| region).collect(),
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

/// Remove executable TABLE formula state from cell maps after their
/// authoritative data-table region is removed. Cached `v` values are retained
/// so a cut/compaction preserves what the user sees while the formula graph is
/// rebuilt as literal values by the caller.
pub fn clear_table_formula_cells_in_txn(
    sheets: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    sheet_id: &SheetId,
    cell_ids: &[CellId],
) -> Vec<CellId> {
    let sheet_hex = compute_document::hex::id_to_hex(sheet_id.as_u128());
    let Some(Out::YMap(sheet_map)) = sheets.get(&*txn, &*sheet_hex) else {
        return Vec::new();
    };
    let Some(Out::YMap(cells_map)) = sheet_map.get(&*txn, compute_document::schema::KEY_CELLS)
    else {
        return Vec::new();
    };

    let mut cleared = Vec::new();
    for cell_id in cell_ids {
        let cell_hex = compute_document::hex::id_to_hex(cell_id.as_u128());
        let Some(Out::YMap(cell_map)) = cells_map.get(&*txn, &*cell_hex) else {
            continue;
        };
        if !is_table_formula_cell(&cell_map, &*txn) {
            continue;
        }
        for key in [
            KEY_FORMULA,
            KEY_FORMULA_TEMPLATE,
            KEY_FORMULA_REFS,
            KEY_FORMULA_DYNAMIC_ARRAY,
            KEY_FORMULA_VOLATILE,
            KEY_FORMULA_AGGREGATE,
            KEY_FORMULA_RESULT_MODE,
            KEY_FORMULA_METADATA,
            KEY_ARRAY_REF,
        ] {
            cell_map.remove(txn, key);
        }
        cleared.push(*cell_id);
    }
    cleared
}

fn is_table_formula_cell<T: yrs::ReadTxn>(cell_map: &MapRef, txn: &T) -> bool {
    let body_is_table = matches!(
        cell_map.get(txn, KEY_FORMULA),
        Some(Out::Any(Any::String(body)))
            if body.trim_start()
                .strip_prefix('=')
                .unwrap_or(body.trim_start())
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("TABLE("))
    );
    let metadata_is_table = matches!(
        cell_map.get(txn, KEY_FORMULA_METADATA),
        Some(Out::Any(Any::String(json)))
            if serde_json::from_str::<serde_json::Value>(&json)
                .ok()
                .and_then(|metadata| {
                    metadata
                        .get("t")
                        .and_then(serde_json::Value::as_str)
                        .map(|formula_type| formula_type.eq_ignore_ascii_case("dataTable"))
                })
                .unwrap_or(false)
    );
    body_is_table || metadata_is_table
}

fn data_table_region_to_yrs_prelim(region: &DataTableRegionDef) -> Vec<(&'static str, Any)> {
    let mut entries = vec![
        (KEY_SHEET, Any::String(Arc::from(region.sheet.as_str()))),
        (KEY_START_ROW, Any::Number(region.start_row as f64)),
        (KEY_START_COL, Any::Number(region.start_col as f64)),
        (KEY_END_ROW, Any::Number(region.end_row as f64)),
        (KEY_END_COL, Any::Number(region.end_col as f64)),
    ];
    if let Some(row_input_ref) = &region.row_input_ref {
        entries.push((
            KEY_ROW_INPUT_REF,
            Any::String(Arc::from(cell_ref_json(row_input_ref).as_str())),
        ));
    }
    if let Some(col_input_ref) = &region.col_input_ref {
        entries.push((
            KEY_COL_INPUT_REF,
            Any::String(Arc::from(cell_ref_json(col_input_ref).as_str())),
        ));
    }
    if let Some(flags) = &region.ooxml_flags {
        if let Some(r1) = &flags.r1 {
            entries.push((KEY_OOXML_R1, Any::String(Arc::from(r1.as_str()))));
        }
        if let Some(r2) = &flags.r2 {
            entries.push((KEY_OOXML_R2, Any::String(Arc::from(r2.as_str()))));
        }
        entries.push((KEY_OOXML_ACA, Any::Bool(flags.aca)));
        entries.push((KEY_OOXML_CA, Any::Bool(flags.ca)));
        entries.push((KEY_OOXML_BX, Any::Bool(flags.bx)));
        entries.push((KEY_OOXML_DT2D, Any::Bool(flags.dt2d)));
        entries.push((KEY_OOXML_DTR, Any::Bool(flags.dtr)));
        entries.push((KEY_OOXML_DEL1, Any::Bool(flags.del1)));
        entries.push((KEY_OOXML_DEL2, Any::Bool(flags.del2)));
    }
    entries
}

fn data_table_region_from_yrs_map<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<DataTableRegionDef> {
    Some(DataTableRegionDef {
        sheet: read_string(map, txn, KEY_SHEET)?,
        start_row: read_u32(map, txn, KEY_START_ROW)?,
        start_col: read_u32(map, txn, KEY_START_COL)?,
        end_row: read_u32(map, txn, KEY_END_ROW)?,
        end_col: read_u32(map, txn, KEY_END_COL)?,
        row_input_ref: read_cell_ref(map, txn, KEY_ROW_INPUT_REF),
        col_input_ref: read_cell_ref(map, txn, KEY_COL_INPUT_REF),
        ooxml_flags: read_ooxml_flags(map, txn),
    })
}

fn read_string<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<String> {
    match map.get(txn, key) {
        Some(Out::Any(Any::String(value))) => Some(value.to_string()),
        _ => None,
    }
}

fn read_u32<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<u32> {
    match map.get(txn, key) {
        Some(Out::Any(Any::Number(value))) if value.is_finite() && value >= 0.0 => {
            Some(value as u32)
        }
        _ => None,
    }
}

fn read_bool<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<bool> {
    match map.get(txn, key) {
        Some(Out::Any(Any::Bool(value))) => Some(value),
        _ => None,
    }
}

fn read_ooxml_flags<T: yrs::ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<snapshot_types::DataTableOoxmlFlags> {
    let has_any = [
        KEY_OOXML_ACA,
        KEY_OOXML_CA,
        KEY_OOXML_BX,
        KEY_OOXML_DT2D,
        KEY_OOXML_DTR,
        KEY_OOXML_DEL1,
        KEY_OOXML_DEL2,
        KEY_OOXML_R1,
        KEY_OOXML_R2,
    ]
    .iter()
    .any(|key| map.get(txn, key).is_some());

    has_any.then(|| snapshot_types::DataTableOoxmlFlags {
        r1: read_string(map, txn, KEY_OOXML_R1),
        r2: read_string(map, txn, KEY_OOXML_R2),
        aca: read_bool(map, txn, KEY_OOXML_ACA).unwrap_or(false),
        ca: read_bool(map, txn, KEY_OOXML_CA).unwrap_or(false),
        bx: read_bool(map, txn, KEY_OOXML_BX).unwrap_or(false),
        dt2d: read_bool(map, txn, KEY_OOXML_DT2D).unwrap_or(false),
        dtr: read_bool(map, txn, KEY_OOXML_DTR).unwrap_or(false),
        del1: read_bool(map, txn, KEY_OOXML_DEL1).unwrap_or(false),
        del2: read_bool(map, txn, KEY_OOXML_DEL2).unwrap_or(false),
    })
}

fn read_cell_ref<T: yrs::ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Option<CellRef> {
    let json = read_string(map, txn, key)?;
    serde_json::from_str(&json).ok()
}

fn cell_ref_json(cell_ref: &CellRef) -> String {
    serde_json::to_string(cell_ref).unwrap_or_else(|_| "null".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use compute_document::schema::{KEY_CELLS, KEY_VALUE};

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
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
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
        upsert_data_table_region(&doc, &workbook, &original);

        let mutation = {
            let mut txn = doc.transact_mut();
            relocate_regions_in_txn(&workbook, &mut txn, &source, 2, 2, 3, 3, &target, 8, 9)
        };

        assert!(mutation.changed);
        assert!(mutation.invalidated.is_empty());
        let regions = get_all_data_table_regions(&doc, &workbook);
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
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
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
        upsert_data_table_region(&doc, &workbook, &original);

        let mutation = {
            let mut txn = doc.transact_mut();
            relocate_regions_in_txn(&workbook, &mut txn, &source, 2, 2, 3, 3, &target, 8, 9)
        };

        assert!(mutation.changed);
        assert_eq!(mutation.invalidated.len(), 1);
        assert!(get_all_data_table_regions(&doc, &workbook).is_empty());
    }

    #[test]
    fn destination_overlap_invalidates_both_regions_before_insert() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
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
        upsert_data_table_region(&doc, &workbook, &source_region);
        upsert_data_table_region(&doc, &workbook, &destination_region);
        upsert_data_table_region(&doc, &workbook, &unrelated_region);

        let mutation = {
            let mut txn = doc.transact_mut();
            relocate_regions_in_txn(&workbook, &mut txn, &source, 2, 2, 3, 3, &target, 8, 9)
        };

        assert!(mutation.changed);
        assert_eq!(mutation.invalidated.len(), 2);
        let remaining = get_all_data_table_regions(&doc, &workbook);
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].sheet, unrelated.to_uuid_string());
    }

    #[test]
    fn same_sheet_move_preserves_external_input_and_translates_region() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map("workbook");
        let sheet = SheetId::from_raw(31);
        let external = CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        };
        let original = region(sheet, 2, 2, 3, 3, Some(external), None);
        upsert_data_table_region(&doc, &workbook, &original);

        let mutation = {
            let mut txn = doc.transact_mut();
            relocate_regions_in_txn(&workbook, &mut txn, &sheet, 2, 2, 3, 3, &sheet, 8, 9)
        };

        assert!(mutation.changed);
        assert!(mutation.invalidated.is_empty());
        let moved = &get_all_data_table_regions(&doc, &workbook)[0];
        assert_eq!(moved.row_input_ref, Some(external));
        assert_eq!((moved.start_row, moved.start_col), (8, 9));
    }

    #[test]
    fn clearing_invalidated_table_body_keeps_cached_value_but_removes_formula() {
        let doc = Doc::new();
        let sheets = doc.get_or_insert_map("sheets");
        let sheet = SheetId::from_raw(41);
        let cell_id = CellId::from_raw(42);
        let sheet_hex = compute_document::hex::id_to_hex(sheet.as_u128());
        let cell_hex = compute_document::hex::id_to_hex(cell_id.as_u128());

        {
            let mut txn = doc.transact_mut();
            let sheet_map: MapRef = sheets.insert(&mut txn, &*sheet_hex, MapPrelim::default());
            let cells_map: MapRef = sheet_map.insert(&mut txn, KEY_CELLS, MapPrelim::default());
            let cell = MapPrelim::from([
                (KEY_VALUE, Any::Number(5.0)),
                (KEY_FORMULA, Any::String(Arc::from("TABLE(A1,B1)"))),
                (
                    KEY_FORMULA_METADATA,
                    Any::String(Arc::from(r#"{"t":"dataTable"}"#)),
                ),
            ]);
            cells_map.insert(&mut txn, &*cell_hex, cell);
        }

        let cleared = {
            let mut txn = doc.transact_mut();
            clear_table_formula_cells_in_txn(&sheets, &mut txn, &sheet, &[cell_id])
        };
        assert_eq!(cleared, vec![cell_id]);

        let txn = doc.transact();
        let sheet_map = match sheets.get(&txn, &*sheet_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("sheet map"),
        };
        let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
            Some(Out::YMap(map)) => map,
            _ => panic!("cells map"),
        };
        let cell = match cells_map.get(&txn, &*cell_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("cell map"),
        };
        assert_eq!(cell.get(&txn, KEY_VALUE), Some(Out::Any(Any::Number(5.0))));
        assert!(cell.get(&txn, KEY_FORMULA).is_none());
        assert!(cell.get(&txn, KEY_FORMULA_METADATA).is_none());
    }
}
