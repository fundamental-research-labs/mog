pub mod borders;
pub mod canvas;
pub mod cells;
pub mod charts;
pub mod colors;
pub mod grid;
pub mod headers;
pub mod merges;
pub mod options;
pub mod text;

#[cfg(test)]
pub(crate) mod test_helpers;

pub use options::ScreenshotOptions;

use canvas::SheetCanvas;
use charts::{ChartOverlay, render_chart_overlays};
use compute_text_measurement::FontDb;
use compute_wire::ViewportRenderData;

/// Default column header height in CSS pixels.
const DEFAULT_HEADER_HEIGHT: f32 = 20.0;
/// Header font size for measuring row header width.
const HEADER_FONT_SIZE: f32 = 11.0;

/// Render a sheet region to a PNG buffer.
///
/// Reads cell data from `viewport_data` (pre-built by compute-core),
/// cell positions from the data's `row_positions`/`col_positions` arrays,
/// and shapes text via `font_db` (FontDb with bundled fonts).
pub fn render_sheet_to_png(
    viewport_data: &ViewportRenderData,
    font_db: &FontDb,
    options: &ScreenshotOptions,
) -> Vec<u8> {
    render_sheet_to_png_with_charts(viewport_data, font_db, options, &[])
}

/// Render a sheet region plus floating chart overlays to a PNG buffer.
pub fn render_sheet_to_png_with_charts(
    viewport_data: &ViewportRenderData,
    font_db: &FontDb,
    options: &ScreenshotOptions,
    charts: &[ChartOverlay],
) -> Vec<u8> {
    let row_positions = &viewport_data.row_positions;
    let col_positions = &viewport_data.col_positions;

    if row_positions.is_empty() || col_positions.is_empty() {
        // No positions → return a minimal 1×1 white PNG
        let canvas = SheetCanvas::new(1, 1, options.dpr);
        return canvas.encode_png();
    }

    let data_width = *col_positions.last().unwrap() as f32;
    let data_height = *row_positions.last().unwrap() as f32;

    // Compute header dimensions
    let (header_width, header_height) = if options.show_headers {
        let max_row = viewport_data.start_row + viewport_data.viewport_rows;
        let max_label = max_row.to_string();
        let hw = headers::row_header_width(font_db, &max_label, HEADER_FONT_SIZE);
        (hw, DEFAULT_HEADER_HEIGHT)
    } else {
        (0.0, 0.0)
    };

    let total_width = (data_width + header_width).ceil() as u32;
    let total_height = (data_height + header_height).ceil() as u32;

    // Apply max_width / max_height by adjusting effective DPR
    let (_cw, _ch, scale) = apply_max_constraints(
        total_width,
        total_height,
        options.max_width,
        options.max_height,
    );
    let effective_dpr = options.dpr * scale;

    let mut canvas = SheetCanvas::new(total_width, total_height, effective_dpr);

    let offset_x = header_width;
    let offset_y = header_height;

    // 1. Gridlines (under everything)
    if options.show_gridlines {
        grid::render_gridlines(
            &mut canvas,
            row_positions,
            col_positions,
            offset_x,
            offset_y,
        );
    }

    // 2. Cells (fills, text, borders)
    cells::render_cells(
        &mut canvas,
        viewport_data,
        row_positions,
        col_positions,
        offset_x,
        offset_y,
        font_db,
    );

    // 3. Merges (over cells and gridlines)
    merges::render_merges(
        &mut canvas,
        viewport_data,
        row_positions,
        col_positions,
        offset_x,
        offset_y,
        font_db,
    );

    // 4. Floating chart objects (over cells, under headers).
    render_chart_overlays(&mut canvas, charts, offset_x, offset_y, font_db);

    // 5. Headers (over data area edges)
    if options.show_headers {
        headers::render_corner(&mut canvas, header_width, header_height);
        headers::render_col_headers(
            &mut canvas,
            col_positions,
            viewport_data.start_col,
            offset_x,
            header_height,
            font_db,
        );
        headers::render_row_headers(
            &mut canvas,
            row_positions,
            viewport_data.start_row,
            offset_y,
            header_width,
            font_db,
        );
    }

    canvas.encode_png()
}

