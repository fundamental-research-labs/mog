//! Standalone style resolver: OOXML multi-level style tables → flat `DocumentFormat` palette.
//!
//! Takes **generic inputs** (simple structs defined here) — NOT xlsx-parser types.
//! Produces `Vec<DocumentFormat>` from our `format.rs`.
//!
//! Handles:
//! - Color resolution with theme slot swapping (indices 0↔1, 2↔3)
//! - Built-in number format code lookup (50+ codes, IDs 0-49)
//! - `FormatCache` memoization via `HashMap`
//! - Multi-level OOXML palette → flat palette conversion

use std::collections::HashMap;

use crate::{
    AlignmentFormat, BorderFormat, BorderSide, DocumentFormat, FillFormat, FontFormat,
    GradientCenter, GradientFillFormat, GradientStopFormat, ProtectionFormat,
};

// =============================================================================
// Input types — generic, no xlsx-parser dependency
// =============================================================================

/// Top-level input to the style resolver. Mirrors the relevant parts of an
/// OOXML stylesheet (`styles.xml`) but uses plain Rust types.
#[derive(Debug, Clone, Default)]
pub struct StyleInput {
    /// Cell XF records — one per style index.
    pub cell_xfs: Vec<CellXfInput>,
    /// Cell style XF records — base styles (e.g., "Normal") referenced by `xf_id`.
    pub cell_style_xfs: Vec<CellXfInput>,
    /// Font table.
    pub fonts: Vec<FontInput>,
    /// Fill table.
    pub fills: Vec<FillInput>,
    /// Border table.
    pub borders: Vec<BorderInput>,
    /// Custom number format codes, keyed by numFmtId.
    pub num_fmts: HashMap<u32, String>,
    /// Theme color palette — 12 slots, already resolved to "#RRGGBB".
    /// Order: [lt1, dk1, lt2, dk2, accent1..accent6, hyperlink, followedHyperlink]
    /// (the raw `clrScheme` child order, *before* OOXML index swapping).
    pub theme_colors: Vec<String>,
    /// Theme major font name (e.g., "Aptos Display") — resolved from theme1.xml.
    pub major_font: Option<String>,
    /// Theme minor font name (e.g., "Aptos Narrow") — resolved from theme1.xml.
    pub minor_font: Option<String>,
}

/// A single CellXf record from `cellXfs`.
#[derive(Debug, Clone, Default)]
pub struct CellXfInput {
    pub font_id: Option<u32>,
    pub fill_id: Option<u32>,
    pub border_id: Option<u32>,
    pub num_fmt_id: Option<u32>,
    pub xf_id: Option<u32>,
    pub apply_font: Option<bool>,
    pub apply_fill: Option<bool>,
    pub apply_border: Option<bool>,
    pub apply_number_format: Option<bool>,
    pub apply_alignment: Option<bool>,
    pub apply_protection: Option<bool>,
    pub alignment: Option<AlignmentInput>,
    pub protection: Option<ProtectionInput>,
}

/// Font record.
#[derive(Debug, Clone, Default)]
pub struct FontInput {
    pub name: String,
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    /// Underline style string: "none", "single", "double",
    /// "singleAccounting", "doubleAccounting". `None` = not specified.
    pub underline: Option<String>,
    pub strikethrough: bool,
    pub color: Option<ColorInput>,
    /// Font scheme: "major", "minor", or `None`.
    pub scheme: Option<String>,
    /// Vertical alignment: "superscript", "subscript", or `None`.
    pub vert_align: Option<String>,
    /// Font charset (e.g. 0 = ANSI, 1 = default, 128 = ShiftJIS).
    pub charset: Option<u32>,
    /// Font family number (e.g. 1 = Roman, 2 = Swiss).
    pub family: Option<u32>,
}

/// Fill record.
#[derive(Debug, Clone, Default)]
pub struct FillInput {
    /// Fill type — typically "pattern" or "gradient".
    pub fill_type: String,
    /// Pattern type as OOXML string: "none", "solid", "gray125", etc.
    pub pattern_type: String,
    /// Foreground color (used as background for solid fills).
    pub fg_color: Option<ColorInput>,
    /// Background color.
    pub bg_color: Option<ColorInput>,
    /// Gradient fill data (only present when fill_type == "gradient").
    pub gradient: Option<GradientFillInput>,
}

