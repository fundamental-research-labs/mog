use compute_text_measurement::FontDb;

use crate::canvas::SheetCanvas;
use crate::colors;
use crate::text;

/// Default header font size in points.
const HEADER_FONT_SIZE: f32 = 11.0;

/// Convert a zero-based column index to an Excel column label (A, B, ..., Z, AA, AB, ...).
pub fn col_label(col: u32) -> String {
    let mut label = String::new();
    let mut n = col as i64;
    loop {
        label.insert(0, (b'A' + (n % 26) as u8) as char);
        n = n / 26 - 1;
        if n < 0 {
            break;
        }
    }
    label
}

/// Compute the pixel width needed for the row header band (width of the largest row number).
pub fn row_header_width(font_db: &FontDb, max_row_label: &str, font_size: f32) -> f32 {
    let (_, entry) = font_db
        .resolve("Carlito")
        .unwrap_or_else(|| font_db.resolve("Liberation Sans").expect("no default font"));
    let face = entry.face().expect("face parse");
    let w = text::measure_text_advance(&face, font_size, max_row_label);
    // Add padding (8px each side)
    w + 16.0
}

/// Render column headers (A, B, C, ...) across the top.
///
/// `col_positions` = cumulative pixel offsets for columns (relative to the data area).
/// `start_col` = the zero-based column index of the first column.
/// `offset_x` = x offset of the data area (after row header band).
/// `header_height` = height of the column header band.
pub fn render_col_headers(
    canvas: &mut SheetCanvas,
    col_positions: &[f64],
    start_col: u32,
    offset_x: f32,
    header_height: f32,
    font_db: &FontDb,
) {
    if col_positions.len() < 2 {
        return;
    }

    let (_, entry) = match font_db.resolve("Carlito") {
        Some(e) => e,
        None => return,
    };
    let buzz_face = match entry.face() {
        Some(f) => f,
        None => return,
    };
    let ttf_face = match ttf_parser::Face::parse(entry.data(), entry.index()) {
        Ok(f) => f,
        Err(_) => return,
    };

    let total_width = *col_positions.last().unwrap() as f32;

    // Background
    canvas.fill_rect(
        offset_x,
        0.0,
        total_width,
        header_height,
        colors::header_bg(),
    );

    // Bottom border of header band
    canvas.stroke_line(
        offset_x,
        header_height,
        offset_x + total_width,
        header_height,
        colors::header_border(),
        1.0,
    );

    let ascender = text::ascender_px(&buzz_face, HEADER_FONT_SIZE);
    let line_h = text::line_height_px(&buzz_face, HEADER_FONT_SIZE);
    let text_y = (header_height - line_h) / 2.0 + ascender;

    for i in 0..(col_positions.len() - 1) {
        let x = col_positions[i] as f32 + offset_x;
        let w = (col_positions[i + 1] - col_positions[i]) as f32;

        // Vertical separator
        if i > 0 {
            canvas.stroke_line(x, 0.0, x, header_height, colors::header_border(), 1.0);
        }

        let label = col_label(start_col + i as u32);
        let text_w = text::measure_text_advance(&buzz_face, HEADER_FONT_SIZE, &label);
        let text_x = x + (w - text_w) / 2.0;

        text::render_text(
            canvas,
            &buzz_face,
            &ttf_face,
            text::TextRun {
                font_size: HEADER_FONT_SIZE,
                text: &label,
                x: text_x,
                y: text_y,
                color: colors::header_text(),
            },
        );
    }
}