/// Render a sheet region to a `SheetCanvas` (for testing pixel-level assertions).
#[cfg(test)]
pub(crate) fn render_sheet_to_canvas(
    viewport_data: &ViewportRenderData,
    font_db: &FontDb,
    options: &ScreenshotOptions,
) -> SheetCanvas {
    let row_positions = &viewport_data.row_positions;
    let col_positions = &viewport_data.col_positions;

    if row_positions.is_empty() || col_positions.is_empty() {
        return SheetCanvas::new(1, 1, options.dpr);
    }

    let data_width = *col_positions.last().unwrap() as f32;
    let data_height = *row_positions.last().unwrap() as f32;

    let (header_width, header_height) = if options.show_headers {
        let max_row = viewport_data.start_row + viewport_data.viewport_rows;
        let max_label = max_row.to_string();
        let hw = headers::row_header_width(font_db, &max_label, HEADER_FONT_SIZE);
        (hw, DEFAULT_HEADER_HEIGHT)
    } else {
        (0.0, 0.0)
    };

    let total_width = (data_width + header_width).ceil() as u32;
    let total_height = (data_height + header_height).ceil() as u32;

    let (_cw, _ch, scale) = apply_max_constraints(
        total_width,
        total_height,
        options.max_width,
        options.max_height,
    );
    let effective_dpr = options.dpr * scale;

    let mut canvas = SheetCanvas::new(total_width, total_height, effective_dpr);

    let offset_x = header_width;
    let offset_y = header_height;

    if options.show_gridlines {
        grid::render_gridlines(
            &mut canvas,
            row_positions,
            col_positions,
            offset_x,
            offset_y,
        );
    }

    cells::render_cells(
        &mut canvas,
        viewport_data,
        row_positions,
        col_positions,
        offset_x,
        offset_y,
        font_db,
    );

    merges::render_merges(
        &mut canvas,
        viewport_data,
        row_positions,
        col_positions,
        offset_x,
        offset_y,
        font_db,
    );

    if options.show_headers {
        headers::render_corner(&mut canvas, header_width, header_height);
        headers::render_col_headers(
            &mut canvas,
            col_positions,
            viewport_data.start_col,
            offset_x,
            header_height,
            font_db,
        );
        headers::render_row_headers(
            &mut canvas,
            row_positions,
            viewport_data.start_row,
            offset_y,
            header_width,
            font_db,
        );
    }

    canvas
}

