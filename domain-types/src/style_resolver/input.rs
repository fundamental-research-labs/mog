use std::collections::HashMap;

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
    /// Order: [dk1, lt1, dk2, lt2, accent1..accent6, hyperlink, followedHyperlink]
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
    pub quote_prefix: bool,
    pub pivot_button: bool,
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
    pub condense: Option<bool>,
    pub extend: Option<bool>,
    pub outline: Option<bool>,
    pub shadow: Option<bool>,
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
    /// Indexed color (legacy palette).
    pub indexed: Option<u32>,
    /// Auto color flag.
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
