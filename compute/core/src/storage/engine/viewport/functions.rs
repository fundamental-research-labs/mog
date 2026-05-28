//! Extracted viewport service free functions.
//!
//! Each function receives only the sub-struct references it actually needs,
//! making borrow scopes explicit and enabling future parallelism.

use cell_types::{SheetId, SheetPos};
use chrono::Datelike;
use compute_wire::FormatPalette;
use compute_wire::ViewportBounds;
use compute_wire::mutation::CfColorOverrides;
use snapshot_types;
use snapshot_types::CellChange;
use value_types::{CellValue, ComputeError};

use super::render::color_to_u32;
use super::service::{ViewportRegistration, ViewportService};
use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use crate::storage::sheet::{comments, dimensions, hyperlinks, merges, sparklines};
use compute_cf::types::{CFUnderlineType, CellCFResult, DataBarResult, IconResult};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_wire::flags as render_flags;
use compute_wire::{
    CellCFExtras, DataBarRenderData, IconRenderData, RenderColDimension, RenderRowDimension,
    RenderViewportMerge, ViewportRenderCell, ViewportRenderData,
};
use domain_types::CellFormat;

// ---------------------------------------------------------------------------
// Viewport key helper
// ---------------------------------------------------------------------------

/// Derive a deterministic viewport key from a sheet ID.
///
/// Used by legacy `get_viewport_binary` / `get_viewport_binary_delta`
/// methods that don't take an explicit viewport_id.
pub(super) fn viewport_key_for_sheet(sheet_id: &SheetId) -> String {
    format!("__sheet_{}", sheet_id.to_uuid_string())
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

/// Register a named viewport with explicit bounds.
///
/// If a viewport with this ID already exists, it is replaced.
pub(super) fn register_viewport(
    viewport: &ViewportService,
    viewport_id: &str,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    viewport.registered_viewports_mut().insert(
        viewport_id.to_string(),
        ViewportRegistration {
            sheet_id: *sheet_id,
            bounds: ViewportBounds {
                start_row,
                start_col,
                end_row,
                end_col,
            },
            palette_len: 0,
        },
    );
    Ok(MutationResult::empty())
}

/// Update the bounds of an already-registered viewport.
///
/// No-op if the viewport ID is not found.
pub(super) fn update_viewport_bounds(
    viewport: &ViewportService,
    viewport_id: &str,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if let Some(reg) = viewport.registered_viewports_mut().get_mut(viewport_id) {
        reg.bounds = ViewportBounds {
            start_row,
            start_col,
            end_row,
            end_col,
        };
    }
    Ok(MutationResult::empty())
}

/// Unregister a viewport by ID.
///
/// No-op if the viewport ID is not found.
pub(super) fn unregister_viewport(
    viewport: &ViewportService,
    viewport_id: &str,
) -> Result<MutationResult, ComputeError> {
    viewport.registered_viewports_mut().remove(viewport_id);
    Ok(MutationResult::empty())
}

/// Get all registered viewports.
///
/// Returns a list of `(viewport_id, sheet_id_hex, start_row, start_col, end_row, end_col)`.
pub(super) fn get_registered_viewports(
    viewport: &ViewportService,
) -> Vec<(String, String, u32, u32, u32, u32)> {
    viewport
        .registered_viewports()
        .iter()
        .map(|(id, reg)| {
            (
                id.clone(),
                reg.sheet_id.to_uuid_string(),
                reg.bounds.start_row,
                reg.bounds.start_col,
                reg.bounds.end_row,
                reg.bounds.end_col,
            )
        })
        .collect()
}

/// Reset (unregister) all viewports for a given sheet.
pub(super) fn reset_sheet_viewports(
    viewport: &ViewportService,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    viewport
        .registered_viewports_mut()
        .retain(|_, reg| reg.sheet_id != *sheet_id);
    Ok(MutationResult::empty())
}

/// Reset viewport state for a sheet (removes all viewports for this sheet).
pub(super) fn reset_viewport_state(
    viewport: &ViewportService,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    viewport
        .registered_viewports_mut()
        .retain(|_, reg| reg.sheet_id != *sheet_id);
    Ok(MutationResult::empty())
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/// Parse a date string using the workbook's locale conventions.
pub(super) fn parse_date_input(
    settings: &EngineSettings,
    text: &str,
) -> Option<compute_formats::ParsedDateInput> {
    let default_year = crate::eval::clock::current_calendar_date().year();
    compute_formats::parse_date_input_with_default_year(text, &settings.locale, default_year)
}

/// Format a batch of cell values using format codes and the workbook's locale.
pub(super) fn format_values(
    settings: &EngineSettings,
    entries: Vec<compute_formats::FormatEntry>,
) -> Vec<String> {
    compute_formats::format_values_batch(&entries, &settings.locale)
}

// ---------------------------------------------------------------------------
// CF color overrides
// ---------------------------------------------------------------------------

/// Build a [`CfColorOverrides`] map from the CF cache for a given sheet.
///
/// Replicates the same priority logic used by `viewport_render.rs`:
/// - `bg_color_override`: color_scale > style.background_color
/// - `font_color_override`: style.font_color
///
/// Returns `None` if the sheet has no CF cache entry.
pub(super) fn build_cf_color_overrides(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<CfColorOverrides> {
    let cache_entry = stores.cf_cache.get(sheet_id)?;
    if cache_entry.results.is_empty() {
        return None;
    }
    let mut overrides = CfColorOverrides::with_capacity(cache_entry.results.len());
    for (&(row, col), cf_result) in &cache_entry.results {
        let mut bg: u32 = 0;
        let mut fc: u32 = 0;

        // Background color: color_scale takes priority over style.background_color
        if let Some(cs) = &cf_result.color_scale {
            bg = color_to_u32(&cs.color);
        } else if let Some(style) = &cf_result.style
            && let Some(ref bg_color) = style.background_color
        {
            bg = color_to_u32(bg_color);
        }

        // Font color
        if let Some(style) = &cf_result.style
            && let Some(ref font_color) = style.font_color
        {
            fc = color_to_u32(font_color);
        }

        if bg != 0 || fc != 0 {
            overrides.insert(row, col, bg, fc);
        }
    }
    if overrides.is_empty() {
        None
    } else {
        Some(overrides)
    }
}

// ---------------------------------------------------------------------------
// CF → CellFormat merge (6th cascade layer)
// ---------------------------------------------------------------------------

/// Apply CF (the 6th and final cascade layer) to `fmt` for the cell at
/// (row, col).
///
/// CF rules are **range-scoped** and the cf_cache is keyed by `(row, col)`
/// independently of CellId allocation — they apply equally to cells with
/// values and to truly-blank cells (e.g. a `containsBlanks` rule painting
/// otherwise-empty rows). Callers MUST NOT gate this on `cell_id.is_some()`;
/// every read path that materializes a displayed CellFormat must funnel
/// through this helper.
pub(crate) fn apply_cf_to_format(
    cf_cache_entry: Option<&super::super::stores::CFCacheEntry>,
    fmt: &mut CellFormat,
    row: u32,
    col: u32,
) {
    if let Some(cache_entry) = cf_cache_entry
        && let Some(cf_result) = cache_entry.results.get(&(row, col))
    {
        merge_cf_into_format(fmt, cf_result);
    }
}

/// Apply number-format section color (e.g. `[Red]`) to the effective format.
/// Priority: CF font_color > number_format_color > stored font_color.
pub(crate) fn apply_number_format_color(
    effective: &mut CellFormat,
    format_color: &compute_formats::color::FormatColor,
    cf_cache_entry: Option<&super::super::stores::CFCacheEntry>,
    row: u32,
    col: u32,
) {
    let cf_overrides = cf_cache_entry
        .and_then(|ce| ce.results.get(&(row, col)))
        .and_then(|cr| cr.style.as_ref())
        .and_then(|s| s.font_color.as_ref())
        .is_some();
    if !cf_overrides {
        effective.font_color = Some(format_color.to_hex().to_string());
    }
}

/// Merge CF evaluation results into an effective CellFormat.
///
/// CF is the 6th and highest-priority layer in the format cascade:
/// default → column → row → table → cell → CF
///
/// Only `Some` fields in CfRenderStyle override — `None` fields leave the base untouched.
/// Color scale background takes priority over style background (matching Excel).
pub(crate) fn merge_cf_into_format(effective: &mut CellFormat, cf_result: &CellCFResult) {
    // Background color: color_scale > style.background_color
    if let Some(cs) = &cf_result.color_scale {
        effective.background_color = Some(cs.color.to_string());
    } else if let Some(style) = &cf_result.style
        && let Some(bg) = &style.background_color
    {
        effective.background_color = Some(bg.to_string());
    }

    // Style property overrides (font, number format, etc.)
    if let Some(style) = &cf_result.style {
        if let Some(fc) = &style.font_color {
            effective.font_color = Some(fc.to_string());
        }
        if let Some(b) = style.bold {
            effective.bold = Some(b);
        }
        if let Some(i) = style.italic {
            effective.italic = Some(i);
        }
        if let Some(ut) = &style.underline_type {
            effective.underline_type = Some(cf_underline_to_ooxml(ut));
        }
        if let Some(s) = style.strikethrough {
            effective.strikethrough = Some(s);
        }
        if let Some(nf) = &style.number_format {
            effective.number_format = Some(nf.clone());
        }
    }
}

fn cf_underline_to_ooxml(ut: &CFUnderlineType) -> ooxml_types::styles::UnderlineStyle {
    use ooxml_types::styles::UnderlineStyle;
    match ut {
        CFUnderlineType::None => UnderlineStyle::None,
        CFUnderlineType::Single => UnderlineStyle::Single,
        CFUnderlineType::Double => UnderlineStyle::Double,
        CFUnderlineType::SingleAccounting => UnderlineStyle::SingleAccounting,
        CFUnderlineType::DoubleAccounting => UnderlineStyle::DoubleAccounting,
    }
}

// =============================================================================
// Render helpers (moved from render.rs)
// =============================================================================

/// Convert a `DataBarResult` (compute-cf) to a `DataBarRenderData` (compute-wire).
fn data_bar_to_render(db: &DataBarResult) -> DataBarRenderData {
    DataBarRenderData {
        fill_percent: db.fill_percent as f32,
        color: color_to_u32(&db.color),
        is_negative: db.is_negative,
        gradient: db.gradient,
        show_value: db.show_value,
        show_axis: db.show_axis,
        axis_position: db.axis_position as f32,
        negative_color: db.negative_color.as_ref().map(color_to_u32).unwrap_or(0),
    }
}

/// Convert an `IconResult` (compute-cf) to an `IconRenderData` (compute-wire).
fn icon_to_render(icon: &IconResult) -> IconRenderData {
    IconRenderData {
        set_name_index: icon.set_name as u8,
        icon_index: icon.icon_index,
        icon_only: !icon.show_value, // invert: show_value → icon_only
    }
}

// =============================================================================
// Core viewport render data builder
// =============================================================================

/// Core viewport render data builder with all parameters.
///
/// When `show_formulas` is true, cells that have a formula will use the raw
/// formula string (e.g., `=SUM(A1:A10)`) as the `formatted` field instead of
/// the number-formatted display text.
///
/// `palette` is the pre-resolved `&mut FormatPalette` for the target sheet
/// (caller must create via `viewport.format_palettes.entry(sheet_id).or_insert_with(...)`).
/// `resolve_table_format` is a closure that resolves table-derived formatting for a cell.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_viewport_render_data_inner(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    palette: &mut FormatPalette,
    cf_cache_entry: Option<&super::super::CFCacheEntry>,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    palette_start_index: u16,
    show_formulas: bool,
    resolve_table_format: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> ViewportRenderData {
    let rows = end_row - start_row;
    let cols = end_col - start_col;

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

                        cells.push((effective, row, col, flags, number_value, formatted, error));
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

                        cells.push((effective, row, col, flags, number_value, formatted, error));
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
                        cells.push((
                            positional_fmt,
                            row,
                            col,
                            render_flags::VALUE_TYPE_NULL | sparkline_flag | hyperlink_flag,
                            f64::NAN,
                            None,
                            None,
                        ));
                    }
                }
            }
        }
    } else {
        // Grid not found for sheet — fill with nulls
        for row in start_row..end_row {
            for col in start_col..end_col {
                cells.push((
                    domain_types::CellFormat::default(),
                    row,
                    col,
                    render_flags::VALUE_TYPE_NULL,
                    f64::NAN,
                    None,
                    None,
                ));
            }
        }
    }

    // Now intern formats into the palette (mirror borrow released above).
    let mut render_cells: Vec<ViewportRenderCell> = cells
        .into_iter()
        .map(|(fmt, row, col, flags, number_value, formatted, error)| {
            let format_idx = palette.intern(&fmt).unwrap_or(0);
            ViewportRenderCell {
                row,
                col,
                format_idx,
                flags,
                number_value,
                formatted,
                error,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }
        })
        .collect();
    let format_palette = palette.formats_since(palette_start_index).to_vec();

    // --- CF extras only (data bars, icons) — style is already merged into CellFormat palette ---
    if let Some(cache_entry) = cf_cache_entry {
        for cell in &mut render_cells {
            if let Some(cf_result) = cache_entry.results.get(&(cell.row, cell.col)) {
                let has_data_bar = cf_result.data_bar.is_some();
                let has_icon = cf_result.icon.is_some();
                if has_data_bar || has_icon {
                    cell.cf_extras = Some(CellCFExtras {
                        data_bar: cf_result.data_bar.as_ref().map(data_bar_to_render),
                        icon: cf_result.icon.as_ref().map(icon_to_render),
                    });
                }
            }
        }
    }

    // --- Merges ---
    let render_merges: Vec<RenderViewportMerge> = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_merges_in_viewport(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            start_row,
            start_col,
            end_row,
            end_col,
        )
        .into_iter()
        .map(|r| RenderViewportMerge {
            start_row: r.start_row,
            start_col: r.start_col,
            end_row: r.end_row,
            end_col: r.end_col,
        })
        .collect(),
        None => Vec::new(),
    };

    // --- Row dimensions (pixels from LayoutIndex) ---
    let layout_index = stores.layout_indexes.get(sheet_id);
    let row_dimensions: Vec<RenderRowDimension> = (start_row..end_row)
        .map(|row| {
            let hidden = dimensions::is_row_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                row,
            );
            let height = layout_index
                .map(|li| li.get_row_height(row as usize))
                .unwrap_or(compute_layout_index::DEFAULT_ROW_HEIGHT);
            RenderRowDimension {
                row,
                height: if hidden { 0.0 } else { height.0 as f32 },
                hidden,
            }
        })
        .collect();

    // --- Column dimensions (pixels from LayoutIndex) ---
    let col_dimensions: Vec<RenderColDimension> = (start_col..end_col)
        .map(|col| {
            let hidden = dimensions::is_column_hidden(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                col,
            );
            let width = layout_index
                .map(|li| li.get_col_width(col as usize))
                .unwrap_or_else(compute_layout_index::platform_default_col_width);
            RenderColDimension {
                col,
                width: if hidden { 0.0 } else { width.0 as f32 },
                hidden,
            }
        })
        .collect();

    // --- Position arrays ---
    let row_positions = stores
        .layout_indexes
        .get(sheet_id)
        .map(|li| li.build_row_positions(start_row as usize, end_row as usize))
        .unwrap_or_default();
    let col_positions = stores
        .layout_indexes
        .get(sheet_id)
        .map(|li| li.build_col_positions(start_col as usize, end_col as usize))
        .unwrap_or_default();

    ViewportRenderData {
        cells: render_cells,
        format_palette,
        merges: render_merges,
        row_dimensions,
        col_dimensions,
        viewport_rows: rows,
        viewport_cols: cols,
        start_row,
        start_col,
        row_positions,
        col_positions,
    }
}

