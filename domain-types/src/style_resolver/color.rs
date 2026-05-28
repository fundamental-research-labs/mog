use super::input::ColorInput;

// =============================================================================
// Theme color slot names
// =============================================================================

/// OOXML theme color indices 0-11 → internal slot names.
///
/// **IMPORTANT**: Indices 0-1 and 2-3 are SWAPPED relative to the `clrScheme`
/// child order (dk1, lt1, dk2, lt2, ...). In `<color theme="X">`:
///   - X=0 → lt1 (Light 1), X=1 → dk1 (Dark 1)
///   - X=2 → lt2 (Light 2), X=3 → dk2 (Dark 2)
///   - Indices 4-11 are NOT swapped.
const THEME_COLOR_SLOTS: &[&str] = &[
    "light1",            // 0 (swapped: lt1, not dk1)
    "dark1",             // 1 (swapped: dk1, not lt1)
    "light2",            // 2 (swapped: lt2, not dk2)
    "dark2",             // 3 (swapped: dk2, not lt2)
    "accent1",           // 4
    "accent2",           // 5
    "accent3",           // 6
    "accent4",           // 7
    "accent5",           // 8
    "accent6",           // 9
    "hyperlink",         // 10
    "followedHyperlink", // 11
];

/// Map a theme index (0-11) to its position in the `theme_colors` vec,
/// applying the OOXML swap for indices 0↔1 and 2↔3.
///
/// The `theme_colors` vec stores colors in clrScheme child order:
///   [dk1, lt1, dk2, lt2, accent1, ..., followedHyperlink]
/// But OOXML `<color theme="X">` uses swapped indices for 0-3.
fn theme_index_to_palette_index(theme_idx: u32) -> Option<usize> {
    let palette_idx = match theme_idx {
        0 => 1, // theme 0 (lt1) → palette slot 1 (lt1 is 2nd child)
        1 => 0, // theme 1 (dk1) → palette slot 0 (dk1 is 1st child)
        2 => 3, // theme 2 (lt2) → palette slot 3 (lt2 is 4th child)
        3 => 2, // theme 3 (dk2) → palette slot 2 (dk2 is 3rd child)
        4..=11 => theme_idx as usize,
        _ => return None,
    };
    Some(palette_idx)
}

// =============================================================================
// Color resolution
// =============================================================================

/// Standard OOXML indexed color palette (64 entries + 2 system colors).
///
/// Indices 0-7: Standard 8 colors.
/// Indices 8-15: Duplicate of 0-7.
/// Indices 16-63: Extended palette colors.
/// Index 64: System foreground (typically black).
/// Index 65: System background (typically white).
const INDEXED_COLORS: [&str; 66] = [
    "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF",
    "#00FFFF", // 0-7
    "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF",
    "#00FFFF", // 8-15
    "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0",
    "#808080", // 16-23
    "#9999FF", "#993366", "#FFFFCC", "#CCFFFF", "#660066", "#FF8080", "#0066CC",
    "#CCCCFF", // 24-31
    "#000080", "#FF00FF", "#FFFF00", "#00FFFF", "#800080", "#800000", "#008080",
    "#0000FF", // 32-39
    "#00CCFF", "#CCFFFF", "#CCFFCC", "#FFFF99", "#99CCFF", "#FF99CC", "#CC99FF",
    "#FFCC99", // 40-47
    "#3366FF", "#33CCCC", "#99CC00", "#FFCC00", "#FF9900", "#FF6600", "#666699",
    "#969696", // 48-55
    "#003366", "#339966", "#003300", "#333300", "#993300", "#993366", "#333399",
    "#333333", // 56-63
    "#000000", "#FFFFFF", // 64=system foreground, 65=system background
];

/// Resolve an OOXML indexed color to a hex string.
fn resolve_indexed_color(index: u32) -> Option<&'static str> {
    INDEXED_COLORS.get(index as usize).copied()
}

