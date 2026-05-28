//! Cell-level export: batch Yrs reads, per-sheet cell export, row/col style export.

use cell_types::{CellId, RangeId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex, parse_cell_id};
use compute_document::schema::*;
use domain_types::{
    AuthoredStyleRun, CellData, CellFormat, ColStyleEntry, DocumentFormat,
    ImportedCellProjectionRole, RoundTripContext, RowStyleEntry,
};
use rustc_hash::{FxHashMap, FxHashSet};
use value_types::CellValue;
use yrs::{Any, Map, Out, Transact};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties::{self, CellProperties};

use super::super::super::export::cell_format_to_document_format;
use super::PaletteOps;

// -------------------------------------------------------------------
// Combined batch Yrs reads (O2+O3 optimization)
// -------------------------------------------------------------------

/// Batch-read cell properties AND raw formulas in a single Yrs transaction.
///
/// Combines what was previously two separate operations:
/// 1. `properties::get_all_properties()` — reads `properties` Y.Map
/// 2. Raw formula extraction — reads `cells` Y.Map
///
/// Sharing a single transaction eliminates the overhead of opening a
/// second snapshot. Uses `CellId` keys to avoid per-cell `id_to_hex()`
/// String allocations (~3.1M saved for large workbooks).
fn batch_read_props_formulas_and_array_refs(
    stores: &EngineStores,
    sheet_id: &SheetId,
    read_raw_formulas: bool,
) -> (
    FxHashMap<CellId, CellProperties>,
    FxHashMap<CellId, String>,
    FxHashMap<CellId, String>,
) {
    let doc = stores.storage.doc();
    let txn = doc.transact();

    // --- Properties ---
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut all_props = FxHashMap::default();

    // Navigate to the properties sub-map for this sheet
    let sheets = stores.storage.sheets();
    let workbook = stores.storage.workbook_map();
    if let Some(Out::YMap(sheet_map)) = sheets.get(&txn, &sheet_hex)
        && let Some(Out::YMap(props_map)) = sheet_map.get(&txn, KEY_CELL_PROPERTIES)
    {
        // Pre-size the map to eliminate rehashes during the fill loop.
        // For large sheets this is the dominant cost in export.
        all_props.reserve(props_map.len(&txn) as usize);
        for (key, value) in props_map.iter(&txn) {
            let cell_id = match parse_cell_id(key) {
                Some(id) => id,
                None => continue,
            };
            let props_opt = match value {
                Out::YMap(nested) => {
                    domain_types::yrs_schema::cell_properties::from_yrs_map(&nested, &txn)
                        .map(Into::into)
                }
                Out::Any(Any::String(ref json_str)) => {
                    properties::resolve_compact_props_with_txn(json_str, workbook, &txn)
                }
                _ => None,
            };
            if let Some(props) = props_opt {
                all_props.insert(cell_id, props);
            }
        }
    }

    // --- Raw formulas (only for lossless round-trip) + array formula refs ---
    let mut raw_formulas = FxHashMap::default();
    let mut array_refs = FxHashMap::default();
    if let Some(cells_map) = crate::storage::infra::grid_helpers::get_cells_map(
        &txn,
        stores.storage.sheets(),
        &sheet_hex,
    ) {
        raw_formulas.reserve(cells_map.len(&txn) as usize);
        array_refs.reserve(cells_map.len(&txn) as usize);
        for (cell_hex, value) in cells_map.iter(&txn) {
            let Out::YMap(cell_map) = value else {
                continue;
            };
            let Some(cell_id) = parse_cell_id(cell_hex) else {
                continue;
            };
            if read_raw_formulas
                && let Some(Out::Any(Any::String(f))) = cell_map.get(&txn, KEY_FORMULA)
            {
                raw_formulas.insert(cell_id, f.to_string());
            }
            if let Some(Out::Any(Any::String(array_ref))) = cell_map.get(&txn, KEY_ARRAY_REF) {
                array_refs.insert(cell_id, array_ref.to_string());
            }
        }
    }

    (all_props, raw_formulas, array_refs)
}

fn batch_read_range_format_style_ids(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> FxHashMap<RangeId, u32> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let mut out = FxHashMap::default();
    let sheet_hex = id_to_hex(sheet_id.as_u128());

    let Some(Out::YMap(sheet_map)) = stores.storage.sheets().get(&txn, &sheet_hex) else {
        return out;
    };
    let Some(Out::YMap(range_formats_map)) = sheet_map.get(&txn, KEY_RANGE_FORMATS) else {
        return out;
    };

    for (range_hex, value) in range_formats_map.iter(&txn) {
        let Some(raw_id) = hex_to_id(range_hex) else {
            continue;
        };
        let Out::YMap(format_map) = value else {
            continue;
        };
        let Some(Out::Any(Any::Number(style_id))) = format_map.get(
            &txn,
            domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
        ) else {
            continue;
        };
        if style_id >= 0.0 {
            out.insert(RangeId::from_raw(raw_id), style_id as u32);
        }
    }

    out
}

fn style_id_for_cell_format(
    format: &CellFormat,
    has_lossless_stylesheet: bool,
    original_cellxfs_count: u32,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let doc_fmt = cell_format_to_document_format(format);
    if doc_fmt == DocumentFormat::default() {
        return None;
    }
    let palette_id = palette.get_or_insert(doc_fmt);
    Some(if has_lossless_stylesheet {
        original_cellxfs_count + palette_id
    } else {
        palette_id
    })
}

