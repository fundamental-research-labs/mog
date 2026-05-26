use crate::canvas::SheetCanvas;
use compute_text_measurement::FontDb;
use std::sync::OnceLock;

// ── Color constants (u8 tuples) ─────────────────────────────────────

pub const WHITE_RGB: (u8, u8, u8) = (255, 255, 255);
pub const BLACK_RGB: (u8, u8, u8) = (0, 0, 0);
pub const GRIDLINE_RGB: (u8, u8, u8) = (208, 215, 222);
pub const HEADER_BG_RGB: (u8, u8, u8) = (248, 249, 250);
pub const HEADER_BORDER_RGB: (u8, u8, u8) = (218, 220, 224);
pub const RED_RGB: (u8, u8, u8) = (255, 0, 0);
pub const GREEN_RGB: (u8, u8, u8) = (0, 255, 0);
pub const BLUE_RGB: (u8, u8, u8) = (0, 0, 255);

// ── Shared font DB ──────────────────────────────────────────────────

pub fn shared_font_db() -> &'static FontDb {
    static DB: OnceLock<FontDb> = OnceLock::new();
    DB.get_or_init(FontDb::with_defaults)
}

// ── Single-pixel assertions ─────────────────────────────────────────

/// Assert that pixel (px, py) matches `expected` RGB within `tolerance` per channel.
#[track_caller]
pub fn assert_pixel_eq(
    canvas: &SheetCanvas,
    px: u32,
    py: u32,
    expected: (u8, u8, u8),
    tolerance: u8,
    msg: &str,
) {
    let (r, g, b, _a) = canvas.pixel_at(px, py);
    assert!(
        r.abs_diff(expected.0) <= tolerance
            && g.abs_diff(expected.1) <= tolerance
            && b.abs_diff(expected.2) <= tolerance,
        "{msg}: pixel ({px},{py}) = ({r},{g},{b}), expected ({},{},{}) ±{tolerance}",
        expected.0,
        expected.1,
        expected.2,
    );
}

/// Assert that pixel (px, py) is white (255,255,255).
#[track_caller]
pub fn assert_pixel_white(canvas: &SheetCanvas, px: u32, py: u32, msg: &str) {
    assert_pixel_eq(canvas, px, py, WHITE_RGB, 0, msg);
}

// ── Rectangle assertions ────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl PixelRect {
    pub fn new(x: u32, y: u32, w: u32, h: u32) -> Self {
        Self { x, y, w, h }
    }
}

/// Assert every pixel in [x..x+w) × [y..y+h) matches `expected` within `tolerance`.
#[track_caller]
pub fn assert_rect_filled(
    canvas: &SheetCanvas,
    rect: PixelRect,
    expected: (u8, u8, u8),
    tolerance: u8,
    msg: &str,
) {
    for py in rect.y..rect.y + rect.h {
        for px in rect.x..rect.x + rect.w {
            let (r, g, b, _a) = canvas.pixel_at(px, py);
            assert!(
                r.abs_diff(expected.0) <= tolerance
                    && g.abs_diff(expected.1) <= tolerance
                    && b.abs_diff(expected.2) <= tolerance,
                "{msg}: pixel ({px},{py}) = ({r},{g},{b}), expected ({},{},{}) ±{tolerance}",
                expected.0,
                expected.1,
                expected.2,
            );
        }
    }
}

/// Assert every pixel in [x..x+w) × [y..y+h) is white.
#[track_caller]
pub fn assert_rect_white(canvas: &SheetCanvas, x: u32, y: u32, w: u32, h: u32, msg: &str) {
    assert_rect_filled(canvas, PixelRect::new(x, y, w, h), WHITE_RGB, 0, msg);
}

// ── Line/band assertions ────────────────────────────────────────────

