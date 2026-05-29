use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_wire::flags as render_flags;
use value_types::CellValue;

use super::cf_format::{apply_cf_to_format, apply_number_format_color};
use super::materialized_cells::build_materialized_cell_material;
use crate::mirror::CellMirror;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::{CFCacheEntry, EngineStores};
use crate::storage::properties;
use crate::storage::sheet::{comments, hyperlinks, merges, sparklines};

pub(super) struct RenderCellMaterial {
    pub(super) format: domain_types::CellFormat,
    pub(super) row: u32,
    pub(super) col: u32,
    pub(super) flags: u16,
    pub(super) number_value: f64,
    pub(super) formatted: Option<String>,
    pub(super) error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_render_cell_materials(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    cf_cache_entry: Option<&CFCacheEntry>,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    rows: u32,
    cols: u32,
    show_formulas: bool,
    resolve_table_format: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> Vec<RenderCellMaterial> {
    let locale = &settings.locale;

    let mut cells = Vec::with_capacity((rows * cols) as usize);

    // Build a set of cell IDs that have comments in the viewport,
    // so we can check per-cell without repeated full scans.
    let comment_cell_ids: std::collections::HashSet<u128> = {
        let cell_id_hexes = comments::get_cell_ids_with_comments(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
        );
        cell_id_hexes
            .iter()
            .filter_map(|hex| hex_to_id(hex))
            .collect()
    };

    // Iterate in dense row-major order
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        // Build merge child→origin lookup for this viewport
        let merge_origins: std::collections::HashMap<(u32, u32), (u32, u32)> = {
            let all_merges = merges::get_all_merges(
                stores.storage.doc(),
                stores.storage.sheets(),
                *sheet_id,
                grid,
            );
            let mut map = std::collections::HashMap::new();
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

        for row in start_row..end_row {
            for col in start_col..end_col {
                // Merge child cells render against the merge origin's identity
                // and format. The lookup row/col below is the *effective*
                // position after redirect; `cell_render_at` operates on it
                // uniformly and returns either a Projection / Plain / Empty
                // view of that origin. Positional-cascade lookups (CF,
                // sparkline, hyperlink) keep using the visible (row, col)
                // because those are range-keyed, not identity-keyed.
                let (eff_row, eff_col) = merge_origins
                    .get(&(row, col))
                    .copied()
                    .unwrap_or((row, col));

                let render = mirror.cell_render_at(sheet_id, eff_row, eff_col);

                let mut sparkline_flag = 0u16;
                if sparklines::has_sparkline(
                    stores.storage.doc(),
                    &stores.storage.sheets_ref(),
                    sheet_id,
                    row,
                    col,
                ) {
                    sparkline_flag |= render_flags::HAS_SPARKLINE;
                }
                let mut hyperlink_flag = 0u16;
                if hyperlinks::get_hyperlink(
                    stores.storage.doc(),
                    stores.storage.sheets(),
                    sheet_id,
                    grid,
                    row,
                    col,
                )
                .is_some()
                {
                    hyperlink_flag |= render_flags::HAS_HYPERLINK;
                }

                match render {
                    crate::projection::CellRender::Projection(proj) => {
                        // Format inheritance: anchor-keyed cell format as the
                        // CellId-cascade base, then positional cascade at
                        // (row, col) layered on top by `get_effective_format`.
                        let anchor_id_hex = id_to_hex(proj.anchor_id.as_u128());
                        let table_fmt = resolve_table_format(sheet_id, row, col);
                        let mut effective = properties::get_effective_format(
                            &stores.storage,
                            sheet_id,
                            &anchor_id_hex,
                            row,
                            col,
                            table_fmt.as_ref(),
                            stores.grid_indexes.get(sheet_id),
                            mirror.get_sheet(sheet_id),
                        );
                        domain_types::theme_color::resolve_theme_refs(
                            &mut effective,
                            &settings.theme_palette,
                        );
                        apply_cf_to_format(cf_cache_entry, &mut effective, row, col);

                        let formula_str = stores.compute.get_formula(&proj.anchor_id);

                        let format_code = effective.number_format.as_deref().unwrap_or("General");
                        let (formatted, format_color) = if show_formulas
                            && let Some(formula_str) = formula_str
                        {
                            (Some(formula_str.to_string()), None)
                        } else {
                            let fr = compute_formats::format_value(proj.value, format_code, locale);
                            (Some(fr.text), fr.color)
                        };
                        if let Some(ref color) = format_color {
                            apply_number_format_color(
                                &mut effective,
                                color,
                                cf_cache_entry,
                                row,
                                col,
                            );
                        }

                        let error = match proj.value {
                            CellValue::Error(e, _) => Some(e.as_str().to_string()),
                            CellValue::Image(image) => serde_json::to_string(image).ok(),
                            _ => None,
                        };

                        let mut flags: u16 = match proj.value {
                            CellValue::Null => render_flags::VALUE_TYPE_NULL,
                            CellValue::Number(_) => render_flags::VALUE_TYPE_NUMBER,
                            CellValue::Text(_) => render_flags::VALUE_TYPE_TEXT,
                            CellValue::Boolean(_) => render_flags::VALUE_TYPE_BOOL,
                            CellValue::Error(..) => render_flags::VALUE_TYPE_ERROR,
                            CellValue::Array(_) => render_flags::VALUE_TYPE_NUMBER,
                            CellValue::Control(_) => render_flags::VALUE_TYPE_BOOL,
                            CellValue::Image(_) => render_flags::VALUE_TYPE_IMAGE,
                        };
                        if matches!(proj.value, CellValue::Image(_)) {
                            flags |= render_flags::HAS_CELL_IMAGE;
                        }
                        // `HAS_FORMULA` means formula ownership. Dynamic-array
                        // spill members are values projected from the anchor:
                        // they carry `IS_SPILL_MEMBER` but do not own formula
                        // text. CSE members are the legacy exception: Excel
                        // treats every selected cell as belonging to the array
                        // formula, so they retain `HAS_FORMULA`.
                        let is_anchor = row == proj.anchor_row && col == proj.anchor_col;
                        if is_anchor || proj.is_cse {
                            flags |= render_flags::HAS_FORMULA;
                        }
                        if !is_anchor {
                            flags |= render_flags::IS_SPILL_MEMBER;
                        }
                        if comment_cell_ids.contains(&proj.anchor_id.as_u128()) && is_anchor {
                            flags |= render_flags::HAS_COMMENT;
                        }
                        flags |= sparkline_flag | hyperlink_flag;

                        let number_value = match proj.value {
                            CellValue::Number(n) => n.get(),
                            CellValue::Boolean(b) => {
                                if *b {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            _ => f64::NAN,
                        };

                        cells.push(RenderCellMaterial {
                            format: effective,
                            row,
                            col,
                            flags,
                            number_value,
                            formatted,
                            error,
                        });
                    }
                    crate::projection::CellRender::Plain(plain) => {
                        let cell_id = plain.cell_id;
                        let value = plain.value;
                        let region = plain.region;

                        let formula_str = stores.compute.get_formula(&cell_id);
                        // Region members (Data Table body cells today) belong to
                        // a region whose master holds the formula; treat the
                        // whole rectangle as having a formula so the formula
                        // bar renders `{=…}` braces uniformly across master and
                        // body. Body-cell formula text propagation is Stream
                        // D2's job — until that lands, body cells expose
                        // HAS_FORMULA but `formula_str` may be None for body.
                        let has_formula = formula_str.is_some()
                            || mirror.get_formula(&cell_id).is_some()
                            || region.is_some();

                        let cell_id_hex = id_to_hex(cell_id.as_u128());
                        let table_fmt = resolve_table_format(sheet_id, row, col);
                        let mut effective = properties::get_effective_format(
                            &stores.storage,
                            sheet_id,
                            &cell_id_hex,
                            row,
                            col,
                            table_fmt.as_ref(),
                            stores.grid_indexes.get(sheet_id),
                            mirror.get_sheet(sheet_id),
                        );

                        // No runtime formula format inheritance: a formula cell
                        // uses its OWN format. Excel applies operand-format
                        // inheritance at edit time, not display time, so the
                        // viewport-patch path here intentionally does not walk
                        // referenced cells. Keeping the stored format authoritative
                        // also makes `format_idx` and `display_text` agree on the
                        // wire (see fix-009 history).
                        domain_types::theme_color::resolve_theme_refs(
                            &mut effective,
                            &settings.theme_palette,
                        );
                        apply_cf_to_format(cf_cache_entry, &mut effective, row, col);

                        let is_null_no_formula = matches!(value, CellValue::Null) && !has_formula;
                        let format_code = effective.number_format.as_deref().unwrap_or("General");
                        let (formatted, format_color) = if is_null_no_formula {
                            (None, None)
                        } else if show_formulas && formula_str.is_some() {
                            (Some(formula_str.unwrap().to_string()), None)
                        } else {
                            let fr = compute_formats::format_value(value, format_code, locale);
                            (Some(fr.text), fr.color)
                        };
                        if let Some(ref color) = format_color {
                            apply_number_format_color(
                                &mut effective,
                                color,
                                cf_cache_entry,
                                row,
                                col,
                            );
                        }

                        let error = match value {
                            CellValue::Error(e, _) => Some(e.as_str().to_string()),
                            CellValue::Image(image) => serde_json::to_string(image).ok(),
                            _ => None,
                        };

                        let mut flags: u16 = match value {
                            CellValue::Null => render_flags::VALUE_TYPE_NULL,
                            CellValue::Number(_) => render_flags::VALUE_TYPE_NUMBER,
                            CellValue::Text(_) => render_flags::VALUE_TYPE_TEXT,
                            CellValue::Boolean(_) => render_flags::VALUE_TYPE_BOOL,
                            CellValue::Error(..) => render_flags::VALUE_TYPE_ERROR,
                            CellValue::Array(_) => render_flags::VALUE_TYPE_NUMBER,
                            CellValue::Control(_) => render_flags::VALUE_TYPE_BOOL,
                            CellValue::Image(_) => render_flags::VALUE_TYPE_IMAGE,
                        };
                        if matches!(value, CellValue::Image(_)) {
                            flags |= render_flags::HAS_CELL_IMAGE;
                        }
                        if has_formula {
                            flags |= render_flags::HAS_FORMULA;
                        }
                        // Region members (non-anchor cells of a Data Table)
                        // get IS_SPILL_MEMBER so the canvas paints the
                        // region-outline cue, mirroring CSE / dynamic-array
                        // behavior.
                        if let Some(r) = region
                            && !r.is_anchor
                        {
                            flags |= render_flags::IS_SPILL_MEMBER;
                        }
                        if comment_cell_ids.contains(&cell_id.as_u128()) {
                            flags |= render_flags::HAS_COMMENT;
                        }
                        flags |= sparkline_flag | hyperlink_flag;

                        let number_value = match value {
                            CellValue::Number(n) => n.get(),
                            CellValue::Boolean(b) => {
                                if *b {
                                    1.0
                                } else {
                                    0.0
                                }
                            }
                            _ => f64::NAN,
                        };

                        cells.push(RenderCellMaterial {
                            format: effective,
                            row,
                            col,
                            flags,
                            number_value,
                            formatted,
                            error,
                        });
                    }
                    crate::projection::CellRender::Materialized(materialized) => {
                        cells.push(build_materialized_cell_material(
                            stores,
                            mirror,
                            settings,
                            cf_cache_entry,
                            sheet_id,
                            row,
                            col,
                            materialized.value,
                            sparkline_flag,
                            hyperlink_flag,
                            resolve_table_format,
                        ));
                    }
                    crate::projection::CellRender::Empty => {
                        let mut positional_fmt = if let Some(cell_id) = grid.cell_id_at(row, col) {
                            let cell_id_hex = id_to_hex(cell_id.as_u128());
                            let table_fmt = resolve_table_format(sheet_id, row, col);
                            properties::get_effective_format(
                                &stores.storage,
                                sheet_id,
                                &cell_id_hex,
                                row,
                                col,
                                table_fmt.as_ref(),
                                stores.grid_indexes.get(sheet_id),
                                mirror.get_sheet(sheet_id),
                            )
                        } else {
                            properties::get_positional_format(
                                &stores.storage,
                                sheet_id,
                                row,
                                col,
                                stores.grid_indexes.get(sheet_id),
                                mirror.get_sheet(sheet_id),
                            )
                        };
                        domain_types::theme_color::resolve_theme_refs(
                            &mut positional_fmt,
                            &settings.theme_palette,
                        );
                        // CF is the 6th cascade layer — applies to truly-blank
                        // cells too (e.g. `containsBlanks` rules).
                        apply_cf_to_format(cf_cache_entry, &mut positional_fmt, row, col);
                        cells.push(RenderCellMaterial {
                            format: positional_fmt,
                            row,
                            col,
                            flags: render_flags::VALUE_TYPE_NULL | sparkline_flag | hyperlink_flag,
                            number_value: f64::NAN,
                            formatted: None,
                            error: None,
                        });
                    }
                }
            }
        }
    } else {
        // Grid not found for sheet — fill with nulls
        for row in start_row..end_row {
            for col in start_col..end_col {
                cells.push(RenderCellMaterial {
                    format: domain_types::CellFormat::default(),
                    row,
                    col,
                    flags: render_flags::VALUE_TYPE_NULL,
                    number_value: f64::NAN,
                    formatted: None,
                    error: None,
                });
            }
        }
    }

    cells
}
