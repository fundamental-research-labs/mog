use domain_types::CellBorderSide;
use tiny_skia::{Color, LineCap};

use crate::canvas::{CssRect, LineSegment, SheetCanvas};
use crate::colors;

/// Resolved border rendering parameters.
pub struct BorderParams {
    pub width: f32,
    pub dash: Option<(Vec<f32>, LineCap)>,
    pub is_double: bool,
}

/// Map an Excel border style string to rendering parameters.
pub fn resolve_border_style(style: &str) -> Option<BorderParams> {
    match style {
        "hair" => Some(BorderParams {
            width: 1.0,
            dash: None,
            is_double: false,
        }),
        "thin" => Some(BorderParams {
            width: 1.0,
            dash: None,
            is_double: false,
        }),
        "medium" => Some(BorderParams {
            width: 1.5,
            dash: None,
            is_double: false,
        }),
        "thick" => Some(BorderParams {
            width: 2.25,
            dash: None,
            is_double: false,
        }),
        "dashed" => Some(BorderParams {
            width: 1.0,
            dash: Some((vec![3.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "dotted" => Some(BorderParams {
            width: 1.0,
            dash: Some((vec![1.0, 1.0], LineCap::Round)),
            is_double: false,
        }),
        "double" => Some(BorderParams {
            width: 1.0,
            dash: None,
            is_double: true,
        }),
        "dashDot" => Some(BorderParams {
            width: 1.0,
            dash: Some((vec![3.0, 1.0, 1.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "dashDotDot" => Some(BorderParams {
            width: 1.0,
            dash: Some((vec![3.0, 1.0, 1.0, 1.0, 1.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "mediumDashed" => Some(BorderParams {
            width: 1.5,
            dash: Some((vec![4.0, 1.5], LineCap::Butt)),
            is_double: false,
        }),
        "mediumDashDot" => Some(BorderParams {
            width: 1.5,
            dash: Some((vec![3.0, 1.0, 1.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "mediumDashDotDot" => Some(BorderParams {
            width: 1.5,
            dash: Some((vec![3.0, 1.0, 1.0, 1.0, 1.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "slantDashDot" => Some(BorderParams {
            width: 1.5,
            dash: Some((vec![4.0, 1.0, 1.0, 1.0], LineCap::Butt)),
            is_double: false,
        }),
        "none" | "" => None,
        _ => None,
    }
}

/// Draw a single border edge (horizontal or vertical line).
fn draw_border_line(
    canvas: &mut SheetCanvas,
    line: LineSegment,
    color: Color,
    params: &BorderParams,
) {
    if params.is_double {
        // Double border: two parallel lines ~3px apart
        let is_horiz = (line.y1 - line.y2).abs() < 0.001;
        let offset = 1.5;
        if is_horiz {
            canvas.stroke_line(
                line.x1,
                line.y1 - offset,
                line.x2,
                line.y2 - offset,
                color,
                params.width,
            );
            canvas.stroke_line(
                line.x1,
                line.y1 + offset,
                line.x2,
                line.y2 + offset,
                color,
                params.width,
            );
        } else {
            canvas.stroke_line(
                line.x1 - offset,
                line.y1,
                line.x2 - offset,
                line.y2,
                color,
                params.width,
            );
            canvas.stroke_line(
                line.x1 + offset,
                line.y1,
                line.x2 + offset,
                line.y2,
                color,
                params.width,
            );
        }
    } else if let Some((ref dash_array, cap)) = params.dash {
        canvas.stroke_line_dashed(line, color, params.width, dash_array, cap);
    } else {
        canvas.stroke_line(line.x1, line.y1, line.x2, line.y2, color, params.width);
    }
}

pub struct CellBorderRefs<'a> {
    pub top: Option<&'a CellBorderSide>,
    pub right: Option<&'a CellBorderSide>,
    pub bottom: Option<&'a CellBorderSide>,
    pub left: Option<&'a CellBorderSide>,
}

/// Render the four borders of a cell rectangle.
pub fn render_cell_borders(canvas: &mut SheetCanvas, rect: CssRect, borders: CellBorderRefs<'_>) {
    for (side, line) in [
        (
            borders.top,
            LineSegment::new(rect.x, rect.y, rect.x + rect.w, rect.y),
        ),
        (
            borders.right,
            LineSegment::new(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h),
        ),
        (
            borders.bottom,
            LineSegment::new(rect.x, rect.y + rect.h, rect.x + rect.w, rect.y + rect.h),
        ),
        (
            borders.left,
            LineSegment::new(rect.x, rect.y, rect.x, rect.y + rect.h),
        ),
    ] {
        if let Some(border) = side
            && let Some(style) = border.style
            && let Some(params) = resolve_border_style(style.to_ooxml())
        {
            let color = border
                .color
                .as_deref()
                .and_then(colors::css_hex_to_color)
                .unwrap_or(colors::BLACK);
            draw_border_line(canvas, line, color, &params);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;
    use domain_types::CellBorderSide;

    fn black_border(style: &str) -> CellBorderSide {
        CellBorderSide {
            // Test helper: the style literal comes from a known-valid list
            // below, so an unknown token is a test bug, not runtime input —
            // panic rather than silently default.
            style: Some(
                ooxml_types::styles::BorderStyle::from_ooxml_token(style)
                    .unwrap_or_else(|| panic!("test bug: unknown BorderStyle token {style:?}")),
            ),
            color: Some("#000000".to_string()),
            color_tint: None,
        }
    }

    fn top_border(side: &CellBorderSide) -> CellBorderRefs<'_> {
        CellBorderRefs {
            top: Some(side),
            right: None,
            bottom: None,
            left: None,
        }
    }

    #[test]
    fn resolve_all_13_styles() {
        let styles = [
            "hair",
            "thin",
            "medium",
            "thick",
            "dashed",
            "dotted",
            "double",
            "dashDot",
            "dashDotDot",
            "mediumDashed",
            "mediumDashDot",
            "mediumDashDotDot",
            "slantDashDot",
        ];
        for s in styles {
            assert!(resolve_border_style(s).is_some(), "missing style: {s}");
        }
    }

    #[test]
    fn resolve_none_returns_none() {
        assert!(resolve_border_style("none").is_none());
        assert!(resolve_border_style("").is_none());
        assert!(resolve_border_style("bogus").is_none());
    }

    #[test]
    fn thin_border_at_exact_position() {
        let mut canvas = SheetCanvas::new(60, 60, 1.0);
        let border = black_border("thin");
        render_cell_borders(
            &mut canvas,
            CssRect::new(10.0, 10.0, 40.0, 30.0),
            CellBorderRefs {
                top: Some(&border),
                right: Some(&border),
                bottom: Some(&border),
                left: Some(&border),
            },
        );

        // Top edge at y=10
        assert_row_colored_in_band(&canvas, 10, 1, 30, BLACK_RGB, 10, "top border");
        // Bottom edge at y=40
        assert_row_colored_in_band(&canvas, 40, 1, 30, BLACK_RGB, 10, "bottom border");
        // Left edge at x=10
        assert_col_colored_in_band(&canvas, 10, 1, 25, BLACK_RGB, 10, "left border");
        // Right edge at x=50
        assert_col_colored_in_band(&canvas, 50, 1, 25, BLACK_RGB, 10, "right border");

        // Interior should be white
        assert_pixel_white(&canvas, 30, 25, "interior of bordered cell");
    }

    #[test]
    fn thick_vs_thin_pixel_count() {
        let mut canvas_thin = SheetCanvas::new(60, 20, 1.0);
        let mut canvas_thick = SheetCanvas::new(60, 20, 1.0);
        let thin = black_border("thin");
        let thick = black_border("thick");

        // Horizontal border at y=10
        render_cell_borders(
            &mut canvas_thin,
            CssRect::new(0.0, 10.0, 60.0, 0.0),
            top_border(&thin),
        );
        render_cell_borders(
            &mut canvas_thick,
            CssRect::new(0.0, 10.0, 60.0, 0.0),
            top_border(&thick),
        );

        let thin_n = count_dark_pixels_in_col(&canvas_thin, 30, 5, 16, 200);
        let thick_n = count_dark_pixels_in_col(&canvas_thick, 30, 5, 16, 200);

        assert!(
            thick_n > thin_n,
            "thick ({thick_n}) should cover more pixels than thin ({thin_n})"
        );
        assert!(
            thick_n >= 2,
            "thick border (2.25px) should cover at least 2 pixel rows, got {thick_n}"
        );
    }

    #[test]
    fn double_border_two_groups() {
        let mut canvas = SheetCanvas::new(60, 20, 1.0);
        let border = black_border("double");
        render_cell_borders(
            &mut canvas,
            CssRect::new(0.0, 10.0, 60.0, 0.0),
            top_border(&border),
        );

        // Scan column at x=30 for dark pixels in y=[6..15]
        let mut dark_rows: Vec<u32> = Vec::new();
        for py in 6..15 {
            let (r, _, _, _) = canvas.pixel_at(30, py);
            if r < 200 {
                dark_rows.push(py);
            }
        }

        // Group consecutive dark rows
        let mut groups = 0u32;
        let mut prev: Option<u32> = None;
        for &row in &dark_rows {
            match prev {
                Some(p) if row == p + 1 => {} // same group
                _ => groups += 1,             // new group
            }
            prev = Some(row);
        }

        assert!(
            groups >= 2,
            "double border should have ≥2 separate dark groups, got {groups} from {dark_rows:?}"
        );
    }

    #[test]
    fn border_color_exact() {
        let mut canvas = SheetCanvas::new(60, 40, 1.0);
        let border = CellBorderSide {
            style: Some(ooxml_types::styles::BorderStyle::Medium),
            color: Some("#FF0000".to_string()),
            color_tint: None,
        };
        render_cell_borders(
            &mut canvas,
            CssRect::new(5.0, 10.0, 50.0, 20.0),
            top_border(&border),
        );

        // Find the top border pixel (medium = 1.5px wide) in band around y=10
        assert_row_colored_in_band(&canvas, 10, 1, 30, RED_RGB, 5, "red border color");
    }

    #[test]
    fn dashed_border_alternating_segments() {
        let mut canvas = SheetCanvas::new(80, 20, 1.0);
        let border = black_border("dashed");
        // Dashed border on top edge of cell at (0,10) width=80
        render_cell_borders(
            &mut canvas,
            CssRect::new(0.0, 10.0, 80.0, 0.0),
            top_border(&border),
        );

        // Sample pixels along the border (within ±1 of y=10)
        // Dashed pattern is [3,1] at 0.5px width — we should see colored and gap segments
        let mut colored = 0;
        let mut gap = 0;
        for px in 2..78 {
            let mut found_dark = false;
            for py in 9..=11 {
                let (r, _, _, _) = canvas.pixel_at(px, py);
                if r < 200 {
                    found_dark = true;
                    break;
                }
            }
            if found_dark {
                colored += 1;
            } else {
                gap += 1;
            }
        }

        assert!(
            colored > 10,
            "dashed border should have colored segments, got {colored}"
        );
        assert!(gap > 3, "dashed border should have gap segments, got {gap}");
    }
}
