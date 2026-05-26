//! Theme color resolution utilities.
//!
//! Extracted from the former `format-types` crate. These functions handle
//! ECMA-376 theme color references (`"theme:slot:tint"` strings) and
//! HSL-based tint application.

use std::collections::HashMap;

use crate::CellFormat;
use crate::cell_format::CellBorderSide;

/// Convert RGB (0..255 each) to HSL (h in 0..360, s and l in 0..1).
pub fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let r = r as f64 / 255.0;
    let g = g as f64 / 255.0;
    let b = b as f64 / 255.0;

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if (max - min).abs() < 1e-10 {
        return (0.0, 0.0, l);
    }

    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };

    let h = if (max - r).abs() < 1e-10 {
        let mut h = (g - b) / d;
        if g < b {
            h += 6.0;
        }
        h
    } else if (max - g).abs() < 1e-10 {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };

    (h * 60.0, s, l)
}

/// Convert HSL (h in 0..360, s and l in 0..1) back to RGB (0..255 each).
pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    if s.abs() < 1e-10 {
        let v = (l * 255.0).round() as u8;
        return (v, v, v);
    }

    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let h = h / 360.0;

    fn hue_to_rgb(p: f64, q: f64, mut t: f64) -> f64 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 1.0 / 2.0 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    }

    let r = (hue_to_rgb(p, q, h + 1.0 / 3.0) * 255.0).round() as u8;
    let g = (hue_to_rgb(p, q, h) * 255.0).round() as u8;
    let b = (hue_to_rgb(p, q, h - 1.0 / 3.0) * 255.0).round() as u8;
    (r, g, b)
}

/// Apply an ECMA-376 tint to a hex color string (e.g. "#4472C4").
///
/// - tint < 0 darkens: L' = L * (1 + tint)
/// - tint > 0 lightens: L' = L * (1 - tint) + tint
///
/// Returns a hex color string with "#" prefix.
pub fn apply_tint(hex_color: &str, tint: f64) -> String {
    let hex = hex_color.strip_prefix('#').unwrap_or(hex_color);
    if hex.len() < 6 {
        return hex_color.to_string();
    }
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);

    let (h, s, l) = rgb_to_hsl(r, g, b);

    let l2 = if tint < 0.0 {
        l * (1.0 + tint)
    } else {
        l * (1.0 - tint) + tint
    };

    let (r2, g2, b2) = hsl_to_rgb(h, s, l2);
    format!("#{:02X}{:02X}{:02X}", r2, g2, b2)
}

/// Resolve a color string that may be a theme reference.
///
/// Theme references have the form `"theme:slot"` or `"theme:slot:tint"`.
/// The `palette` maps slot names (e.g. "accent1", "dark1") to hex colors (e.g. "#4472C4").
///
/// Non-theme strings are returned unchanged.
pub fn resolve_theme_color(color: &str, palette: &HashMap<String, String>) -> String {
    let rest = match color.strip_prefix("theme:") {
        Some(r) => r,
        None => return color.to_string(),
    };

    let mut parts = rest.splitn(2, ':');
    let slot = match parts.next() {
        Some(s) if !s.is_empty() => s,
        _ => return color.to_string(),
    };
    let tint: Option<f64> = parts.next().and_then(|t| t.parse().ok());

    let base_hex = match palette.get(slot) {
        Some(h) => h,
        None => return color.to_string(),
    };

    match tint {
        Some(t) => apply_tint(base_hex, t),
        None => base_hex.clone(),
    }
}

/// Resolve a theme reference in a border side's color, if present.
fn resolve_border_side_theme(side: &mut Option<CellBorderSide>, palette: &HashMap<String, String>) {
    if let Some(s) = side
        && let Some(ref c) = s.color
        && c.starts_with("theme:")
    {
        s.color = Some(resolve_theme_color(c, palette));
    }
}

/// Resolve any theme references in a `CellFormat`'s color fields in-place.
pub fn resolve_theme_refs(fmt: &mut CellFormat, palette: &HashMap<String, String>) {
    if let Some(ref c) = fmt.font_color
        && c.starts_with("theme:")
    {
        fmt.font_color = Some(resolve_theme_color(c, palette));
    }
    if let Some(ref c) = fmt.background_color
        && c.starts_with("theme:")
    {
        fmt.background_color = Some(resolve_theme_color(c, palette));
    }
    if let Some(ref c) = fmt.pattern_foreground_color
        && c.starts_with("theme:")
    {
        fmt.pattern_foreground_color = Some(resolve_theme_color(c, palette));
    }

    // Resolve border side colors
    if let Some(ref mut borders) = fmt.borders {
        resolve_border_side_theme(&mut borders.top, palette);
        resolve_border_side_theme(&mut borders.right, palette);
        resolve_border_side_theme(&mut borders.bottom, palette);
        resolve_border_side_theme(&mut borders.left, palette);
        resolve_border_side_theme(&mut borders.diagonal, palette);
        resolve_border_side_theme(&mut borders.vertical, palette);
        resolve_border_side_theme(&mut borders.horizontal, palette);
    }

    // Resolve gradient stop colors
    if let Some(ref mut gradient) = fmt.gradient_fill {
        for stop in &mut gradient.stops {
            if stop.color.starts_with("theme:") {
                stop.color = resolve_theme_color(&stop.color, palette);
            }
        }
    }
}
