use tiny_skia::{
    Color, FillRule, LineCap, Mask, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform,
};

#[derive(Clone, Copy)]
pub struct CssRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl CssRect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
}

#[derive(Clone, Copy)]
pub struct LineSegment {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

impl LineSegment {
    pub fn new(x1: f32, y1: f32, x2: f32, y2: f32) -> Self {
        Self { x1, y1, x2, y2 }
    }
}

/// Thin wrapper around `tiny_skia::Pixmap` providing spreadsheet-oriented drawing primitives.
///
/// All coordinates are in CSS pixels; `dpr` scaling is applied internally.
pub struct SheetCanvas {
    pixmap: Pixmap,
    dpr: f32,
    clip: Option<Mask>,
}

impl SheetCanvas {
    /// Create a new canvas with the given CSS-pixel dimensions and DPR.
    /// The backing pixmap is `(width * dpr) × (height * dpr)` physical pixels.
    pub fn new(width: u32, height: u32, dpr: f32) -> Self {
        let pw = ((width as f32) * dpr).ceil() as u32;
        let ph = ((height as f32) * dpr).ceil() as u32;
        let mut pixmap = Pixmap::new(pw.max(1), ph.max(1)).expect("pixmap allocation");
        // Fill with white background
        pixmap.fill(tiny_skia::Color::from_rgba8(255, 255, 255, 255));
        Self {
            pixmap,
            dpr,
            clip: None,
        }
    }

    pub fn dpr(&self) -> f32 {
        self.dpr
    }

    pub fn width(&self) -> u32 {
        self.pixmap.width()
    }

    pub fn height(&self) -> u32 {
        self.pixmap.height()
    }

    /// Fill a rectangle with a solid color.
    pub fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Color) {
        let d = self.dpr;
        let rect = match Rect::from_xywh(x * d, y * d, w * d, h * d) {
            Some(r) => r,
            None => return,
        };
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = false;
        self.pixmap
            .fill_rect(rect, &paint, Transform::identity(), self.clip.as_ref());
    }

