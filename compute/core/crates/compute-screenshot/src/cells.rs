use compute_text_measurement::FontDb;
use compute_wire::ViewportRenderData;
use domain_types::CellFormat;

use crate::borders::{self, CellBorderRefs};
use crate::canvas::{CssRect, SheetCanvas};
use crate::colors;
use crate::text;

/// Default font size in points (Calibri 11pt equivalent).
const DEFAULT_FONT_SIZE: f32 = 11.0;
/// Default font family.
const DEFAULT_FONT_FAMILY: &str = "Calibri";
/// Cell horizontal padding in CSS pixels.
const CELL_PADDING: f32 = 4.0;

/// Render all cells from ViewportRenderData onto the canvas.
///
/// `offset_x` / `offset_y` shift the data area (e.g., to account for headers).
/// `row_positions` / `col_positions` are cumulative pixel offsets from the data origin.
pub fn render_cells(
    canvas: &mut SheetCanvas,
    data: &ViewportRenderData,
    row_positions: &[f64],
    col_positions: &[f64],
    offset_x: f32,
    offset_y: f32,
    font_db: &FontDb,
) {
    for cell in &data.cells {
        let local_row = cell.row.saturating_sub(data.start_row) as usize;
        let local_col = cell.col.saturating_sub(data.start_col) as usize;

        // Bounds check
        if local_row + 1 >= row_positions.len() || local_col + 1 >= col_positions.len() {
            continue;
        }

        let x = col_positions[local_col] as f32 + offset_x;
        let y = row_positions[local_row] as f32 + offset_y;
        let w = (col_positions[local_col + 1] - col_positions[local_col]) as f32;
        let h = (row_positions[local_row + 1] - row_positions[local_row]) as f32;

        // Skip hidden (zero-size) cells
        if w < 0.5 || h < 0.5 {
            continue;
        }

        let format = data
            .format_palette
            .get(cell.format_idx as usize)
            .cloned()
            .unwrap_or_default();

        // 1. Fill background
        render_cell_fill(canvas, x, y, w, h, &format, cell.bg_color_override);

        // 2. Text
        if let Some(ref text_str) = cell.formatted {
            render_cell_text(
                canvas,
                CellText {
                    rect: CssRect::new(x, y, w, h),
                    text: text_str,
                    format: &format,
                    font_color_override: cell.font_color_override,
                    font_db,
                },
            );
        }

        // 3. Borders
        if let Some(ref borders) = format.borders {
            borders::render_cell_borders(
                canvas,
                CssRect::new(x, y, w, h),
                CellBorderRefs {
                    top: borders.top.as_ref(),
                    right: borders.right.as_ref(),
                    bottom: borders.bottom.as_ref(),
                    left: borders.left.as_ref(),
                },
            );
        }
    }
}

/// Render cell background fill.
fn render_cell_fill(
    canvas: &mut SheetCanvas,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    format: &CellFormat,
    bg_color_override: u32,
) {
    // CF override takes precedence
    if let Some(color) = colors::rgba_to_color(bg_color_override) {
        canvas.fill_rect(x, y, w, h, color);
        return;
    }

    // Explicit fill from format
    if let Some(ref bg) = format.background_color
        && let Some(color) = colors::css_hex_to_color(bg)
    {
        // Only fill if pattern is Solid or absent (default=solid).
        use ooxml_types::styles::PatternType;
        let is_solid = matches!(format.pattern_type, None | Some(PatternType::Solid));
        if is_solid {
            canvas.fill_rect(x, y, w, h, color);
        }
    }
}

struct CellText<'a> {
    rect: CssRect,
    text: &'a str,
    format: &'a CellFormat,
    font_color_override: u32,
    font_db: &'a FontDb,
}

