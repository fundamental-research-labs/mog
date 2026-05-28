//! Style resolution: StylesOutput -> StyleInput for the domain-types style resolver.
//!
//! UTF-8 boundary guard: the single `&s[n..]` slice in this file splits an
//! ASCII-only color / style token at a fixed byte offset. Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

use domain_types::style_resolver::{
    AlignmentInput, BorderInput, BorderSideInput, CellXfInput, ColorInput, FillInput, FontInput,
    GradientFillInput, GradientStopInput, ProtectionInput, StyleInput,
};

use crate::output::results::{
    AlignmentOutput, BorderOutput, BorderSideOutput, CellProtectionOutput, CellXfOutput,
    ColorOutput, FillOutput, FontOutput, FullParseResult, StylesOutput,
};

/// Build the `StyleInput` that the domain-types style resolver expects.
pub(super) fn build_style_input(styles: &StylesOutput, result: &FullParseResult) -> StyleInput {
    let fonts: Vec<FontInput> = styles.fonts.iter().map(convert_font_to_input).collect();
    let fills: Vec<FillInput> = styles.fills.iter().map(convert_fill_to_input).collect();
    let borders: Vec<BorderInput> = styles.borders.iter().map(convert_border_to_input).collect();
    let cell_xfs: Vec<CellXfInput> = styles.cell_xfs.iter().map(convert_xf_to_input).collect();
    let cell_style_xfs: Vec<CellXfInput> = styles
        .cell_style_xfs
        .iter()
        .map(convert_xf_to_input)
        .collect();

    let num_fmts: HashMap<u32, String> = styles
        .number_formats
        .iter()
        .map(|nf| (nf.id, nf.format_code.clone()))
        .collect();

    let theme_colors = extract_theme_color_palette(result);
    let (major_font, minor_font) = extract_theme_fonts(result);

    StyleInput {
        cell_xfs,
        cell_style_xfs,
        fonts,
        fills,
        borders,
        num_fmts,
        theme_colors,
        major_font,
        minor_font,
    }
}

pub(super) fn convert_font_to_input(f: &FontOutput) -> FontInput {
    FontInput {
        name: f.name.clone(),
        size: f.size,
        bold: f.bold,
        italic: f.italic,
        underline: f.underline.map(|u| u.to_ooxml().to_string()),
        strikethrough: f.strikethrough,
        color: f.color.as_ref().map(convert_color_to_input),
        scheme: f.scheme.clone(),
        vert_align: f.vert_align.clone(),
        condense: f.condense,
        extend: f.extend,
        outline: f.outline,
        shadow: f.shadow,
        charset: None,
        family: f.family,
    }
}

pub(super) fn convert_fill_to_input(f: &FillOutput) -> FillInput {
    FillInput {
        fill_type: f.fill_type.clone(),
        pattern_type: f.pattern_type.to_ooxml().to_string(),
        fg_color: f.fg_color.as_ref().map(convert_color_to_input),
        bg_color: f.bg_color.as_ref().map(convert_color_to_input),
        gradient: f.gradient.as_ref().map(convert_gradient_to_input),
    }
}

fn convert_gradient_to_input(g: &crate::output::results::GradientFillOutput) -> GradientFillInput {
    GradientFillInput {
        gradient_type: g.gradient_type.clone(),
        degree: g.degree,
        stops: g
            .stops
            .iter()
            .map(|s| GradientStopInput {
                position: s.position,
                color: convert_color_to_input(&s.color),
            })
            .collect(),
        left: g.left,
        right: g.right,
        top: g.top,
        bottom: g.bottom,
    }
}

pub(super) fn convert_border_to_input(b: &BorderOutput) -> BorderInput {
    BorderInput {
        left: b.left.as_ref().map(convert_border_side_to_input),
        right: b.right.as_ref().map(convert_border_side_to_input),
        top: b.top.as_ref().map(convert_border_side_to_input),
        bottom: b.bottom.as_ref().map(convert_border_side_to_input),
        diagonal: b.diagonal.as_ref().map(convert_border_side_to_input),
        diagonal_up: b.diagonal_up,
        diagonal_down: b.diagonal_down,
    }
}