fn format_range_style_id_at(
    sheet: &crate::mirror::SheetMirror,
    row: u32,
    col: u32,
    imported_style_ids: &FxHashMap<RangeId, u32>,
    has_lossless_stylesheet: bool,
    original_cellxfs_count: u32,
    palette: &impl PaletteOps,
) -> Option<u32> {
    let matching = sheet.format_ranges_at(row, col);
    if matching.is_empty() {
        return None;
    }

    for (range_id, _) in matching.iter().rev() {
        if let Some(style_id) = imported_style_ids.get(range_id) {
            return Some(*style_id);
        }
    }

    matching.last().and_then(|(_, format)| {
        style_id_for_cell_format(
            format,
            has_lossless_stylesheet,
            original_cellxfs_count,
            palette,
        )
    })
}

// -------------------------------------------------------------------
// Per-sheet cell export
// -------------------------------------------------------------------

/// Export all cells for a sheet as position-keyed `CellData`.
///
/// Iterates the grid_index (which maps CellId → position) and reads
/// values from ComputeCore (for recalc'd formulas) or the mirror.
/// Builds style_palette entries for cells with formatting.
pub(in crate::storage::engine) fn export_cells_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    _round_trip_context: Option<&RoundTripContext>,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<CellData> {
    let mut profile = crate::xlsx_profile::PhaseTimer::new("export", "export_cells_for_sheet");
    // When a lossless stylesheet is available, cell style_ids reference
    // the original cellXfs indices directly (stored during hydration as "s").
    let has_lossless_stylesheet = false;
    // Original cellXfs count — new palette entries are appended after these,
    // so mutated cells get style_id = original_count + palette_idx.
    let original_cellxfs_count = 0;

    // Batch-read ALL cell properties and raw formulas in a single Yrs
    // transaction, avoiding duplicate transaction setup overhead (O2+O3).
    // Uses CellId keys to eliminate per-cell id_to_hex() String allocations.
    let (all_props, raw_formulas, array_refs) =
        batch_read_props_formulas_and_array_refs(stores, sheet_id, has_lossless_stylesheet);
    let imported_range_style_ids = batch_read_range_format_style_ids(stores, sheet_id);

    // Build a reverse map: cell_id → (row, col) from grid_indexes.
    let grid = stores.grid_indexes.get(sheet_id);
    let sheet_mirror = mirror.get_sheet(sheet_id);
    let mut cells_by_pos: FxHashMap<(u32, u32), CellData> = FxHashMap::default();
    let mut range_override_positions: FxHashSet<(u32, u32)> = FxHashSet::default();

    if let Some(sheet) = sheet_mirror {
        for (_, range) in sheet.ranges_sorted_by_id() {
            for &(row_id, col_id) in range.overrides.keys() {
                let Some(row) = sheet.row_index_of(&row_id) else {
                    continue;
                };
                let Some(col) = sheet.col_index_of(&col_id) else {
                    continue;
                };
                range_override_positions.insert((row, col));
            }
        }
    }

    // Iterate all cells registered in the grid index.
    if let Some(grid) = grid {
        profile.counter("grid_cells", grid.cells().count() as u64);
        for (cell_id, row, col) in grid.cells() {
            if let Some(mut cell) = build_cell_data_for_cell_id(
                stores,
                mirror,
                sheet_id,
                &cell_id,
                row,
                col,
                &all_props,
                &raw_formulas,
                &array_refs,
                has_lossless_stylesheet,
                original_cellxfs_count,
                palette,
                false,
            ) {
                if cell.style_id.is_none()
                    && let Some(sheet) = sheet_mirror
                {
                    cell.style_id = format_range_style_id_at(
                        sheet,
                        row,
                        col,
                        &imported_range_style_ids,
                        has_lossless_stylesheet,
                        original_cellxfs_count,
                        palette,
                    );
                }
                cells_by_pos.insert((row, col), cell);
            }
        }
    }

    if let Some(sheet) = sheet_mirror {
        sheet.visit_range_values_for_export(|row, col, value| {
            if value.is_null() || range_override_positions.contains(&(row, col)) {
                return;
            }
            match cells_by_pos.get_mut(&(row, col)) {
                Some(existing) => {
                    if existing.formula.is_none() && existing.value.is_null() {
                        existing.value = value;
                    }
                }
                None => {
                    let mut cell = range_payload_cell(row, col, value);
                    cell.style_id = format_range_style_id_at(
                        sheet,
                        row,
                        col,
                        &imported_range_style_ids,
                        has_lossless_stylesheet,
                        original_cellxfs_count,
                        palette,
                    );
                    cells_by_pos.insert((row, col), cell);
                }
            }
        });

        // Match the dense-column overlay contract: RangeView overrides win over
        // payload values and explicit sparse cells. Sorting makes overlapping
        // range override conflicts deterministic, with higher RangeId winning.
        for (_, range) in sheet.ranges_sorted_by_id() {
            let mut overrides: Vec<_> = range.overrides.iter().collect();
            overrides.sort_by_key(|((row_id, col_id), _)| {
                (
                    sheet.row_index_of(row_id).unwrap_or(u32::MAX),
                    sheet.col_index_of(col_id).unwrap_or(u32::MAX),
                )
            });
            for (&(row_id, col_id), cell_id) in overrides {
                let Some(row) = sheet.row_index_of(&row_id) else {
                    continue;
                };
                let Some(col) = sheet.col_index_of(&col_id) else {
                    continue;
                };
                let replacement_from_cell = build_cell_data_for_cell_id(
                    stores,
                    mirror,
                    sheet_id,
                    cell_id,
                    row,
                    col,
                    &all_props,
                    &raw_formulas,
                    &array_refs,
                    has_lossless_stylesheet,
                    original_cellxfs_count,
                    palette,
                    true,
                );
                let is_synthetic_placeholder = replacement_from_cell.is_none();
                let mut replacement =
                    replacement_from_cell.unwrap_or_else(|| explicit_blank_cell(row, col));
                let replaces_existing_payload = cells_by_pos.contains_key(&(row, col));
                if !replaces_existing_payload
                    && ((is_synthetic_placeholder && is_plain_blank_cell(&replacement))
                        || is_imported_style_only_blank_cell(&replacement))
                {
                    continue;
                }
                if replacement.style_id.is_none() {
                    replacement.style_id = format_range_style_id_at(
                        sheet,
                        row,
                        col,
                        &imported_range_style_ids,
                        has_lossless_stylesheet,
                        original_cellxfs_count,
                        palette,
                    );
                }

                if cells_by_pos.get(&(row, col)).is_some_and(|existing| {
                    existing.formula.is_some() && replacement.formula.is_none()
                }) {
                    continue;
                }
                cells_by_pos.insert((row, col), replacement);
            }
        }
    }

    let sheet_uuid = sheet_id.to_uuid_string();
    for pivot in mirror
        .all_pivot_tables()
        .iter()
        .filter(|pivot| pivot.sheet == sheet_uuid)
    {
        if pivot.is_empty_rendered_region() {
            continue;
        }

        let end_row = pivot
            .start_row
            .saturating_add(pivot.rendered_row_count())
            .saturating_sub(1);
        let end_col = pivot
            .start_col
            .saturating_add(pivot.rendered_col_count())
            .saturating_sub(1);

        for row in pivot.start_row..=end_row {
            for col in pivot.start_col..=end_col {
                let Some(value) = mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col))
                else {
                    continue;
                };
                if value.is_null() {
                    continue;
                }

                if let std::collections::hash_map::Entry::Vacant(entry) =
                    cells_by_pos.entry((row, col))
                {
                    entry.insert(range_payload_cell(row, col, value.clone()));
                }
            }
        }
    }

    let mut cells: Vec<CellData> = cells_by_pos.into_values().collect();
    // Sort by (row, col) to maintain deterministic output order
    cells.sort_by_key(|c| (c.row, c.col));

    profile.counter("cells", cells.len() as u64);
    cells
}

