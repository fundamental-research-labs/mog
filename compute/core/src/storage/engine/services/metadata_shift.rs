//! Shift position-based metadata ranges on structural changes (insert/delete rows/cols).
//!
//! When rows or columns are inserted or deleted, cell formulas and merge cells
//! are already handled by `ComputeCore::structure_change` and `rebuild_merge_index`.
//! This module shifts the remaining position-based metadata: conditional formats,
//! tables, validations, outline groups, sparklines, pivot tables, and print metadata.

use cell_types::SheetId;
use formula_types::StructureChange;

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{cf_store, grouping, pivots, print as meta, sparklines};

// =========================================================================
// Public entry point
// =========================================================================

/// Shift all position-based metadata ranges after a structural change.
///
/// Called from `apply_structure_change` after structural ops complete but
/// before `rebuild_merge_index` and formula recalc.
pub(in crate::storage::engine) fn shift_all_metadata_ranges(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    // No-op for remap (sort) — ranges don't change
    if matches!(change, StructureChange::RemapPositions { .. }) {
        return;
    }

    shift_cf_ranges(stores, sheet_id, change);
    shift_table_ranges(stores, mirror, sheet_id, change);
    shift_validation_ranges(stores, sheet_id, change);
    shift_grouping_ranges(stores, sheet_id, change);
    shift_col_format_ranges(stores, mirror, sheet_id, change);
    shift_sparkline_ranges(stores, sheet_id, change);
    shift_pivot_ranges(stores, mirror, sheet_id, change);
    shift_print_metadata(stores, sheet_id, change);
    invalidate_range_bound_worksheet_semantic_containers(stores, sheet_id, change);
}

fn shift_col_format_ranges(
    _stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    let Some(sheet) = mirror.get_sheet_mut(sheet_id) else {
        return;
    };
    if sheet.history.is_active() {
        for range in &sheet.format_ranges {
            let bounds=cell_types::SheetRange::new(range.start_row,range.start_col,range.end_row,range.end_col);
            if shift_range(&bounds,change) != Some(bounds) { crate::storage::engine::history::metadata::capture_format_range(sheet,range.id); }
        }
    }
    sheet.format_ranges.retain_mut(|range| {
        let bounds = cell_types::SheetRange::new(
            range.start_row,
            range.start_col,
            range.end_row,
            range.end_col,
        );
        if let Some(shifted) = shift_range(&bounds, change) {
            range.start_row = shifted.start_row();
            range.start_col = shifted.start_col();
            range.end_row = shifted.end_row();
            range.end_col = shifted.end_col();
            true
        } else {
            sheet.range_format_cache.remove(&range.id);
            sheet.range_xlsx_style_id_cache.remove(&range.id);
            false
        }
    });
    sheet.rebuild_format_range_spatial_index();
    if !matches!(
        change,
        StructureChange::InsertCols { .. } | StructureChange::DeleteCols { .. }
    ) {
        return;
    }
    if sheet.history.is_active() {
        for range in &sheet.col_format_ranges {
            let bounds=cell_types::SheetRange::new(0,range.start_col,0,range.end_col);
            if shift_range(&bounds,change) != Some(bounds) { crate::storage::engine::history::metadata::capture_column_format_range(sheet,range.id); }
        }
    }
    sheet.col_format_ranges.retain_mut(|range| {
        let bounds = cell_types::SheetRange::new(0, range.start_col, 0, range.end_col);
        if let Some(shifted) = shift_range(&bounds, change) {
            range.start_col = shifted.start_col();
            range.end_col = shifted.end_col();
            true
        } else {
            sheet.col_format_range_cache.remove(&range.id);
            sheet.col_range_xlsx_style_id_cache.remove(&range.id);
            false
        }
    });
    sheet.rebuild_col_format_range_spatial_index();
}