/// Gradient fill input.
#[derive(Debug, Clone)]
pub struct GradientFillInput {
    /// "linear" or "path".
    pub gradient_type: String,
    /// Angle in degrees for linear gradients.
    pub degree: Option<f64>,
    /// Color stops.
    pub stops: Vec<GradientStopInput>,
    /// Fill-to rectangle for path gradients (0.0-1.0).
    pub left: Option<f64>,
    pub right: Option<f64>,
    pub top: Option<f64>,
    pub bottom: Option<f64>,
}

/// A single gradient stop.
#[derive(Debug, Clone)]
pub struct GradientStopInput {
    /// Position along the gradient (0.0 to 1.0).
    pub position: f64,
    /// Color at this position.
    pub color: ColorInput,
}

/// Border record.
#[derive(Debug, Clone, Default)]
pub struct BorderInput {
    pub left: Option<BorderSideInput>,
    pub right: Option<BorderSideInput>,
    pub top: Option<BorderSideInput>,
    pub bottom: Option<BorderSideInput>,
    pub diagonal: Option<BorderSideInput>,
    /// `None` = attribute absent in source XML; `Some(bool)` = explicit value.
    /// Preserves the absent-vs-explicit-false distinction for round-trip.
    pub diagonal_up: Option<bool>,
    pub diagonal_down: Option<bool>,
}

/// A single border side.
#[derive(Debug, Clone, Default)]
pub struct BorderSideInput {
    /// Border style as OOXML string: "thin", "medium", "thick", "dashed", etc.
    pub style: String,
    pub color: Option<ColorInput>,
}

/// Generic color input. At most one of `rgb` or `theme` should be set.
#[derive(Debug, Clone, Default)]
pub struct ColorInput {
    /// ARGB hex (e.g. "FFFF0000") or RGB hex (e.g. "FF0000" or "#FF0000").
    pub rgb: Option<String>,
    /// Theme color index (0-11).
    pub theme: Option<u32>,
    /// Tint value (-1.0 to 1.0).
    pub tint: Option<f64>,
    /// Indexed color (legacy palette). Currently not resolved.
    pub indexed: Option<u32>,
    /// Auto color flag. Currently not resolved.
    pub auto: bool,
}

/// Alignment properties.
#[derive(Debug, Clone, Default)]
pub struct AlignmentInput {
    pub horizontal: Option<String>,
    pub vertical: Option<String>,
    pub wrap_text: Option<bool>,
    pub text_rotation: Option<u32>,
    pub indent: Option<u32>,
    pub shrink_to_fit: Option<bool>,
    /// ECMA-376 integer: 0 = context, 1 = ltr, 2 = rtl.
    pub reading_order: Option<u32>,
    pub auto_indent: Option<bool>,
    /// ECMA-376 CT_CellAlignment/@relativeIndent (xsd:int).
    pub relative_indent: Option<i32>,
    /// ECMA-376 CT_CellAlignment/@justifyLastLine.
    pub justify_last_line: Option<bool>,
}

/// Protection properties.
#[derive(Debug, Clone, Default)]
pub struct ProtectionInput {
    pub locked: bool,
    pub hidden: bool,
}

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
// Built-in Excel number format codes (IDs 0-49)
// =============================================================================

