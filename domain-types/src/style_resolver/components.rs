use crate::{
    AlignmentFormat, BorderFormat, BorderSide, FillFormat, FontFormat, GradientCenter,
    GradientFillFormat, GradientStopFormat,
};

use super::{color::resolve_color, input::*};

/// Resolve font input to `FontFormat`.
pub(super) fn resolve_font(
    font: &FontInput,
    theme_colors: &[String],
    major_font: Option<&str>,
    minor_font: Option<&str>,
) -> FontFormat {
    let mut ff = FontFormat::default();

    if font.bold {
        ff.bold = Some(true);
    }
    if font.italic {
        ff.italic = Some(true);
    }
    if let Some(ref u) = font.underline
        && u != "none"
    {
        ff.underline = Some(u.clone());
    }
    if font.strikethrough {
        ff.strikethrough = Some(true);
    }
    if font.size > 0.0 {
        ff.size = Some((font.size * 1000.0) as u32);
    }

    // Font scheme takes priority over font name — resolve to actual theme font name
    match font.scheme.as_deref() {
        Some("major") => {
            ff.scheme = Some("major".to_string());
            if let Some(name) = major_font {
                ff.name = Some(name.to_string());
            }
        }
        Some("minor") => {
            ff.scheme = Some("minor".to_string());
            if let Some(name) = minor_font {
                ff.name = Some(name.to_string());
            }
        }
        _ => {
            if !font.name.is_empty() {
                ff.name = Some(font.name.clone());
            }
        }
    }

    // Font color
    if let Some(ref color) = font.color {
        if let Some(c) = resolve_color(color, theme_colors) {
            ff.color = Some(c);
        }
        ff.color_tint = color.tint.filter(|&t| t != 0.0);
    }

    // Vertical alignment (superscript/subscript)
    match font.vert_align.as_deref() {
        Some("superscript") => {
            ff.superscript = Some(true);
            ff.vertical_align = Some("superscript".to_string());
        }
        Some("subscript") => {
            ff.subscript = Some(true);
            ff.vertical_align = Some("subscript".to_string());
        }
        Some("baseline") => {
            ff.vertical_align = Some("baseline".to_string());
        }
        _ => {}
    }

    ff.condense = font.condense;
    ff.extend = font.extend;
    ff.outline = font.outline;
    ff.shadow = font.shadow;

    // Charset and family
    ff.charset = font.charset;
    ff.family = font.family;

    ff
}

/// Resolve fill input to `FillFormat`. Returns `None` if no visible fill.
pub(super) fn resolve_fill(fill: &FillInput, theme_colors: &[String]) -> Option<FillFormat> {
    // Handle gradient fills
    if fill.fill_type == "gradient" {
        if let Some(ref grad) = fill.gradient {
            let stops: Vec<GradientStopFormat> = grad
                .stops
                .iter()
                .filter_map(|s| {
                    resolve_color(&s.color, theme_colors).map(|c| GradientStopFormat {
                        position: s.position,
                        color: c,
                    })
                })
                .collect();

            if stops.len() >= 2 {
                let gradient_type = if grad.gradient_type == "path" {
                    "path".to_string()
                } else {
                    "linear".to_string()
                };

                let center = if grad.gradient_type == "path" {
                    Some(GradientCenter {
                        left: grad.left.unwrap_or(0.5),
                        top: grad.top.unwrap_or(0.5),
                    })
                } else {
                    None
                };

                return Some(FillFormat {
                    background_color: None,
                    background_color_tint: None,
                    pattern_type: None,
                    pattern_foreground_color: None,
                    pattern_foreground_color_tint: None,
                    gradient_fill: Some(GradientFillFormat {
                        gradient_type,
                        degree: grad.degree,
                        center,
                        stops,
                    }),
                });
            }
        }
        return None;
    }

    if fill.fill_type != "pattern" {
        return None;
    }

    if fill.pattern_type == "solid" {
        // Solid fill: foreground color is the background color
        let bg = fill
            .fg_color
            .as_ref()
            .and_then(|c| resolve_color(c, theme_colors));
        let bg_tint = fill
            .fg_color
            .as_ref()
            .and_then(|c| c.tint)
            .filter(|&t| t != 0.0);
        if bg.is_some() {
            return Some(FillFormat {
                background_color: bg,
                background_color_tint: bg_tint,
                pattern_type: Some("solid".to_string()),
                pattern_foreground_color: None,
                pattern_foreground_color_tint: None,
                gradient_fill: None,
            });
        }
        return None;
    }

    if fill.pattern_type != "none" {
        let fg = fill
            .fg_color
            .as_ref()
            .and_then(|c| resolve_color(c, theme_colors));
        let fg_tint = fill
            .fg_color
            .as_ref()
            .and_then(|c| c.tint)
            .filter(|&t| t != 0.0);
        let bg = fill
            .bg_color
            .as_ref()
            .and_then(|c| resolve_color(c, theme_colors));
        let bg_tint = fill
            .bg_color
            .as_ref()
            .and_then(|c| c.tint)
            .filter(|&t| t != 0.0);

        return Some(FillFormat {
            pattern_type: Some(fill.pattern_type.clone()),
            pattern_foreground_color: fg,
            pattern_foreground_color_tint: fg_tint,
            background_color: bg,
            background_color_tint: bg_tint,
            gradient_fill: None,
        });
    }

    None
}