/// Relocate range-backed validation metadata for a cut/move operation.
///
/// Cell relocation preserves CellIds, so cell-owned metadata follows the moved
/// cells automatically. Range-backed data validation is position-owned: the
/// source covered area must be removed from the source sheet and the moved
/// covered fragments must be recreated at the target position. Existing
/// validation at the destination is overwritten, matching cut-paste semantics.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn relocate_validation_ranges(
    stores: &mut EngineStores,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
) {
    let source_range =
        cell_types::SheetRange::new(src_start_row, src_start_col, src_end_row, src_end_col);
    let height = source_range.end_row() - source_range.start_row();
    let width = source_range.end_col() - source_range.start_col();
    let target_range = cell_types::SheetRange::new(
        target_row,
        target_col,
        target_row + height,
        target_col + width,
    );

    let Some(source) = stores.storage.sheet_metadata.get(source_sheet_id) else {
        return;
    };
    let mut source_rules = source.validations.rules.clone();
    let mut moved = Vec::new();
    for entry in &mut source_rules {
        let mut fragments = Vec::new();
        entry.spec.ranges = entry
            .spec
            .ranges
            .iter()
            .flat_map(|text| {
                let Some(range) = parse_validation_range(text) else {
                    return vec![text.clone()];
                };
                if let Some(overlap) = intersect_ranges(&range, &source_range) {
                    fragments.push(
                        translate_range(
                            &overlap,
                            source_range.start_row(),
                            source_range.start_col(),
                            target_row,
                            target_col,
                        )
                        .to_string(),
                    );
                    subtract_range(&range, &source_range)
                        .into_iter()
                        .map(|r| r.to_string())
                        .collect()
                } else {
                    vec![text.clone()]
                }
            })
            .collect();
        if !fragments.is_empty() {
            let mut fragment = entry.clone();
            fragment.spec.ranges = fragments;
            moved.push(fragment);
        }
    }
    if moved.is_empty() {
        return;
    }
    let mut target_rules = if source_sheet_id == target_sheet_id {
        source_rules.clone()
    } else {
        stores
            .storage
            .sheet_metadata
            .get(target_sheet_id)
            .map(|m| m.validations.rules.clone())
            .unwrap_or_default()
    };
    for entry in &mut target_rules {
        entry.spec.ranges = entry
            .spec
            .ranges
            .iter()
            .flat_map(|text| {
                let Some(range) = parse_validation_range(text) else {
                    return vec![text.clone()];
                };
                subtract_range(&range, &target_range)
                    .into_iter()
                    .map(|r| r.to_string())
                    .collect::<Vec<_>>()
            })
            .collect();
    }
    for mut entry in moved {
        if source_sheet_id == target_sheet_id {
            if let Some(existing) = target_rules.iter_mut().find(|e| e.id == entry.id) {
                existing.spec.ranges.extend(entry.spec.ranges);
                continue;
            }
        } else if target_rules.iter().any(|e| e.id == entry.id) {
            entry.id = format!("validation-{:032x}", stores.id_alloc.next_u128());
        }
        target_rules.push(entry);
    }
    if source_sheet_id != target_sheet_id {
        source_rules.retain(|entry| !entry.spec.ranges.is_empty());
        crate::storage::engine::history::metadata::capture_validation_replacement(&stores.storage,*source_sheet_id,&source_rules);
        if let Some(metadata) = stores.storage.sheet_metadata.get_mut(source_sheet_id) {
            metadata.validations.rules = source_rules;
            metadata.validations.declared_count = None;
        }
    }
    target_rules.retain(|entry| !entry.spec.ranges.is_empty());
    crate::storage::engine::history::metadata::capture_validation_replacement(&stores.storage,*target_sheet_id,&target_rules);
    if let Some(metadata) = stores.storage.sheet_metadata.get_mut(target_sheet_id) {
        metadata.validations.rules = target_rules;
        metadata.validations.declared_count = None;
    }
}