/// Resolve a numFmtId to its format code string.
///
/// Checks built-in formats first (IDs 0-49), then custom formats from the input.
fn resolve_number_format(num_fmt_id: u32, custom_fmts: &HashMap<u32, String>) -> Option<String> {
    let builtin = match num_fmt_id {
        0 => Some("General"),
        1 => Some("0"),
        2 => Some("0.00"),
        3 => Some("#,##0"),
        4 => Some("#,##0.00"),
        5 => Some("$#,##0_);($#,##0)"),
        6 => Some("$#,##0_);[Red]($#,##0)"),
        7 => Some("$#,##0.00_);($#,##0.00)"),
        8 => Some("$#,##0.00_);[Red]($#,##0.00)"),
        9 => Some("0%"),
        10 => Some("0.00%"),
        11 => Some("0.00E+00"),
        12 => Some("# ?/?"),
        13 => Some("# ??/??"),
        14 => Some("m/d/yyyy"),
        15 => Some("d-mmm-yy"),
        16 => Some("d-mmm"),
        17 => Some("mmm-yy"),
        18 => Some("h:mm AM/PM"),
        19 => Some("h:mm:ss AM/PM"),
        20 => Some("h:mm"),
        21 => Some("h:mm:ss"),
        22 => Some("m/d/yyyy h:mm"),
        37 => Some("#,##0_);(#,##0)"),
        38 => Some("#,##0_);[Red](#,##0)"),
        39 => Some("#,##0.00_);(#,##0.00)"),
        40 => Some("#,##0.00_);[Red](#,##0.00)"),
        41 => Some("_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)"),
        42 => Some("_($* #,##0_);_($* (#,##0);_($* \"-\"_);_(@_)"),
        43 => Some("_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)"),
        44 => Some("_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"),
        45 => Some("mm:ss"),
        46 => Some("[h]:mm:ss"),
        47 => Some("mm:ss.0"),
        48 => Some("##0.0E+0"),
        49 => Some("@"),
        _ => None,
    };

    if let Some(code) = builtin {
        return Some(code.to_string());
    }

    custom_fmts.get(&num_fmt_id).cloned()
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
fn resolve_color(color: &ColorInput, theme_colors: &[String]) -> Option<String> {
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
fn normalize_rgb(rgb: &str) -> String {
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
fn apply_tint(hex_color: &str, tint: f64) -> String {
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

// =============================================================================
// Core resolver: CellXfInput → DocumentFormat
// =============================================================================

/// Resolve a single XF record into a `DocumentFormat` by direct table lookups only.
///
/// This resolves font/fill/border/numFmt/alignment/protection from the shared tables
/// WITHOUT looking at `xf_id` inheritance. Used for both cellStyleXfs base resolution
/// and as the direct-properties step of cellXfs resolution.
fn resolve_xf_direct(xf: &CellXfInput, input: &StyleInput) -> DocumentFormat {
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
fn resolve_single_xf(xf: &CellXfInput, input: &StyleInput) -> Option<DocumentFormat> {
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
    };

    if fmt == DocumentFormat::default() {
        None
    } else {
        Some(fmt)
    }
}

/// Resolve font input to `FontFormat`.
fn resolve_font(
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
        }
        Some("subscript") => {
            ff.subscript = Some(true);
        }
        _ => {}
    }

    // Charset and family
    ff.charset = font.charset;
    ff.family = font.family;

    ff
}

/// Resolve fill input to `FillFormat`. Returns `None` if no visible fill.
fn resolve_fill(fill: &FillInput, theme_colors: &[String]) -> Option<FillFormat> {
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
fn resolve_border(border: &BorderInput, theme_colors: &[String]) -> Option<BorderFormat> {
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
fn resolve_border_side(
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
fn resolve_alignment(alignment: &AlignmentInput) -> Option<AlignmentFormat> {
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

// =============================================================================
// Format cache
// =============================================================================

/// Memoization cache for resolved formats by style index.
pub struct FormatCache {
    cache: HashMap<u32, Option<DocumentFormat>>,
}

impl FormatCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
        }
    }

    /// Get or compute the resolved format for a style index.
    pub fn get(&mut self, style_idx: u32, input: &StyleInput) -> Option<&DocumentFormat> {
        self.cache
            .entry(style_idx)
            .or_insert_with(|| {
                input
                    .cell_xfs
                    .get(style_idx as usize)
                    .and_then(|xf| resolve_single_xf(xf, input))
            })
            .as_ref()
    }
}

impl Default for FormatCache {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Public API
// =============================================================================

/// Resolve all cell XF records into a flat `Vec<DocumentFormat>`.
///
/// The returned vec is indexed by style index (same position as `cell_xfs`).
/// Style index 0 is always `DocumentFormat::default()` (the Excel default style).
///
/// This is the main entry point for style resolution.
pub fn resolve_styles(input: &StyleInput) -> Vec<DocumentFormat> {
    let mut result = Vec::with_capacity(input.cell_xfs.len());

    for (idx, xf) in input.cell_xfs.iter().enumerate() {
        if idx == 0 {
            // Style index 0: resolve the Normal base style from cellStyleXfs[0]
            // if it exists, otherwise use default.
            let base = input
                .cell_style_xfs
                .first()
                .map(|base_xf| resolve_xf_direct(base_xf, input))
                .unwrap_or_default();
            result.push(base);
            continue;
        }

        match resolve_single_xf(xf, input) {
            Some(fmt) => result.push(fmt),
            None => result.push(DocumentFormat::default()),
        }
    }

    result
}

/// Resolve a single style index, using a `FormatCache` for memoization.
///
/// Returns `None` for the default style (index 0) or unknown indices.
pub fn resolve_style(
    style_idx: u32,
    input: &StyleInput,
    cache: &mut FormatCache,
) -> Option<DocumentFormat> {
    if style_idx == 0 {
        return None;
    }
    cache.get(style_idx, input).cloned()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_input() -> StyleInput {
        StyleInput {
            cell_style_xfs: vec![
                // cellStyleXfs[0]: Normal style — default font/fill/border/numFmt
                CellXfInput {
                    num_fmt_id: Some(0),
                    font_id: Some(0),
                    fill_id: Some(0),
                    border_id: Some(0),
                    ..Default::default()
                },
            ],
            num_fmts: {
                let mut m = HashMap::new();
                m.insert(164, "#,##0.00_);(#,##0.00)".to_string());
                m
            },
            fonts: vec![
                // Font 0: default with minor scheme
                FontInput {
                    name: "Calibri".to_string(),
                    size: 11.0,
                    bold: false,
                    italic: false,
                    underline: Some("none".to_string()),
                    strikethrough: false,
                    color: None,
                    scheme: Some("minor".to_string()),
                    vert_align: None,
                    charset: None,
                    family: None,
                },
                // Font 1: bold with color
                FontInput {
                    name: "Arial".to_string(),
                    size: 14.0,
                    bold: true,
                    italic: true,
                    underline: Some("single".to_string()),
                    strikethrough: false,
                    color: Some(ColorInput {
                        rgb: Some("FFFF0000".to_string()),
                        theme: None,
                        tint: None,
                        indexed: None,
                        auto: false,
                    }),
                    scheme: None,
                    vert_align: Some("superscript".to_string()),
                    charset: None,
                    family: None,
                },
            ],
            fills: vec![
                // Fill 0: none
                FillInput {
                    fill_type: "pattern".to_string(),
                    pattern_type: "none".to_string(),
                    fg_color: None,
                    bg_color: None,
                    gradient: None,
                },
                // Fill 1: gray125 (standard padding)
                FillInput {
                    fill_type: "pattern".to_string(),
                    pattern_type: "gray125".to_string(),
                    fg_color: None,
                    bg_color: None,
                    gradient: None,
                },
                // Fill 2: solid blue
                FillInput {
                    fill_type: "pattern".to_string(),
                    pattern_type: "solid".to_string(),
                    fg_color: Some(ColorInput {
                        rgb: Some("FF4472C4".to_string()),
                        theme: None,
                        tint: None,
                        indexed: None,
                        auto: false,
                    }),
                    bg_color: None,
                    gradient: None,
                },
            ],
            borders: vec![
                // Border 0: none
                BorderInput::default(),
                // Border 1: thin bottom
                BorderInput {
                    bottom: Some(BorderSideInput {
                        style: "thin".to_string(),
                        color: Some(ColorInput {
                            rgb: Some("FF000000".to_string()),
                            ..Default::default()
                        }),
                    }),
                    ..Default::default()
                },
            ],
            cell_xfs: vec![
                // XF 0: default
                CellXfInput {
                    num_fmt_id: Some(0),
                    font_id: Some(0),
                    fill_id: Some(0),
                    border_id: Some(0),
                    apply_number_format: Some(false),
                    apply_font: Some(false),
                    apply_fill: Some(false),
                    apply_border: Some(false),
                    apply_alignment: Some(false),
                    apply_protection: Some(false),
                    ..Default::default()
                },
                // XF 1: bold + blue fill + custom number format + alignment + protection + border
                CellXfInput {
                    num_fmt_id: Some(164),
                    font_id: Some(1),
                    fill_id: Some(2),
                    border_id: Some(1),
                    apply_number_format: Some(true),
                    apply_font: Some(true),
                    apply_fill: Some(true),
                    apply_border: Some(true),
                    apply_alignment: Some(true),
                    apply_protection: Some(true),
                    alignment: Some(AlignmentInput {
                        horizontal: Some("center".to_string()),
                        vertical: Some("center".to_string()),
                        wrap_text: Some(true),
                        indent: Some(2),
                        ..Default::default()
                    }),
                    protection: Some(ProtectionInput {
                        locked: true,
                        hidden: true,
                    }),
                    ..Default::default()
                },
            ],
            theme_colors: vec![],
            major_font: None,
            minor_font: None,
        }
    }

    #[test]
    fn default_style_resolves_normal_base() {
        let input = make_input();
        let palette = resolve_styles(&input);
        // Style index 0 now resolves the Normal base style from cellStyleXfs[0].
        // The Normal style references font 0 (Calibri, scheme=minor, size=11),
        // which produces a non-default font. Fill/border/numFmt are default.
        let fmt = &palette[0];
        let font = fmt.font.as_ref().expect("Normal style should have font");
        assert_eq!(font.scheme.as_deref(), Some("minor"));
        assert_eq!(font.size, Some(11000));
        assert!(fmt.fill.is_none());
        assert!(fmt.border.is_none());
        assert!(fmt.number_format.is_none());
    }

    #[test]
    fn default_style_is_empty_without_cell_style_xfs() {
        // When no cellStyleXfs are provided, index 0 falls back to default.
        let mut input = make_input();
        input.cell_style_xfs.clear();
        let palette = resolve_styles(&input);
        assert_eq!(palette[0], DocumentFormat::default());
    }

    #[test]
    fn full_style_conversion() {
        let input = make_input();
        let palette = resolve_styles(&input);
        let fmt = &palette[1];

        // Number format
        assert_eq!(fmt.number_format.as_deref(), Some("#,##0.00_);(#,##0.00)"));

        // Font
        let font = fmt.font.as_ref().expect("should have font");
        assert_eq!(font.bold, Some(true));
        assert_eq!(font.italic, Some(true));
        assert_eq!(font.underline.as_deref(), Some("single"));
        assert_eq!(font.size, Some(14000));
        assert_eq!(font.name.as_deref(), Some("Arial"));
        assert_eq!(font.color.as_deref(), Some("#FF0000"));
        assert_eq!(font.superscript, Some(true));

        // Fill
        let fill = fmt.fill.as_ref().expect("should have fill");
        assert_eq!(fill.background_color.as_deref(), Some("#4472C4"));

        // Border
        let border = fmt.border.as_ref().expect("should have border");
        let bottom = border.bottom.as_ref().expect("should have bottom border");
        assert_eq!(bottom.style, "thin");
        assert_eq!(bottom.color.as_deref(), Some("#000000"));

        // Alignment
        let align = fmt.alignment.as_ref().expect("should have alignment");
        assert_eq!(align.horizontal.as_deref(), Some("center"));
        assert_eq!(align.vertical.as_deref(), Some("middle")); // center → middle
        assert_eq!(align.wrap_text, Some(true));
        assert_eq!(align.indent, Some(2));

        // Protection
        let prot = fmt.protection.as_ref().expect("should have protection");
        assert_eq!(prot.locked, Some(true));
        assert_eq!(prot.hidden, Some(true));
    }

    #[test]
    fn theme_color_resolution_with_palette() {
        let input = StyleInput {
            theme_colors: vec![
                "#000000".to_string(), // dk1 (palette 0)
                "#FFFFFF".to_string(), // lt1 (palette 1)
                "#44546A".to_string(), // dk2 (palette 2)
                "#E7E6E6".to_string(), // lt2 (palette 3)
                "#4472C4".to_string(), // accent1 (palette 4)
            ],
            ..Default::default()
        };

        // theme=0 → lt1 → palette[1] = #FFFFFF
        let color = ColorInput {
            theme: Some(0),
            ..Default::default()
        };
        assert_eq!(
            resolve_color(&color, &input.theme_colors).as_deref(),
            Some("#FFFFFF")
        );

        // theme=1 → dk1 → palette[0] = #000000
        let color = ColorInput {
            theme: Some(1),
            ..Default::default()
        };
        assert_eq!(
            resolve_color(&color, &input.theme_colors).as_deref(),
            Some("#000000")
        );

        // theme=4 → accent1 → palette[4] = #4472C4
        let color = ColorInput {
            theme: Some(4),
            ..Default::default()
        };
        assert_eq!(
            resolve_color(&color, &input.theme_colors).as_deref(),
            Some("#4472C4")
        );
    }

    #[test]
    fn theme_color_with_tint() {
        let input = StyleInput {
            theme_colors: vec![
                "#000000".to_string(),
                "#FFFFFF".to_string(),
                "#44546A".to_string(),
                "#E7E6E6".to_string(),
                "#4472C4".to_string(), // accent1
            ],
            ..Default::default()
        };

        // theme=4 (accent1 = #4472C4) with positive tint → lighter
        let color = ColorInput {
            theme: Some(4),
            tint: Some(0.5),
            ..Default::default()
        };
        let result = resolve_color(&color, &input.theme_colors);
        assert!(result.is_some());
        let hex = result.unwrap();
        assert!(hex.starts_with('#'));
        assert_eq!(hex.len(), 7); // #RRGGBB
    }

    #[test]
    fn theme_color_fallback_without_palette() {
        // No theme_colors provided — should fall back to symbolic reference
        let color = ColorInput {
            theme: Some(4),
            tint: Some(0.39997),
            ..Default::default()
        };
        assert_eq!(
            resolve_color(&color, &[]).as_deref(),
            Some("theme:accent1:0.39997")
        );

        let color_no_tint = ColorInput {
            theme: Some(0),
            ..Default::default()
        };
        assert_eq!(
            resolve_color(&color_no_tint, &[]).as_deref(),
            Some("theme:light1")
        );
    }

    #[test]
    fn builtin_number_format_resolution() {
        let empty = HashMap::new();
        assert_eq!(resolve_number_format(0, &empty).as_deref(), Some("General"));
        assert_eq!(resolve_number_format(1, &empty).as_deref(), Some("0"));
        assert_eq!(
            resolve_number_format(14, &empty).as_deref(),
            Some("m/d/yyyy")
        );
        assert_eq!(resolve_number_format(49, &empty).as_deref(), Some("@"));
        assert!(resolve_number_format(999, &empty).is_none());
    }

    #[test]
    fn custom_number_format_resolution() {
        let mut custom = HashMap::new();
        custom.insert(164, "0.000%".to_string());
        assert_eq!(
            resolve_number_format(164, &custom).as_deref(),
            Some("0.000%")
        );
        // Built-in still takes priority
        assert_eq!(
            resolve_number_format(0, &custom).as_deref(),
            Some("General")
        );
    }

    #[test]
    fn font_scheme_sets_scheme_not_name() {
        let input = StyleInput {
            fonts: vec![FontInput {
                name: "Calibri".to_string(),
                size: 11.0,
                scheme: Some("minor".to_string()),
                ..Default::default()
            }],
            cell_xfs: vec![
                CellXfInput::default(),
                CellXfInput {
                    font_id: Some(0),
                    apply_font: Some(true),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let palette = resolve_styles(&input);
        let font = palette[1].font.as_ref().expect("should have font");
        assert_eq!(font.scheme.as_deref(), Some("minor"));
        assert!(font.name.is_none());
    }

    #[test]
    fn format_cache_deduplication() {
        let input = make_input();
        let mut cache = FormatCache::new();

        let fmt1 = cache.get(1, &input).cloned();
        let fmt2 = cache.get(1, &input).cloned();
        assert_eq!(fmt1, fmt2);
        assert!(fmt1.is_some());
    }

    #[test]
    fn rgb_normalization() {
        assert_eq!(normalize_rgb("FFFF0000"), "#FF0000");
        assert_eq!(normalize_rgb("FF0000"), "#FF0000");
        assert_eq!(normalize_rgb("#FF0000"), "#FF0000");
        assert_eq!(normalize_rgb("00FF00"), "#00FF00");
    }

    #[test]
    fn border_resolution() {
        let border = BorderInput {
            top: Some(BorderSideInput {
                style: "medium".to_string(),
                color: Some(ColorInput {
                    rgb: Some("FFFF0000".to_string()),
                    ..Default::default()
                }),
            }),
            bottom: Some(BorderSideInput {
                style: "none".to_string(),
                color: None,
            }),
            diagonal: Some(BorderSideInput {
                style: "thin".to_string(),
                color: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: Some(true),
            ..Default::default()
        };

        let bf = resolve_border(&border, &[]).expect("should resolve border");
        assert!(bf.top.is_some());
        assert_eq!(bf.top.as_ref().unwrap().style, "medium");
        assert_eq!(bf.top.as_ref().unwrap().color.as_deref(), Some("#FF0000"));
        assert!(bf.bottom.is_none()); // "none" style is filtered
        assert!(bf.diagonal.is_some());
        assert_eq!(bf.diagonal_up, Some(true));
        assert_eq!(bf.diagonal_down, Some(true));
    }

    #[test]
    fn border_diagonal_absent_vs_explicit_false_preserved() {
        // Absent on the OOXML side (None) must NOT be promoted to Some(false).
        let absent = BorderInput {
            diagonal: Some(BorderSideInput {
                style: "thin".to_string(),
                color: None,
            }),
            diagonal_up: None,
            diagonal_down: None,
            ..Default::default()
        };
        let bf = resolve_border(&absent, &[]).expect("has a diagonal side");
        assert_eq!(bf.diagonal_up, None);
        assert_eq!(bf.diagonal_down, None);

        // Explicit Some(false) must be preserved, not collapsed to None.
        let explicit_false = BorderInput {
            diagonal: Some(BorderSideInput {
                style: "thin".to_string(),
                color: None,
            }),
            diagonal_up: Some(false),
            diagonal_down: Some(false),
            ..Default::default()
        };
        let bf = resolve_border(&explicit_false, &[]).expect("has a diagonal side");
        assert_eq!(bf.diagonal_up, Some(false));
        assert_eq!(bf.diagonal_down, Some(false));

        // Asymmetric: one explicit true, other absent.
        let asymmetric = BorderInput {
            diagonal: Some(BorderSideInput {
                style: "thin".to_string(),
                color: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: None,
            ..Default::default()
        };
        let bf = resolve_border(&asymmetric, &[]).expect("has a diagonal side");
        assert_eq!(bf.diagonal_up, Some(true));
        assert_eq!(bf.diagonal_down, None);
    }

    #[test]
    fn alignment_resolution_preserves_all_fields() {
        let input = AlignmentInput {
            text_rotation: Some(255), // stacked/vertical sentinel
            reading_order: Some(2),   // rtl
            shrink_to_fit: Some(false),
            wrap_text: Some(false),
            indent: Some(0),
            relative_indent: Some(-3),
            justify_last_line: Some(true),
            ..Default::default()
        };
        let af = resolve_alignment(&input).expect("has properties");
        assert_eq!(af.rotation, Some(255));
        assert_eq!(af.reading_order.as_deref(), Some("rtl"));
        assert_eq!(af.shrink_to_fit, Some(false));
        assert_eq!(af.wrap_text, Some(false));
        assert_eq!(af.indent, Some(0));
        assert_eq!(af.relative_indent, Some(-3));
        assert_eq!(af.justify_last_line, Some(true));
    }

    #[test]
    fn alignment_resolution_reading_order_tokens() {
        for (int_val, token) in [(0u32, "context"), (1, "ltr"), (2, "rtl")] {
            let input = AlignmentInput {
                reading_order: Some(int_val),
                ..Default::default()
            };
            let af = resolve_alignment(&input).expect("has readingOrder");
            assert_eq!(af.reading_order.as_deref(), Some(token));
        }
        // Unknown reading order value must not materialize a token.
        let input = AlignmentInput {
            reading_order: Some(99),
            ..Default::default()
        };
        assert!(resolve_alignment(&input).is_none());
    }

    #[test]
    fn apply_tint_positive_lightens() {
        // White has L=1.0, tinting further stays white
        let result = apply_tint("#000000", 0.5);
        // Black (L=0) with tint 0.5 → L = 0*(1-0.5) + 0.5 = 0.5 → mid-gray
        assert_eq!(result.len(), 7);
        assert!(result.starts_with('#'));
        // Should be approximately #808080 (mid-gray)
        let hex = &result[1..];
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap();
        assert!(r > 100 && r < 140, "expected mid-gray, got R={}", r);
    }

    #[test]
    fn apply_tint_negative_darkens() {
        // White with negative tint → darker
        let result = apply_tint("#FFFFFF", -0.5);
        let hex = &result[1..];
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap();
        assert!(r > 100 && r < 140, "expected mid-gray, got R={}", r);
    }

    #[test]
    fn resolve_styles_preserves_indices() {
        let input = make_input();
        let palette = resolve_styles(&input);
        assert_eq!(palette.len(), input.cell_xfs.len());
    }
}
