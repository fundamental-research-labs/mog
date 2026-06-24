//! Theme color resolution utilities.
//!
//! Extracted from the former `format-types` crate. These functions handle
//! ECMA-376 theme color references (`"theme:slot:tint"` strings) and
//! Excel-compatible HLS tint application.

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

const HLSMAX: i32 = 240;
const RGBMAX: i32 = 255;
const HLS_UNDEFINED: i32 = (HLSMAX * 2) / 3;

/// Apply an ECMA-376 tint to a hex color string (e.g. "#4472C4").
///
/// - tint < 0 darkens: L' = L * (1 + tint)
/// - tint > 0 lightens: L' = L * (1 - tint) + HLSMAX * tint
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

    let tint = canonicalize_excel_tint(tint);
    let (h, l, s) = rgb_to_excel_hls(r, g, b);

    let l2 = if tint < 0.0 {
        (l as f64 * (1.0 + tint)).floor()
    } else {
        (l as f64 * (1.0 - tint) + HLSMAX as f64 * tint).floor()
    }
    .clamp(0.0, HLSMAX as f64) as i32;

    let (r2, g2, b2) = excel_hls_to_rgb(h, l2, s);
    format!("#{:02X}{:02X}{:02X}", r2, g2, b2)
}

fn canonicalize_excel_tint(tint: f64) -> f64 {
    let rounded = (tint * 100.0).round() / 100.0;
    if (tint - rounded).abs() < 0.0001 {
        rounded
    } else {
        tint
    }
}

fn rgb_to_excel_hls(r: u8, g: u8, b: u8) -> (i32, i32, i32) {
    let r = r as i32;
    let g = g as i32;
    let b = b as i32;

    let c_max = r.max(g).max(b);
    let c_min = r.min(g).min(b);
    let luminance = (((c_max + c_min) * HLSMAX) + RGBMAX) / (2 * RGBMAX);

    if c_max == c_min {
        return (HLS_UNDEFINED, luminance, 0);
    }

    let saturation = if luminance <= HLSMAX / 2 {
        (((c_max - c_min) * HLSMAX) + ((c_max + c_min) / 2)) / (c_max + c_min)
    } else {
        (((c_max - c_min) * HLSMAX) + ((2 * RGBMAX - c_max - c_min) / 2))
            / (2 * RGBMAX - c_max - c_min)
    };

    let r_delta = (((c_max - r) * (HLSMAX / 6)) + ((c_max - c_min) / 2)) / (c_max - c_min);
    let g_delta = (((c_max - g) * (HLSMAX / 6)) + ((c_max - c_min) / 2)) / (c_max - c_min);
    let b_delta = (((c_max - b) * (HLSMAX / 6)) + ((c_max - c_min) / 2)) / (c_max - c_min);

    let mut hue = if r == c_max {
        b_delta - g_delta
    } else if g == c_max {
        (HLSMAX / 3) + r_delta - b_delta
    } else {
        ((2 * HLSMAX) / 3) + g_delta - r_delta
    };

    if hue < 0 {
        hue += HLSMAX;
    }
    if hue > HLSMAX {
        hue -= HLSMAX;
    }

    (hue, luminance, saturation)
}

fn excel_hls_to_rgb(hue: i32, luminance: i32, saturation: i32) -> (u8, u8, u8) {
    if saturation == 0 {
        let value = ((luminance * RGBMAX) + (HLSMAX / 2)) / HLSMAX;
        let value = value.clamp(0, RGBMAX) as u8;
        return (value, value, value);
    }

    let magic2 = if luminance <= HLSMAX / 2 {
        (luminance * (HLSMAX + saturation) + (HLSMAX / 2)) / HLSMAX
    } else {
        luminance + saturation - ((luminance * saturation + (HLSMAX / 2)) / HLSMAX)
    };
    let magic1 = 2 * luminance - magic2;

    let r = excel_hue_to_rgb(magic1, magic2, hue + HLSMAX / 3);
    let g = excel_hue_to_rgb(magic1, magic2, hue);
    let b = excel_hue_to_rgb(magic1, magic2, hue - HLSMAX / 3);

    (
        (((r * RGBMAX) + (HLSMAX / 2)) / HLSMAX).clamp(0, RGBMAX) as u8,
        (((g * RGBMAX) + (HLSMAX / 2)) / HLSMAX).clamp(0, RGBMAX) as u8,
        (((b * RGBMAX) + (HLSMAX / 2)) / HLSMAX).clamp(0, RGBMAX) as u8,
    )
}

fn excel_hue_to_rgb(magic1: i32, magic2: i32, mut hue: i32) -> i32 {
    if hue < 0 {
        hue += HLSMAX;
    }
    if hue > HLSMAX {
        hue -= HLSMAX;
    }

    if hue < HLSMAX / 6 {
        return magic1 + (((magic2 - magic1) * hue + (HLSMAX / 12)) / (HLSMAX / 6));
    }
    if hue < HLSMAX / 2 {
        return magic2;
    }
    if hue < (HLSMAX * 2) / 3 {
        return magic1
            + (((magic2 - magic1) * (((HLSMAX * 2) / 3) - hue) + (HLSMAX / 12)) / (HLSMAX / 6));
    }

    magic1
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

#[cfg(test)]
mod tests {
    use super::{apply_tint, resolve_theme_color};
    use std::collections::HashMap;

    #[test]
    fn apply_tint_matches_excel_hls() {
        let cases = [
            ("#0F9ED5", -0.499984740745262, "#074F69"),
            ("#0F9ED5", 0.59999389629810485, "#94DCF8"),
            ("#0E2841", 0.89999084444715716, "#DAE9F8"),
            ("#0E2841", 0.249977111117893, "#215C98"),
            ("#70AD47", 0.79998168889431442, "#E2EFDA"),
            ("#9BBB59", 0.79998168889431442, "#EBF1DE"),
            ("#FFC000", 0.79998168889431442, "#FFF2CC"),
            ("#4EA72E", 0.79998168889431442, "#DAF2D0"),
        ];

        for (base, tint, expected) in cases {
            assert_eq!(apply_tint(base, tint), expected, "base={base} tint={tint}");
        }
    }

    #[test]
    fn resolve_theme_color_applies_excel_hls_tint() {
        let mut palette = HashMap::new();
        palette.insert("accent4".to_string(), "#0F9ED5".to_string());

        assert_eq!(
            resolve_theme_color("theme:accent4:-0.499984740745262", &palette),
            "#074F69"
        );
    }
}
