use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use value_types::CellValue;

use crate::mirror::CellMirror;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use crate::storage::sheet::{hyperlinks, merges};

pub(in crate::storage::engine::viewport) fn get_active_cell(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cell_id: &cell_types::CellId,
    is_sheet_protected: bool,
) -> crate::snapshot::ActiveCellData {
    // Merge-aware: if this cell is a child of a merge, redirect to origin
    let effective_cell_id = {
        let pos = mirror.resolve_position(cell_id);
        if let (Some(p), Some(grid)) = (pos, stores.grid_indexes.get(sheet_id)) {
            if let Some(merge_info) = merges::get_merge_for_cell(
                stores.storage.doc(),
                stores.storage.sheets(),
                *sheet_id,
                grid,
                p.row(),
                p.col(),
            ) {
                if !merge_info.is_origin {
                    grid.cell_id_at(merge_info.merge.start_row, merge_info.merge.start_col)
                        .unwrap_or(*cell_id)
                } else {
                    *cell_id
                }
            } else {
                *cell_id
            }
        } else {
            *cell_id
        }
    };
    let effective_pos = mirror.resolve_position(&effective_cell_id);

    // Prefer ComputeCore's value (includes formula results) over mirror's raw value.
    let value = stores
        .compute
        .get_cell_value(mirror, &effective_cell_id)
        .cloned()
        .unwrap_or_else(|| {
            mirror
                .get_cell_value_in_sheet(sheet_id, &effective_cell_id)
                .cloned()
                .unwrap_or(CellValue::Null)
        });

    let formula = effective_pos
        .and_then(|p| {
            crate::storage::engine::formula_read::formula_text_at(
                stores,
                mirror,
                sheet_id,
                p.row(),
                p.col(),
                Some(&effective_cell_id),
            )
        })
        .or_else(|| {
            crate::storage::engine::formula_read::formula_text_for_cell_id(
                stores,
                mirror,
                sheet_id,
                &effective_cell_id,
            )
        });

    // Resolve format and metadata from properties.
    let cell_id_hex = id_to_hex(cell_id.as_u128());
    let pos = mirror.resolve_position(cell_id);
    let table_fmt = pos.and_then(|p| {
        crate::storage::engine::services::tables::resolve_table_format_at_cell(
            mirror,
            sheet_id,
            p.row(),
            p.col(),
        )
    });

    let format = pos.and_then(|p| {
        let mut effective = properties::get_effective_format(
            &stores.storage,
            sheet_id,
            &cell_id_hex,
            p.row(),
            p.col(),
            table_fmt.as_ref(),
            stores.grid_indexes.get(sheet_id),
            mirror.get_sheet(sheet_id),
        );
        domain_types::theme_color::resolve_theme_refs(&mut effective, &settings.theme_palette);
        serde_json::to_value(effective).ok()
    });

    // Region metadata is derived from runtime mirror state, not from Yrs
    // properties — the projection registry + Data Table region rectangles
    // are populated at hydration / runtime. Excel `<f t="array">` on
    // hydration inserts into both the projection registry and
    // `mirror.cse_anchors`; XLSX `<f t="dataTable">` populates
    // `mirror.data_table_regions`. Post-hydration reads see consistent
    // shapes via the unified `cell_render_at` chokepoint.
    //
    // `is_array_formula`, `is_cse_anchor`, `is_array_member` are
    // back-compat fields — derived directly from `region` so the formula
    // bar's existing reads continue working. The new wire field is
    // `region: Option<RegionMeta>` carrying kind/anchor/bounds. There is
    // NO `source` field on `RegionMeta` — formula text stays on
    // `cellData.formula`. (D5 will swap the formula bar to read `region`
    // directly and deprecate the back-compat flags.)
    let region_meta: Option<crate::storage::properties::RegionMeta> = match pos {
        Some(p) => match mirror.cell_render_at(sheet_id, p.row(), p.col()) {
            crate::projection::CellRender::Projection(view) => {
                let kind = if view.is_cse {
                    crate::storage::properties::RegionKind::CseArray
                } else {
                    crate::storage::properties::RegionKind::ArraySpill
                };
                let bounds = mirror
                    .projection_registry
                    .get(&view.anchor_id)
                    .map(|p| crate::storage::properties::RegionBounds {
                        rows: p.rows,
                        cols: p.cols,
                    })
                    .unwrap_or(crate::storage::properties::RegionBounds { rows: 1, cols: 1 });
                Some(crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor: view.anchor_id == *cell_id,
                    anchor_row: view.anchor_row,
                    anchor_col: view.anchor_col,
                    bounds,
                })
            }
            crate::projection::CellRender::Plain(plain) => plain.region.map(|r| {
                // Bounds come from the `RegionRef` returned by the
                // chokepoint — no parallel `mirror.data_table_regions`
                // read from render code. The kind enum is forward-
                // compatible: today only `DataTable` is plumbed, but
                // the discriminant carries the future Pivot/TableColumn/
                // etc. when those land.
                let kind = match r.kind {
                    crate::projection::RegionKind::DataTable => {
                        crate::storage::properties::RegionKind::DataTable
                    }
                };
                crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor: r.is_anchor,
                    anchor_row: r.anchor_row,
                    anchor_col: r.anchor_col,
                    bounds: crate::storage::properties::RegionBounds {
                        rows: r.rows,
                        cols: r.cols,
                    },
                }
            }),
            crate::projection::CellRender::Materialized(_) => None,
            crate::projection::CellRender::Empty => None,
        },
        None => None,
    };

    // Back-compat flags derived from `region`. Existing formula-bar
    // readers (FormulaBarContainer.tsx) consume `isArrayFormula` and
    // `isCseAnchor`; D5 will swap them out for `region.kind`.
    let is_array_formula = region_meta.is_some();
    let is_cse_anchor = matches!(
        &region_meta,
        Some(r) if r.is_anchor && matches!(r.kind, crate::storage::properties::RegionKind::CseArray),
    );
    let is_array_member = matches!(&region_meta, Some(r) if !r.is_anchor);

    let metadata = properties::get_properties(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        &cell_id_hex,
    )
    .map(|props| crate::storage::properties::CellMetadata {
        provenance: props.provenance,
        validation: props.validation,
        connection_id: props.connection_id,
        style_id: props.style_id,
        cell_metadata_index: props.cell_metadata_index,
        vm: props.vm,
        phonetic: props.phonetic,
        date_lexical_value: props.date_lexical_value,
        formula_result_type: props.formula_result_type,
        has_empty_cached_value: props.has_empty_cached_value,
        formula_cache_provenance: props.formula_cache_provenance,
        original_sst_index: props.original_sst_index,
        original_value: props.original_value,
        is_array_formula: false,
        is_cse_anchor: false,
        is_array_member: false,
        region: None,
    })
    .map(|mut meta| {
        // Overlay the runtime-derived region/back-compat fields before
        // checking emptiness — if the cell is a region member but has no
        // Yrs-side metadata, we still want `metadata` to be emitted so
        // the formula bar can render `{=…}` braces.
        meta.is_array_formula = is_array_formula;
        meta.is_cse_anchor = is_cse_anchor;
        meta.is_array_member = is_array_member;
        meta.region = region_meta.clone();
        meta
    })
    .or_else(|| {
        if is_array_formula {
            Some(crate::storage::properties::CellMetadata {
                is_array_formula,
                is_cse_anchor,
                is_array_member,
                region: region_meta.clone(),
                ..Default::default()
            })
        } else {
            None
        }
    })
    .and_then(|meta| {
        if meta.is_empty() {
            None
        } else {
            serde_json::to_value(meta).ok()
        }
    });

    // Edit text for date/time cells.
    let edit_text = pos.and_then(|p| {
        let effective = properties::get_effective_format(
            &stores.storage,
            sheet_id,
            &cell_id_hex,
            p.row(),
            p.col(),
            table_fmt.as_ref(),
            stores.grid_indexes.get(sheet_id),
            mirror.get_sheet(sheet_id),
        );
        let format_code = effective.number_format.as_deref().unwrap_or("General");
        if compute_formats::is_date_format(format_code) {
            if let CellValue::Number(n) = &value {
                let edit_fmt = if compute_formats::is_time_only_format(format_code) {
                    "h:mm:ss AM/PM"
                } else if compute_formats::has_time_tokens(format_code)
                    && compute_formats::has_date_tokens(format_code)
                {
                    "M/d/yyyy h:mm:ss AM/PM"
                } else {
                    "M/d/yyyy"
                };
                Some(
                    compute_formats::format_value(
                        &CellValue::Number(*n),
                        edit_fmt,
                        &compute_formats::CultureInfo::default(),
                    )
                    .text,
                )
            } else {
                None
            }
        } else {
            None
        }
    });

    // Is formula hidden (sheet protected AND cell format has hidden flag).
    let is_formula_hidden = if is_sheet_protected {
        properties::is_formula_hidden(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            sheet_id,
            &cell_id_hex,
        )
    } else {
        false
    };

    // Hyperlink URL.
    let hyperlink_url = pos.and_then(|p| {
        let grid = stores.grid_indexes.get(sheet_id)?;
        hyperlinks::get_hyperlink(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            grid,
            p.row(),
            p.col(),
        )
    });

    // Number format from effective format.
    let number_format = pos.and_then(|p| {
        let effective = properties::get_effective_format(
            &stores.storage,
            sheet_id,
            &cell_id_hex,
            p.row(),
            p.col(),
            table_fmt.as_ref(),
            stores.grid_indexes.get(sheet_id),
            mirror.get_sheet(sheet_id),
        );
        effective.number_format
    });

    crate::snapshot::ActiveCellData {
        cell_id: cell_id.to_uuid_string(),
        value,
        formula,
        format,
        metadata,
        edit_text,
        is_formula_hidden,
        hyperlink_url,
        number_format,
    }
}