/// Resolve border input to `BorderFormat`. Returns `None` if no visible borders.
pub(super) fn resolve_border(
    border: &BorderInput,
    theme_colors: &[String],
) -> Option<BorderFormat> {
    let left = resolve_border_side(border.left.as_ref(), theme_colors);
    let right = resolve_border_side(border.right.as_ref(), theme_colors);
    let top = resolve_border_side(border.top.as_ref(), theme_colors);
    let bottom = resolve_border_side(border.bottom.as_ref(), theme_colors);
    let diagonal = resolve_border_side(border.diagonal.as_ref(), theme_colors);

    // Preserve the absent-vs-explicit-false distinction on both flags directly
    // (formerly collapsed into a `DiagonalDirection` enum). `Some(false)` must
    // round-trip as an explicit false attribute on `<border>`.
    let diagonal_up = border.diagonal_up;
    let diagonal_down = border.diagonal_down;

    if left.is_none()
        && right.is_none()
        && top.is_none()
        && bottom.is_none()
        && diagonal.is_none()
        && diagonal_up.is_none()
        && diagonal_down.is_none()
    {
        return None;
    }

    Some(BorderFormat {
        left,
        right,
        top,
        bottom,
        diagonal,
        diagonal_up,
        diagonal_down,
    })
}

/// Resolve a single border side. Returns `None` if style is "none" or absent.
pub(super) fn resolve_border_side(
    side: Option<&BorderSideInput>,
    theme_colors: &[String],
) -> Option<BorderSide> {
    let side = side?;
    if side.style.is_empty() || side.style == "none" {
        return None;
    }
    let color = side
        .color
        .as_ref()
        .and_then(|c| resolve_color(c, theme_colors));
    let color_tint = side.color.as_ref().and_then(|c| c.tint);
    Some(BorderSide {
        style: side.style.clone(),
        color,
        color_tint,
    })
}

/// Resolve alignment input to `AlignmentFormat`. Returns `None` if no properties set.
pub(super) fn resolve_alignment(alignment: &AlignmentInput) -> Option<AlignmentFormat> {
    let mut af = AlignmentFormat::default();
    let mut has_props = false;

    if let Some(ref h) = alignment.horizontal {
        af.horizontal = Some(h.clone());
        has_props = true;
    }
    if let Some(ref v) = alignment.vertical {
        // OOXML 'center' → internal 'middle' for vertical alignment
        let mapped = if v == "center" {
            "middle".to_string()
        } else {
            v.clone()
        };
        af.vertical = Some(mapped);
        has_props = true;
    }
    // Preserve explicit `false` as well as `true` — Option<bool>
    // distinguishes absent from explicit false for round-trip fidelity.
    if let Some(wt) = alignment.wrap_text {
        af.wrap_text = Some(wt);
        has_props = true;
    }
    if let Some(rotation) = alignment.text_rotation {
        // `textRotation = 255` is the stacked / vertical-text sentinel per
        // ECMA-376 §18.8.1. Pass through unchanged — downstream writers
        // recognize 255 and re-emit it as-is.
        af.rotation = Some(rotation as i32);
        has_props = true;
    }
    if let Some(indent) = alignment.indent {
        // Preserve indent=0 explicitly when the source set it — callers that
        // want to ignore 0 should do so at the UI layer, not here.
        af.indent = Some(indent);
        has_props = true;
    }
    if let Some(stf) = alignment.shrink_to_fit {
        af.shrink_to_fit = Some(stf);
        has_props = true;
    }
    if let Some(ro) = alignment.reading_order {
        // Map ECMA-376 integer → CellFormat-compatible token. Unknown integers
        // are skipped (attribute absent on write).
        let token = match ro {
            0 => Some("context"),
            1 => Some("ltr"),
            2 => Some("rtl"),
            _ => None,
        };
        if let Some(t) = token {
            af.reading_order = Some(t.to_string());
            has_props = true;
        }
    }
    if let Some(ri) = alignment.relative_indent {
        af.relative_indent = Some(ri);
        has_props = true;
    }
    if let Some(jll) = alignment.justify_last_line {
        af.justify_last_line = Some(jll);
        has_props = true;
    }
    if let Some(ai) = alignment.auto_indent {
        af.auto_indent = Some(ai);
        has_props = true;
    }

    if has_props { Some(af) } else { None }
}
