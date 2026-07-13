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
    let Some(rgb_hex) = hex.get(..6).filter(|value| {
        value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit())
    }) else {
        return hex_color.to_string();
    };
    let r = u8::from_str_radix(&rgb_hex[0..2], 16).expect("validated hex byte");
    let g = u8::from_str_radix(&rgb_hex[2..4], 16).expect("validated hex byte");
    let b = u8::from_str_radix(&rgb_hex[4..6], 16).expect("validated hex byte");

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
/// The `palette` maps slot names (e.g. "accent1", "dk1") to hex colors (e.g. "#4472C4").
/// Both semantic slot names (`dark1`, `followedHyperlink`) and their OOXML
/// spellings (`dk1`, `folHlink`) are accepted on either side of the lookup.
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

    let base_hex = match palette_color(slot, palette) {
        Some(h) => h,
        None => return color.to_string(),
    };

    match tint {
        Some(t) => apply_tint(base_hex, t),
        None => base_hex.clone(),
    }
}

/// Return a theme color regardless of whether the reference and palette use
/// semantic names or OOXML `clrScheme` element names.
fn palette_color<'a>(slot: &str, palette: &'a HashMap<String, String>) -> Option<&'a String> {
    palette.get(slot).or_else(|| {
        let (semantic, ooxml) = theme_slot_aliases(slot)?;
        palette.get(semantic).or_else(|| palette.get(ooxml))
    })
}

/// Map every supported theme slot spelling to its semantic/OOXML alias pair.
fn theme_slot_aliases(slot: &str) -> Option<(&'static str, &'static str)> {
    Some(match slot {
        "dark1" | "dk1" => ("dark1", "dk1"),
        "light1" | "lt1" => ("light1", "lt1"),
        "dark2" | "dk2" => ("dark2", "dk2"),
        "light2" | "lt2" => ("light2", "lt2"),
        "accent1" => ("accent1", "accent1"),
        "accent2" => ("accent2", "accent2"),
        "accent3" => ("accent3", "accent3"),
        "accent4" => ("accent4", "accent4"),
        "accent5" => ("accent5", "accent5"),
        "accent6" => ("accent6", "accent6"),
        "hyperlink" | "hlink" => ("hyperlink", "hlink"),
        "followedHyperlink" | "folHlink" => ("followedHyperlink", "folHlink"),
        _ => return None,
    })
}

/// Apply an Excel tint to any concrete color syntax accepted by the public
/// cell-format contract. The result is normalized to `#RRGGBB[AA]`; alpha is
/// preserved rather than participating in the tint transform.
fn apply_tint_to_concrete_color(color: &str, tint: f64) -> Option<String> {
    if !tint.is_finite() {
        return None;
    }
    let (rgb, alpha) = parse_concrete_color(color)?;
    let mut tinted = apply_tint(&rgb, tint);
    if let Some(alpha) = alpha {
        tinted.push_str(&format!("{alpha:02X}"));
    }
    Some(tinted)
}

fn parse_concrete_color(color: &str) -> Option<(String, Option<u8>)> {
    if let Some(hex) = color.strip_prefix('#') {
        if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        return match hex.len() {
            3 => {
                let bytes = hex.as_bytes();
                Some((
                    format!(
                        "#{0}{0}{1}{1}{2}{2}",
                        (bytes[0] as char).to_ascii_uppercase(),
                        (bytes[1] as char).to_ascii_uppercase(),
                        (bytes[2] as char).to_ascii_uppercase()
                    ),
                    None,
                ))
            }
            6 | 8 => {
                let rgb = format!("#{}", hex[..6].to_ascii_uppercase());
                let alpha = (hex.len() == 8)
                    .then(|| u8::from_str_radix(&hex[6..8], 16).ok())
                    .flatten();
                Some((rgb, alpha))
            }
            _ => None,
        };
    }

    parse_css_rgb(color)
}

