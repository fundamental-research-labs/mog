use super::*;

// -------------------------------------------------------------------
// Merge Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_merge_at_cell_query(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    merges::get_merge_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn get_all_merges_in_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ResolvedMergedRegion> {
    match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_all_merges(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
        ),
        None => Vec::new(),
    }
}

// -------------------------------------------------------------------
// Range Parsing & Stringification
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn parse_range_ref(range_str: &str) -> Option<A1RangeRef> {
    range_manager::parse_range(range_str)
}

pub(in crate::storage::engine) fn stringify_range_ref(range: &A1RangeRef) -> Option<String> {
    Some(range_manager::stringify_range(range))
}

pub(in crate::storage::engine) fn parse_cell_ref(cell_str: &str) -> Option<A1CellRef> {
    range_manager::parse_cell(cell_str)
}

pub(in crate::storage::engine) fn stringify_cell_ref(cell: &A1CellRef) -> Option<String> {
    Some(range_manager::stringify_cell(cell))
}

// -------------------------------------------------------------------
// Spatial Range Queries
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_merges_in_viewport_spatial(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<MergeRegion> {
    let viewport = ViewportBounds {
        min_row: start_row,
        max_row: end_row,
        min_col: start_col,
        max_col: end_col,
    };

    if let Some(index) = stores.merge_indexes.get(sheet_id) {
        let resolver = MergeDirectResolver;
        let items = index.get_items_in_viewport(&viewport, &resolver);
        return items
            .values()
            .map(|item| MergeRegion {
                start_row: item.start_row,
                start_col: item.start_col,
                end_row: item.end_row,
                end_col: item.end_col,
            })
            .collect();
    }

    let merges_vec = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_merges_in_viewport(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        ),
        None => Vec::new(),
    };
    merges_vec
        .into_iter()
        .map(|m| MergeRegion {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect()
}

pub(in crate::storage::engine) fn get_merge_at_cell_spatial(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    if let Some(index) = stores.merge_indexes.get(sheet_id) {
        let resolver = MergeDirectResolver;
        let items = index.get_items_for_cell(row, col, &resolver);
        if let Some(item) = items.first() {
            let is_origin = row == item.start_row && col == item.start_col;
            return Some(CellMergeInfo {
                merge: ResolvedMergedRegion::new(
                    IdentityMergedRegion {
                        top_left_id: String::new(),
                        bottom_right_id: String::new(),
                    },
                    item.start_row,
                    item.start_col,
                    item.end_row,
                    item.end_col,
                ),
                is_origin,
            });
        }
        return None;
    }

    let grid = stores.grid_indexes.get(sheet_id)?;
    merges::get_merge_for_cell(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
        row,
        col,
    )
}

// -------------------------------------------------------------------
// Shared Cell Visitor
// -------------------------------------------------------------------

/// Per-cell data yielded by the shared cell visitor.
pub(in crate::storage::engine) struct CellVisit {
    pub row: u32,
    pub col: u32,
    pub cell_id: Option<cell_types::CellId>,
    pub value: value_types::CellValue,
    pub formatted: String,
    pub formula: Option<String>,
    pub is_projection: bool,
    pub effective_format: domain_types::CellFormat,
}

fn formula_text_for_cell(
    engine: &crate::storage::engine::YrsComputeEngine,
    mirror: &CellMirror,
    cell_id: &CellId,
) -> Option<String> {
    engine
        .stores
        .compute
        .get_formula(cell_id)
        .map(|s| s.to_string())
        .or_else(|| {
            mirror
                .get_formula(cell_id)
                .map(|f| format!("={}", f.template))
        })
}

/// Iterate all non-empty cells in the given range, handling merge redirects,
/// ComputeCore-first value priority, spill values, and locale-aware formatting.
/// This is the single source of truth for "how to walk cells correctly."
///
/// - `include_format_only`: if true, emit cells that have row/col/range formatting only
///   (no value, no formula). `query_range` passes true; `regex_search` passes false.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn for_each_cell_in_range(
    engine: &crate::storage::engine::YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    include_format_only: bool,
    visitor: &mut impl FnMut(CellVisit),
) {
    use crate::storage::properties;
    use std::collections::HashMap;
    use value_types::CellValue;

    let locale = &engine.settings.locale;
    let mirror = &engine.mirror;
    let sheet_mirror = mirror.get_sheet(sheet_id);

    if let Some(grid) = engine.stores.grid_indexes.get(sheet_id) {
        // Build merge child→origin lookup for this range
        let merge_origins: HashMap<(u32, u32), (u32, u32)> = {
            let all_merges = merges::get_all_merges(
                engine.stores.storage.doc(),
                engine.stores.storage.sheets(),
                *sheet_id,
                grid,
            );
            let mut map = HashMap::new();
            for m in &all_merges {
                let origin = (m.start_row, m.start_col);
                for r in m.start_row..=m.end_row {
                    for c in m.start_col..=m.end_col {
                        if (r, c) != origin {
                            map.insert((r, c), origin);
                        }
                    }
                }
            }
            map
        };

        // Pre-cache column formats (one CRDT read per column, not per cell).
        let col_fmt_cache: HashMap<u32, bool> = (start_col..=end_col)
            .map(|c| {
                let has = properties::get_col_format(
                    &engine.stores.storage,
                    sheet_id,
                    c,
                    engine.stores.grid_indexes.get(sheet_id),
                )
                .is_some();
                (c, has)
            })
            .collect();

        for row in start_row..=end_row {
            // Cache row format once per row (not per cell).
            let has_row_fmt = properties::get_row_format(
                &engine.stores.storage,
                sheet_id,
                row,
                engine.stores.grid_indexes.get(sheet_id),
            )
            .is_some();

            for col in start_col..=end_col {
                let has_col_fmt = col_fmt_cache.get(&col).copied().unwrap_or(false);
                let has_range_fmt = sheet_mirror
                    .map(|sm| !sm.format_ranges_at(row, col).is_empty())
                    .unwrap_or(false);

                let cell_id_raw = grid.cell_id_at(row, col);

                // Merge-aware: redirect child cells to origin
                let cell_id_opt =
                    if let Some(&(origin_row, origin_col)) = merge_origins.get(&(row, col)) {
                        grid.cell_id_at(origin_row, origin_col).or(cell_id_raw)
                    } else {
                        cell_id_raw
                    };

                if let Some(cell_id) = cell_id_opt {
                    // ComputeCore-first value read (same pattern as get_active_cell), with a
                    // positional fallback for range-backed import cells whose virtual id reads
                    // as null but whose coordinate-backed value is materialized.
                    let identity_value = engine
                        .stores
                        .compute
                        .get_cell_value(&engine.mirror, &cell_id)
                        .cloned()
                        .or_else(|| mirror.get_cell_value_in_sheet(sheet_id, &cell_id).cloned());
                    let value = match identity_value {
                        Some(value) if !value.is_null() => value,
                        Some(value) => mirror
                            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
                            .filter(|pos_value| !pos_value.is_null())
                            .cloned()
                            .unwrap_or(value),
                        None => mirror
                            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
                            .cloned()
                            .unwrap_or(CellValue::Null),
                    };

                    // Actual formula text from ComputeCore, mirror identity formula fallback
                    let formula = formula_text_for_cell(engine, mirror, &cell_id).or_else(|| {
                        crate::storage::engine::data_table_formula::formula_at(
                            mirror, sheet_id, row, col,
                        )
                    });

                    let cell_id_hex = id_to_hex(cell_id.as_u128());

                    // Pre-fetch cell properties once for both the skip check
                    // and effective format build.
                    let cell_props = properties::get_properties(
                        engine.stores.storage.doc(),
                        engine.stores.storage.workbook_map(),
                        engine.stores.storage.sheets(),
                        sheet_id,
                        &cell_id_hex,
                    );
                    let has_cell_format = cell_props
                        .as_ref()
                        .map(|props| props.format.is_some() || props.style_id.is_some())
                        .unwrap_or(false);

                    // Skip truly empty cells: no value, no formula, no cell-level formatting,
                    // AND no explicit row/column format.
                    if matches!(value, CellValue::Null)
                        && formula.is_none()
                        && !has_cell_format
                        && !has_row_fmt
                        && !has_col_fmt
                        && !has_range_fmt
                    {
                        continue;
                    }

                    // Build effective format reusing the pre-fetched cell format
                    let table_fmt =
                        crate::storage::engine::services::resolve_structured_format_at_cell(
                            mirror, sheet_id, row, col,
                        );
                    let mut effective = properties::get_effective_format_preloaded(
                        &engine.stores.storage,
                        sheet_id,
                        row,
                        col,
                        table_fmt.as_ref(),
                        cell_props.as_ref(),
                        engine.stores.grid_indexes.get(sheet_id),
                        sheet_mirror,
                    );
                    domain_types::theme_color::resolve_theme_refs(
                        &mut effective,
                        &engine.settings.theme_palette,
                    );
                    let format_code = effective.number_format.as_deref().unwrap_or("General");
                    let format_result = compute_formats::format_value(&value, format_code, locale);
                    let formatted = format_result.text;

                    visitor(CellVisit {
                        row,
                        col,
                        cell_id: Some(cell_id),
                        value,
                        formatted,
                        formula,
                        is_projection: false,
                        effective_format: effective,
                    });
                } else if let Some(proj_value) =
                    mirror.get_cell_value_at(sheet_id, SheetPos::new(row, col))
                {
                    // No real cell at this position — check for materialized
                    // projection (spill) values in col_data.
                    if !proj_value.is_null() {
                        let value = proj_value.clone();
                        let table_fmt =
                            crate::storage::engine::services::resolve_structured_format_at_cell(
                                mirror, sheet_id, row, col,
                            );
                        let empty_cell_id_hex = String::new();
                        let mut effective = properties::get_effective_format(
                            &engine.stores.storage,
                            sheet_id,
                            &empty_cell_id_hex,
                            row,
                            col,
                            table_fmt.as_ref(),
                            engine.stores.grid_indexes.get(sheet_id),
                            sheet_mirror,
                        );
                        domain_types::theme_color::resolve_theme_refs(
                            &mut effective,
                            &engine.settings.theme_palette,
                        );
                        let format_code = effective.number_format.as_deref().unwrap_or("General");
                        let format_result =
                            compute_formats::format_value(&value, format_code, locale);
                        let formatted = format_result.text;

                        let formula = mirror.cse_anchor_covering(sheet_id, row, col).and_then(
                            |(anchor_id, _)| formula_text_for_cell(engine, mirror, &anchor_id),
                        );

                        visitor(CellVisit {
                            row,
                            col,
                            cell_id: None,
                            value,
                            formatted,
                            formula,
                            is_projection: true,
                            effective_format: effective,
                        });
                    }
                } else if include_format_only && (has_row_fmt || has_col_fmt || has_range_fmt) {
                    // No cell_id, no spill value — but explicit row/column
                    // format exists that should be visible to the API.
                    let table_fmt =
                        crate::storage::engine::services::resolve_structured_format_at_cell(
                            mirror, sheet_id, row, col,
                        );
                    let empty_cell_id_hex = String::new();
                    let mut effective = properties::get_effective_format(
                        &engine.stores.storage,
                        sheet_id,
                        &empty_cell_id_hex,
                        row,
                        col,
                        table_fmt.as_ref(),
                        engine.stores.grid_indexes.get(sheet_id),
                        sheet_mirror,
                    );
                    domain_types::theme_color::resolve_theme_refs(
                        &mut effective,
                        &engine.settings.theme_palette,
                    );

                    visitor(CellVisit {
                        row,
                        col,
                        cell_id: None,
                        value: CellValue::Null,
                        formatted: String::new(),
                        formula: None,
                        is_projection: false,
                        effective_format: effective,
                    });
                }
            }
        }
    }
}