// =============================================================================
// Viewport patch helpers (extracted from patches.rs)
// =============================================================================

/// Build the changed cells for comment viewport patches.
///
/// Builds a list of `CellChange` entries for the given cells, using the cell's
/// current value and position. The `extra_flags` field carries `HAS_COMMENT`
/// when `has_comment` is true (add/existing) or 0 when false (delete).
pub(super) fn build_comment_changed_cells(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cells: &[(u32, u32)],
    has_comment: bool,
) -> Vec<CellChange> {
    let sheet_id_str = sheet_id.to_uuid_string();
    let extra_flags = if has_comment {
        compute_wire::flags::HAS_COMMENT
    } else {
        0
    };

    cells
        .iter()
        .map(|&(row, col)| {
            let pos = SheetPos::new(row, col);
            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);

            let cell_id_str = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .map(|cid| cid.to_uuid_string())
                .unwrap_or_default();

            CellChange {
                cell_id: cell_id_str,
                sheet_id: sheet_id_str.clone(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: None,
                extra_flags,
                old_value: None,
            }
        })
        .collect()
}

/// Build the changed cells for sparkline viewport patches.
///
/// Sparkline mutations affect only metadata flags. The cell value comes from
/// the current mirror state and `HAS_SPARKLINE` is derived from post-mutation
/// storage state so add/update/delete all serialize the correct bit.
pub(super) fn build_sparkline_changed_cells(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cells: &[(u32, u32)],
) -> Vec<CellChange> {
    let sheet_id_str = sheet_id.to_uuid_string();

    cells
        .iter()
        .map(|&(row, col)| {
            let pos = SheetPos::new(row, col);
            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);

            let cell_id_str = stores
                .grid_indexes
                .get(sheet_id)
                .and_then(|g| g.cell_id_at(row, col))
                .map(|cid| cid.to_uuid_string())
                .unwrap_or_default();

            let extra_flags = if crate::storage::sheet::sparklines::has_sparkline(
                stores.storage.doc(),
                &stores.storage.sheets_ref(),
                sheet_id,
                row,
                col,
            ) {
                compute_wire::flags::HAS_SPARKLINE
            } else {
                0
            };

            CellChange {
                cell_id: cell_id_str,
                sheet_id: sheet_id_str.clone(),
                position: Some(snapshot_types::CellPosition { row, col }),
                value,
                display_text: None,
                format_idx: None,
                extra_flags,
                old_value: None,
            }
        })
        .collect()
}

// =============================================================================
// Active cell data (extracted from mod.rs)
// =============================================================================

/// Get full data for the active cell (for toolbar/formula bar display).
///
/// Reads value, formula, format, metadata, edit text, formula hidden state,
/// hyperlink URL, and number format for the given cell.
pub(super) fn get_active_cell(
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

    // Get formula text from ComputeCore (A1-notation string), falling back to
    // the mirror's identity formula template.
    let formula = stores
        .compute
        .get_formula(&effective_cell_id)
        .map(|s| s.to_string())
        .or_else(|| {
            mirror
                .get_formula(&effective_cell_id)
                .map(|f| format!("={}", f.template))
        })
        .or_else(|| {
            effective_pos.and_then(|p| {
                crate::storage::engine::data_table_formula::formula_at(
                    mirror,
                    sheet_id,
                    p.row(),
                    p.col(),
                )
            })
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
        cm: props.cm,
        vm: props.vm,
        formula_result_type: props.formula_result_type,
        has_empty_cached_value: props.has_empty_cached_value,
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