/// Relocate pivot tables whose rendered output is fully contained within a
/// cut/moved source range, called from `mutation_relocate_cells` alongside
/// `relocate_whole_tables` (cells) and `relocate_validation_ranges`.
///
/// When the user cuts a range that covers an entire pivot's output and pastes
/// it elsewhere, the pivot's authoritative `output_location` must move with the
/// cells. We only shift the anchor here; the subsequent `materialize_all_pivots`
/// pass clears the pivot's old rendered region and re-renders at the new anchor,
/// which is exactly the "clear original, write at destination" move semantics.
/// The caller marks the compute store dirty when this returns `true` so that
/// pass actually runs.
///
/// Same-sheet only: cross-sheet relocation would require re-homing the config
/// across per-sheet `pivotTables` maps plus a cross-sheet old-region clear. The
/// cells-side structure relocation is itself same-sheet (`relocate_whole_tables`
/// keys tables by sheet, and the app cut-paste path moves structures only
/// within a sheet), so we match that scope here.
///
/// Returns the IDs of the pivots whose anchor moved. The caller re-materializes
/// and rebuilds the sheet viewport when this is non-empty (pivot output cells
/// live in the mirror's `col_data`, written only by `materialize_all_pivots`;
/// the cell-relocation patches do not cover them).
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn relocate_pivot_ranges(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
) -> Vec<String> {
    if source_sheet_id != target_sheet_id {
        return Vec::new();
    }

    let sheet_uuid = source_sheet_id.to_uuid_string();
    let sheet_name = mirror
        .get_sheet(source_sheet_id)
        .map(|s| s.name.clone())
        .unwrap_or_default();

    // Collect pivots and new anchors before updating their native records.
    let moves: Vec<_> = {
        pivots::get_all_pivots(&stores.storage, source_sheet_id)
            .into_iter()
            .filter_map(|pivot| {
                // Only pivots whose output renders on this sheet are eligible.
                if pivot.output_sheet_name != sheet_name {
                    return None;
                }
                // Require the whole rendered region to be inside the moved
                // range — Excel only moves a pivot when its full output is
                // selected. The rendered region comes from the mirror def
                // (the authoritative config stores just the top-left anchor).
                let def = mirror.find_pivot_table_def(&pivot.id, &pivot.name, &sheet_uuid)?;
                if def.is_empty_rendered_region()
                    || def.start_row < src_start_row
                    || def.start_col < src_start_col
                    || def.end_row > src_end_row
                    || def.end_col > src_end_col
                {
                    return None;
                }
                let new_row = target_row + (pivot.output_location.row - src_start_row);
                let new_col = target_col + (pivot.output_location.col - src_start_col);
                Some((pivot, new_row, new_col))
            })
            .collect()
    };

    if moves.is_empty() {
        return Vec::new();
    }

    let mut moved_ids = Vec::with_capacity(moves.len());
    for (mut pivot, new_row, new_col) in moves {
        let pivot_id = pivot.id.clone();
        pivot.output_location = compute_pivot::OutputLocation {
            row: new_row,
            col: new_col,
        };
        if pivots::update_pivot(&mut stores.storage, source_sheet_id, &pivot_id, pivot).is_some() {
            moved_ids.push(pivot_id);
        }
    }
    moved_ids
}

// =========================================================================
// Core shift utilities
// =========================================================================

