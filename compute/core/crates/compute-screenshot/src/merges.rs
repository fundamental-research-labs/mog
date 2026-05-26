use compute_text_measurement::FontDb;
use compute_wire::{RenderViewportMerge, ViewportRenderData};
use domain_types::CellFormat;

use crate::borders::{self, CellBorderRefs};
use crate::canvas::{CssRect, SheetCanvas};
use crate::colors;
use crate::text;

/// Default font size for merged cell text.
const DEFAULT_FONT_SIZE: f32 = 11.0;
const DEFAULT_FONT_FAMILY: &str = "Calibri";
const CELL_PADDING: f32 = 4.0;

/// Render merged cells: clear gridlines within the merge, render content spanning full rect.
pub fn render_merges(
    canvas: &mut SheetCanvas,
    data: &ViewportRenderData,
    row_positions: &[f64],
    col_positions: &[f64],
    offset_x: f32,
    offset_y: f32,
    font_db: &FontDb,
) {
    for merge in &data.merges {
        let ctx = MergeRenderContext {
            row_positions,
            col_positions,
            offset_x,
            offset_y,
            font_db,
        };
        render_single_merge(canvas, data, merge, &ctx);
    }
}

struct MergeRenderContext<'a> {
    row_positions: &'a [f64],
    col_positions: &'a [f64],
    offset_x: f32,
    offset_y: f32,
    font_db: &'a FontDb,
}

fn render_single_merge(
    canvas: &mut SheetCanvas,
    data: &ViewportRenderData,
    merge: &RenderViewportMerge,
    ctx: &MergeRenderContext<'_>,
) {
    let r1 = merge.start_row.saturating_sub(data.start_row) as usize;
    let c1 = merge.start_col.saturating_sub(data.start_col) as usize;
    let r2 = (merge.end_row.saturating_sub(data.start_row) + 1) as usize;
    let c2 = (merge.end_col.saturating_sub(data.start_col) + 1) as usize;

    // Bounds check
    if r1 >= ctx.row_positions.len()
        || r2 >= ctx.row_positions.len()
        || c1 >= ctx.col_positions.len()
        || c2 >= ctx.col_positions.len()
    {
        return;
    }

    let rect = CssRect::new(
        ctx.col_positions[c1] as f32 + ctx.offset_x,
        ctx.row_positions[r1] as f32 + ctx.offset_y,
        (ctx.col_positions[c2] - ctx.col_positions[c1]) as f32,
        (ctx.row_positions[r2] - ctx.row_positions[r1]) as f32,
    );

    if rect.w < 0.5 || rect.h < 0.5 {
        return;
    }

    // Find the top-left cell of the merge for its content and format
    let top_left_cell = data
        .cells
        .iter()
        .find(|c| c.row == merge.start_row && c.col == merge.start_col);

    let format = top_left_cell
        .and_then(|c| data.format_palette.get(c.format_idx as usize))
        .cloned()
        .unwrap_or_default();

    // 1. Clear the merge area (fill with background to cover gridlines)
    let bg_override = top_left_cell.map_or(0, |c| c.bg_color_override);
    let bg_color = colors::rgba_to_color(bg_override)
        .or_else(|| {
            format
                .background_color
                .as_deref()
                .and_then(colors::css_hex_to_color)
        })
        .unwrap_or(colors::WHITE);
    canvas.fill_rect(rect.x, rect.y, rect.w, rect.h, bg_color);

    // 2. Render text spanning the full merge rect
    if let Some(text_str) = top_left_cell.and_then(|c| c.formatted.as_ref())
        && !text_str.is_empty()
    {
        let font_color_override = top_left_cell.map_or(0, |c| c.font_color_override);
        render_merge_text(
            canvas,
            MergeText {
                rect,
                text: text_str,
                format: &format,
                font_color_override,
                font_db: ctx.font_db,
            },
        );
    }

    // 3. Borders on the merge perimeter
    if let Some(ref b) = format.borders {
        borders::render_cell_borders(
            canvas,
            rect,
            CellBorderRefs {
                top: b.top.as_ref(),
                right: b.right.as_ref(),
                bottom: b.bottom.as_ref(),
                left: b.left.as_ref(),
            },
        );
    }
}

struct MergeText<'a> {
    rect: CssRect,
    text: &'a str,
    format: &'a CellFormat,
    font_color_override: u32,
    font_db: &'a FontDb,
}