pub(in crate::storage::engine) fn export_authored_style_runs_for_sheet(
    stores: &EngineStores,
    mirror: &CellMirror,
    _round_trip_context: Option<&RoundTripContext>,
    sheet_id: &SheetId,
    palette: &impl PaletteOps,
) -> Vec<AuthoredStyleRun> {
    let Some(sheet) = mirror.get_sheet(sheet_id) else {
        return Vec::new();
    };

    let has_lossless_stylesheet = false;
    let original_cellxfs_count = 0;
    let imported_style_ids = batch_read_range_format_style_ids(stores, sheet_id);

    let mut runs = Vec::new();
    for range in sheet.format_ranges() {
        let style_id = imported_style_ids.get(&range.id).copied().or_else(|| {
            sheet
                .range_format_cache()
                .get(&range.id)
                .and_then(|format| {
                    style_id_for_cell_format(
                        format,
                        has_lossless_stylesheet,
                        original_cellxfs_count,
                        palette,
                    )
                })
        });
        let Some(style_id) = style_id else {
            continue;
        };
        runs.push(AuthoredStyleRun {
            start_row: range.start_row,
            start_col: range.start_col,
            end_row: range.end_row,
            end_col: range.end_col,
            style_id,
        });
    }

    runs.sort_by_key(|r| (r.start_row, r.start_col, r.end_row, r.end_col, r.style_id));
    runs.dedup();
    runs
}