/// Shift a `SheetRange` according to a structural change.
/// Returns `None` if the range is fully deleted.
fn shift_range(
    range: &cell_types::SheetRange,
    change: &StructureChange,
) -> Option<cell_types::SheetRange> {
    let (sr, sc, er, ec) = (
        range.start_row(),
        range.start_col(),
        range.end_row(),
        range.end_col(),
    );

    match change {
        StructureChange::InsertRows { at, count, .. } => {
            let mut new_sr = sr;
            let mut new_er = er;
            if er >= *at {
                new_er = er + count;
            }
            if sr >= *at {
                new_sr = sr + count;
            }
            Some(cell_types::SheetRange::new(new_sr, sc, new_er, ec))
        }
        StructureChange::DeleteRows { at, count, .. } => {
            let del_end = at + count;
            if sr >= *at && er < del_end {
                return None;
            }
            if er < *at {
                return Some(*range);
            }
            let (new_sr, new_er);
            if sr >= del_end {
                new_sr = sr - count;
                new_er = er - count;
            } else if sr < *at && er >= del_end {
                new_sr = sr;
                new_er = er - count;
            } else if sr < *at {
                new_sr = sr;
                new_er = at.saturating_sub(1);
            } else {
                new_sr = *at;
                new_er = er - count;
            }
            Some(cell_types::SheetRange::new(new_sr, sc, new_er, ec))
        }
        StructureChange::InsertCols { at, count, .. } => {
            let mut new_sc = sc;
            let mut new_ec = ec;
            if ec >= *at {
                new_ec = ec + count;
            }
            if sc >= *at {
                new_sc = sc + count;
            }
            Some(cell_types::SheetRange::new(sr, new_sc, er, new_ec))
        }
        StructureChange::DeleteCols { at, count, .. } => {
            let del_end = at + count;
            if sc >= *at && ec < del_end {
                return None;
            }
            if ec < *at {
                return Some(*range);
            }
            let (new_sc, new_ec);
            if sc >= del_end {
                new_sc = sc - count;
                new_ec = ec - count;
            } else if sc < *at && ec >= del_end {
                new_sc = sc;
                new_ec = ec - count;
            } else if sc < *at {
                new_sc = sc;
                new_ec = at.saturating_sub(1);
            } else {
                new_sc = *at;
                new_ec = ec - count;
            }
            Some(cell_types::SheetRange::new(sr, new_sc, er, new_ec))
        }
        StructureChange::RemapPositions { .. } => Some(*range),
    }
}

fn invalidate_range_bound_worksheet_semantic_containers(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    if !matches!(
        change,
        StructureChange::InsertRows { .. }
            | StructureChange::DeleteRows { .. }
            | StructureChange::InsertCols { .. }
            | StructureChange::DeleteCols { .. }
    ) {
        return;
    }

    crate::storage::engine::history::metadata::capture_sheet_field!(stores.storage,*sheet_id,semantic_containers);
    if let Some(meta) = stores.storage.sheet_metadata.get_mut(sheet_id) {
        meta.semantic_containers = Default::default();
    }
}

/// Shift a single positional index (row or column) according to a structural change.
/// Returns `None` if the position falls within the deleted zone.
fn shift_position(pos: u32, change: &StructureChange, is_row: bool) -> Option<u32> {
    match change {
        StructureChange::InsertRows { at, count, .. } if is_row => {
            if pos >= *at {
                Some(pos + count)
            } else {
                Some(pos)
            }
        }
        StructureChange::DeleteRows { at, count, .. } if is_row => {
            let del_end = at + count;
            if pos >= *at && pos < del_end {
                None
            } else if pos >= del_end {
                Some(pos - count)
            } else {
                Some(pos)
            }
        }
        StructureChange::InsertCols { at, count, .. } if !is_row => {
            if pos >= *at {
                Some(pos + count)
            } else {
                Some(pos)
            }
        }
        StructureChange::DeleteCols { at, count, .. } if !is_row => {
            let del_end = at + count;
            if pos >= *at && pos < del_end {
                None
            } else if pos >= del_end {
                Some(pos - count)
            } else {
                Some(pos)
            }
        }
        _ => Some(pos),
    }
}

// =========================================================================
// Per-metadata-type shift functions
// =========================================================================

/// Shift conditional format ranges.
fn shift_cf_ranges(stores: &mut EngineStores, sheet_id: &SheetId, change: &StructureChange) {
    let formats = cf_store::get_formats_for_sheet(&stores.storage, sheet_id);

    for format in &formats {
        let new_ranges: Vec<cell_types::SheetRange> = format
            .ranges
            .iter()
            .filter_map(|r| shift_range(r, change))
            .collect();
        if new_ranges != format.ranges {
            cf_store::update_cf_ranges(&mut stores.storage, &format.id, sheet_id, &new_ranges);
        }
    }
}