fn parse_css_rgb(color: &str) -> Option<(String, Option<u8>)> {
    let (inner, requires_alpha) = if let Some(inner) = color
        .strip_prefix("rgb(")
        .and_then(|value| value.strip_suffix(')'))
    {
        (inner, false)
    } else if let Some(inner) = color
        .strip_prefix("rgba(")
        .and_then(|value| value.strip_suffix(')'))
    {
        (inner, true)
    } else {
        return None;
    };

    let (channels, alpha) = if inner.contains(',') {
        let parts: Vec<_> = inner.split(',').map(str::trim).collect();
        match parts.as_slice() {
            [red, green, blue] if !requires_alpha => ([*red, *green, *blue], None),
            [red, green, blue, alpha] => ([*red, *green, *blue], Some(*alpha)),
            _ => return None,
        }
    } else {
        let (channels, alpha) = match inner.split_once('/') {
            Some((channels, alpha)) => (channels, Some(alpha.trim())),
            None => (inner, None),
        };
        let channels: Vec<_> = channels.split_whitespace().collect();
        let [red, green, blue] = channels.as_slice() else {
            return None;
        };
        ([*red, *green, *blue], alpha)
    };

    if requires_alpha && alpha.is_none() {
        return None;
    }

    let red = parse_css_rgb_channel(channels[0])?;
    let green = parse_css_rgb_channel(channels[1])?;
    let blue = parse_css_rgb_channel(channels[2])?;
    let alpha = match alpha {
        Some(value) => Some(parse_css_alpha(value)?),
        None => None,
    };
    Some((format!("#{red:02X}{green:02X}{blue:02X}"), alpha))
}

fn parse_css_rgb_channel(value: &str) -> Option<u8> {
    if let Some(percent) = value.strip_suffix('%') {
        let percent = percent.trim().parse::<f64>().ok()?;
        percent
            .is_finite()
            .then(|| (percent.clamp(0.0, 100.0) * 255.0 / 100.0).round() as u8)
    } else {
        let value = value.parse::<f64>().ok()?;
        value
            .is_finite()
            .then(|| value.clamp(0.0, 255.0).round() as u8)
    }
}

fn parse_css_alpha(value: &str) -> Option<u8> {
    if let Some(percent) = value.strip_suffix('%') {
        let percent = percent.trim().parse::<f64>().ok()?;
        percent
            .is_finite()
            .then(|| (percent.clamp(0.0, 100.0) * 255.0 / 100.0).round() as u8)
    } else {
        let value = value.parse::<f64>().ok()?;
        value
            .is_finite()
            .then(|| (value.clamp(0.0, 1.0) * 255.0).round() as u8)
    }
}

/// Resolve a color and consume its parallel tint when a concrete display color
/// is available. Leaving an unresolved theme reference untouched preserves all
/// information if a workbook has no palette.
fn resolve_color_and_tint(
    color: &mut Option<String>,
    tint: &mut Option<f64>,
    palette: &HashMap<String, String>,
) {
    let Some(authored_color) = color.as_deref() else {
        return;
    };

    // Inline tint is the complete representation used by gradient stops and
    // some legacy formats. If a stale parallel tint also exists, the inline
    // representation is authoritative rather than applying the transform
    // twice.
    let has_inline_theme_tint = authored_color
        .strip_prefix("theme:")
        .and_then(|reference| reference.split_once(':'))
        .and_then(|(_, value)| value.parse::<f64>().ok())
        .is_some();
    let mut resolved = resolve_theme_color(authored_color, palette);
    if resolved.starts_with("theme:") {
        return;
    }

    if let Some(value) = *tint {
        if has_inline_theme_tint {
            *tint = None;
        } else if let Some(tinted) = apply_tint_to_concrete_color(&resolved, value) {
            resolved = tinted;
            *tint = None;
        } else {
            // A malformed/unsupported concrete syntax must not be converted to
            // black or lose its unapplied tint.
            return;
        }
    }
    *color = Some(resolved);
}

/// Resolve a border side's color and parallel tint, if present.
fn resolve_border_side_theme(side: &mut Option<CellBorderSide>, palette: &HashMap<String, String>) {
    if let Some(s) = side {
        resolve_color_and_tint(&mut s.color, &mut s.color_tint, palette);
    }
}