/// Render row headers (1, 2, 3, ...) down the left side.
///
/// `row_positions` = cumulative pixel offsets for rows (relative to the data area).
/// `start_row` = the zero-based row index of the first row.
/// `offset_y` = y offset of the data area (after column header band).
/// `header_width` = width of the row header band.
pub fn render_row_headers(
    canvas: &mut SheetCanvas,
    row_positions: &[f64],
    start_row: u32,
    offset_y: f32,
    header_width: f32,
    font_db: &FontDb,
) {
    if row_positions.len() < 2 {
        return;
    }

    let (_, entry) = match font_db.resolve("Carlito") {
        Some(e) => e,
        None => return,
    };
    let buzz_face = match entry.face() {
        Some(f) => f,
        None => return,
    };
    let ttf_face = match ttf_parser::Face::parse(entry.data(), entry.index()) {
        Ok(f) => f,
        Err(_) => return,
    };

    let total_height = *row_positions.last().unwrap() as f32;

    // Background
    canvas.fill_rect(
        0.0,
        offset_y,
        header_width,
        total_height,
        colors::header_bg(),
    );

    // Right border of header band
    canvas.stroke_line(
        header_width,
        offset_y,
        header_width,
        offset_y + total_height,
        colors::header_border(),
        1.0,
    );

    let ascender = text::ascender_px(&buzz_face, HEADER_FONT_SIZE);
    let line_h = text::line_height_px(&buzz_face, HEADER_FONT_SIZE);

    for i in 0..(row_positions.len() - 1) {
        let y = row_positions[i] as f32 + offset_y;
        let h = (row_positions[i + 1] - row_positions[i]) as f32;

        // Horizontal separator
        if i > 0 {
            canvas.stroke_line(0.0, y, header_width, y, colors::header_border(), 1.0);
        }

        let label = (start_row + i as u32 + 1).to_string(); // 1-based
        let text_w = text::measure_text_advance(&buzz_face, HEADER_FONT_SIZE, &label);
        let text_x = (header_width - text_w) / 2.0;
        let text_y = y + (h - line_h) / 2.0 + ascender;

        text::render_text(
            canvas,
            &buzz_face,
            &ttf_face,
            text::TextRun {
                font_size: HEADER_FONT_SIZE,
                text: &label,
                x: text_x,
                y: text_y,
                color: colors::header_text(),
            },
        );
    }
}