/// Shift table ranges.
fn shift_table_ranges(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    let sheet_id_hex = sheet_id.to_uuid_string();
    let tables: Vec<_> = mirror
        .all_tables()
        .iter()
        .filter(|t| t.sheet_id == sheet_id_hex)
        .cloned()
        .collect();

    for table in tables {
        match shift_range(&table.range, change) {
            Some(new_range) if new_range != table.range => {
                let mut updated = table;
                updated.range = new_range;
                stores.compute.set_table(mirror, updated.clone());
            }
            None => {
                stores.compute.remove_table(mirror, &table.name);
            }
            _ => {} // unchanged
        }
    }
}

/// Shift validation geometry without reconstructing its lossless OOXML properties.
fn shift_validation_ranges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    if stores.storage.history.is_active() {
        if let Some(meta)=stores.storage.sheet_metadata.get(sheet_id) {
            for entry in &meta.validations.rules {
                crate::storage::engine::history::metadata::capture_sheet_vector_entry!(stores.storage,*sheet_id,validations.rules,entry.id,value=>value.id);
            }
        }
    }
    crate::storage::engine::history::metadata::capture_sheet_field!(stores.storage,*sheet_id,validations.declared_count);
    let Some(metadata) = stores.storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    let mut changed = false;
    for entry in &mut metadata.validations.rules {
        entry.spec.ranges = entry
            .spec
            .ranges
            .iter()
            .filter_map(|text| {
                let Some(range) = parse_validation_range(text) else {
                    return Some(text.clone());
                };
                match shift_range(&range, change) {
                    Some(shifted) if shifted == range => Some(text.clone()),
                    Some(shifted) => {
                        changed = true;
                        Some(shifted.to_string())
                    }
                    None => {
                        changed = true;
                        None
                    }
                }
            })
            .collect();
    }
    if changed {
        metadata
            .validations
            .rules
            .retain(|entry| !entry.spec.ranges.is_empty());
        metadata.validations.declared_count = None;
    }
}

fn parse_validation_range(text: &str) -> Option<cell_types::SheetRange> {
    text.parse().ok().or_else(|| {
        text.parse::<cell_types::SheetPos>()
            .ok()
            .map(|pos| cell_types::SheetRange::single(pos.row(), pos.col()))
    })
}

fn intersect_ranges(
    a: &cell_types::SheetRange,
    b: &cell_types::SheetRange,
) -> Option<cell_types::SheetRange> {
    let sr = a.start_row().max(b.start_row());
    let sc = a.start_col().max(b.start_col());
    let er = a.end_row().min(b.end_row());
    let ec = a.end_col().min(b.end_col());
    (sr <= er && sc <= ec).then(|| cell_types::SheetRange::new(sr, sc, er, ec))
}

fn subtract_range(
    range: &cell_types::SheetRange,
    cut: &cell_types::SheetRange,
) -> Vec<cell_types::SheetRange> {
    let Some(overlap) = intersect_ranges(range, cut) else {
        return vec![*range];
    };

    let mut pieces = Vec::new();
    let sr = range.start_row();
    let sc = range.start_col();
    let er = range.end_row();
    let ec = range.end_col();
    let osr = overlap.start_row();
    let osc = overlap.start_col();
    let oer = overlap.end_row();
    let oec = overlap.end_col();

    if sr < osr {
        pieces.push(cell_types::SheetRange::new(sr, sc, osr - 1, ec));
    }
    if oer < er {
        pieces.push(cell_types::SheetRange::new(oer + 1, sc, er, ec));
    }
    if sc < osc {
        pieces.push(cell_types::SheetRange::new(osr, sc, oer, osc - 1));
    }
    if oec < ec {
        pieces.push(cell_types::SheetRange::new(osr, oec + 1, oer, ec));
    }

    pieces
}