/// Resolve any theme references in a `CellFormat`'s color fields in-place.
pub fn resolve_theme_refs(fmt: &mut CellFormat, palette: &HashMap<String, String>) {
    resolve_color_and_tint(&mut fmt.font_color, &mut fmt.font_color_tint, palette);
    resolve_color_and_tint(
        &mut fmt.background_color,
        &mut fmt.background_color_tint,
        palette,
    );
    resolve_color_and_tint(
        &mut fmt.pattern_foreground_color,
        &mut fmt.pattern_foreground_color_tint,
        palette,
    );

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
    use super::{apply_tint, resolve_theme_color, resolve_theme_refs};
    use crate::cell_format::{CellBorderSide, CellBorders};
    use crate::{CellFormat, GradientFillFormat, GradientStopFormat};
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
    fn apply_tint_does_not_substitute_black_for_invalid_hex() {
        assert_eq!(apply_tint("not-a-color", 0.5), "not-a-color");
        assert_eq!(apply_tint("#XYZXYZ", 0.5), "#XYZXYZ");
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

    #[test]
    fn resolve_theme_color_accepts_all_semantic_and_ooxml_slot_names() {
        let slots = [
            ("dark1", "dk1", "#010101"),
            ("light1", "lt1", "#020202"),
            ("dark2", "dk2", "#030303"),
            ("light2", "lt2", "#040404"),
            ("accent1", "accent1", "#050505"),
            ("accent2", "accent2", "#060606"),
            ("accent3", "accent3", "#070707"),
            ("accent4", "accent4", "#080808"),
            ("accent5", "accent5", "#090909"),
            ("accent6", "accent6", "#0A0A0A"),
            ("hyperlink", "hlink", "#0B0B0B"),
            ("followedHyperlink", "folHlink", "#0C0C0C"),
        ];

        for (semantic, ooxml, expected) in slots {
            for palette_slot in [semantic, ooxml] {
                let palette = HashMap::from([(palette_slot.to_string(), expected.to_string())]);
                for reference_slot in [semantic, ooxml] {
                    assert_eq!(
                        resolve_theme_color(&format!("theme:{reference_slot}"), &palette),
                        expected,
                        "reference={reference_slot} palette={palette_slot}"
                    );
                }
            }
        }
    }

    #[test]
    fn resolve_theme_refs_applies_and_consumes_all_parallel_color_tints() {
        let palette = HashMap::from([
            ("dk1".to_string(), "#0F9ED5".to_string()),
            ("lt1".to_string(), "#70AD47".to_string()),
            ("dk2".to_string(), "#FFC000".to_string()),
        ]);
        let side = |color: &str, tint| {
            Some(CellBorderSide {
                color: Some(color.to_string()),
                color_tint: Some(tint),
                ..Default::default()
            })
        };
        let mut format = CellFormat {
            font_color: Some("theme:dark1".to_string()),
            font_color_tint: Some(-0.5),
            background_color: Some("theme:light1".to_string()),
            background_color_tint: Some(0.8),
            pattern_foreground_color: Some("theme:dark2".to_string()),
            pattern_foreground_color_tint: Some(0.8),
            borders: Some(CellBorders {
                top: side("theme:dark1", -0.5),
                right: side("theme:light1", 0.8),
                bottom: side("theme:dark2", 0.8),
                left: side("#0F9ED5", -0.5),
                diagonal: side("theme:dark1", -0.5),
                vertical: side("theme:light1", 0.8),
                horizontal: side("theme:dark2", 0.8),
                ..Default::default()
            }),
            ..Default::default()
        };

        resolve_theme_refs(&mut format, &palette);

        assert_eq!(format.font_color.as_deref(), Some("#074F69"));
        assert_eq!(format.background_color.as_deref(), Some("#E2EFDA"));
        assert_eq!(format.pattern_foreground_color.as_deref(), Some("#FFF2CC"));
        assert_eq!(format.font_color_tint, None);
        assert_eq!(format.background_color_tint, None);
        assert_eq!(format.pattern_foreground_color_tint, None);

        let borders = format.borders.as_ref().unwrap();
        let expected = [
            (&borders.top, "#074F69"),
            (&borders.right, "#E2EFDA"),
            (&borders.bottom, "#FFF2CC"),
            (&borders.left, "#074F69"),
            (&borders.diagonal, "#074F69"),
            (&borders.vertical, "#E2EFDA"),
            (&borders.horizontal, "#FFF2CC"),
        ];
        for (side, color) in expected {
            let side = side.as_ref().unwrap();
            assert_eq!(side.color.as_deref(), Some(color));
            assert_eq!(side.color_tint, None);
        }

        let resolved_once = format.clone();
        resolve_theme_refs(&mut format, &palette);
        assert_eq!(
            format, resolved_once,
            "resolved tints must not be applied twice"
        );
    }

    #[test]
    fn resolve_theme_refs_preserves_unresolved_theme_linkage_and_tint() {
        let mut format = CellFormat {
            font_color: Some("theme:accent1".to_string()),
            font_color_tint: Some(0.5),
            ..Default::default()
        };

        resolve_theme_refs(&mut format, &HashMap::new());

        assert_eq!(format.font_color.as_deref(), Some("theme:accent1"));
        assert_eq!(format.font_color_tint, Some(0.5));
    }

    #[test]
    fn resolve_theme_refs_resolves_inline_gradient_tints_without_parallel_state() {
        let palette = HashMap::from([("accent4".to_string(), "#0F9ED5".to_string())]);
        let mut format = CellFormat {
            gradient_fill: Some(GradientFillFormat {
                gradient_type: "linear".to_string(),
                degree: None,
                center: None,
                stops: vec![GradientStopFormat {
                    position: 0.0,
                    color: "theme:accent4:-0.499984740745262".to_string(),
                }],
            }),
            ..Default::default()
        };

        resolve_theme_refs(&mut format, &palette);

        assert_eq!(format.gradient_fill.unwrap().stops[0].color, "#074F69");
    }

    #[test]
    fn resolve_theme_refs_applies_rgb_tint_once_and_ignores_stale_inline_parallel_tint() {
        let palette = HashMap::from([("accent4".to_string(), "#0F9ED5".to_string())]);
        let mut format = CellFormat {
            font_color: Some("#0F9ED5".to_string()),
            font_color_tint: Some(-0.499984740745262),
            background_color: Some("theme:accent4:-0.499984740745262".to_string()),
            background_color_tint: Some(-0.499984740745262),
            ..Default::default()
        };

        resolve_theme_refs(&mut format, &palette);

        assert_eq!(format.font_color.as_deref(), Some("#074F69"));
        assert_eq!(format.background_color.as_deref(), Some("#074F69"));
        assert_eq!(format.font_color_tint, None);
        assert_eq!(format.background_color_tint, None);

        let resolved_once = format.clone();
        resolve_theme_refs(&mut format, &palette);
        assert_eq!(format, resolved_once);
    }

    #[test]
    fn resolve_theme_refs_tints_every_supported_concrete_color_syntax() {
        let cases = [
            ("#F00", "#FF8080"),
            ("#FF0000", "#FF8080"),
            ("#FF000080", "#FF808080"),
            ("rgb(255, 0, 0)", "#FF8080"),
            ("rgba(255, 0, 0, 0.5)", "#FF808080"),
            ("rgb(100% 0% 0% / 50%)", "#FF808080"),
            ("rgba(255 0 0 / 25%)", "#FF808040"),
        ];

        for (color, expected) in cases {
            let mut format = CellFormat {
                font_color: Some(color.to_string()),
                font_color_tint: Some(0.5),
                ..Default::default()
            };

            resolve_theme_refs(&mut format, &HashMap::new());

            assert_eq!(format.font_color.as_deref(), Some(expected), "{color}");
            assert_eq!(format.font_color_tint, None, "{color}");
        }
    }

    #[test]
    fn resolve_theme_refs_does_not_consume_tint_for_malformed_concrete_color() {
        let mut format = CellFormat {
            font_color: Some("rgb(not-a-color)".to_string()),
            font_color_tint: Some(0.5),
            ..Default::default()
        };

        resolve_theme_refs(&mut format, &HashMap::new());

        assert_eq!(format.font_color.as_deref(), Some("rgb(not-a-color)"));
        assert_eq!(format.font_color_tint, Some(0.5));
    }
}