#[allow(clippy::too_many_arguments)]
fn build_cell_data_for_cell_id(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: &CellId,
    row: u32,
    col: u32,
    all_props: &FxHashMap<CellId, CellProperties>,
    raw_formulas: &FxHashMap<CellId, String>,
    array_refs: &FxHashMap<CellId, String>,
    has_lossless_stylesheet: bool,
    original_cellxfs_count: u32,
    palette: &impl PaletteOps,
    preserve_blank: bool,
) -> Option<CellData> {
    // Get value: ComputeCore first, then mirror fallback.
    let value = stores
        .compute
        .get_cell_value(mirror, cell_id)
        .cloned()
        .unwrap_or_else(|| {
            mirror
                .get_cell_value_in_sheet(sheet_id, cell_id)
                .cloned()
                .unwrap_or(CellValue::Null)
        });

    // Get formula text — prefer raw Yrs formula for lossless round-trip.
    let formula = raw_formulas
        .get(cell_id)
        .cloned()
        .or_else(|| stores.compute.get_formula(cell_id).map(|s| s.to_string()))
        .or_else(|| {
            mirror
                .get_formula(cell_id)
                .map(|f| format!("={}", f.template))
        });

    let cell_props = all_props.get(cell_id);
    let style_id = cell_style_id(
        cell_props,
        has_lossless_stylesheet,
        original_cellxfs_count,
        palette,
    );

    let cm = cell_props.map(|props| props.cm).unwrap_or(false);
    let vm = cell_props.and_then(|props| props.vm);
    let formula_result_type = cell_props.and_then(|props| props.formula_result_type);
    let original_sst_index = cell_props.and_then(|props| props.original_sst_index);
    let original_value = cell_props
        .and_then(|props| props.original_value.as_ref())
        .cloned();

    let is_empty = value.is_null() && formula.is_none();
    if is_empty
        && style_id.is_none()
        && !cm
        && vm.is_none()
        && formula_result_type.is_none()
        && original_sst_index.is_none()
        && original_value.is_none()
        && !preserve_blank
    {
        return None;
    }
    if is_empty
        && !preserve_blank
        && is_imported_style_only_blank(
            style_id,
            cell_props,
            cm,
            vm,
            formula_result_type,
            original_sst_index,
            original_value.as_ref(),
        )
    {
        return None;
    }

    Some(CellData {
        row,
        col,
        value,
        formula: formula
            .as_deref()
            .map(|f| f.strip_prefix('=').unwrap_or(f).to_string()),
        array_ref: array_refs.get(cell_id).cloned(),
        style_id,
        cell_formula: None,
        cm,
        formula_result_type,
        has_empty_cached_value: false,
        vm,
        original_sst_index,
        original_value,
        projection_role: ImportedCellProjectionRole::Normal,
    })
}

fn is_imported_style_only_blank(
    style_id: Option<u32>,
    cell_props: Option<&CellProperties>,
    cm: bool,
    vm: Option<u32>,
    formula_result_type: Option<u8>,
    original_sst_index: Option<u32>,
    original_value: Option<&String>,
) -> bool {
    style_id.is_some()
        && cell_props.is_some_and(|props| props.format.is_none() && props.style_id.is_some())
        && !cm
        && vm.is_none()
        && formula_result_type.is_none()
        && original_sst_index.is_none()
        && original_value.is_none_or(|value| value.is_empty())
}

fn cell_style_id(
    cell_props: Option<&CellProperties>,
    has_lossless_stylesheet: bool,
    original_cellxfs_count: u32,
    palette: &impl PaletteOps,
) -> Option<u32> {
    if has_lossless_stylesheet {
        // Prefer the original style index for unmodified cells (lossless round-trip).
        // If `style_id` was cleared, fall through to CellFormat -> DocumentFormat.
        cell_props.and_then(|props| props.style_id).or_else(|| {
            cell_props.and_then(|props| {
                let cell_fmt = props.format.as_ref()?;
                let doc_fmt = cell_format_to_document_format(cell_fmt);
                if doc_fmt == DocumentFormat::default() {
                    return None;
                }
                Some(original_cellxfs_count + palette.get_or_insert(doc_fmt))
            })
        })
    } else {
        cell_props.and_then(|props| {
            let cell_fmt = props.format.as_ref()?;
            let doc_fmt = cell_format_to_document_format(cell_fmt);
            if doc_fmt == DocumentFormat::default() {
                return None;
            }
            Some(palette.get_or_insert(doc_fmt))
        })
    }
}

fn range_payload_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        row,
        col,
        value,
        formula: None,
        array_ref: None,
        style_id: None,
        cell_formula: None,
        cm: false,
        formula_result_type: None,
        has_empty_cached_value: false,
        vm: None,
        original_sst_index: None,
        original_value: None,
        projection_role: ImportedCellProjectionRole::Normal,
    }
}

fn is_plain_blank_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.style_id.is_none()
        && cell.cell_formula.is_none()
        && !cell.cm
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.vm.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

fn is_imported_style_only_blank_cell(cell: &CellData) -> bool {
    cell.value.is_null()
        && cell.formula.is_none()
        && cell.style_id.is_some()
        && cell.cell_formula.is_none()
        && !cell.cm
        && cell.formula_result_type.is_none()
        && !cell.has_empty_cached_value
        && cell.vm.is_none()
        && cell.original_sst_index.is_none()
        && cell
            .original_value
            .as_ref()
            .is_none_or(|value| value.is_empty())
}

fn explicit_blank_cell(row: u32, col: u32) -> CellData {
    range_payload_cell(row, col, CellValue::Null)
}

// -------------------------------------------------------------------
// Row/Col styles export
// -------------------------------------------------------------------