fn translate_range(
    range: &cell_types::SheetRange,
    source_origin_row: u32,
    source_origin_col: u32,
    target_origin_row: u32,
    target_origin_col: u32,
) -> cell_types::SheetRange {
    let row_delta_start = range.start_row() - source_origin_row;
    let col_delta_start = range.start_col() - source_origin_col;
    let row_delta_end = range.end_row() - source_origin_row;
    let col_delta_end = range.end_col() - source_origin_col;
    cell_types::SheetRange::new(
        target_origin_row + row_delta_start,
        target_origin_col + col_delta_start,
        target_origin_row + row_delta_end,
        target_origin_col + col_delta_end,
    )
}

/// Shift outline/grouping ranges.
fn shift_grouping_ranges(stores: &mut EngineStores, sheet_id: &SheetId, change: &StructureChange) {
    let mut config = grouping::get_sheet_grouping_config(&stores.storage, sheet_id);
    let mut changed = false;

    let affects_rows = matches!(
        change,
        StructureChange::InsertRows { .. } | StructureChange::DeleteRows { .. }
    );
    let affects_cols = matches!(
        change,
        StructureChange::InsertCols { .. } | StructureChange::DeleteCols { .. }
    );

    if affects_rows {
        let original_len = config.row_groups.len();
        let mut new_groups = Vec::with_capacity(original_len);
        for group in &config.row_groups {
            let range = cell_types::SheetRange::new(group.start, 0, group.end, 0);
            if let Some(shifted) = shift_range(&range, change) {
                let mut g = group.clone();
                g.start = shifted.start_row();
                g.end = shifted.end_row();
                new_groups.push(g);
            }
        }
        if new_groups.len() != original_len
            || new_groups
                .iter()
                .zip(config.row_groups.iter())
                .any(|(a, b)| a.start != b.start || a.end != b.end)
        {
            changed = true;
            config.row_groups = new_groups;
        }
    }

    if affects_cols {
        let original_len = config.column_groups.len();
        let mut new_groups = Vec::with_capacity(original_len);
        for group in &config.column_groups {
            let range = cell_types::SheetRange::new(0, group.start, 0, group.end);
            if let Some(shifted) = shift_range(&range, change) {
                let mut g = group.clone();
                g.start = shifted.start_col();
                g.end = shifted.end_col();
                new_groups.push(g);
            }
        }
        if new_groups.len() != original_len
            || new_groups
                .iter()
                .zip(config.column_groups.iter())
                .any(|(a, b)| a.start != b.start || a.end != b.end)
        {
            changed = true;
            config.column_groups = new_groups;
        }
    }

    if changed {
        grouping::set_sheet_grouping_config(&mut stores.storage, sheet_id, &config);
    }
}

/// Shift sparkline cell positions and data ranges.
fn shift_sparkline_ranges(stores: &mut EngineStores, sheet_id: &SheetId, change: &StructureChange) {
    let sheet_id_hex = sheet_id.to_uuid_string();
    let all_sparklines = sparklines::get_sparklines_in_sheet(&stores.storage, sheet_id);

    for sp in &all_sparklines {
        if sp.cell.sheet_id != sheet_id_hex {
            continue;
        }

        let cell_row = shift_position(sp.cell.row, change, true);
        let cell_col = shift_position(sp.cell.col, change, false);

        if cell_row.is_none() || cell_col.is_none() {
            sparklines::delete_sparkline(&mut stores.storage, sheet_id, &sp.id);
            continue;
        }
        let new_row = cell_row.unwrap();
        let new_col = cell_col.unwrap();

        let data_range = cell_types::SheetRange::new(
            sp.data_range.start_row,
            sp.data_range.start_col,
            sp.data_range.end_row,
            sp.data_range.end_col,
        );
        let shifted_data = shift_range(&data_range, change);

        let cell_changed = new_row != sp.cell.row || new_col != sp.cell.col;
        let data_changed = shifted_data.is_none_or(|s| {
            s.start_row() != sp.data_range.start_row
                || s.start_col() != sp.data_range.start_col
                || s.end_row() != sp.data_range.end_row
                || s.end_col() != sp.data_range.end_col
        });

        if cell_changed || data_changed {
            let mut update = domain_types::domain::sparkline::SparklineUpdate::default();
            if cell_changed {
                update.cell = Some(domain_types::domain::sparkline::SparklineCellAddress {
                    sheet_id: sp.cell.sheet_id.clone(),
                    row: new_row,
                    col: new_col,
                });
            }
            if let Some(s) = shifted_data
                && data_changed
            {
                update.data_range = Some(domain_types::domain::sparkline::SparklineDataRange {
                    source_sheet_name: sp.data_range.source_sheet_name.clone(),
                    start_row: s.start_row(),
                    start_col: s.start_col(),
                    end_row: s.end_row(),
                    end_col: s.end_col(),
                });
            }
            sparklines::update_sparkline(&mut stores.storage, sheet_id, &sp.id, &update);
        }
    }
}

