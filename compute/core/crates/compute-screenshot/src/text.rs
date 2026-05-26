use rustybuzz::{Face, UnicodeBuffer};
use tiny_skia::Color;
use tiny_skia_path::PathBuilder;
use ttf_parser::GlyphId;

use crate::canvas::SheetCanvas;

pub struct TextRun<'a> {
    pub font_size: f32,
    pub text: &'a str,
    pub x: f32,
    pub y: f32,
    pub color: Color,
}

/// Outline builder adapter: converts ttf-parser glyph outlines to tiny-skia paths.
struct OutlineAdapter {
    builder: PathBuilder,
    scale: f32,
}

impl OutlineAdapter {
    fn new(scale: f32) -> Self {
        Self {
            builder: PathBuilder::new(),
            scale,
        }
    }

    fn finish(self) -> Option<tiny_skia::Path> {
        self.builder.finish()
    }
}

impl ttf_parser::OutlineBuilder for OutlineAdapter {
    fn move_to(&mut self, x: f32, y: f32) {
        self.builder.move_to(x * self.scale, -y * self.scale);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.builder.line_to(x * self.scale, -y * self.scale);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.builder.quad_to(
            x1 * self.scale,
            -y1 * self.scale,
            x * self.scale,
            -y * self.scale,
        );
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.builder.cubic_to(
            x1 * self.scale,
            -y1 * self.scale,
            x2 * self.scale,
            -y2 * self.scale,
            x * self.scale,
            -y * self.scale,
        );
    }

    fn close(&mut self) {
        self.builder.close();
    }
}

/// Convert a glyph outline to a tiny-skia Path, scaled to font_size pixels.
fn glyph_outline_to_path(
    face: &ttf_parser::Face<'_>,
    glyph_id: GlyphId,
    scale: f32,
) -> Option<tiny_skia::Path> {
    let mut adapter = OutlineAdapter::new(scale);
    face.outline_glyph(glyph_id, &mut adapter)?;
    adapter.finish()
}

/// Render shaped text onto the canvas at (x, y) baseline position (CSS pixels).
///
/// Uses rustybuzz for shaping and ttf-parser for glyph outlines, rendering
/// each glyph as a filled path on the canvas.
pub fn render_text(
    canvas: &mut SheetCanvas,
    face: &Face<'_>,
    ttf_face: &ttf_parser::Face<'_>,
    run: TextRun<'_>,
) {
    if run.text.is_empty() {
        return;
    }
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return;
    }
    let scale = run.font_size / upem;
    let dpr = canvas.dpr();

    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(run.text);
    let output = rustybuzz::shape(face, &[], buffer);

    let positions = output.glyph_positions();
    let infos = output.glyph_infos();
    let mut cursor_x = run.x;

    for (info, pos) in infos.iter().zip(positions.iter()) {
        let glyph_id = GlyphId(info.glyph_id as u16);
        if let Some(path) = glyph_outline_to_path(ttf_face, glyph_id, scale * dpr) {
            let tx = (cursor_x + pos.x_offset as f32 * scale) * dpr;
            let ty = (run.y - pos.y_offset as f32 * scale) * dpr;
            canvas.fill_path_raw(&path, tx, ty, run.color);
        }
        cursor_x += pos.x_advance as f32 * scale;
    }
}

/// Measure the total advance width of shaped text in CSS pixels.
pub fn measure_text_advance(face: &Face<'_>, font_size: f32, text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return 0.0;
    }
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    let output = rustybuzz::shape(face, &[], buffer);
    let total: i32 = output.glyph_positions().iter().map(|p| p.x_advance).sum();
    total as f32 * font_size / upem
}

/// Get the ascender in CSS pixels for a font face at the given size.
pub fn ascender_px(face: &Face<'_>, font_size: f32) -> f32 {
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return font_size;
    }
    face.ascender() as f32 * font_size / upem
}

