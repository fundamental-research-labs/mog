use std::collections::HashMap;

use cell_types::SheetId;
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::schema::KEY_CELLS;
use compute_wire::flags as render_flags;
use value_types::CellValue;
use yrs::{Map, Out, Transact};

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

fn read_cell_rich_string(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
) -> Option<domain_types::RichSharedString> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = stores.storage.doc().transact();
    let sheet_map = match stores.storage.sheets().get(&txn, &sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => return None,
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS) {
        Some(Out::YMap(map)) => map,
        _ => return None,
    };
    let cell_map = match cells_map.get(&txn, cell_id_hex) {
        Some(Out::YMap(map)) => map,
        _ => return None,
    };

    compute_document::cell_serde::read_rich_string_from_yrs(&cell_map, &txn)
}

fn workbook_theme_colors(theme_palette: &HashMap<String, String>) -> Vec<String> {
    const THEME_SLOT_ALIASES: &[&[&str]] = &[
        &["dk1", "dark1"],
        &["lt1", "light1"],
        &["dk2", "dark2"],
        &["lt2", "light2"],
        &["accent1"],
        &["accent2"],
        &["accent3"],
        &["accent4"],
        &["accent5"],
        &["accent6"],
        &["hlink", "hyperlink"],
        &["folHlink", "followedHyperlink"],
    ];

    let mut colors = Vec::with_capacity(THEME_SLOT_ALIASES.len());
    for aliases in THEME_SLOT_ALIASES {
        let Some(color) = aliases
            .iter()
            .find_map(|slot| theme_palette.get(*slot).cloned())
        else {
            return Vec::new();
        };
        colors.push(color);
    }
    colors
}

fn common_option<T, F>(runs: &[&domain_types::RichTextRun], value: F) -> Option<T>
where
    T: Clone + PartialEq,
    F: Fn(&domain_types::RichTextRun) -> Option<T>,
{
    let first = value(runs[0])?;
    if runs[1..]
        .iter()
        .all(|run| value(run).as_ref() == Some(&first))
    {
        Some(first)
    } else {
        None
    }
}

fn has_mixed_bool<F>(runs: &[&domain_types::RichTextRun], value: F) -> bool
where
    F: Fn(&domain_types::RichTextRun) -> bool,
{
    let first = value(runs[0]);
    runs[1..].iter().any(|run| value(run) != first)
}

fn has_mixed_option<T, F>(runs: &[&domain_types::RichTextRun], value: F) -> bool
where
    T: PartialEq,
    F: Fn(&domain_types::RichTextRun) -> Option<T>,
{
    let first = value(runs[0]);
    runs[1..].iter().any(|run| value(run) != first)
}

fn has_explicit_rich_font_style(run: &domain_types::RichTextRun) -> bool {
    run.font_name.is_some()
        || run.font_size.is_some()
        || run.color.is_some()
        || run.color_indexed.is_some()
        || run.color_theme.is_some()
        || run.color_tint.is_some()
        || run.bold
        || run.italic
        || run.underline
        || run.underline_style.is_some()
        || run.strikethrough
        || run.outline.is_some()
        || run.shadow.is_some()
        || run.condense.is_some()
        || run.extend.is_some()
        || run.charset.is_some()
        || run.family.is_some()
        || run.scheme.is_some()
        || run.vert_align.is_some()
}

fn rich_run_color(run: &domain_types::RichTextRun, theme_colors: &[String]) -> Option<String> {
    let color_input = domain_types::style_resolver::ColorInput {
        rgb: run.color.clone(),
        theme: run.color_theme,
        tint: run.color_tint,
        indexed: run.color_indexed,
        auto: false,
    };
    domain_types::style_resolver::resolve_color(&color_input, theme_colors).map(|color| {
        if color.starts_with('#') {
            color.to_ascii_uppercase()
        } else {
            color
        }
    })
}

fn common_explicit_rich_run_color(
    runs: &[&domain_types::RichTextRun],
    theme_colors: &[String],
) -> Option<String> {
    let mut colors = runs.iter().map(|run| rich_run_color(run, theme_colors));
    let first = colors.next()??;
    if colors.all(|color| color.as_deref() == Some(first.as_str())) {
        Some(first)
    } else {
        None
    }
}

fn rich_run_underline_type(
    run: &domain_types::RichTextRun,
) -> Option<ooxml_types::styles::UnderlineStyle> {
    if let Some(style) = run.underline_style {
        Some(style)
    } else if run.underline {
        Some(ooxml_types::styles::UnderlineStyle::Single)
    } else {
        None
    }
}