/// Shift pivot table source ranges and output locations.
fn shift_pivot_ranges(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    change: &StructureChange,
) {
    let all_pivots: Vec<_> = stores
        .storage
        .sheet_metadata
        .iter()
        .flat_map(|(owner, sheet)| sheet.pivots.values().cloned().map(|pivot| (*owner, pivot)))
        .collect();
    let current_sheet_name = mirror
        .get_sheet(sheet_id)
        .map(|s| s.name.clone())
        .unwrap_or_default();

    for (owner, pivot) in all_pivots {
        let mut updated = pivot.clone();
        let mut changed = false;

        let source_is_affected_sheet = pivot
            .source_sheet_id
            .as_deref()
            .and_then(|id| SheetId::from_uuid_str(id).ok())
            .is_some_and(|source_id| source_id == *sheet_id)
            || (pivot.source_sheet_id.is_none() && pivot.source_sheet_name == current_sheet_name);

        // Shift source_range if it's on the affected sheet
        if source_is_affected_sheet {
            if let Some(new_range) = shift_range(&pivot.source_range, change) {
                if new_range != pivot.source_range {
                    updated.source_range = new_range;
                    changed = true;
                }
            } else {
                pivots::delete_pivot(&mut stores.storage, &owner, &pivot.id);
                crate::storage::workbook::imported_pivots::mark_native_pivot_deleted(
                    &mut stores.storage,
                    &pivot.id,
                );
                continue;
            }
        }

        // Shift output_location if it's on the affected sheet
        if owner == *sheet_id {
            let new_row = shift_position(pivot.output_location.row, change, true);
            let new_col = shift_position(pivot.output_location.col, change, false);

            match (new_row, new_col) {
                (Some(r), Some(c))
                    if r != pivot.output_location.row || c != pivot.output_location.col =>
                {
                    updated.output_location = compute_pivot::OutputLocation { row: r, col: c };
                    changed = true;
                }
                (None, _) | (_, None) => {
                    pivots::delete_pivot(&mut stores.storage, &owner, &pivot.id);
                    crate::storage::workbook::imported_pivots::mark_native_pivot_deleted(
                        &mut stores.storage,
                        &pivot.id,
                    );
                    continue;
                }
                _ => {}
            }
        }

        if changed {
            pivots::update_pivot(&mut stores.storage, &owner, &pivot.id, updated);
        }
    }
}