fn render_merge_text(canvas: &mut SheetCanvas, merge_text: MergeText<'_>) {
    let rect = merge_text.rect;
    let format = merge_text.format;
    let family = format.font_family.as_deref().unwrap_or(DEFAULT_FONT_FAMILY);
    let bold = format.bold.unwrap_or(false);
    let italic = format.italic.unwrap_or(false);
    let font_size = format
        .font_size
        .map(|fs| fs.points() as f32)
        .unwrap_or(DEFAULT_FONT_SIZE);

    let (_, entry) = match merge_text.font_db.resolve_styled(family, bold, italic) {
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

    let text_color = colors::rgba_to_color(merge_text.font_color_override)
        .or_else(|| {
            format
                .font_color
                .as_deref()
                .and_then(colors::css_hex_to_color)
        })
        .unwrap_or(colors::BLACK);

    let text_w = text::measure_text_advance(&buzz_face, font_size, merge_text.text);
    let ascender = text::ascender_px(&buzz_face, font_size);
    let line_h = text::line_height_px(&buzz_face, font_size);

    use domain_types::CellVerticalAlign;
    use ooxml_types::styles::HorizontalAlign;
    let h_align = format.horizontal_align.unwrap_or(HorizontalAlign::Center);
    let text_x = match h_align {
        HorizontalAlign::Left | HorizontalAlign::General => rect.x + CELL_PADDING,
        HorizontalAlign::Right => rect.x + rect.w - text_w - CELL_PADDING,
        _ => rect.x + (rect.w - text_w) / 2.0, // center for merges by default
    };

    let v_align = format.vertical_align.unwrap_or(CellVerticalAlign::Middle);
    let text_y = match v_align {
        CellVerticalAlign::Top => rect.y + ascender + 2.0,
        CellVerticalAlign::Bottom => rect.y + rect.h - (line_h - ascender) - 2.0,
        _ => rect.y + (rect.h - line_h) / 2.0 + ascender, // center
    };

    canvas.set_clip(rect.x, rect.y, rect.w, rect.h);
    text::render_text(
        canvas,
        &buzz_face,
        &ttf_face,
        text::TextRun {
            font_size,
            text: merge_text.text,
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
    use compute_wire::{RenderViewportMerge, ViewportRenderCell, ViewportRenderData};
    use domain_types::{CellBorderSide, CellBorders};

    fn make_merge_data() -> ViewportRenderData {
        ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 0,
                col: 0,
                format_idx: 0,
                flags: 0,
                number_value: f64::NAN,
                formatted: Some("Merged".to_string()),
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }],
            format_palette: vec![CellFormat::default()],
            merges: vec![RenderViewportMerge {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 2,
            }],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 5,
            viewport_cols: 5,
            start_row: 0,
            start_col: 0,
            // Merge spans rows 0-1 (y: 0..40) and cols 0-2 (x: 0..192)
            row_positions: vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0],
            col_positions: vec![0.0, 64.0, 128.0, 192.0, 256.0, 320.0],
        }
    }

    #[test]
    fn merge_clears_gridlines_exact() {
        let db = shared_font_db();
        let data = make_merge_data();
        let mut canvas = SheetCanvas::new(320, 100, 1.0);

        // Draw gridlines first
        crate::grid::render_gridlines(
            &mut canvas,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
        );

        // Verify gridlines exist before merge
        // Internal column boundary at x=64 should have gridline
        assert_col_colored_in_band(&canvas, 64, 1, 10, GRIDLINE_RGB, 5, "gridline before merge");

        // Render merges (should white-fill over internal gridlines)
        render_merges(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // All internal gridline positions should now be white (or have text, not gridline)
        // Internal column boundaries at x=64 and x=128 within the merge
        for &gx in &[64u32, 128] {
            // Check at y=5 (above where text likely is)
            let (r, g, b, _) = canvas.pixel_at(gx, 5);
            let is_gridline = r.abs_diff(208) < 10 && g.abs_diff(215) < 10 && b.abs_diff(222) < 10;
            assert!(
                !is_gridline,
                "internal col gridline at x={gx} should be cleared, got ({r},{g},{b})"
            );
        }
        // Internal row boundary at y=20 within the merge
        let (r, g, b, _) = canvas.pixel_at(32, 20);
        let is_gridline = r.abs_diff(208) < 10 && g.abs_diff(215) < 10 && b.abs_diff(222) < 10;
        assert!(
            !is_gridline,
            "internal row gridline at y=20 should be cleared, got ({r},{g},{b})"
        );

        // Gridline OUTSIDE the merge should still be visible
        // Column boundary at x=192 (right edge of merge) should still have gridline below the merge
        assert_col_colored_in_band(
            &canvas,
            192,
            1,
            50,
            GRIDLINE_RGB,
            5,
            "gridline at x=192 outside merge should survive",
        );
    }

    #[test]
    fn merge_renders_text_centered() {
        let db = shared_font_db();
        let data = make_merge_data();
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_merges(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Merge spans 3 cols × 2 rows = 192px × 40px
        let bounds = find_text_horizontal_bounds(&canvas, 0, 40, 0, 192, 200);
        assert!(bounds.is_some(), "expected text in merged cell");
        let (left, right) = bounds.unwrap();
        let text_center_x = (left + right) / 2;
        // Merge horizontal center is at x=96
        assert!(
            text_center_x.abs_diff(96) <= 10,
            "text center_x={text_center_x}, expected near 96 (merge center)"
        );

        // Text should also be vertically centered
        let v_bounds = find_text_vertical_bounds(&canvas, 0, 40, 0, 192, 200);
        assert!(v_bounds.is_some(), "text should have vertical extent");
        let (top, bottom) = v_bounds.unwrap();
        let text_center_y = (top + bottom) / 2;
        // Merge vertical center is at y=20
        assert!(
            text_center_y.abs_diff(20) <= 5,
            "text center_y={text_center_y}, expected near 20 (merge center)"
        );
    }

    #[test]
    fn merge_with_bg_color() {
        let db = shared_font_db();
        let mut data = make_merge_data();
        // Set bg_color_override on the top-left cell to green
        data.cells[0].bg_color_override = 0x00FF00FF;
        data.cells[0].formatted = None; // no text, just fill

        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_merges(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Multiple interior points should be green
        assert_pixel_eq(&canvas, 10, 10, GREEN_RGB, 0, "merge bg top-left");
        assert_pixel_eq(&canvas, 96, 20, GREEN_RGB, 0, "merge bg center");
        assert_pixel_eq(&canvas, 180, 35, GREEN_RGB, 0, "merge bg bottom-right");

        // Outside the merge should be white
        assert_pixel_white(&canvas, 194, 10, "right of merge should be white");
        assert_pixel_white(&canvas, 96, 42, "below merge should be white");
    }

    #[test]
    fn merge_perimeter_borders() {
        let db = shared_font_db();
        // Use a merge starting at row=1, col=1 so borders aren't at canvas edge
        let mut data = ViewportRenderData {
            cells: vec![ViewportRenderCell {
                row: 1,
                col: 1,
                format_idx: 0,
                flags: 0,
                number_value: f64::NAN,
                formatted: None,
                error: None,
                bg_color_override: 0,
                font_color_override: 0,
                cf_extras: None,
            }],
            format_palette: vec![CellFormat::default()],
            merges: vec![RenderViewportMerge {
                start_row: 1,
                start_col: 1,
                end_row: 2,
                end_col: 3,
            }],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 5,
            viewport_cols: 5,
            start_row: 0,
            start_col: 0,
            row_positions: vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0],
            col_positions: vec![0.0, 64.0, 128.0, 192.0, 256.0, 320.0],
        };
        let thin = CellBorderSide {
            style: Some(ooxml_types::styles::BorderStyle::Thin),
            color: Some("#000000".to_string()),
            color_tint: None,
        };
        let format = CellFormat {
            borders: Some(CellBorders {
                top: Some(thin.clone()),
                right: Some(thin.clone()),
                bottom: Some(thin.clone()),
                left: Some(thin.clone()),
                diagonal: None,
                diagonal_up: None,
                diagonal_down: None,
                vertical: None,
                horizontal: None,
                outline: None,
            }),
            ..Default::default()
        };
        data.format_palette = vec![format];

        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_merges(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Merge spans rows 1-2, cols 1-3 → rect (64,20) to (256,60)
        // Top edge at y=20
        assert_row_colored_in_band(&canvas, 20, 1, 160, BLACK_RGB, 10, "merge top border");
        // Bottom edge at y=60
        assert_row_colored_in_band(&canvas, 60, 1, 160, BLACK_RGB, 10, "merge bottom border");
        // Left edge at x=64
        assert_col_colored_in_band(&canvas, 64, 1, 40, BLACK_RGB, 10, "merge left border");
        // Right edge at x=256
        assert_col_colored_in_band(&canvas, 256, 1, 40, BLACK_RGB, 10, "merge right border");

        // Interior should be white (no text, no gridlines)
        assert_pixel_white(&canvas, 160, 40, "merge interior should be white");
    }
}
