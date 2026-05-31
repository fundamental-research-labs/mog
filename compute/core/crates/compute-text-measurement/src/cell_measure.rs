use crate::font_db::FontDb;
use crate::shaper;
use crate::wrap;

/// Cell padding (each side) — matches TS DEFAULT_CELL_STYLE.CELL_PADDING.
pub const CELL_PADDING: f32 = 4.0;

/// Extra padding added during autofit to prevent text clipping.
pub const AUTOFIT_PADDING: f32 = 2.0;

/// Pixels per indent level — matches TS INDENT_WIDTH.
pub const INDENT_WIDTH: f32 = 8.0;

/// Default line height factor when font metrics are unavailable.
pub const DEFAULT_LINE_HEIGHT_FACTOR: f32 = 1.2;

/// Maximum autofit width in pixels.
pub const MAX_AUTOFIT_WIDTH: f32 = 500.0;

/// Maximum autofit height in pixels (Excel max).
pub const MAX_AUTOFIT_HEIGHT: f32 = 409.0;

/// Minimum column width in pixels.
pub const MIN_COL_WIDTH: f32 = 20.0;

/// Minimum row height in pixels.
pub const MIN_ROW_HEIGHT: f32 = 16.0;

/// Measure the width needed for a cell's display text, accounting for
/// font, padding, indent, and autofit padding.
///
/// `display_text` should be pre-formatted (via `compute_formats::format_value`).
/// `font_family` is the CSS font family from CellFormat (e.g. "Calibri").
/// `font_size` is in points (e.g. 11.0).
pub fn measure_cell_width(
    font_db: &FontDb,
    font_family: &str,
    font_size_pt: f32,
    bold: bool,
    italic: bool,
    indent: u32,
    display_text: &str,
) -> f32 {
    if display_text.is_empty() {
        return 0.0;
    }

    let font_size_px = font_size_pt;

    let (_font_id, entry) = match font_db.resolve_styled(font_family, bold, italic) {
        Some(r) => r,
        None => return 0.0,
    };

    let face = match entry.face() {
        Some(f) => f,
        None => return 0.0,
    };

    // For multiline text (contains newlines), measure each line and take max
    let text_width = if display_text.contains('\n') {
        display_text
            .lines()
            .map(|line| shaper::measure_text_width(&face, font_size_px, line))
            .fold(0.0f32, f32::max)
    } else {
        shaper::measure_text_width(&face, font_size_px, display_text)
    };

    let indent_px = indent as f32 * INDENT_WIDTH;
    text_width + CELL_PADDING * 2.0 + AUTOFIT_PADDING + indent_px
}

/// Measure the height needed for a cell, accounting for text wrapping.
///
/// `available_width` is the column width minus padding (for wrap calculation).
/// If the cell has wrap_text enabled and available_width > 0, text will be
/// wrapped and the height will reflect the number of wrapped lines.
#[allow(clippy::too_many_arguments)]
pub fn measure_cell_height(
    font_db: &FontDb,
    font_family: &str,
    font_size_pt: f32,
    bold: bool,
    italic: bool,
    wrap_text: bool,
    display_text: &str,
    available_width: f32,
) -> f32 {
    if display_text.is_empty() {
        return 0.0;
    }

    let font_size_px = font_size_pt;

    let (_font_id, entry) = match font_db.resolve_styled(font_family, bold, italic) {
        Some(r) => r,
        None => return font_size_px * DEFAULT_LINE_HEIGHT_FACTOR,
    };

    let face = match entry.face() {
        Some(f) => f,
        None => return font_size_px * DEFAULT_LINE_HEIGHT_FACTOR,
    };

    let line_height = shaper::measure_line_height(&face, font_size_px);

    if wrap_text && available_width > CELL_PADDING * 2.0 {
        let wrap_width = available_width - CELL_PADDING * 2.0;
        let lines = wrap::wrap_text(&face, font_size_px, display_text, wrap_width);
        let num_lines = lines.max(1) as f32;
        num_lines * line_height + CELL_PADDING * 2.0
    } else {
        // Count explicit newlines
        let num_lines = display_text.matches('\n').count() as f32 + 1.0;
        num_lines * line_height + CELL_PADDING * 2.0
    }
}

/// Measure rotated cell dimensions.
/// Returns (width, height) after applying rotation.
/// `rotation` is in degrees (0-180, where 0=horizontal, 90=vertical,
/// 255=vertical text in Excel).
pub fn measure_rotated_cell(
    font_db: &FontDb,
    font_family: &str,
    font_size_pt: f32,
    bold: bool,
    italic: bool,
    display_text: &str,
    rotation: u16,
) -> (f32, f32) {
    if display_text.is_empty() || rotation == 0 {
        let w = measure_cell_width(
            font_db,
            font_family,
            font_size_pt,
            bold,
            italic,
            0,
            display_text,
        );
        let h = measure_cell_height(
            font_db,
            font_family,
            font_size_pt,
            bold,
            italic,
            false,
            display_text,
            0.0,
        );
        return (w, h);
    }

    let font_size_px = font_size_pt;
    let (_font_id, entry) = match font_db.resolve_styled(font_family, bold, italic) {
        Some(r) => r,
        None => return (0.0, 0.0),
    };
    let face = match entry.face() {
        Some(f) => f,
        None => return (0.0, 0.0),
    };

    let text_width = shaper::measure_text_width(&face, font_size_px, display_text);
    let line_height = shaper::measure_line_height(&face, font_size_px);

    // Excel rotation: 0-90 = counterclockwise degrees, 91-180 = -(91-180) degrees
    // 255 = vertical stacked text
    if rotation == 255 {
        // Vertical stacked text: width = single char width, height = sum of char heights
        let char_count = display_text.chars().count() as f32;
        let w = font_size_px + CELL_PADDING * 2.0;
        let h = char_count * line_height + CELL_PADDING * 2.0;
        return (w, h);
    }

    let degrees = if rotation <= 90 {
        rotation as f32
    } else {
        -(rotation as f32 - 90.0)
    };
    let radians = degrees * std::f32::consts::PI / 180.0;
    let cos = radians.cos().abs();
    let sin = radians.sin().abs();

    let rotated_w = text_width * cos + line_height * sin + CELL_PADDING * 2.0 + AUTOFIT_PADDING;
    let rotated_h = text_width * sin + line_height * cos + CELL_PADDING * 2.0;

    (rotated_w, rotated_h)
}