/// Shift print metadata (print area, print titles, page breaks).
fn shift_print_metadata(stores: &mut EngineStores, sheet_id: &SheetId, change: &StructureChange) {
    // --- Print area ---
    if let Some(area) = meta::get_print_area(&stores.storage, sheet_id) {
        let range =
            cell_types::SheetRange::new(area.start_row, area.start_col, area.end_row, area.end_col);
        match shift_range(&range, change) {
            Some(shifted) => {
                let new_area = domain_types::domain::sheet::PrintRange {
                    start_row: shifted.start_row(),
                    start_col: shifted.start_col(),
                    end_row: shifted.end_row(),
                    end_col: shifted.end_col(),
                };
                if new_area != area {
                    meta::set_print_area(&mut stores.storage, sheet_id, Some(&new_area));
                }
            }
            None => {
                meta::set_print_area(&mut stores.storage, sheet_id, None);
            }
        }
    }

    // --- Print titles ---
    let titles = meta::get_print_titles(&stores.storage, sheet_id);
    let mut new_titles = titles.clone();
    let mut titles_changed = false;

    if let Some((start, end)) = titles.repeat_rows {
        match change {
            StructureChange::InsertRows { .. } | StructureChange::DeleteRows { .. } => {
                let range = cell_types::SheetRange::new(start, 0, end, 0);
                match shift_range(&range, change) {
                    Some(shifted) => {
                        let new_pair = (shifted.start_row(), shifted.end_row());
                        if new_pair != (start, end) {
                            new_titles.repeat_rows = Some(new_pair);
                            titles_changed = true;
                        }
                    }
                    None => {
                        new_titles.repeat_rows = None;
                        titles_changed = true;
                    }
                }
            }
            _ => {}
        }
    }

    if let Some((start, end)) = titles.repeat_cols {
        match change {
            StructureChange::InsertCols { .. } | StructureChange::DeleteCols { .. } => {
                let range = cell_types::SheetRange::new(0, start, 0, end);
                match shift_range(&range, change) {
                    Some(shifted) => {
                        let new_pair = (shifted.start_col(), shifted.end_col());
                        if new_pair != (start, end) {
                            new_titles.repeat_cols = Some(new_pair);
                            titles_changed = true;
                        }
                    }
                    None => {
                        new_titles.repeat_cols = None;
                        titles_changed = true;
                    }
                }
            }
            _ => {}
        }
    }

    if titles_changed {
        meta::set_print_titles(&mut stores.storage, sheet_id, &new_titles);
    }

    // --- Page breaks ---
    let mut breaks = meta::get_page_breaks(&stores.storage, sheet_id);
    let mut breaks_changed = false;

    let affects_rows = matches!(
        change,
        StructureChange::InsertRows { .. } | StructureChange::DeleteRows { .. }
    );
    let affects_cols = matches!(
        change,
        StructureChange::InsertCols { .. } | StructureChange::DeleteCols { .. }
    );

    if affects_rows && !breaks.row_breaks.is_empty() {
        let original_len = breaks.row_breaks.len();
        let mut new_breaks = Vec::with_capacity(original_len);
        for entry in &breaks.row_breaks {
            if let Some(new_id) = shift_position(entry.id, change, true) {
                let mut e = entry.clone();
                e.id = new_id;
                new_breaks.push(e);
            }
        }
        if new_breaks.len() != original_len
            || new_breaks
                .iter()
                .zip(breaks.row_breaks.iter())
                .any(|(a, b)| a.id != b.id)
        {
            breaks_changed = true;
            breaks.row_breaks = new_breaks;
        }
    }

    if affects_cols && !breaks.col_breaks.is_empty() {
        let original_len = breaks.col_breaks.len();
        let mut new_breaks = Vec::with_capacity(original_len);
        for entry in &breaks.col_breaks {
            if let Some(new_id) = shift_position(entry.id, change, false) {
                let mut e = entry.clone();
                e.id = new_id;
                new_breaks.push(e);
            }
        }
        if new_breaks.len() != original_len
            || new_breaks
                .iter()
                .zip(breaks.col_breaks.iter())
                .any(|(a, b)| a.id != b.id)
        {
            breaks_changed = true;
            breaks.col_breaks = new_breaks;
        }
    }

    if breaks_changed {
        meta::set_page_breaks(&mut stores.storage, sheet_id, &breaks);
    }
}