/// Export row-level and column-level style overrides for a sheet.
///
/// Uses batch Yrs reads (`get_all_row_formats` / `get_all_col_formats`)
/// to read all row/col formats in a single transaction per map, instead
/// of creating a new transaction per row/col. For a sheet with 50K+ rows
/// but only a few hundred with actual formats, this eliminates tens of
/// thousands of redundant Yrs transactions.
pub(in crate::storage::engine) fn export_row_col_styles_for_sheet(
    stores: &EngineStores,
    _round_trip_context: Option<&RoundTripContext>,
    sheet_id: &SheetId,
    _max_row: u32,
    _max_col: u32,
    palette: &impl PaletteOps,
) -> (Vec<RowStyleEntry>, Vec<ColStyleEntry>) {
    let has_lossless_stylesheet = false;
    let original_cellxfs_count = 0;

    let grid_index = stores.grid_indexes.get(sheet_id);

    // Batch-read all row formats in one transaction
    let all_row_fmts = properties::get_all_row_formats(&stores.storage, sheet_id, grid_index);
    let mut row_styles = Vec::with_capacity(all_row_fmts.len());
    for entry in all_row_fmts {
        // Lossless path: use stored XLSX style index if available
        if has_lossless_stylesheet && let Some(stored_idx) = entry.xlsx_style_id {
            if stored_idx > 0 {
                row_styles.push(RowStyleEntry {
                    row: entry.row,
                    style_id: stored_idx,
                });
            }
            continue;
        }
        if let Some(fmt) = entry.format
            && let Some(style_id) = style_id_for_cell_format(
                &fmt,
                has_lossless_stylesheet,
                original_cellxfs_count,
                palette,
            )
        {
            row_styles.push(RowStyleEntry {
                row: entry.row,
                style_id,
            });
        }
    }

    // Batch-read all column formats in one transaction
    let all_col_fmts = properties::get_all_col_formats(&stores.storage, sheet_id, grid_index);
    let mut col_styles = Vec::with_capacity(all_col_fmts.len());
    for entry in all_col_fmts {
        if has_lossless_stylesheet && let Some(stored_idx) = entry.xlsx_style_id {
            if stored_idx > 0 {
                col_styles.push(ColStyleEntry {
                    col: entry.col,
                    style_id: stored_idx,
                });
            }
            continue;
        }
        if let Some(fmt) = entry.format
            && let Some(style_id) = style_id_for_cell_format(
                &fmt,
                has_lossless_stylesheet,
                original_cellxfs_count,
                palette,
            )
        {
            col_styles.push(ColStyleEntry {
                col: entry.col,
                style_id,
            });
        }
    }

    (row_styles, col_styles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::parse_output_to_snapshot::{
        DefaultIdAllocator, parse_output_to_workbook_snapshot,
    };
    use crate::mirror::CellMirror;
    use crate::scheduler::ComputeCore;
    use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
    use crate::storage::YrsStorage;
    use crate::storage::engine::YrsComputeEngine;
    use crate::storage::engine::construction::assemble_engine;
    use crate::storage::engine::services::export::LocalPalette;
    use compute_pivot::types::{
        FieldId, PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow, PivotTableResult,
    };
    use snapshot_types::PivotTableDef;
    use std::sync::Arc;
    use value_types::FiniteF64;

    fn number(n: f64) -> CellValue {
        CellValue::Number(FiniteF64::must(n))
    }

    fn workbook(sheet_id: &SheetId, cells: Vec<snapshot_types::CellData>) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id.to_uuid_string(),
                name: "PivotOut".to_string(),
                rows: 20,
                cols: 10,
                cells,
                ranges: vec![],
            }],
            ..WorkbookSnapshot::default()
        }
    }

    fn metadata_only_shared_string_output() -> domain_types::ParseOutput {
        domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::<str>::from("")),
                    original_sst_index: Some(7),
                    original_value: Some("7".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn empty_shared_string_source_xlsx() -> Vec<u8> {
        let output = domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::<str>::from("")),
                    original_sst_index: Some(0),
                    original_value: Some("0".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let ctx = domain_types::RoundTripContext {
            raw_shared_strings_xml: Some(
                br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t></t></si></sst>"#
                    .to_vec(),
            ),
            original_sst_count: Some(1),
            ..Default::default()
        };

        xlsx_parser::write::write_xlsx_from_parse_output(&output, Some(&ctx))
            .expect("source XLSX should be writable")
    }

    fn engine_from_parse_output(output: &domain_types::ParseOutput) -> (YrsComputeEngine, SheetId) {
        engine_from_parse_output_with_roundtrip(output, None)
    }

    fn engine_from_parse_output_with_roundtrip(
        output: &domain_types::ParseOutput,
        round_trip_context: Option<domain_types::RoundTripContext>,
    ) -> (YrsComputeEngine, SheetId) {
        let mut storage = YrsStorage::new();
        let mut allocator = DefaultIdAllocator::new();
        let id_map = storage
            .hydrate_from_parse_output(output, &mut allocator)
            .expect("hydrate_from_parse_output");
        let mut snapshot_allocator = DefaultIdAllocator::new();
        let snapshot =
            parse_output_to_workbook_snapshot(output, Some(&id_map), &mut snapshot_allocator);
        let mut mirror = CellMirror::from_snapshot(snapshot.clone()).expect("mirror from snapshot");
        let mut compute = ComputeCore::new();
        compute
            .init_from_snapshot_no_recalc(&mut mirror, snapshot.clone())
            .expect("compute init");
        let sheet_id = id_map.sheet_ids[0];
        let engine = assemble_engine(storage, mirror, compute, &snapshot, round_trip_context)
            .expect("engine");
        (engine, sheet_id)
    }

    fn authored_style_run_output() -> domain_types::ParseOutput {
        domain_types::ParseOutput {
            style_palette: vec![DocumentFormat {
                fill: Some(domain_types::FillFormat {
                    background_color: Some("#FFEE00".to_string()),
                    pattern_type: Some("solid".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 2,
                cols: 2,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 1,
                    value: number(12.0),
                    ..Default::default()
                }],
                authored_style_runs: vec![AuthoredStyleRun {
                    start_row: 0,
                    start_col: 0,
                    end_row: 1,
                    end_col: 1,
                    style_id: 0,
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn authored_style_runs_hydrate_as_format_ranges_without_blank_cells() {
        let output = authored_style_run_output();
        let (engine, sheet_id) = engine_from_parse_output(&output);
        let grid = engine
            .stores
            .grid_indexes
            .get(&sheet_id)
            .expect("grid index");
        let sheet_mirror = engine.mirror.get_sheet(&sheet_id).expect("sheet mirror");

        assert_eq!(grid.cells().count(), 1);
        assert_eq!(sheet_mirror.format_ranges().len(), 1);

        let positional = crate::storage::properties::get_positional_format(
            &engine.stores.storage,
            &sheet_id,
            1,
            0,
            Some(grid),
            Some(sheet_mirror),
        );
        assert_eq!(positional.background_color.as_deref(), Some("#FFEE00"));

        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let cells =
            export_cells_for_sheet(&engine.stores, &engine.mirror, None, &sheet_id, &palette);
        assert_eq!(
            cells.len(),
            1,
            "format ranges should not emit styled blank cells"
        );
        assert!(
            cells.iter().all(|cell| (cell.row, cell.col) != (0, 0)),
            "authored style run coverage should not materialize A1 as a blank cell"
        );
        let value_cell = cells
            .iter()
            .find(|cell| cell.row == 0 && cell.col == 1)
            .expect("overlapping value cell should export");
        assert_eq!(value_cell.style_id, Some(0));

        let exported_runs = export_authored_style_runs_for_sheet(
            &engine.stores,
            &engine.mirror,
            None,
            &sheet_id,
            &palette,
        );
        assert_eq!(exported_runs, output.sheets[0].authored_style_runs);
    }

    #[test]
    fn mutated_row_and_col_formats_use_authored_palette_ids() {
        let output = domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 4,
                cols: 4,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: number(1.0),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let (mut engine, sheet_id) = engine_from_parse_output(&output);

        engine
            .set_row_format(
                &sheet_id,
                2,
                CellFormat {
                    bold: Some(true),
                    ..Default::default()
                },
            )
            .expect("set row format");
        engine
            .set_col_format(
                &sheet_id,
                1,
                CellFormat {
                    background_color: Some("#FFEE00".to_string()),
                    pattern_type: Some(ooxml_types::styles::PatternType::Solid),
                    ..Default::default()
                },
            )
            .expect("set col format");

        let exported = engine.build_parse_output_from_yrs();
        assert_eq!(exported.style_palette.len(), 2);
        assert_eq!(exported.sheets[0].row_styles[0].style_id, 0);
        assert_eq!(exported.sheets[0].col_styles[0].style_id, 1);
    }

    #[test]
    fn imported_style_only_blank_cells_do_not_export_as_cells() {
        let sheet_id = SheetId::from_raw(103);
        let blank_cell_id = CellId::from_raw(203);
        let mut props = FxHashMap::default();
        props.insert(
            blank_cell_id,
            CellProperties {
                format: None,
                style_id: Some(15),
                ..Default::default()
            },
        );
        let raw_formulas = FxHashMap::default();
        let array_refs = FxHashMap::default();
        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let (engine, _) =
            YrsComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");

        let exported = build_cell_data_for_cell_id(
            &engine.stores,
            &engine.mirror,
            &sheet_id,
            &blank_cell_id,
            1,
            55,
            &props,
            &raw_formulas,
            &array_refs,
            true,
            20,
            &palette,
            false,
        );

        assert!(
            exported.is_none(),
            "lossless imported style metadata alone should remain range/style metadata, not a physical blank cell"
        );
    }

    #[test]
    fn xlsx_import_rebuild_hydrates_authored_style_ranges() {
        let output = authored_style_run_output();
        let source_xlsx = xlsx_parser::write::write_xlsx_from_parse_output(&output, None)
            .expect("source XLSX should be writable");
        let bootstrap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-4000-8000-000000000001".to_string(),
                name: "Sheet1".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![],
                ranges: vec![],
            }],
            ..WorkbookSnapshot::default()
        };
        let (mut engine, _) = YrsComputeEngine::from_snapshot(bootstrap).expect("bootstrap engine");

        engine
            .import_from_xlsx_bytes_no_recalc(&source_xlsx)
            .expect("import XLSX");

        let exported = engine.build_parse_output_from_yrs();
        let runs = &exported.sheets[0].authored_style_runs;
        assert!(
            runs.iter()
                .any(|run| run.start_row == 0 && run.start_col == 0),
            "styled blank coverage should survive XLSX import rebuild"
        );
    }

    #[test]
    fn cached_shared_string_metadata_survives_hydration_export() {
        let output = metadata_only_shared_string_output();
        let (engine, sheet_id) = engine_from_parse_output(&output);

        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let cells =
            export_cells_for_sheet(&engine.stores, &engine.mirror, None, &sheet_id, &palette);
        let exported = cells
            .iter()
            .find(|cell| cell.row == 0 && cell.col == 0)
            .expect("A1 should export");

        assert_eq!(exported.original_sst_index, Some(7));
        assert_eq!(exported.original_value.as_deref(), Some("7"));
    }

    #[test]
    fn skipped_spill_target_is_not_replayed_from_roundtrip_sidecar() {
        let source = domain_types::CellData {
            row: 0,
            col: 0,
            value: number(1.0),
            formula: Some("SEQUENCE(1,2)".to_string()),
            cm: true,
            projection_role: domain_types::ImportedCellProjectionRole::DynamicArraySource,
            ..Default::default()
        };
        let spill = domain_types::CellData {
            row: 0,
            col: 1,
            value: number(2.0),
            cm: true,
            original_value: Some("2".to_string()),
            projection_role: domain_types::ImportedCellProjectionRole::DynamicArraySpillTarget,
            ..Default::default()
        };
        let output = domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 1,
                cols: 2,
                cells: vec![source, spill.clone()],
                ..Default::default()
            }],
            ..Default::default()
        };

        let (engine, sheet_id) = engine_from_parse_output(&output);
        let grid = engine
            .stores
            .grid_indexes
            .get(&sheet_id)
            .expect("grid index");
        assert!(
            !grid
                .cells()
                .any(|(_cell_id, row, col)| row == 0 && col == 1),
            "spill target must not materialize as editable storage"
        );

        let exported = engine.build_parse_output_from_yrs();
        let cells = &exported.sheets[0].cells;
        assert!(cells.iter().any(|cell| (cell.row, cell.col) == (0, 0)));
        assert!(
            !cells.iter().any(|cell| (cell.row, cell.col) == (0, 1)),
            "spill target sidecars are no longer replayed through roundtrip context"
        );
    }

    #[test]
    fn original_sst_metadata_survives_l2_import_export() {
        let input = empty_shared_string_source_xlsx();
        let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&input).expect("import XLSX");

        let output = engine
            .export_to_xlsx_bytes()
            .expect("export_to_xlsx_bytes should succeed");
        let archive = xlsx_parser::XlsxArchive::new(&output).expect("exported XLSX archive");
        let sheet_xml =
            String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

        assert!(
            sheet_xml.contains(r#"<c r="A1" t="s"><v>0</v></c>"#),
            "empty shared-string cell should retain its SST reference; got: {sheet_xml}"
        );
        assert!(
            !sheet_xml.contains(r#"<c r="A1" t="s"/>"#),
            "empty shared-string cell must not regress to a self-closing t=\"s\" cell"
        );
    }

    #[test]
    fn edited_formula_export_does_not_replay_stale_shared_group_metadata() {
        let output = domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 2,
                cols: 1,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: number(10.0),
                    formula: Some("SUM(A2:A10)".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let (mut engine, sheet_id) = engine_from_parse_output(&output);
        let cell_id = engine
            .stores
            .grid_indexes
            .get(&sheet_id)
            .and_then(|grid| {
                grid.cells()
                    .find_map(|(cell_id, row, col)| (row == 0 && col == 0).then_some(cell_id))
            })
            .expect("A1 cell id");

        engine
            .set_cell(
                &sheet_id,
                cell_id,
                0,
                0,
                crate::bridge_types::CellInput::Parse {
                    text: "=SUM(B2:B10)".into(),
                },
            )
            .expect("formula edit should succeed");

        let xlsx = engine
            .export_to_xlsx_bytes()
            .expect("export_to_xlsx_bytes should succeed");
        let archive = xlsx_parser::XlsxArchive::new(&xlsx).expect("exported XLSX archive");
        xlsx_parser::infra::package_integrity::validate_archive_package_integrity(&archive)
            .expect("exported package should be valid");
        let sheet_xml =
            String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

        assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
        assert!(!sheet_xml.contains(r#"t="shared""#));
        assert!(!sheet_xml.contains(r#"si="7""#));
        assert!(!sheet_xml.contains(r#"ref="A1:A2""#));
        assert!(!sheet_xml.contains(r#"ca="1""#));
        assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
    }

    #[test]
    fn edited_formula_export_does_not_replay_stale_array_group_metadata() {
        let output = domain_types::ParseOutput {
            sheets: vec![domain_types::SheetData {
                name: "Sheet1".to_string(),
                rows: 2,
                cols: 1,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: number(10.0),
                    formula: Some("SUM(A2:A10)".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };
        let (mut engine, sheet_id) = engine_from_parse_output(&output);
        let cell_id = engine
            .stores
            .grid_indexes
            .get(&sheet_id)
            .and_then(|grid| {
                grid.cells()
                    .find_map(|(cell_id, row, col)| (row == 0 && col == 0).then_some(cell_id))
            })
            .expect("A1 cell id");

        engine
            .set_cell(
                &sheet_id,
                cell_id,
                0,
                0,
                crate::bridge_types::CellInput::Parse {
                    text: "=SUM(B2:B10)".into(),
                },
            )
            .expect("formula edit should succeed");

        let xlsx = engine
            .export_to_xlsx_bytes()
            .expect("export_to_xlsx_bytes should succeed");
        let archive = xlsx_parser::XlsxArchive::new(&xlsx).expect("exported XLSX archive");
        xlsx_parser::infra::package_integrity::validate_archive_package_integrity(&archive)
            .expect("exported package should be valid");
        let sheet_xml =
            String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

        assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
        assert!(!sheet_xml.contains(r#"t="array""#));
        assert!(!sheet_xml.contains(r#"ref="A1:A2""#));
        assert!(!sheet_xml.contains(r#"aca="1""#));
        assert!(!sheet_xml.contains(r#"ca="1""#));
    }

    fn one_value_pivot_result(value: CellValue) -> PivotTableResult {
        PivotTableResult {
            column_headers: vec![],
            rows: vec![PivotRow {
                key: "east".to_string(),
                headers: vec![PivotHeader {
                    key: "east".to_string(),
                    value: CellValue::Text("East".into()),
                    field_id: FieldId::from("region"),
                    depth: 0,
                    span: 1,
                    is_expandable: false,
                    is_expanded: true,
                    is_subtotal: false,
                    is_grand_total: false,
                    parent_key: None,
                    child_keys: None,
                }],
                values: vec![value],
                depth: 0,
                is_subtotal: false,
                is_grand_total: false,
                source_row_indices: None,
            }],
            grand_totals: PivotGrandTotals {
                row: None,
                column: None,
                grand: None,
                row_label: None,
            },
            rendered_bounds: PivotRenderedBounds {
                total_rows: 2,
                total_cols: 2,
                first_data_row: 1,
                first_data_col: 1,
                num_data_cols: 1,
            },
            source_row_count: 1,
            measure_descriptors: vec![],
            value_records: vec![],
            errors: None,
        }
    }

    fn register_rendered_pivot(
        engine: &mut YrsComputeEngine,
        sheet_id: &SheetId,
        value: CellValue,
    ) {
        let result = one_value_pivot_result(value);
        engine
            .mirror
            .materialize_pivot(sheet_id, 0, 0, &result, &["Region".to_string()]);
        engine.mirror.upsert_pivot_table_def(PivotTableDef {
            id: "pivot-1".to_string(),
            name: "Pivot1".to_string(),
            sheet: sheet_id.to_uuid_string(),
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
            rendered_rows: Some(2),
            rendered_cols: Some(2),
            first_data_row: 1,
            first_data_col: 1,
            data_field_names: vec!["Sum of Sales".to_string()],
            cache_field_names: vec!["Region".to_string(), "Sales".to_string()],
            row_field_indices: vec![0],
            col_field_indices: vec![],
            data_on_rows: false,
        });
    }

    #[test]
    fn export_cells_includes_pivot_overlay_without_grid_index() {
        let sheet_id = SheetId::from_raw(100);
        let (mut engine, _) =
            YrsComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");
        register_rendered_pivot(&mut engine, &sheet_id, number(10.0));
        engine.stores.grid_indexes.remove(&sheet_id);

        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let cells =
            export_cells_for_sheet(&engine.stores, &engine.mirror, None, &sheet_id, &palette);

        assert!(
            cells
                .iter()
                .any(|cell| cell.row == 1 && cell.col == 1 && cell.value == number(10.0)),
            "pivot materialized value should export even when the sheet has no grid index"
        );
    }

    #[test]
    fn export_cells_preserves_explicit_cell_over_pivot_overlay() {
        let sheet_id = SheetId::from_raw(101);
        let explicit_cell_id = cell_types::CellId::from_raw(201);
        let (mut engine, _) = YrsComputeEngine::from_snapshot(workbook(
            &sheet_id,
            vec![snapshot_types::CellData {
                cell_id: explicit_cell_id.to_uuid_string(),
                row: 1,
                col: 1,
                value: number(99.0),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
        ))
        .expect("engine");
        register_rendered_pivot(&mut engine, &sheet_id, number(10.0));

        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let cells =
            export_cells_for_sheet(&engine.stores, &engine.mirror, None, &sheet_id, &palette);
        let exported = cells
            .iter()
            .find(|cell| cell.row == 1 && cell.col == 1)
            .expect("explicit pivot-overlap cell should export");

        assert_eq!(exported.value, number(99.0));
    }

    #[test]
    fn export_cells_does_not_emit_empty_pivot_overlay_at_origin() {
        let sheet_id = SheetId::from_raw(102);
        let (mut engine, _) =
            YrsComputeEngine::from_snapshot(workbook(&sheet_id, vec![])).expect("engine");
        let result = one_value_pivot_result(number(10.0));
        engine
            .mirror
            .materialize_pivot(&sheet_id, 0, 0, &result, &["Region".to_string()]);
        engine.mirror.upsert_pivot_table_def(PivotTableDef {
            id: "empty-pivot".to_string(),
            name: "EmptyPivot".to_string(),
            sheet: sheet_id.to_uuid_string(),
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
            rendered_rows: Some(0),
            rendered_cols: Some(0),
            first_data_row: 0,
            first_data_col: 0,
            data_field_names: vec![],
            cache_field_names: vec![],
            row_field_indices: vec![],
            col_field_indices: vec![],
            data_on_rows: false,
        });
        engine.stores.grid_indexes.remove(&sheet_id);

        let mut palette = Vec::new();
        let palette = LocalPalette::from_vec(&mut palette);
        let cells =
            export_cells_for_sheet(&engine.stores, &engine.mirror, None, &sheet_id, &palette);

        assert!(
            cells
                .iter()
                .all(|cell| cell.row != 0 || cell.col != 0 || cell.value.is_null()),
            "empty pivot bounds must not export a phantom A1 overlay"
        );
    }
}
