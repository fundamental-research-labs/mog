use cell_types::SheetId;
use compute_cf::types::{CFUnderlineType, CellCFResult};
use compute_wire::mutation::CfColorOverrides;
use domain_types::CellFormat;

use super::super::render::color_to_u32;
use crate::storage::engine::stores::{CFCacheEntry, EngineStores};

pub(in crate::storage::engine::viewport) fn build_cf_color_overrides(
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
    cf_cache_entry: Option<&CFCacheEntry>,
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
    cf_cache_entry: Option<&CFCacheEntry>,
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
