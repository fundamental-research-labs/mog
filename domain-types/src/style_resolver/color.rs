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
pub fn resolve_color(color: &ColorInput, theme_colors: &[String]) -> Option<String> {
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
pub(super) fn apply_tint(hex_color: &str, tint: f64) -> String {
    crate::theme_color::apply_tint(hex_color, tint)
}
