use crate::{AlignmentFormat, DocumentFormat, FillFormat, FontFormat, ProtectionFormat};

use super::{
    components::{resolve_alignment, resolve_border, resolve_fill, resolve_font},
    input::{AlignmentInput, CellXfInput, FontInput, StyleInput},
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
    xf.apply_number_format.unwrap_or(xf.num_fmt_id.is_some())
}
fn should_apply_alignment(xf: &CellXfInput) -> bool {
    xf.apply_alignment.unwrap_or(xf.alignment.is_some())
}
fn should_apply_protection(xf: &CellXfInput) -> bool {
    xf.apply_protection.unwrap_or(xf.protection.is_some())
}

fn resolve_applied_number_format(xf: &CellXfInput, input: &StyleInput) -> Option<String> {
    resolve_number_format(xf.num_fmt_id.unwrap_or(0), &input.num_fmts)
}

fn resolve_applied_font(xf: &CellXfInput, input: &StyleInput) -> Option<FontFormat> {
    let font_id = xf.font_id.unwrap_or(0);
    input.fonts.get(font_id as usize).map(|font| {
        let mut fmt = resolve_font(
            font,
            &input.theme_colors,
            input.major_font.as_deref(),
            input.minor_font.as_deref(),
        );
        complete_applied_font(&mut fmt, font);
        fmt
    })
}

fn resolve_applied_fill(xf: &CellXfInput, input: &StyleInput) -> Option<FillFormat> {
    let fill_id = xf.fill_id.unwrap_or(0);
    input.fills.get(fill_id as usize).and_then(|fill| {
        if fill.fill_type == "pattern" && fill.pattern_type == "none" {
            Some(explicit_no_fill())
        } else {
            resolve_fill(fill, &input.theme_colors)
        }
    })
}

fn explicit_no_fill() -> FillFormat {
    FillFormat {
        background_color: None,
        background_color_tint: None,
        pattern_type: Some("none".to_string()),
        pattern_foreground_color: None,
        pattern_foreground_color_tint: None,
        gradient_fill: None,
    }
}

fn complete_applied_font(fmt: &mut FontFormat, font: &FontInput) {
    fmt.bold = Some(font.bold);
    fmt.italic = Some(font.italic);
    fmt.strikethrough = Some(font.strikethrough);
    fmt.underline = Some(font.underline.as_deref().unwrap_or("none").to_string());

    // In an applied font component, absent vertical-alignment effects mean
    // baseline text, not inheritance from a lower-priority row or column style.
    if font.vert_align.is_none() {
        fmt.superscript = Some(false);
        fmt.subscript = Some(false);
        fmt.vertical_align = Some("baseline".to_string());
    }
}

fn resolve_applied_alignment(xf: &CellXfInput) -> Option<AlignmentFormat> {
    xf.alignment.as_ref().map(|alignment| {
        let mut fmt = resolve_alignment(alignment).unwrap_or_default();
        complete_applied_alignment(&mut fmt, alignment);
        fmt
    })
}

fn complete_applied_alignment(fmt: &mut AlignmentFormat, alignment: &AlignmentInput) {
    fmt.horizontal.get_or_insert_with(|| "general".to_string());
    fmt.vertical.get_or_insert_with(|| "bottom".to_string());
    fmt.wrap_text = Some(alignment.wrap_text.unwrap_or(false));
    fmt.rotation = Some(alignment.text_rotation.unwrap_or(0) as i32);
    fmt.indent = Some(alignment.indent.unwrap_or(0));
    fmt.shrink_to_fit = Some(alignment.shrink_to_fit.unwrap_or(false));
    if alignment.reading_order.is_none() {
        fmt.reading_order = Some("context".to_string());
    }
    fmt.auto_indent = Some(alignment.auto_indent.unwrap_or(false));
    fmt.relative_indent = Some(alignment.relative_indent.unwrap_or(0));
    fmt.justify_last_line = Some(alignment.justify_last_line.unwrap_or(false));
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
            resolve_applied_number_format(xf, input)
        } else {
            base.number_format
        },
        font: if should_apply_font(xf) {
            resolve_applied_font(xf, input)
        } else {
            base.font
        },
        fill: if should_apply_fill(xf) {
            resolve_applied_fill(xf, input)
        } else {
            base.fill
        },
        border: if should_apply_border(xf) {
            direct.border
        } else {
            base.border
        },
        alignment: if should_apply_alignment(xf) {
            resolve_applied_alignment(xf)
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
