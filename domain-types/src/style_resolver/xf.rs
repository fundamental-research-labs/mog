use crate::{DocumentFormat, FontFormat, ProtectionFormat};

use super::{
    components::{resolve_alignment, resolve_border, resolve_fill, resolve_font},
    input::{CellXfInput, StyleInput},
    number_format::resolve_number_format,
};

/// Resolve a single XF record into a `DocumentFormat` by direct table lookups only.
///
/// This resolves font/fill/border/numFmt/alignment/protection from the shared tables
/// WITHOUT looking at `xf_id` inheritance. Used for both cellStyleXfs base resolution
/// and as the direct-properties step of cellXfs resolution.
pub(super) fn resolve_xf_direct(xf: &CellXfInput, input: &StyleInput) -> DocumentFormat {
    let mut fmt = DocumentFormat::default();

    // --- Number format ---
    let num_fmt_id = xf.num_fmt_id.unwrap_or(0);
    if num_fmt_id != 0
        && let Some(code) = resolve_number_format(num_fmt_id, &input.num_fmts)
        && code != "General"
    {
        fmt.number_format = Some(code);
    }

    // --- Font ---
    let font_id = xf.font_id.unwrap_or(0);
    if let Some(font) = input.fonts.get(font_id as usize) {
        let ff = resolve_font(
            font,
            &input.theme_colors,
            input.major_font.as_deref(),
            input.minor_font.as_deref(),
        );
        if ff != FontFormat::default() {
            fmt.font = Some(ff);
        }
    }

    // --- Fill ---
    let fill_id = xf.fill_id.unwrap_or(0);
    if let Some(fill) = input.fills.get(fill_id as usize)
        && let Some(ff) = resolve_fill(fill, &input.theme_colors)
    {
        fmt.fill = Some(ff);
    }

    // --- Border ---
    let border_id = xf.border_id.unwrap_or(0);
    if let Some(border) = input.borders.get(border_id as usize)
        && let Some(bf) = resolve_border(border, &input.theme_colors)
    {
        fmt.border = Some(bf);
    }

    // --- Alignment ---
    if let Some(ref alignment) = xf.alignment
        && let Some(af) = resolve_alignment(alignment)
    {
        fmt.alignment = Some(af);
    }

    // --- Protection ---
    if let Some(ref prot) = xf.protection {
        let pf = ProtectionFormat {
            locked: Some(prot.locked),
            hidden: if prot.hidden { Some(true) } else { None },
        };
        fmt.protection = Some(pf);
    }

    if xf.quote_prefix {
        fmt.quote_prefix = Some(true);
    }
    if xf.pivot_button {
        fmt.pivot_button = Some(true);
    }

    fmt
}

/// Check whether a cellXfs record says to apply (override) a given property.
///
/// The OOXML `apply_*` flags control inheritance from cellStyleXfs → cellXfs.
/// When `apply_*` is `Some(true)`, the cellXfs value overrides the base.
/// When `apply_*` is `None`, we fall back to checking whether the ID is non-zero
/// (pragmatic heuristic — many producers omit the flags).
fn should_apply_font(xf: &CellXfInput) -> bool {
    xf.apply_font.unwrap_or(xf.font_id.unwrap_or(0) != 0)
}
fn should_apply_fill(xf: &CellXfInput) -> bool {
    xf.apply_fill.unwrap_or(xf.fill_id.unwrap_or(0) != 0)
}
fn should_apply_border(xf: &CellXfInput) -> bool {
    xf.apply_border.unwrap_or(xf.border_id.unwrap_or(0) != 0)
}
fn should_apply_number_format(xf: &CellXfInput) -> bool {
    xf.apply_number_format
        .unwrap_or(xf.num_fmt_id.unwrap_or(0) != 0)
}
fn should_apply_alignment(xf: &CellXfInput) -> bool {
    xf.apply_alignment.unwrap_or(xf.alignment.is_some())
}
fn should_apply_protection(xf: &CellXfInput) -> bool {
    xf.apply_protection.unwrap_or(xf.protection.is_some())
}

/// Resolve a single CellXf record into a `DocumentFormat` with cellStyleXfs inheritance.
///
/// Returns `None` if the format has no meaningful properties (equals default).
pub(super) fn resolve_single_xf(xf: &CellXfInput, input: &StyleInput) -> Option<DocumentFormat> {
    // 1. Resolve the base style from cellStyleXfs (if xf_id is present).
    let base = xf
        .xf_id
        .and_then(|id| input.cell_style_xfs.get(id as usize))
        .map(|base_xf| resolve_xf_direct(base_xf, input))
        .unwrap_or_default();

    // 2. Resolve direct properties from this XF's table references.
    let direct = resolve_xf_direct(xf, input);

    // 3. Merge: for each property, use direct if apply_* says override, else inherit base.
    let fmt = DocumentFormat {
        number_format: if should_apply_number_format(xf) {
            direct.number_format
        } else {
            base.number_format
        },
        font: if should_apply_font(xf) {
            direct.font
        } else {
            base.font
        },
        fill: if should_apply_fill(xf) {
            direct.fill
        } else {
            base.fill
        },
        border: if should_apply_border(xf) {
            direct.border
        } else {
            base.border
        },
        alignment: if should_apply_alignment(xf) {
            direct.alignment
        } else {
            base.alignment
        },
        protection: if should_apply_protection(xf) {
            direct.protection
        } else {
            base.protection
        },
        quote_prefix: direct.quote_prefix.or(base.quote_prefix),
        pivot_button: direct.pivot_button.or(base.pivot_button),
    };

    if fmt == DocumentFormat::default() {
        None
    } else {
        Some(fmt)
    }
}