/// Assert that within the pixel band [y_center - band .. y_center + band],
/// at least one pixel at x=x_sample matches `expected` within `tolerance`.
///
/// This handles ±1px uncertainty in how tiny-skia rasterizes strokes.
#[track_caller]
pub fn assert_row_colored_in_band(
    canvas: &SheetCanvas,
    y_center: u32,
    band: u32,
    x_sample: u32,
    expected: (u8, u8, u8),
    tolerance: u8,
    msg: &str,
) {
    let y_start = y_center.saturating_sub(band);
    let y_end = (y_center + band).min(canvas.height() - 1);
    for py in y_start..=y_end {
        let (r, g, b, _a) = canvas.pixel_at(x_sample, py);
        if r.abs_diff(expected.0) <= tolerance
            && g.abs_diff(expected.1) <= tolerance
            && b.abs_diff(expected.2) <= tolerance
        {
            return; // found a match
        }
    }
    // No match — build diagnostic
    let mut found = Vec::new();
    for py in y_start..=y_end {
        let (r, g, b, _a) = canvas.pixel_at(x_sample, py);
        found.push(format!("  y={py}: ({r},{g},{b})"));
    }
    panic!(
        "{msg}: no pixel in band y=[{y_start}..{y_end}] at x={x_sample} matched ({},{},{}) ±{tolerance}\nfound:\n{}",
        expected.0,
        expected.1,
        expected.2,
        found.join("\n"),
    );
}

/// Same as assert_row_colored_in_band but for a vertical band around x_center.
#[track_caller]
pub fn assert_col_colored_in_band(
    canvas: &SheetCanvas,
    x_center: u32,
    band: u32,
    y_sample: u32,
    expected: (u8, u8, u8),
    tolerance: u8,
    msg: &str,
) {
    let x_start = x_center.saturating_sub(band);
    let x_end = (x_center + band).min(canvas.width() - 1);
    for px in x_start..=x_end {
        let (r, g, b, _a) = canvas.pixel_at(px, y_sample);
        if r.abs_diff(expected.0) <= tolerance
            && g.abs_diff(expected.1) <= tolerance
            && b.abs_diff(expected.2) <= tolerance
        {
            return;
        }
    }
    let mut found = Vec::new();
    for px in x_start..=x_end {
        let (r, g, b, _a) = canvas.pixel_at(px, y_sample);
        found.push(format!("  x={px}: ({r},{g},{b})"));
    }
    panic!(
        "{msg}: no pixel in band x=[{x_start}..{x_end}] at y={y_sample} matched ({},{},{}) ±{tolerance}\nfound:\n{}",
        expected.0,
        expected.1,
        expected.2,
        found.join("\n"),
    );
}

// ── Counting helpers ────────────────────────────────────────────────

/// Count pixels in column `px` from y_start..y_end where any channel < threshold.
pub fn count_dark_pixels_in_col(
    canvas: &SheetCanvas,
    px: u32,
    y_start: u32,
    y_end: u32,
    threshold: u8,
) -> u32 {
    let mut count = 0;
    for py in y_start..y_end {
        let (r, g, b, _) = canvas.pixel_at(px, py);
        if r < threshold || g < threshold || b < threshold {
            count += 1;
        }
    }
    count
}

// ── Text bounds detection ───────────────────────────────────────────

/// Find the leftmost and rightmost x-coordinates of "dark" pixels
/// (any channel < `dark_threshold`) in the region [y_start..y_end) × [x_start..x_end).
///
/// Returns `None` if no dark pixels found.
pub fn find_text_horizontal_bounds(
    canvas: &SheetCanvas,
    y_start: u32,
    y_end: u32,
    x_start: u32,
    x_end: u32,
    dark_threshold: u8,
) -> Option<(u32, u32)> {
    let mut min_x = u32::MAX;
    let mut max_x = 0;
    for py in y_start..y_end {
        for px in x_start..x_end {
            let (r, g, b, _) = canvas.pixel_at(px, py);
            if r < dark_threshold || g < dark_threshold || b < dark_threshold {
                min_x = min_x.min(px);
                max_x = max_x.max(px);
            }
        }
    }
    if min_x <= max_x {
        Some((min_x, max_x))
    } else {
        None
    }
}

/// Find the topmost and bottommost y-coordinates of "dark" pixels in a region.
pub fn find_text_vertical_bounds(
    canvas: &SheetCanvas,
    y_start: u32,
    y_end: u32,
    x_start: u32,
    x_end: u32,
    dark_threshold: u8,
) -> Option<(u32, u32)> {
    let mut min_y = u32::MAX;
    let mut max_y = 0;
    for py in y_start..y_end {
        for px in x_start..x_end {
            let (r, g, b, _) = canvas.pixel_at(px, py);
            if r < dark_threshold || g < dark_threshold || b < dark_threshold {
                min_y = min_y.min(py);
                max_y = max_y.max(py);
            }
        }
    }
    if min_y <= max_y {
        Some((min_y, max_y))
    } else {
        None
    }
}