/// Render cell text with alignment.
fn render_cell_text(canvas: &mut SheetCanvas, cell_text: CellText<'_>) {
    if cell_text.text.is_empty() {
        return;
    }

    let rect = cell_text.rect;
    let format = cell_text.format;
    let family = format.font_family.as_deref().unwrap_or(DEFAULT_FONT_FAMILY);
    let bold = format.bold.unwrap_or(false);
    let italic = format.italic.unwrap_or(false);
    let font_size = format
        .font_size
        .map(|fs| fs.points() as f32)
        .unwrap_or(DEFAULT_FONT_SIZE);

    let (_, entry) = match cell_text.font_db.resolve_styled(family, bold, italic) {
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

    // Determine text color
    let text_color = colors::rgba_to_color(cell_text.font_color_override)
        .or_else(|| {
            format
                .font_color
                .as_deref()
                .and_then(colors::css_hex_to_color)
        })
        .unwrap_or(colors::BLACK);

    let text_w = text::measure_text_advance(&buzz_face, font_size, cell_text.text);
    let ascender = text::ascender_px(&buzz_face, font_size);
    let line_h = text::line_height_px(&buzz_face, font_size);

    // Horizontal alignment
    use domain_types::CellVerticalAlign;
    use ooxml_types::styles::HorizontalAlign;
    let h_align = format.horizontal_align.unwrap_or(HorizontalAlign::General);
    let text_x = match h_align {
        HorizontalAlign::Center | HorizontalAlign::CenterContinuous => {
            rect.x + (rect.w - text_w) / 2.0
        }
        HorizontalAlign::Right => rect.x + rect.w - text_w - CELL_PADDING,
        _ => rect.x + CELL_PADDING, // Left, General, Fill, Justify, Distributed
    };

    // Vertical alignment
    let v_align = format.vertical_align.unwrap_or(CellVerticalAlign::Bottom);
    let text_y = match v_align {
        CellVerticalAlign::Top => rect.y + ascender + 2.0,
        CellVerticalAlign::Middle => rect.y + (rect.h - line_h) / 2.0 + ascender,
        _ => rect.y + rect.h - (line_h - ascender) - 2.0, // Bottom default, Justify, Distributed
    };

    // Clip to cell bounds
    canvas.set_clip(rect.x, rect.y, rect.w, rect.h);
    text::render_text(
        canvas,
        &buzz_face,
        &ttf_face,
        text::TextRun {
            font_size,
            text: cell_text.text,
            x: text_x,
            y: text_y,
            color: text_color,
        },
    );
    canvas.clear_clip();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;
    use compute_wire::{ViewportRenderCell, ViewportRenderData};

    fn make_viewport_data(cells: Vec<ViewportRenderCell>) -> ViewportRenderData {
        ViewportRenderData {
            cells,
            format_palette: vec![CellFormat::default()],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 5,
            viewport_cols: 5,
            start_row: 0,
            start_col: 0,
            row_positions: vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0],
            col_positions: vec![0.0, 64.0, 128.0, 192.0, 256.0, 320.0],
        }
    }

    fn make_cell(row: u32, col: u32, text: &str) -> ViewportRenderCell {
        ViewportRenderCell {
            row,
            col,
            format_idx: 0,
            flags: 0,
            number_value: f64::NAN,
            formatted: Some(text.to_string()),
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }
    }

    fn make_cell_with_format(
        row: u32,
        col: u32,
        text: &str,
        format_idx: u16,
    ) -> ViewportRenderCell {
        ViewportRenderCell {
            row,
            col,
            format_idx,
            flags: 0,
            number_value: f64::NAN,
            formatted: if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            },
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }
    }

    #[test]
    fn render_cell_text_position() {
        let db = shared_font_db();
        let data = make_viewport_data(vec![make_cell(0, 0, "Hello")]);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Text should be within cell A1 (x: 0..64, y: 0..20)
        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected rendered text in cell A1");
        let (left, right) = bounds.unwrap();

        // Default alignment is left with CELL_PADDING=4
        assert!(
            (2..=6).contains(&left),
            "text left edge at {left}, expected near CELL_PADDING (4)"
        );

        // Measure expected width and compare
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        let expected_w = text::measure_text_advance(&face, DEFAULT_FONT_SIZE, "Hello");
        let rendered_w = (right - left + 1) as f32;
        assert!(
            (rendered_w - expected_w).abs() < 5.0,
            "rendered width {rendered_w} vs measured {expected_w}"
        );

        // No text in adjacent cell B1 (x: 64..128)
        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 66, 128, 200).is_none(),
            "no text should leak into cell B1"
        );
    }

    #[test]
    fn cell_fill_exact_rect() {
        let db = shared_font_db();
        let format = CellFormat {
            background_color: Some("#00FF00".to_string()),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Cell A1 is [0..64) × [0..20) — should be filled with green
        assert_rect_filled(
            &canvas,
            PixelRect::new(1, 1, 62, 18),
            GREEN_RGB,
            0,
            "cell A1 green fill",
        );

        // Adjacent cell B1 should remain white
        assert_pixel_white(&canvas, 66, 10, "cell B1 should be white");
        // Cell below A2 should be white
        assert_pixel_white(&canvas, 32, 22, "cell A2 should be white");
    }

    #[test]
    fn cf_bg_override_takes_precedence() {
        let db = shared_font_db();
        // Format has green background, but CF override is red
        let format = CellFormat {
            background_color: Some("#00FF00".to_string()),
            ..Default::default()
        };
        let mut cell = make_cell_with_format(0, 0, "", 1);
        cell.bg_color_override = 0xFF0000FF; // Red, fully opaque
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Cell A1 should be red (override wins), not green
        assert_rect_filled(
            &canvas,
            PixelRect::new(1, 1, 62, 18),
            RED_RGB,
            0,
            "CF override = red",
        );
    }

    #[test]
    fn horizontal_alignment_center() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "Hi", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected centered text in cell A1");
        let (left, right) = bounds.unwrap();
        let text_center = (left + right) / 2;
        // Cell center is at x=32
        assert!(
            text_center.abs_diff(32) <= 5,
            "centered text center at {text_center}, expected near 32"
        );
    }

    #[test]
    fn horizontal_alignment_right() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Right),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "Hi", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected right-aligned text in cell A1");
        let (_left, right) = bounds.unwrap();
        // Right edge of cell is x=63, minus CELL_PADDING(4) → text should end near 59
        assert!(
            (55..=63).contains(&right),
            "right-aligned text ends at {right}, expected near 59"
        );
    }

    #[test]
    fn font_color_override() {
        let db = shared_font_db();
        // Format specifies black font, CF override is blue
        let format = CellFormat {
            font_color: Some("#000000".to_string()),
            ..Default::default()
        };
        let mut cell = make_cell_with_format(0, 0, "X", 1);
        cell.font_color_override = 0x0000FFFF; // Blue, fully opaque
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Find a dark pixel in the text region and verify it's blue
        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected text in cell A1");
        let (left, right) = bounds.unwrap();
        let mid_x = (left + right) / 2;
        // Find a row with a dark pixel at mid_x
        let mut found_blue = false;
        for py in 0..20 {
            let (r, g, b, _) = canvas.pixel_at(mid_x, py);
            if b > 200 && r < 50 && g < 50 {
                found_blue = true;
                break;
            }
            // Anti-aliased pixels will have some blue bias
            if b > r.saturating_add(20) && b > g.saturating_add(20) && b > 100 {
                found_blue = true;
                break;
            }
        }
        assert!(found_blue, "text should be blue (font_color_override)");
    }

    #[test]
    fn clipping_text_to_cell() {
        let db = shared_font_db();
        // Use a very long string that exceeds cell width (64px)
        let long_text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let data = make_viewport_data(vec![make_cell(0, 0, long_text)]);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Text should be clipped at cell boundary (x=64)
        // Check a few pixels past the boundary — should be white
        assert_pixel_white(&canvas, 66, 10, "no text leak past cell right edge");
        assert_pixel_white(&canvas, 70, 10, "no text leak at x=70");
        assert_pixel_white(&canvas, 80, 10, "no text leak at x=80");

        // But text should exist inside the cell
        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "text should be rendered inside cell");
    }

    #[test]
    fn hidden_cell_skipped() {
        let db = shared_font_db();
        let data = make_viewport_data(vec![make_cell(0, 0, "Hidden")]);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        // Use zero-height row to simulate hidden
        let rows = vec![0.0, 0.0, 40.0, 60.0, 80.0, 100.0];
        render_cells(&mut canvas, &data, &rows, &data.col_positions, 0.0, 0.0, db);
        // Cell at row 0 has zero height → no text rendered
        // The first row area should remain entirely white
        assert_rect_white(&canvas, 0, 0, 64, 1, "hidden cell row should be white");
    }
}