    /// Stroke a 1-CSS-pixel line between two points.
    pub fn stroke_line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, color: Color, width: f32) {
        let d = self.dpr;
        let mut pb = PathBuilder::new();
        pb.move_to(x1 * d, y1 * d);
        pb.line_to(x2 * d, y2 * d);
        let path = match pb.finish() {
            Some(p) => p,
            None => return,
        };
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = false;
        let stroke = Stroke {
            width: width * d,
            ..Default::default()
        };
        self.pixmap.stroke_path(
            &path,
            &paint,
            &stroke,
            Transform::identity(),
            self.clip.as_ref(),
        );
    }

    /// Stroke a line with a dash pattern.
    pub fn stroke_line_dashed(
        &mut self,
        line: LineSegment,
        color: Color,
        width: f32,
        dash_array: &[f32],
        line_cap: LineCap,
    ) {
        let d = self.dpr;
        let mut pb = PathBuilder::new();
        pb.move_to(line.x1 * d, line.y1 * d);
        pb.line_to(line.x2 * d, line.y2 * d);
        let path = match pb.finish() {
            Some(p) => p,
            None => return,
        };
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = false;
        let scaled_dash: Vec<f32> = dash_array.iter().map(|v| v * d).collect();
        let dash = match tiny_skia::StrokeDash::new(scaled_dash, 0.0) {
            Some(d) => d,
            None => return,
        };
        let stroke = Stroke {
            width: width * d,
            dash: Some(dash),
            line_cap,
            ..Default::default()
        };
        self.pixmap.stroke_path(
            &path,
            &paint,
            &stroke,
            Transform::identity(),
            self.clip.as_ref(),
        );
    }

    /// Stroke a rectangle outline.
    pub fn stroke_rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: Color, width: f32) {
        let d = self.dpr;
        let rect = match Rect::from_xywh(x * d, y * d, w * d, h * d) {
            Some(r) => r,
            None => return,
        };
        let path = PathBuilder::from_rect(rect);
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = false;
        let stroke = Stroke {
            width: width * d,
            ..Default::default()
        };
        self.pixmap.stroke_path(
            &path,
            &paint,
            &stroke,
            Transform::identity(),
            self.clip.as_ref(),
        );
    }

    /// Fill a tiny-skia Path at the given translation, with DPR already applied to the path.
    pub fn fill_path_raw(&mut self, path: &tiny_skia::Path, tx: f32, ty: f32, color: Color) {
        let mut paint = Paint::default();
        paint.set_color(color);
        paint.anti_alias = true;
        self.pixmap.fill_path(
            path,
            &paint,
            FillRule::Winding,
            Transform::from_translate(tx, ty),
            self.clip.as_ref(),
        );
    }

    /// Set a rectangular clip region (CSS pixels).
    pub fn set_clip(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let d = self.dpr;
        let rect = match Rect::from_xywh(x * d, y * d, w * d, h * d) {
            Some(r) => r,
            None => return,
        };
        let pw = self.pixmap.width();
        let ph = self.pixmap.height();
        let mut mask = match Mask::new(pw, ph) {
            Some(m) => m,
            None => return,
        };
        let path = PathBuilder::from_rect(rect);
        mask.fill_path(&path, FillRule::Winding, false, Transform::identity());
        self.clip = Some(mask);
    }

    /// Clear the clip region.
    pub fn clear_clip(&mut self) {
        self.clip = None;
    }

    /// Encode the pixmap as PNG bytes.
    pub fn encode_png(&self) -> Vec<u8> {
        let width = self.pixmap.width();
        let height = self.pixmap.height();
        let data = self.pixmap.data();

        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut buf, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("png header");
            writer.write_image_data(data).expect("png data");
        }
        buf
    }

    /// Get raw pixel data (for testing).
    pub fn pixel_at(&self, px: u32, py: u32) -> (u8, u8, u8, u8) {
        let w = self.pixmap.width();
        let data = self.pixmap.data();
        let idx = ((py * w + px) * 4) as usize;
        (data[idx], data[idx + 1], data[idx + 2], data[idx + 3])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;

    #[test]
    fn new_canvas_is_white() {
        let c = SheetCanvas::new(10, 10, 1.0);
        assert_rect_filled(
            &c,
            PixelRect::new(0, 0, 10, 10),
            WHITE_RGB,
            0,
            "fresh canvas",
        );
    }

    #[test]
    fn fill_rect_exact_bounds() {
        let mut c = SheetCanvas::new(30, 30, 1.0);
        let red = Color::from_rgba8(255, 0, 0, 255);
        c.fill_rect(5.0, 5.0, 10.0, 10.0, red);

        // Every pixel inside [5..15) × [5..15) is red
        assert_rect_filled(
            &c,
            PixelRect::new(5, 5, 10, 10),
            RED_RGB,
            0,
            "fill interior",
        );

        // Boundary pixels just outside are white
        assert_pixel_white(&c, 4, 5, "left of fill");
        assert_pixel_white(&c, 5, 4, "above fill");
        assert_pixel_white(&c, 15, 5, "right of fill");
        assert_pixel_white(&c, 5, 15, "below fill");

        // Corners outside
        assert_pixel_white(&c, 0, 0, "top-left corner");
        assert_pixel_white(&c, 29, 29, "bottom-right corner");
    }

    #[test]
    fn fill_rect_boundary_fence_post() {
        let mut c = SheetCanvas::new(20, 20, 1.0);
        let blue = Color::from_rgba8(0, 0, 255, 255);
        c.fill_rect(0.0, 0.0, 10.0, 10.0, blue);

        // Last included pixel
        assert_pixel_eq(&c, 9, 9, BLUE_RGB, 0, "last pixel in rect");
        // First excluded pixel
        assert_pixel_white(&c, 10, 0, "first pixel outside width");
        assert_pixel_white(&c, 0, 10, "first pixel outside height");
    }

    #[test]
    fn dpr2_exact_physical_bounds() {
        let mut c = SheetCanvas::new(20, 20, 2.0);
        assert_eq!(c.width(), 40, "physical width = CSS × DPR");
        assert_eq!(c.height(), 40, "physical height = CSS × DPR");

        let green = Color::from_rgba8(0, 255, 0, 255);
        // CSS rect (10,10) size (5,5) → physical [20..30) × [20..30)
        c.fill_rect(10.0, 10.0, 5.0, 5.0, green);

        // First and last physical pixels inside
        assert_pixel_eq(&c, 20, 20, GREEN_RGB, 0, "first physical pixel inside");
        assert_pixel_eq(&c, 29, 29, GREEN_RGB, 0, "last physical pixel inside");

        // Just outside in each direction
        assert_pixel_white(&c, 19, 20, "physical pixel left of fill");
        assert_pixel_white(&c, 20, 19, "physical pixel above fill");
        assert_pixel_white(&c, 30, 20, "physical pixel right of fill");
        assert_pixel_white(&c, 20, 30, "physical pixel below fill");
    }

    #[test]
    fn stroke_line_horizontal_at_pixel_row() {
        let mut c = SheetCanvas::new(20, 20, 1.0);
        let black = Color::from_rgba8(0, 0, 0, 255);
        c.stroke_line(0.0, 10.0, 20.0, 10.0, black, 1.0);

        // The 1px stroke at y=10.0 should color pixels in band [9..11]
        assert_row_colored_in_band(&c, 10, 1, 10, BLACK_RGB, 10, "stroke at y=10");

        // Well away from the line should be white
        assert_pixel_white(&c, 10, 0, "far above line");
        assert_pixel_white(&c, 10, 18, "far below line");
    }

    #[test]
    fn stroke_rect_four_sides() {
        let mut c = SheetCanvas::new(50, 40, 1.0);
        let red = Color::from_rgba8(255, 0, 0, 255);
        c.stroke_rect(5.0, 5.0, 30.0, 20.0, red, 1.0);

        // Top edge at y≈5
        assert_row_colored_in_band(&c, 5, 1, 20, RED_RGB, 10, "top edge");
        // Bottom edge at y≈25
        assert_row_colored_in_band(&c, 25, 1, 20, RED_RGB, 10, "bottom edge");
        // Left edge at x≈5
        assert_col_colored_in_band(&c, 5, 1, 15, RED_RGB, 10, "left edge");
        // Right edge at x≈35
        assert_col_colored_in_band(&c, 35, 1, 15, RED_RGB, 10, "right edge");

        // Interior should be white
        assert_pixel_white(&c, 20, 15, "interior of stroked rect");
    }

    #[test]
    fn png_roundtrip() {
        let mut c = SheetCanvas::new(5, 5, 1.0);
        let green = Color::from_rgba8(0, 255, 0, 255);
        c.fill_rect(0.0, 0.0, 5.0, 5.0, green);
        let png_bytes = c.encode_png();
        assert_eq!(&png_bytes[0..4], &[0x89, 0x50, 0x4E, 0x47], "PNG magic");
        assert!(png_bytes.len() > 50);
    }

    #[test]
    fn clip_restricts_fill_to_region() {
        let mut c = SheetCanvas::new(20, 20, 1.0);
        let red = Color::from_rgba8(255, 0, 0, 255);
        c.set_clip(5.0, 5.0, 5.0, 5.0);
        c.fill_rect(0.0, 0.0, 20.0, 20.0, red);

        // Inside clip [5..10) × [5..10): red
        assert_rect_filled(&c, PixelRect::new(5, 5, 5, 5), RED_RGB, 0, "inside clip");

        // Outside clip: still white
        assert_pixel_white(&c, 0, 0, "outside clip top-left");
        assert_pixel_white(&c, 4, 7, "just left of clip");
        assert_pixel_white(&c, 10, 7, "just right of clip");
        assert_pixel_white(&c, 7, 4, "just above clip");
        assert_pixel_white(&c, 7, 10, "just below clip");

        c.clear_clip();
    }
}