pub(super) fn convert_border_side_to_input(s: &BorderSideOutput) -> BorderSideInput {
    BorderSideInput {
        style: s.style.to_ooxml().to_string(),
        color: s.color.as_ref().map(convert_color_to_input),
    }
}

pub(super) fn convert_color_to_input(c: &ColorOutput) -> ColorInput {
    ColorInput {
        rgb: c.rgb.clone(),
        theme: c.theme,
        tint: c.tint,
        indexed: c.indexed,
        auto: c.auto,
    }
}

pub(super) fn convert_xf_to_input(xf: &CellXfOutput) -> CellXfInput {
    CellXfInput {
        font_id: xf.font_id,
        fill_id: xf.fill_id,
        border_id: xf.border_id,
        num_fmt_id: xf.number_format_id,
        xf_id: xf.xf_id,
        apply_font: xf.apply_font,
        apply_fill: xf.apply_fill,
        apply_border: xf.apply_border,
        apply_number_format: xf.apply_number_format,
        apply_alignment: xf.apply_alignment,
        apply_protection: xf.apply_protection,
        alignment: xf.alignment.as_ref().map(convert_alignment_to_input),
        protection: xf.protection.as_ref().map(convert_protection_to_input),
        quote_prefix: xf.quote_prefix,
        pivot_button: xf.pivot_button,
    }
}

pub(super) fn convert_alignment_to_input(a: &AlignmentOutput) -> AlignmentInput {
    AlignmentInput {
        horizontal: a.horizontal.map(|h| h.to_ooxml().to_string()),
        vertical: a.vertical.map(|v| v.to_ooxml().to_string()),
        wrap_text: a.wrap_text,
        text_rotation: a.text_rotation.map(|t| t as u32),
        indent: a.indent,
        shrink_to_fit: a.shrink_to_fit,
        reading_order: a.reading_order,
        auto_indent: a.auto_indent,
        relative_indent: a.relative_indent,
        justify_last_line: a.justify_last_line,
    }
}

pub(super) fn convert_protection_to_input(p: &CellProtectionOutput) -> ProtectionInput {
    ProtectionInput {
        locked: p.locked,
        hidden: p.hidden,
    }
}

// =============================================================================
// Theme font extraction
// =============================================================================

/// Extract theme major/minor font names from the typed theme font scheme.
fn extract_theme_fonts(result: &FullParseResult) -> (Option<String>, Option<String>) {
    match result.theme_font_scheme.as_ref() {
        Some(fonts) => (
            Some(fonts.major_font.latin.typeface.clone()),
            Some(fonts.minor_font.latin.typeface.clone()),
        ),
        None => (None, None),
    }
}

// =============================================================================
// Theme color extraction
// =============================================================================

/// Extract theme colors as resolved "#RRGGBB" strings for the style resolver.
///
/// Returns a Vec of 12 colors in clrScheme child order:
/// [dk1, lt1, dk2, lt2, accent1..accent6, hyperlink, followedHyperlink]
///
/// Uses the typed `theme_color_scheme` field with `resolve_hex()` to get sRGB values.
pub(super) fn extract_theme_color_palette(result: &FullParseResult) -> Vec<String> {
    let Some(cs) = result.theme_color_scheme.as_ref() else {
        return Vec::new();
    };

    (0u8..12)
        .map(|idx| {
            cs.resolve_hex(idx)
                .map(|hex| normalize_rgb_color(&hex))
                .unwrap_or_else(|| "#000000".to_string())
        })
        .collect()
}

pub(super) fn normalize_rgb_color(s: &str) -> String {
    if s.starts_with('#') {
        s.to_string()
    } else if s.len() == 8 {
        // ARGB: strip alpha
        format!("#{}", &s[2..])
    } else {
        format!("#{s}")
    }
}
