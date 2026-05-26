use crate::canvas::SheetCanvas;
use crate::colors;

/// Render gridlines onto the canvas.
///
/// `row_positions` and `col_positions` are cumulative pixel offsets (CSS pixels)
/// relative to the top-left of the rendered area. The last position in each array
/// defines the total height/width of the grid.
///
/// `offset_x` / `offset_y` shift the grid origin (e.g., for header bands).
pub fn render_gridlines(
    canvas: &mut SheetCanvas,
    row_positions: &[f64],
    col_positions: &[f64],
    offset_x: f32,
    offset_y: f32,
) {
    if row_positions.is_empty() || col_positions.is_empty() {
        return;
    }

    let total_width = *col_positions.last().unwrap() as f32;
    let total_height = *row_positions.last().unwrap() as f32;

    // Horizontal gridlines (row boundaries)
    for &y in row_positions {
        let y = y as f32 + offset_y;
        canvas.stroke_line(
            offset_x,
            y,
            offset_x + total_width,
            y,
            colors::gridline_color(),
            1.0,
        );
    }

    // Vertical gridlines (column boundaries)
    for &x in col_positions {
        let x = x as f32 + offset_x;
        canvas.stroke_line(
            x,
            offset_y,
            x,
            offset_y + total_height,
            colors::gridline_color(),
            1.0,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;

    #[test]
    fn gridlines_at_exact_positions() {
        let mut canvas = SheetCanvas::new(100, 60, 1.0);
        let rows = vec![0.0, 20.0, 40.0, 60.0];
        let cols = vec![0.0, 30.0, 60.0, 100.0];
        render_gridlines(&mut canvas, &rows, &cols, 0.0, 0.0);

        // Horizontal gridlines at each row position
        for &y in &[0u32, 20, 40, 60] {
            if y < 60 {
                assert_row_colored_in_band(
                    &canvas,
                    y,
                    1,
                    15,
                    GRIDLINE_RGB,
                    3,
                    &format!("horizontal gridline at y={y}"),
                );
            }
        }

        // Vertical gridlines at each col position
        for &x in &[0u32, 30, 60] {
            assert_col_colored_in_band(
                &canvas,
                x,
                1,
                10,
                GRIDLINE_RGB,
                3,
                &format!("vertical gridline at x={x}"),
            );
        }
    }

    #[test]
    fn no_gridlines_at_mid_cell() {
        let mut canvas = SheetCanvas::new(100, 60, 1.0);
        let rows = vec![0.0, 20.0, 40.0, 60.0];
        let cols = vec![0.0, 30.0, 60.0, 100.0];
        render_gridlines(&mut canvas, &rows, &cols, 0.0, 0.0);

        // Center of each cell should be white (no stray gridlines)
        assert_pixel_white(&canvas, 15, 10, "center of cell (0,0)");
        assert_pixel_white(&canvas, 45, 10, "center of cell (0,1)");
        assert_pixel_white(&canvas, 80, 30, "center of cell (1,2)");
        assert_pixel_white(&canvas, 15, 50, "center of cell (2,0)");
    }

    #[test]
    fn gridline_color_exact() {
        let mut canvas = SheetCanvas::new(60, 30, 1.0);
        let rows = vec![0.0, 30.0];
        let cols = vec![0.0, 60.0];
        render_gridlines(&mut canvas, &rows, &cols, 0.0, 0.0);

        // Find the gridline pixel at the top edge (y≈0) at x=30
        // and verify its color matches GRIDLINE_RGB within ±3
        assert_row_colored_in_band(
            &canvas,
            0,
            1,
            30,
            GRIDLINE_RGB,
            3,
            "gridline color should match GRIDLINE_RGB",
        );
    }

    #[test]
    fn gridlines_offset_exact() {
        let mut canvas = SheetCanvas::new(120, 80, 1.0);
        let rows = vec![0.0, 20.0, 40.0];
        let cols = vec![0.0, 30.0, 60.0];
        render_gridlines(&mut canvas, &rows, &cols, 10.0, 10.0);

        // Horizontal gridline at row_pos=20 + offset_y=10 → y=30
        assert_row_colored_in_band(
            &canvas,
            30,
            1,
            25,
            GRIDLINE_RGB,
            3,
            "gridline at y=30 (pos=20 + offset=10)",
        );

        // Vertical gridline at col_pos=30 + offset_x=10 → x=40
        assert_col_colored_in_band(
            &canvas,
            40,
            1,
            20,
            GRIDLINE_RGB,
            3,
            "gridline at x=40 (pos=30 + offset=10)",
        );

        // Before offset: should be white
        assert_pixel_white(&canvas, 5, 5, "before offset area");
    }

    #[test]
    fn empty_positions_noop() {
        let mut canvas = SheetCanvas::new(10, 10, 1.0);
        render_gridlines(&mut canvas, &[], &[], 0.0, 0.0);
        assert_rect_white(&canvas, 0, 0, 10, 10, "empty gridlines = all white");
    }
}