/// Get the line height (ascender - descender + line_gap) in CSS pixels.
pub fn line_height_px(face: &Face<'_>, font_size: f32) -> f32 {
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return font_size * 1.2;
    }
    let asc = face.ascender() as f32;
    let desc = face.descender() as f32; // negative
    let gap = face.line_gap() as f32;
    (asc - desc + gap) * font_size / upem
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;

    #[test]
    fn measure_empty_string() {
        let db = shared_font_db();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        assert_eq!(measure_text_advance(&face, 11.0, ""), 0.0);
    }

    #[test]
    fn measure_advance_cross_check() {
        // measure_text_advance and compute_text_measurement::measure_text_width
        // use the same rustybuzz shaping — they must return identical values.
        let db = shared_font_db();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        for text in &["Hello World", "12345.67", "MMMM", "iiiii"] {
            for &size in &[8.0, 11.0, 14.0, 24.0] {
                let ours = measure_text_advance(&face, size, text);
                let theirs = compute_text_measurement::measure_text_width(&face, size, text);
                assert!(
                    (ours - theirs).abs() < 0.001,
                    "advance mismatch for {text:?} at {size}pt: ours={ours}, theirs={theirs}"
                );
            }
        }
    }

    #[test]
    fn bold_wider_than_regular() {
        let db = shared_font_db();
        let (_, regular) = db.resolve_styled("Carlito", false, false).unwrap();
        let (_, bold) = db.resolve_styled("Carlito", true, false).unwrap();
        let r_face = regular.face().unwrap();
        let b_face = bold.face().unwrap();
        let text = "XXXXXXXXXX";
        let rw = measure_text_advance(&r_face, 11.0, text);
        let bw = measure_text_advance(&b_face, 11.0, text);
        assert!(bw > rw, "expected bold ({bw}) > regular ({rw})");
    }

    #[test]
    fn render_text_bounding_box() {
        let db = shared_font_db();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let buzz_face = entry.face().unwrap();
        let ttf_face = ttf_parser::Face::parse(entry.data(), entry.index()).unwrap();

        let font_size = 14.0;
        let text = "Hello";
        let x_origin = 5.0;
        let baseline_y = 20.0;
        let text_w = measure_text_advance(&buzz_face, font_size, text);

        let mut canvas = SheetCanvas::new(100, 30, 1.0);
        render_text(
            &mut canvas,
            &buzz_face,
            &ttf_face,
            TextRun {
                font_size,
                text,
                x: x_origin,
                y: baseline_y,
                color: Color::from_rgba8(0, 0, 0, 255),
            },
        );

        // Find actual rendered bounds
        let (left, right) = find_text_horizontal_bounds(&canvas, 0, 30, 0, 100, 200)
            .expect("text should produce dark pixels");

        // Text should start near x_origin (5)
        assert!(
            (4..=8).contains(&left),
            "text left edge at {left}, expected near {x_origin}"
        );

        // Rendered width should match measured advance ±3px
        let rendered_w = (right - left + 1) as f32;
        assert!(
            (rendered_w - text_w).abs() < 4.0,
            "rendered width {rendered_w} vs measured {text_w}"
        );

        // No dark pixels before the text
        assert_rect_white(&canvas, 0, 0, 3, 30, "no pixels before text origin");
    }

    #[test]
    fn render_text_baseline_position() {
        let db = shared_font_db();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let buzz_face = entry.face().unwrap();
        let ttf_face = ttf_parser::Face::parse(entry.data(), entry.index()).unwrap();

        let baseline_y = 25.0;
        let mut canvas = SheetCanvas::new(80, 40, 1.0);
        render_text(
            &mut canvas,
            &buzz_face,
            &ttf_face,
            TextRun {
                font_size: 14.0,
                text: "Hg", // 'g' has descender, 'H' has ascender
                x: 5.0,
                y: baseline_y,
                color: Color::from_rgba8(0, 0, 0, 255),
            },
        );

        let (top, bottom) = find_text_vertical_bounds(&canvas, 0, 40, 0, 80, 200)
            .expect("text should have dark pixels");

        // Ascender should be above baseline
        assert!(
            top < baseline_y as u32,
            "top of text ({top}) should be above baseline ({baseline_y})"
        );
        // Descender ('g') should extend below baseline
        assert!(
            bottom >= baseline_y as u32,
            "bottom of text ({bottom}) should be at or below baseline ({baseline_y})"
        );
        // Nothing far above the text (top of canvas should be white)
        assert_rect_white(&canvas, 0, 0, 80, top.saturating_sub(1), "above text");
    }

    #[test]
    fn ascender_and_line_height_positive() {
        let db = shared_font_db();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        let asc = ascender_px(&face, 11.0);
        let lh = line_height_px(&face, 11.0);
        assert!(asc > 0.0);
        assert!(lh > asc, "line_height should be > ascender");
    }
}