/// Render the corner cell (top-left intersection of row and column headers).
pub fn render_corner(canvas: &mut SheetCanvas, header_width: f32, header_height: f32) {
    canvas.fill_rect(0.0, 0.0, header_width, header_height, colors::header_bg());
    canvas.stroke_line(
        header_width,
        0.0,
        header_width,
        header_height,
        colors::header_border(),
        1.0,
    );
    canvas.stroke_line(
        0.0,
        header_height,
        header_width,
        header_height,
        colors::header_border(),
        1.0,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;

    #[test]
    fn col_label_single() {
        assert_eq!(col_label(0), "A");
        assert_eq!(col_label(1), "B");
        assert_eq!(col_label(25), "Z");
    }

    #[test]
    fn col_label_double() {
        assert_eq!(col_label(26), "AA");
        assert_eq!(col_label(27), "AB");
        assert_eq!(col_label(51), "AZ");
        assert_eq!(col_label(52), "BA");
    }

    #[test]
    fn col_label_triple() {
        assert_eq!(col_label(702), "AAA");
    }

    #[test]
    fn row_header_width_reasonable() {
        let db = shared_font_db();
        let w = row_header_width(db, "100", HEADER_FONT_SIZE);
        assert!(w > 20.0, "expected reasonable width, got {w}");
        assert!(w < 100.0, "width unexpectedly large: {w}");
    }

    #[test]
    fn col_header_background_exact() {
        let db = shared_font_db();
        let mut canvas = SheetCanvas::new(200, 25, 1.0);
        let cols = vec![0.0, 64.0, 128.0, 200.0];
        render_col_headers(&mut canvas, &cols, 0, 0.0, 20.0, db);

        // Header background should fill the region. Sample several points
        // that are NOT on text or separator lines.
        // Between cols 0 and 1, near the top (likely above text)
        assert_pixel_eq(&canvas, 5, 2, HEADER_BG_RGB, 3, "col header bg top-left");
        assert_pixel_eq(&canvas, 100, 2, HEADER_BG_RGB, 3, "col header bg mid");

        // Below the header band should be white
        assert_pixel_white(&canvas, 50, 22, "below col header band");
    }

    #[test]
    fn col_header_separators_at_positions() {
        let db = shared_font_db();
        let mut canvas = SheetCanvas::new(200, 25, 1.0);
        let cols = vec![0.0, 64.0, 128.0, 200.0];
        render_col_headers(&mut canvas, &cols, 0, 0.0, 20.0, db);

        // Separator at x=64 (between col A and B)
        assert_col_colored_in_band(
            &canvas,
            64,
            1,
            10,
            HEADER_BORDER_RGB,
            5,
            "col separator at x=64",
        );
        // Separator at x=128
        assert_col_colored_in_band(
            &canvas,
            128,
            1,
            10,
            HEADER_BORDER_RGB,
            5,
            "col separator at x=128",
        );
        // Bottom border of header at y=20
        assert_row_colored_in_band(
            &canvas,
            20,
            1,
            50,
            HEADER_BORDER_RGB,
            5,
            "col header bottom border",
        );
    }

    #[test]
    fn col_header_text_roughly_centered() {
        let db = shared_font_db();
        let mut canvas = SheetCanvas::new(200, 25, 1.0);
        let cols = vec![0.0, 64.0, 128.0, 200.0];
        render_col_headers(&mut canvas, &cols, 0, 0.0, 20.0, db);

        // Find text bounds for column A (x: 0..64)
        let bounds = find_text_horizontal_bounds(&canvas, 2, 18, 0, 64, 200);
        assert!(bounds.is_some(), "column A header text not found");
        let (left, right) = bounds.unwrap();
        let center_x = (left + right) / 2;
        // Column center is at x=32; text should be roughly centered
        assert!(
            center_x.abs_diff(32) < 10,
            "column A text center at {center_x}, expected near 32"
        );
    }

    #[test]
    fn row_header_background_exact() {
        let db = shared_font_db();
        let mut canvas = SheetCanvas::new(50, 100, 1.0);
        let rows = vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0];
        render_row_headers(&mut canvas, &rows, 0, 0.0, 40.0, db);

        // Header background
        assert_pixel_eq(&canvas, 5, 5, HEADER_BG_RGB, 3, "row header bg");
        assert_pixel_eq(&canvas, 5, 50, HEADER_BG_RGB, 3, "row header bg mid");

        // Right of header band should be white
        assert_pixel_white(&canvas, 42, 50, "right of row header band");
    }

    #[test]
    fn row_header_separators_at_positions() {
        let db = shared_font_db();
        let mut canvas = SheetCanvas::new(50, 100, 1.0);
        let rows = vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0];
        render_row_headers(&mut canvas, &rows, 0, 0.0, 40.0, db);

        // Horizontal separator at y=20 (between row 1 and row 2)
        assert_row_colored_in_band(
            &canvas,
            20,
            1,
            20,
            HEADER_BORDER_RGB,
            5,
            "row separator at y=20",
        );
        // Right border at x=40
        assert_col_colored_in_band(
            &canvas,
            40,
            1,
            50,
            HEADER_BORDER_RGB,
            5,
            "row header right border",
        );
    }

    #[test]
    fn corner_fills_exact_rect() {
        let mut canvas = SheetCanvas::new(50, 25, 1.0);
        render_corner(&mut canvas, 40.0, 20.0);

        // Interior of corner should be header background
        assert_pixel_eq(&canvas, 5, 5, HEADER_BG_RGB, 3, "corner interior");
        assert_pixel_eq(&canvas, 35, 15, HEADER_BG_RGB, 3, "corner interior far");

        // Right border at x=40
        assert_col_colored_in_band(
            &canvas,
            40,
            1,
            10,
            HEADER_BORDER_RGB,
            5,
            "corner right border",
        );
        // Bottom border at y=20
        assert_row_colored_in_band(
            &canvas,
            20,
            1,
            20,
            HEADER_BORDER_RGB,
            5,
            "corner bottom border",
        );
    }
}