/// Resolve a `ColorInput` to a CSS-style color string.
///
/// Resolution strategy:
/// 1. **RGB**: ARGB hex → `#RRGGBB`
/// 2. **Theme + resolved palette**: look up `theme_colors[swapped_index]`,
///    apply tint if present, return `#RRGGBB`
/// 3. **Theme without palette**: return `theme:slot` or `theme:slot:tint`
/// 4. **Indexed**: look up the standard 64-entry OOXML indexed color palette
/// 5. **Auto**: system foreground color (black)
pub(super) fn resolve_color(color: &ColorInput, theme_colors: &[String]) -> Option<String> {
    // RGB color takes priority
    if let Some(ref rgb) = color.rgb
        && !rgb.is_empty()
    {
        return Some(normalize_rgb(rgb));
    }

    // Theme color
    if let Some(theme_idx) = color.theme {
        // Try to resolve from the palette
        if let Some(palette_idx) = theme_index_to_palette_index(theme_idx)
            && let Some(base_hex) = theme_colors.get(palette_idx)
        {
            let base = normalize_rgb(base_hex);
            if let Some(tint) = color.tint
                && tint != 0.0
            {
                return Some(apply_tint(&base, tint));
            }
            return Some(base);
        }

        // Fallback: emit symbolic theme reference if palette not available
        if let Some(&slot) = THEME_COLOR_SLOTS.get(theme_idx as usize) {
            if let Some(tint) = color.tint
                && tint != 0.0
            {
                return Some(format!("theme:{slot}:{tint}"));
            }
            return Some(format!("theme:{slot}"));
        }
    }

    // Indexed color (legacy palette)
    if let Some(idx) = color.indexed
        && let Some(hex) = resolve_indexed_color(idx)
    {
        if let Some(tint) = color.tint
            && tint != 0.0
        {
            return Some(apply_tint(hex, tint));
        }
        return Some(hex.to_string());
    }

    // Auto color: system foreground (black) by default
    if color.auto {
        return Some("#000000".to_string());
    }

    None
}

/// Normalize an RGB string to `#RRGGBB` format.
///
/// Handles:
/// - 8-char ARGB hex (e.g. "FFFF0000") → "#FF0000"
/// - 6-char RGB hex (e.g. "FF0000") → "#FF0000"
/// - Already prefixed (e.g. "#FF0000") → "#FF0000"
pub(super) fn normalize_rgb(rgb: &str) -> String {
    if rgb.len() == 8 && !rgb.starts_with('#') {
        // ARGB: strip alpha prefix
        return format!("#{}", &rgb[2..]);
    }
    if rgb.starts_with('#') {
        rgb.to_string()
    } else {
        format!("#{rgb}")
    }
}

/// Apply an OOXML tint to a `#RRGGBB` color.
///
/// OOXML tint algorithm (ECMA-376 §20.1.2.3.13):
/// - Positive tint: blend toward white (increase luminance)
/// - Negative tint: blend toward black (decrease luminance)
///
/// Works in HSL space for accurate results.
pub(super) fn apply_tint(hex_color: &str, tint: f64) -> String {
    let hex = hex_color.trim_start_matches('#');
    if hex.len() < 6 {
        return hex_color.to_string();
    }

    let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);

    let (h, s, l) = rgb_to_hsl(r, g, b);

    let new_l = if tint < 0.0 {
        l * (1.0 + tint)
    } else {
        l * (1.0 - tint) + tint
    };

    let (nr, ng, nb) = hsl_to_rgb(h, s, new_l.clamp(0.0, 1.0));
    format!("#{:02X}{:02X}{:02X}", nr, ng, nb)
}

/// Convert RGB (0-255) to HSL (h: 0-360, s: 0-1, l: 0-1).
fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
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

    let h = if (max - rf).abs() < 1e-10 {
        let mut h = (gf - bf) / d;
        if gf < bf {
            h += 6.0;
        }
        h
    } else if (max - gf).abs() < 1e-10 {
        (bf - rf) / d + 2.0
    } else {
        (rf - gf) / d + 4.0
    };

    (h * 60.0, s, l)
}

/// Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB (0-255).
fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
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
    let h_norm = h / 360.0;

    let r = hue_to_rgb(p, q, h_norm + 1.0 / 3.0);
    let g = hue_to_rgb(p, q, h_norm);
    let b = hue_to_rgb(p, q, h_norm - 1.0 / 3.0);

    (
        (r * 255.0).round() as u8,
        (g * 255.0).round() as u8,
        (b * 255.0).round() as u8,
    )
}

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
