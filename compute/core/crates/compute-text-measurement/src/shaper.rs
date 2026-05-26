use rustybuzz::{Face, UnicodeBuffer, shape};

/// Measure the width of `text` in pixels when rendered at `font_size` using `face`.
///
/// This uses HarfBuzz-level shaping via rustybuzz, so it handles:
/// - Ligatures (fi, fl, ffi)
/// - Kerning (AV, To, etc.)
/// - Complex scripts (Arabic, Devanagari, Thai)
/// - CJK full-width glyphs
pub fn measure_text_width(face: &Face<'_>, font_size: f32, text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return 0.0;
    }
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    let output = shape(face, &[], buffer);
    let total: i32 = output.glyph_positions().iter().map(|p| p.x_advance).sum();
    total as f32 * font_size / upem
}

/// Measure the height of a single line of text (ascent + descent + line gap).
/// Returns the line height in pixels at the given font size.
pub fn measure_line_height(face: &Face<'_>, font_size: f32) -> f32 {
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return font_size * 1.2; // fallback
    }
    let ascender = face.ascender() as f32;
    let descender = face.descender() as f32; // negative
    let line_gap = face.line_gap() as f32;
    (ascender - descender + line_gap) * font_size / upem
}