fn apply_rich_text_aggregate_font(
    format: &mut domain_types::CellFormat,
    rich_string: &domain_types::RichSharedString,
    theme_palette: &HashMap<String, String>,
) {
    let runs: Vec<_> = rich_string
        .runs
        .iter()
        .filter(|run| !run.text.trim().is_empty())
        .collect();
    if runs.is_empty() {
        return;
    }

    let theme_colors = workbook_theme_colors(theme_palette);
    let styled_runs: Vec<_> = runs
        .iter()
        .copied()
        .filter(|run| has_explicit_rich_font_style(run))
        .collect();
    let aggregate_runs = if styled_runs.is_empty() {
        runs.as_slice()
    } else {
        styled_runs.as_slice()
    };

    format.font_family = common_option(aggregate_runs, |run| run.font_name.clone());
    format.font_size = common_option(aggregate_runs, |run| {
        run.font_size.map(domain_types::FontSize::from_points)
    });
    format.font_color = common_explicit_rich_run_color(&runs, &theme_colors);
    format.font_color_tint = None;
    format.font_theme = common_option(aggregate_runs, |run| run.scheme.clone());
    format.font_charset = common_option(aggregate_runs, |run| run.charset);
    format.font_family_type = common_option(aggregate_runs, |run| run.family);

    if !styled_runs.is_empty() {
        let has_multiple_visible_runs = runs.len() > 1;
        if has_mixed_bool(&styled_runs, |run| run.bold) {
            format.bold = None;
        } else if has_multiple_visible_runs && styled_runs.iter().all(|run| run.bold) {
            format.bold = Some(true);
        }

        if has_mixed_bool(&styled_runs, |run| run.italic) {
            format.italic = None;
        } else if styled_runs.len() > 1 && styled_runs.iter().all(|run| run.italic) {
            format.italic = Some(true);
        }

        if has_mixed_option(&styled_runs, rich_run_underline_type) {
            format.underline_type = None;
        } else if has_multiple_visible_runs {
            format.underline_type = rich_run_underline_type(styled_runs[0]);
        }

        if has_mixed_bool(&styled_runs, |run| run.strikethrough) {
            format.strikethrough = None;
        } else if has_multiple_visible_runs && styled_runs.iter().all(|run| run.strikethrough) {
            format.strikethrough = Some(true);
        }

        if has_mixed_option(&styled_runs, |run| run.outline) {
            format.font_outline = None;
        }
        if has_mixed_option(&styled_runs, |run| run.shadow) {
            format.font_shadow = None;
        }
    }

    if has_mixed_option(aggregate_runs, |run| run.vert_align.clone()) {
        format.superscript = None;
        format.subscript = None;
    }
}

fn apply_cell_rich_text_aggregate_font(
    stores: &EngineStores,
    sheet_id: &SheetId,
    cell_id_hex: &str,
    value: &CellValue,
    format: &mut domain_types::CellFormat,
    theme_palette: &HashMap<String, String>,
) {
    let CellValue::Text(text) = value else {
        return;
    };
    let Some(rich_string) = read_cell_rich_string(stores, sheet_id, cell_id_hex) else {
        return;
    };
    if rich_string.plain_text != text.as_ref() {
        return;
    }

    apply_rich_text_aggregate_font(format, &rich_string, theme_palette);
}

pub(super) fn apply_pivot_display_format(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    format: &mut domain_types::CellFormat,
) {
    let Some(pivot_format) =
        crate::storage::engine::services::objects::resolve_pivot_format_at_cell(
            mirror, sheet_id, row, col,
        )
    else {
        return;
    };
    *format = properties::merge_formats(format, &pivot_format);
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
                        // Imported array/projection members can have concrete
                        // worksheet cells with their own XFs. Use that member
                        // identity when present; purely generated spill cells
                        // fall back to the formula anchor's format.
                        let anchor_id_hex = id_to_hex(proj.anchor_id.as_u128());
                        let format_cell_id_hex = grid
                            .cell_id_at(eff_row, eff_col)
                            .map(|cell_id| id_to_hex(cell_id.as_u128()))
                            .unwrap_or_else(|| anchor_id_hex.clone());
                        let table_fmt = resolve_table_format(sheet_id, row, col);
                        let mut effective = properties::get_effective_format(
                            &stores.storage,
                            sheet_id,
                            &format_cell_id_hex,
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
                        apply_cell_rich_text_aggregate_font(
                            stores,
                            sheet_id,
                            &format_cell_id_hex,
                            proj.value,
                            &mut effective,
                            &settings.theme_palette,
                        );
                        apply_pivot_display_format(mirror, sheet_id, row, col, &mut effective);
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
                        apply_cell_rich_text_aggregate_font(
                            stores,
                            sheet_id,
                            &cell_id_hex,
                            value,
                            &mut effective,
                            &settings.theme_palette,
                        );
                        apply_pivot_display_format(mirror, sheet_id, row, col, &mut effective);
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
                        apply_pivot_display_format(mirror, sheet_id, row, col, &mut positional_fmt);
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