/// Apply max_width/max_height constraints, returning (width, height, scale_factor).
fn apply_max_constraints(
    width: u32,
    height: u32,
    max_width: Option<u32>,
    max_height: Option<u32>,
) -> (u32, u32, f32) {
    let mut scale = 1.0f32;
    if let Some(mw) = max_width
        && width > mw
    {
        scale = scale.min(mw as f32 / width as f32);
    }
    if let Some(mh) = max_height
        && height > mh
    {
        scale = scale.min(mh as f32 / height as f32);
    }
    let w = (width as f32 * scale).ceil() as u32;
    let h = (height as f32 * scale).ceil() as u32;
    (w, h, scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;
    use compute_wire::{ViewportRenderCell, ViewportRenderData};
    use domain_types::CellFormat;

    fn make_empty_viewport(rows: u32, cols: u32) -> ViewportRenderData {
        let mut row_pos = Vec::with_capacity(rows as usize + 1);
        for i in 0..=rows {
            row_pos.push(i as f64 * 20.0);
        }
        let mut col_pos = Vec::with_capacity(cols as usize + 1);
        for i in 0..=cols {
            col_pos.push(i as f64 * 64.0);
        }
        ViewportRenderData {
            cells: vec![],
            format_palette: vec![CellFormat::default()],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: rows,
            viewport_cols: cols,
            start_row: 0,
            start_col: 0,
            row_positions: row_pos,
            col_positions: col_pos,
        }
    }

    fn make_red_cell_viewport() -> ViewportRenderData {
        let format = CellFormat {
            background_color: Some("#FF0000".to_string()),
            ..Default::default()
        };
        let mut data = make_empty_viewport(5, 5);
        data.format_palette.push(format);
        data.cells.push(ViewportRenderCell {
            row: 0,
            col: 0,
            format_idx: 1,
            flags: 0,
            number_value: f64::NAN,
            formatted: None,
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        });
        data
    }

    #[test]
    fn render_empty_sheet_valid_png() {
        let db = shared_font_db();
        let data = make_empty_viewport(5, 5);
        let opts = ScreenshotOptions::default();
        let png = render_sheet_to_png(&data, db, &opts);
        assert_eq!(&png[0..4], &[0x89, 0x50, 0x4E, 0x47]);
        assert!(png.len() > 100);
    }

    #[test]
    fn with_headers_data_offset() {
        let db = shared_font_db();
        let data = make_red_cell_viewport();
        let opts = ScreenshotOptions {
            show_headers: true,
            show_gridlines: false,
            ..Default::default()
        };
        let canvas = render_sheet_to_canvas(&data, db, &opts);

        // Compute expected header dimensions
        let max_label = (data.start_row + data.viewport_rows).to_string();
        let hw = headers::row_header_width(db, &max_label, HEADER_FONT_SIZE);
        let hh = DEFAULT_HEADER_HEIGHT;

        // Cell (0,0) fill should start at (header_width, header_height)
        let fill_x = hw.ceil() as u32 + 1;
        let fill_y = hh.ceil() as u32 + 1;
        assert_pixel_eq(
            &canvas,
            fill_x,
            fill_y,
            RED_RGB,
            3,
            "red fill at data offset",
        );

        // Just before the offset (in header region) should NOT be red
        let (r, g, b, _) = canvas.pixel_at(2, fill_y);
        assert!(
            r.abs_diff(255) > 10 || g > 10 || b > 10,
            "header area at (2,{fill_y}) should not be red, got ({r},{g},{b})"
        );
    }

    #[test]
    fn without_headers_cell_at_origin() {
        let db = shared_font_db();
        let data = make_red_cell_viewport();
        let opts = ScreenshotOptions {
            show_headers: false,
            show_gridlines: false,
            ..Default::default()
        };
        let canvas = render_sheet_to_canvas(&data, db, &opts);

        // Without headers, cell (0,0) fill starts at (0,0)
        assert_pixel_eq(&canvas, 1, 1, RED_RGB, 0, "red fill at origin");
        assert_pixel_eq(&canvas, 32, 10, RED_RGB, 0, "red fill center of cell");

        // Cell (0,1) at x=64 should be white
        assert_pixel_white(&canvas, 66, 10, "adjacent cell should be white");
    }

    #[test]
    fn gridlines_toggle_exact() {
        let db = shared_font_db();
        let data = make_empty_viewport(5, 5);

        // With gridlines: check specific gridline position
        let opts_on = ScreenshotOptions {
            show_headers: false,
            show_gridlines: true,
            ..Default::default()
        };
        let canvas_on = render_sheet_to_canvas(&data, db, &opts_on);
        // Horizontal gridline at y=20 (row boundary)
        assert_row_colored_in_band(
            &canvas_on,
            20,
            1,
            32,
            GRIDLINE_RGB,
            5,
            "gridline at y=20 with gridlines=true",
        );

        // Without gridlines: same position should be white
        let opts_off = ScreenshotOptions {
            show_headers: false,
            show_gridlines: false,
            ..Default::default()
        };
        let canvas_off = render_sheet_to_canvas(&data, db, &opts_off);
        assert_pixel_white(
            &canvas_off,
            32,
            20,
            "no gridline at y=20 with gridlines=false",
        );
    }

    #[test]
    fn dpr2_physical_pixels() {
        let db = shared_font_db();
        let data = make_empty_viewport(3, 3);
        let opts = ScreenshotOptions {
            dpr: 2.0,
            show_headers: false,
            ..Default::default()
        };
        let canvas = render_sheet_to_canvas(&data, db, &opts);

        // CSS dimensions: 3 cols × 64 = 192, 3 rows × 20 = 60
        // Physical should be 2× = 384 × 120
        assert_eq!(canvas.width(), 384, "physical width = CSS × DPR");
        assert_eq!(canvas.height(), 120, "physical height = CSS × DPR");
    }

    #[test]
    fn render_empty_positions_minimal() {
        let db = shared_font_db();
        let data = ViewportRenderData {
            cells: vec![],
            format_palette: vec![],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 0,
            viewport_cols: 0,
            start_row: 0,
            start_col: 0,
            row_positions: vec![],
            col_positions: vec![],
        };
        let opts = ScreenshotOptions::default();
        let png = render_sheet_to_png(&data, db, &opts);
        assert_eq!(&png[0..4], &[0x89, 0x50, 0x4E, 0x47]);
    }

    #[test]
    fn apply_max_width_scales_down() {
        let (w, h, s) = apply_max_constraints(1000, 500, Some(200), None);
        assert_eq!(w, 200);
        assert_eq!(h, 100);
        assert!((s - 0.2).abs() < 0.001);
    }

    #[test]
    fn apply_max_no_constraint() {
        let (w, h, s) = apply_max_constraints(100, 50, None, None);
        assert_eq!(w, 100);
        assert_eq!(h, 50);
        assert_eq!(s, 1.0);
    }

    #[test]
    fn apply_max_both_uses_smaller_scale() {
        let (w, h, s) = apply_max_constraints(400, 400, Some(200), Some(100));
        // max_height is more constraining: 100/400 = 0.25
        assert_eq!(s, 0.25);
        assert_eq!(w, 100);
        assert_eq!(h, 100);
    }
}
